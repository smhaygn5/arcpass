import assert from "node:assert/strict";
import test from "node:test";
import { EMPTY_MERCHANT_PASSPORT, createInvoice } from "./arcpass.ts";
import { isReceiptForInvoice, publicPaymentReceiptLink } from "./payment-receipt.ts";

const invoice = createInvoice({
  amount: "12.50",
  description: "Receipt test",
  expiresAt: "2030-01-01T12:00:00.000Z",
  merchant: { ...EMPTY_MERCHANT_PASSPORT, walletAddress: "0x1111111111111111111111111111111111111111" },
  token: "USDC",
});

test("creates an encoded public receipt path", () => {
  assert.equal(publicPaymentReceiptLink("a/b c"), "/receipt/a%2Fb%20c");
});

test("only accepts a verified receipt that matches its locked invoice", () => {
  const receipt = {
    amount: invoice.amount,
    blockNumber: "42",
    explorerUrl: "https://testnet.arcscan.app/tx/0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    invoiceId: invoice.invoiceId,
    merchant: invoice.merchant.walletAddress,
    paidAt: "2029-12-01T12:00:00.000Z",
    payer: "0x2222222222222222222222222222222222222222",
    token: invoice.token,
    txHash: "0xaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaaa",
    verified: true as const,
  };
  assert.equal(isReceiptForInvoice(receipt, invoice), true);
  assert.equal(isReceiptForInvoice({ ...receipt, amount: "13.00" }, invoice), false);
});
