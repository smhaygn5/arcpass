import assert from "node:assert/strict";
import test from "node:test";
import { createX402SettlementReceipt } from "./x402-receipt.ts";
import type { X402Access, X402ResourceSummary } from "./x402.ts";

test("creates a portable receipt from a verified x402 access", () => {
  const access: X402Access = {
    accessId: "xacc_1234567890abcdefghij",
    amount: "1234500",
    createdAt: "2030-01-01T12:00:00.000Z",
    merchant: "0x1111111111111111111111111111111111111111",
    network: "eip155:5042002",
    payer: "0x2222222222222222222222222222222222222222",
    resourceId: "xres_1234567890abcdefghij",
    transaction: "transfer_12345678",
  };
  const resource = { ...access, accessCount: 1, description: "Arc pricing API", price: "1.2345", responseBody: { ok: true }, settledAmount: "1.2345", status: "active", title: "Pricing API", updatedAt: access.createdAt } satisfies X402ResourceSummary;
  const receipt = createX402SettlementReceipt(access, resource);
  assert.equal(receipt.amountUsdc, "1.2345");
  assert.equal(receipt.resource.title, "Pricing API");
  assert.equal(receipt.receiptId, "x402rcpt_1234567890abcdefghij");
});
