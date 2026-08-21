import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_MERCHANT_PASSPORT, createInvoice } from "./arcpass.ts";
import { collectionReminders } from "./collection-reminders.ts";
import { createSavedInvoice } from "./invoices.ts";
import type { SavedReceipt } from "./receipts.ts";

function savedInvoice(expiresAt: string) {
  const invoice = createInvoice({ amount: "25", description: "Reminder test", expiresAt: "2030-01-01T12:00:00.000Z", merchant: { ...EMPTY_MERCHANT_PASSPORT, businessName: "Demo Studio" }, token: "USDC" });
  invoice.createdAt = "2026-08-15T12:00:00.000Z";
  invoice.expiresAt = expiresAt;
  return createSavedInvoice({ invoice, origin: "https://arcpass.example" });
}

test("prioritizes expired and near-expiry invoices", () => {
  const now = new Date("2026-08-21T12:00:00.000Z");
  const reminders = collectionReminders([savedInvoice("2026-08-20T12:00:00.000Z"), savedInvoice("2026-08-22T06:00:00.000Z"), savedInvoice("2026-08-23T12:00:00.000Z")], [], now);
  assert.deepEqual(reminders.map((item) => item.kind), ["expired", "due-today", "due-soon"]);
  assert.doesNotMatch(reminders[0].message, /https:\/\//);
  assert.match(reminders[1].message, /Complete payment here/);
});

test("does not remind for a verified invoice", () => {
  const invoice = savedInvoice("2026-08-22T06:00:00.000Z");
  const receipt: SavedReceipt = { amount: "25", blockNumber: "1", description: "Reminder test", explorerUrl: "https://example.com", invoiceId: invoice.invoice.invoiceId, link: invoice.link, merchant: "0x0000000000000000000000000000000000000000", paidAt: "2026-08-21T10:00:00.000Z", payer: "0x1111111111111111111111111111111111111111", status: "verified", token: "USDC", txHash: `0x${"a".repeat(64)}` };
  assert.equal(collectionReminders([invoice], [receipt], new Date("2026-08-21T12:00:00.000Z")).length, 0);
});
