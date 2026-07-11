import { mkdir, readFile, rename, writeFile } from "node:fs/promises";
import { dirname, join } from "node:path";
import { getAddress, isAddress } from "viem";
import type { ArcPassInvoice } from "./arcpass.ts";
import { databaseConfigured, getDatabase } from "./server-database.ts";
import { createSavedInvoice, isSavedInvoice, merchantMatchesInvoice, mergeSavedInvoices, type SavedInvoice } from "./invoices.ts";

const MAX_LEDGER_INVOICES = 200;
const DEFAULT_LEDGER_PATH = join(process.cwd(), ".arcpass-data", "invoices.json");

type InvoiceRow = {
  invoice: unknown;
  link: string;
  payload: string;
};

let ledgerQueue = Promise.resolve();

export async function loadServerInvoices({
  limit = 50,
  merchant,
}: {
  limit?: number;
  merchant?: string;
} = {}) {
  if (databaseConfigured()) {
    return loadDatabaseInvoices({ limit, merchant });
  }

  const normalizedMerchant = merchant && isAddress(merchant) ? getAddress(merchant) : null;
  const invoices = await readFileLedger();
  const filtered = normalizedMerchant
    ? invoices.filter((invoice) => merchantMatchesInvoice(invoice, normalizedMerchant))
    : invoices;

  return filtered
    .sort((a, b) => new Date(b.invoice.createdAt).getTime() - new Date(a.invoice.createdAt).getTime())
    .slice(0, safeLimit(limit));
}

export async function findServerInvoiceByPayload({
  invoiceId,
  merchant,
  payload,
}: {
  invoiceId: string;
  merchant: string;
  payload: string;
}) {
  if (!isAddress(merchant)) return null;

  const normalizedMerchant = getAddress(merchant);

  if (databaseConfigured()) {
    const sql = getDatabase();
    const rows = await sql`
      select invoice, link, payload
      from arcpass_invoices
      where invoice_id = ${invoiceId}
        and payload = ${payload}
        and lower(merchant) = lower(${normalizedMerchant})
      limit 1
    `;
    return rows[0] ? invoiceFromRow(rows[0] as InvoiceRow) : null;
  }

  const invoices = await readFileLedger();
  return invoices.find((item) =>
    item.payload === payload &&
    item.invoice.invoiceId === invoiceId &&
    merchantMatchesInvoice(item, normalizedMerchant),
  ) ?? null;
}

export async function saveServerInvoice({
  invoice,
  origin,
}: {
  invoice: ArcPassInvoice;
  origin: string;
}) {
  const saved = createSavedInvoice({ invoice, origin });

  if (databaseConfigured()) {
    const sql = getDatabase();
    const rows = await sql`
      insert into arcpass_invoices (
        invoice_id, merchant, payload, link, invoice, created_at, expires_at
      ) values (
        ${invoice.invoiceId},
        ${invoice.merchant.walletAddress},
        ${saved.payload},
        ${saved.link},
        ${sql.json(invoice)},
        ${invoice.createdAt},
        ${invoice.expiresAt}
      )
      on conflict (invoice_id) do update
        set link = excluded.link
        where arcpass_invoices.payload = excluded.payload
          and lower(arcpass_invoices.merchant) = lower(excluded.merchant)
      returning invoice, link, payload
    `;
    const stored = rows[0] ? invoiceFromRow(rows[0] as InvoiceRow) : null;
    if (!stored) {
      throw new Error("Invoice id already exists with different content.");
    }
    return stored;
  }

  return withLedgerLock(async () => {
    const existing = await readFileLedger();
    const next = mergeSavedInvoices([[saved], existing], MAX_LEDGER_INVOICES);

    await writeFileLedger(next);
    return saved;
  });
}

async function loadDatabaseInvoices({ limit, merchant }: { limit: number; merchant?: string }) {
  const sql = getDatabase();
  const normalizedMerchant = merchant && isAddress(merchant) ? getAddress(merchant) : null;
  const boundedLimit = safeLimit(limit);
  const rows = normalizedMerchant
    ? await sql`
        select invoice, link, payload
        from arcpass_invoices
        where lower(merchant) = lower(${normalizedMerchant})
        order by created_at desc
        limit ${boundedLimit}
      `
    : await sql`
        select invoice, link, payload
        from arcpass_invoices
        order by created_at desc
        limit ${boundedLimit}
      `;

  return Array.from(rows)
    .map((row) => invoiceFromRow(row as InvoiceRow))
    .filter((invoice): invoice is SavedInvoice => Boolean(invoice));
}

function invoiceFromRow(row: InvoiceRow) {
  const invoice = {
    invoice: row.invoice as ArcPassInvoice,
    link: row.link,
    payload: row.payload,
  };
  return isSavedInvoice(invoice) ? invoice : null;
}

async function readFileLedger() {
  try {
    const raw = await readFile(ledgerPath(), "utf8");
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.filter(isSavedInvoice) : [];
  } catch (err) {
    if (isMissingFileError(err)) return [];
    throw err;
  }
}

async function writeFileLedger(invoices: SavedInvoice[]) {
  const filePath = ledgerPath();
  const tempPath = `${filePath}.${Date.now()}.tmp`;

  await mkdir(dirname(filePath), { recursive: true });
  await writeFile(tempPath, `${JSON.stringify(invoices, null, 2)}\n`, "utf8");
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

function ledgerPath() {
  return process.env.ARCPASS_INVOICE_LEDGER_PATH?.trim() || DEFAULT_LEDGER_PATH;
}

function isMissingFileError(err: unknown) {
  return typeof err === "object" && err !== null && "code" in err && err.code === "ENOENT";
}