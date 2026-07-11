import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAddress, isAddress } from "viem";
import type { ArcPassInvoice } from "./arcpass.ts";
import type { SavedReceipt, VerifiedReceiptPayload } from "./receipts.ts";
import { isSavedReceipt, mergeSavedReceipts } from "./receipts.ts";
import { databaseConfigured, getDatabase } from "./server-database.ts";

const MAX_LEDGER_RECEIPTS = 200;
const DEFAULT_LEDGER_PATH = join(process.cwd(), ".arcpass-data", "receipts.json");

type ReceiptRow = { receipt: unknown };

let ledgerQueue = Promise.resolve();

export class ReceiptAssignmentConflictError extends Error {
  constructor() {
    super("This transaction hash or invoice is already assigned to another receipt.");
    this.name = "ReceiptAssignmentConflictError";
  }
}

export async function loadServerReceipts({
  limit = 50,
  merchant,
}: {
  limit?: number;
  merchant?: string;
} = {}) {
  if (databaseConfigured()) {
    return loadDatabaseReceipts({ limit, merchant });
  }

  const normalizedMerchant = merchant && isAddress(merchant) ? getAddress(merchant) : null;
  const receipts = await readFileLedger();
  const filtered = normalizedMerchant
    ? receipts.filter((receipt) => isAddress(receipt.merchant) && getAddress(receipt.merchant) === normalizedMerchant)
    : receipts;

  return filtered
    .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime())
    .slice(0, safeLimit(limit));
}

export async function findServerReceiptByTxHash(txHash: string) {
  const normalizedHash = txHash.toLowerCase();

  if (databaseConfigured()) {
    const sql = getDatabase();
    const rows = await sql`
      select receipt
      from arcpass_receipts
      where lower(tx_hash) = ${normalizedHash}
      limit 1
    `;
    return rows[0] ? receiptFromRow(rows[0] as ReceiptRow) : null;
  }

  const receipts = await readFileLedger();
  return receipts.find((receipt) => receipt.txHash.toLowerCase() === normalizedHash) ?? null;
}

export async function saveServerReceipt({
  invoice,
  origin,
  payload,
  receipt,
}: {
  invoice: ArcPassInvoice;
  origin: string;
  payload: string;
  receipt: VerifiedReceiptPayload;
}) {
  const saved: SavedReceipt = {
    amount: receipt.amount,
    blockNumber: receipt.blockNumber,
    description: invoice.description,
    explorerUrl: receipt.explorerUrl,
    invoiceId: receipt.invoiceId,
    link: `${origin.replace(/\/$/, "")}/pay/${payload}`,
    merchant: receipt.merchant,
    paidAt: new Date().toISOString(),
    payer: receipt.payer,
    status: "verified",
    token: receipt.token,
    txHash: receipt.txHash,
  };

  if (databaseConfigured()) {
    return saveDatabaseReceipt(saved);
  }

  return withLedgerLock(async () => {
    const existing = await readFileLedger();
    const assignedReceipt = existing.find((item) => item.txHash.toLowerCase() === saved.txHash.toLowerCase());

    if (assignedReceipt) {
      if (assignedReceipt.invoiceId !== saved.invoiceId) {
        throw new ReceiptAssignmentConflictError();
      }
      return assignedReceipt;
    }

    const next = mergeSavedReceipts([[saved], existing], MAX_LEDGER_RECEIPTS);
    await writeFileLedger(next);
    return saved;
  });
}

async function loadDatabaseReceipts({ limit, merchant }: { limit: number; merchant?: string }) {
  const sql = getDatabase();
  const normalizedMerchant = merchant && isAddress(merchant) ? getAddress(merchant) : null;
  const boundedLimit = safeLimit(limit);
  const rows = normalizedMerchant
    ? await sql`
        select receipt
        from arcpass_receipts
        where lower(merchant) = lower(${normalizedMerchant})
        order by paid_at desc
        limit ${boundedLimit}
      `
    : await sql`
        select receipt
        from arcpass_receipts
        order by paid_at desc
        limit ${boundedLimit}
      `;

  return Array.from(rows)
    .map((row) => receiptFromRow(row as ReceiptRow))
    .filter((receipt): receipt is SavedReceipt => Boolean(receipt));
}

async function saveDatabaseReceipt(saved: SavedReceipt) {
  const sql = getDatabase();

  try {
    return await sql.begin(async (transaction) => {
      const assignedRows = await transaction`
        select receipt
        from arcpass_receipts
        where lower(tx_hash) = lower(${saved.txHash})
           or invoice_id = ${saved.invoiceId}
        for update
      `;
      const assigned = assignedRows[0] ? receiptFromRow(assignedRows[0] as ReceiptRow) : null;

      if (assigned) {
        if (assigned.txHash.toLowerCase() !== saved.txHash.toLowerCase() || assigned.invoiceId !== saved.invoiceId) {
          throw new ReceiptAssignmentConflictError();
        }
        return assigned;
      }

      const rows = await transaction`
        insert into arcpass_receipts (tx_hash, invoice_id, merchant, receipt, paid_at)
        values (
          ${saved.txHash.toLowerCase()},
          ${saved.invoiceId},
          ${saved.merchant},
          ${transaction.json(saved)},
          ${saved.paidAt}
        )
        returning receipt
      `;
      const stored = rows[0] ? receiptFromRow(rows[0] as ReceiptRow) : null;
      if (!stored) throw new Error("Verified receipt could not be stored.");
      return stored;
    });
  } catch (err) {
    if (isUniqueViolation(err)) throw new ReceiptAssignmentConflictError();
    throw err;
  }
}

function receiptFromRow(row: ReceiptRow) {
  return isSavedReceipt(row.receipt) ? row.receipt : null;
}

async function readFileLedger() {
  try {
    const raw = await readFile(ledgerPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isSavedReceipt) : [];
  } catch (err) {
    if (isMissingFileError(err)) return [];
    throw err;
  }
}

async function writeFileLedger(receipts: SavedReceipt[]) {
  const filePath = ledgerPath();
  const tempPath = `${filePath}.${Date.now()}.tmp`;

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(receipts, null, 2)}\n`, "utf8");
  await rename(tempPath, filePath);
}

async function withLedgerLock<T>(work: () => Promise<T>) {
  const previous = ledgerQueue;
  let release = () => {};
  ledgerQueue = new Promise<void>((resolve) => {
    release = resolve;
  });

  await previous;
  try {
    return await work();
  } finally {
    release();
  }
}

function safeLimit(limit: number) {
  return Math.min(Math.max(limit, 1), 100);
}

function isUniqueViolation(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "23505";
}

function ledgerPath() {
  return process.env.ARCPASS_LEDGER_PATH?.trim() || DEFAULT_LEDGER_PATH;
}

function isMissingFileError(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}