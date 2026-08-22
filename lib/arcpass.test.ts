import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtemp, rmdir, unlink } from "node:fs/promises";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { ReceiptAssignmentConflictError, saveServerReceipt } from "./server-receipts.ts";
import { isPublicIpAddress, isSafePublicDomain } from "./server-domain-verification.ts";
import {
  createInvoice,
  createMerchantPassport,
  decodeInvoicePayload,
  encodeInvoicePayload,
  invoiceAmountRaw,
  invoiceHash,
  MAX_INVOICE_PAYLOAD_LENGTH,
  normalizeDomain,
  trustScore,
} from "./arcpass.ts";
import { createSavedInvoice, invoiceStatus, merchantPassportLink, mergeSavedInvoices } from "./invoices.ts";
import { extractInvoicePayload, mergeSavedReceipts, type SavedReceipt } from "./receipts.ts";
import { escapeCsvCell } from "./format.ts";

const walletAddress = "0x1111111111111111111111111111111111111111";

test("creates and decodes a verified invoice payload", () => {
  const merchant = createMerchantPassport({
    businessName: "Northstar AI Studio",
    domain: "https://www.northstar.example/pay",
    refundPolicy: "merchant-refund",
    status: "verified",
    walletAddress,
  });
  const invoice = createInvoice({
    amount: "12.50",
    branding: { accent: "violet", message: "Secure checkout for Northstar clients.", showMonogram: true },
    description: "AI research report",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    merchant,
    token: "USDC",
  });

  const encoded = encodeInvoicePayload(invoice);
  const decoded = decodeInvoicePayload(encoded);

  assert.equal(decoded?.amount, "12.50");
  assert.equal(decoded?.merchant.domain, "northstar.example");
  assert.equal(decoded?.branding?.accent, "violet");
  assert.equal(invoiceAmountRaw(invoice), 12_500_000n);
  assert.match(invoiceHash(invoice), /^0x[0-9a-f]{64}$/);
});

test("creates a shareable merchant passport link from an invoice", () => {
  const merchant = createMerchantPassport({ businessName: "Arc Merchant", domain: "merchant.example", refundPolicy: "merchant-refund", status: "verified", walletAddress });
  const invoice = createInvoice({ amount: "2", description: "Passport test", expiresAt: new Date(Date.now() + 60_000).toISOString(), merchant, token: "USDC" });
  const saved = createSavedInvoice({ invoice, origin: "https://arcpass.example" });
  assert.match(merchantPassportLink(saved), /^https:\/\/arcpass\.example\/passport\//);
});

test("scores merchant passport trust signals", () => {
  const merchant = createMerchantPassport({
    businessName: "Arc Merchant",
    domain: "merchant.example",
    refundPolicy: "escrow-window",
    status: "verified",
    walletAddress,
  });

  assert.equal(trustScore(merchant), 100);
});

test("normalizes domains without protocol or www", () => {
  assert.equal(normalizeDomain("https://www.arc.example/path"), "arc.example");
});

test("rejects tampered invoice payload", () => {
  assert.equal(decodeInvoicePayload("not-a-valid-payload"), null);
});

test("rejects oversized and expired invoice input", () => {
  assert.equal(decodeInvoicePayload("a".repeat(MAX_INVOICE_PAYLOAD_LENGTH + 1)), null);

  const merchant = createMerchantPassport({
    businessName: "Arc Merchant",
    domain: "merchant.example",
    refundPolicy: "merchant-refund",
    walletAddress,
  });

  assert.throws(() => createInvoice({
    amount: "5.00",
    description: "Expired invoice",
    expiresAt: new Date(Date.now() - 60_000).toISOString(),
    merchant,
    token: "USDC",
  }), /future/);
});

test("neutralizes spreadsheet formulas in CSV cells", () => {
  assert.equal(escapeCsvCell("=1+1"), "\"'=1+1\"");
  assert.equal(escapeCsvCell(" @SUM(A1:A2)"), "\"' @SUM(A1:A2)\"");
  assert.equal(escapeCsvCell("Normal value"), "\"Normal value\"");
});
test("extracts invoice payload from checkout links", () => {
  assert.equal(extractInvoicePayload("https://merchant.example/pay/abc_DEF-123?utm=test"), "abc_DEF-123");
  assert.equal(extractInvoicePayload("http://localhost:3000/pay/payload_hash#receipt"), "payload_hash");
  assert.equal(extractInvoicePayload("rawPayloadValue"), "rawPayloadValue");
});

test("merges saved receipts by transaction hash", () => {
  const firstHash = `0x${"1".repeat(64)}` as SavedReceipt["txHash"];
  const newerHash = `0x${"2".repeat(64)}` as SavedReceipt["txHash"];
  const first = createTestReceipt({
    paidAt: "2026-07-07T10:00:00.000Z",
    txHash: firstHash,
  });
  const newer = createTestReceipt({
    paidAt: "2026-07-07T11:00:00.000Z",
    txHash: newerHash,
  });
  const duplicate = createTestReceipt({
    paidAt: "2026-07-07T12:00:00.000Z",
    txHash: first.txHash,
  });

  const merged = mergeSavedReceipts([[first], [newer, duplicate]]);

  assert.equal(merged.length, 2);
  assert.equal(merged[0]?.txHash, newer.txHash);
  assert.equal(merged[1]?.txHash, first.txHash);
});

test("merges saved invoices by invoice id", () => {
  const merchant = createMerchantPassport({
    businessName: "Arc Merchant",
    domain: "merchant.example",
    refundPolicy: "merchant-refund",
    status: "verified",
    walletAddress,
  });
  const invoice = createInvoice({
    amount: "5.00",
    description: "Research brief",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    merchant,
    token: "USDC",
  });
  const saved = createSavedInvoice({ invoice, origin: "http://localhost:3000" });
  const duplicate = { ...saved, link: "http://localhost:3000/pay/duplicate" };

  const merged = mergeSavedInvoices([[saved], [duplicate]]);

  assert.equal(merged.length, 1);
  assert.equal(merged[0]?.link, saved.link);
});

test("marks invoices verified when a receipt exists", () => {
  const merchant = createMerchantPassport({
    businessName: "Arc Merchant",
    domain: "merchant.example",
    refundPolicy: "merchant-refund",
    status: "verified",
    walletAddress,
  });
  const invoice = createInvoice({
    amount: "5.00",
    description: "Research brief",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    merchant,
    token: "USDC",
  });
  const receipt = createTestReceipt({
    invoiceId: invoice.invoiceId,
    paidAt: "2026-07-07T10:00:00.000Z",
    txHash: `0x${"3".repeat(64)}` as SavedReceipt["txHash"],
  });

  assert.equal(invoiceStatus(invoice, [receipt]), "verified");
});

test("accepts only public merchant domain syntax", () => {
  assert.equal(isSafePublicDomain("merchant.example"), true);
  assert.equal(isSafePublicDomain("localhost"), false);
  assert.equal(isSafePublicDomain("merchant.internal"), false);
  assert.equal(isSafePublicDomain("127.0.0.1"), false);
});

test("rejects private and local domain resolution targets", () => {
  for (const address of [
    "0.0.0.0",
    "10.0.0.1",
    "127.0.0.1",
    "169.254.169.254",
    "172.16.0.1",
    "192.168.1.1",
    "::1",
    "fd00::1",
    "fe80::1",
    "::ffff:127.0.0.1",
  ]) {
    assert.equal(isPublicIpAddress(address), false, address);
  }

  assert.equal(isPublicIpAddress("1.1.1.1"), true);
  assert.equal(isPublicIpAddress("2606:4700:4700::1111"), true);
});

test("prevents one transaction from being assigned to multiple invoices", async () => {
  const ledgerDirectory = await mkdtemp(join(tmpdir(), "arcpass-receipts-"));
  const ledgerPath = join(ledgerDirectory, "receipts.json");
  const previousLedgerPath = process.env.ARCPASS_LEDGER_PATH;
  process.env.ARCPASS_LEDGER_PATH = ledgerPath;

  const merchant = createMerchantPassport({
    businessName: "Arc Merchant",
    domain: "merchant.example",
    refundPolicy: "merchant-refund",
    status: "verified",
    walletAddress,
  });
  const firstInvoice = createInvoice({
    amount: "5.00",
    description: "First invoice",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    merchant,
    token: "USDC",
  });
  const secondInvoice = createInvoice({
    amount: "5.00",
    description: "Second invoice",
    expiresAt: new Date(Date.now() + 60_000).toISOString(),
    merchant,
    token: "USDC",
  });
  const txHash = `0x${"4".repeat(64)}` as SavedReceipt["txHash"];
  const receipt = {
    amount: firstInvoice.amount,
    blockNumber: "50608930",
    explorerUrl: `https://testnet.arcscan.app/tx/${txHash}`,
    invoiceId: firstInvoice.invoiceId,
    merchant: merchant.walletAddress,
    payer: "0x3333333333333333333333333333333333333333" as `0x${string}`,
    token: firstInvoice.token,
    txHash,
    verified: true as const,
  };

  try {
    const saved = await saveServerReceipt({
      invoice: firstInvoice,
      origin: "http://localhost:3000",
      payload: "first-payload",
      receipt,
    });
    const repeated = await saveServerReceipt({
      invoice: firstInvoice,
      origin: "http://localhost:3000",
      payload: "first-payload",
      receipt,
    });

    assert.equal(repeated.invoiceId, saved.invoiceId);

    await assert.rejects(
      saveServerReceipt({
        invoice: secondInvoice,
        origin: "http://localhost:3000",
        payload: "second-payload",
        receipt: { ...receipt, invoiceId: secondInvoice.invoiceId },
      }),
      ReceiptAssignmentConflictError,
    );
  } finally {
    if (previousLedgerPath === undefined) {
      delete process.env.ARCPASS_LEDGER_PATH;
    } else {
      process.env.ARCPASS_LEDGER_PATH = previousLedgerPath;
    }
    await unlink(ledgerPath).catch(() => undefined);
    await rmdir(ledgerDirectory).catch(() => undefined);
  }
});

function createTestReceipt(input: Pick<SavedReceipt, "paidAt" | "txHash"> & Partial<Pick<SavedReceipt, "invoiceId">>): SavedReceipt {
  return {
    amount: "5.00",
    blockNumber: "50608929",
    description: "AI research report",
    explorerUrl: `https://testnet.arcscan.app/tx/${input.txHash}`,
    invoiceId: input.invoiceId ?? "inv_test",
    link: "http://localhost:3000/pay/test",
    merchant: "0x2222222222222222222222222222222222222222",
    paidAt: input.paidAt,
    payer: "0x3333333333333333333333333333333333333333",
    status: "verified",
    token: "USDC",
    txHash: input.txHash,
  };
}
