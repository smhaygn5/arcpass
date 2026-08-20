import assert from "node:assert/strict";
import test from "node:test";
import { isRefundRequest, normalizeRefundReason, refundRequestMessage } from "./refunds.ts";

const payer = "0x2222222222222222222222222222222222222222" as const;
const txHash = `0x${"a".repeat(64)}` as const;

test("locks the invoice, transaction, payer and reason into the refund signature", () => {
  const message = refundRequestMessage({ invoiceId: "inv_demo", payer, reason: "  Service was not delivered. ", txHash });
  assert.match(message, /Invoice: inv_demo/);
  assert.match(message, /Transaction: 0xaaaa/);
  assert.match(message, /Reason: Service was not delivered\./);
  assert.match(message, /does not authorize a token transfer/);
});

test("rejects vague refund reasons and validates stored requests", () => {
  assert.throws(() => normalizeRefundReason("too short"));
  assert.equal(isRefundRequest({}), false);
});
