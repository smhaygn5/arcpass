import assert from "node:assert/strict";
import test from "node:test";
import { invoiceLifecycle } from "./invoice-lifecycle.ts";
import type { SavedInvoice } from "./invoices.ts";

const invoice: SavedInvoice = {
  invoice: {
    amount: "12.50", createdAt: "2026-08-01T10:00:00.000Z", description: "Design audit", expiresAt: "2026-08-02T10:00:00.000Z", invoiceId: "inv_test", merchant: { businessName: "Northstar", createdAt: "2026-08-01T10:00:00.000Z", domain: "northstar.example", passportId: "pass_test", refundPolicy: "merchant-refund" as const, status: "verified" as const, walletAddress: "0x0000000000000000000000000000000000000001" }, token: "USDC" as const, version: 1 as const,
  }, link: "https://arcpass.example/pay/test", payload: "test",
};

test("invoice lifecycle ends with a verified payment when a receipt exists", () => {
  const events = invoiceLifecycle(invoice, [{ amount: "12.50", blockNumber: "1", description: "Design audit", explorerUrl: "https://example.com", invoiceId: "inv_test", link: invoice.link, merchant: invoice.invoice.merchant.walletAddress, paidAt: "2026-08-01T11:00:00.000Z", payer: "0x0000000000000000000000000000000000000002", status: "verified", token: "USDC", txHash: `0x${"1".repeat(64)}` }]);
  assert.equal(events[0].status, "verified");
  assert.equal(events[1].status, "created");
});

test("invoice lifecycle marks an unpaid link as expired after its deadline", () => {
  const events = invoiceLifecycle(invoice, [], new Date("2026-08-03T10:00:00.000Z"));
  assert.equal(events[0].status, "expired");
});
