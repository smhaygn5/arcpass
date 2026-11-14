import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_MERCHANT_PASSPORT, createInvoice } from "./arcpass.ts";
import { paymentVerificationMessage } from "./payment-verification.ts";

const payer = "0x2222222222222222222222222222222222222222" as const;
const txHash = `0x${"a".repeat(64)}` as const;
const invoice = createInvoice({
  amount: "7.25",
  description: "Payment claim test",
  expiresAt: "2030-01-01T12:00:00.000Z",
  merchant: { ...EMPTY_MERCHANT_PASSPORT, walletAddress: "0x1111111111111111111111111111111111111111" },
  token: "USDC",
});

test("binds a receipt verification claim to one invoice, payer and transaction", () => {
  const message = paymentVerificationMessage({ invoice, payer, txHash });
  assert.match(message, new RegExp(`Invoice: ${invoice.invoiceId}`));
  assert.match(message, /Payer: 0x2222/);
  assert.match(message, /Transaction: 0xaaaa/);
  assert.match(message, /Amount: 7\.25 USDC/);
});
