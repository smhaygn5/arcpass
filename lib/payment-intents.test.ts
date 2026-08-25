import assert from "node:assert/strict";
import test from "node:test";
import type { ArcPassInvoice, ArcPassTokenSymbol } from "./arcpass.ts";
import type { SavedInvoice } from "./invoices.ts";
import {
  arcPassPaymentIntentId,
  buildPaymentIntents,
  filterPaymentIntents,
  summarizePaymentIntents,
} from "./payment-intents.ts";
import type { SavedReceipt } from "./receipts.ts";

const merchant = {
  businessName: "Intent Studio",
  createdAt: "2026-08-01T00:00:00.000Z",
  domain: "intent.example",
  passportId: "pass_intent",
  refundPolicy: "merchant-refund" as const,
  status: "verified" as const,
  walletAddress: "0x1111111111111111111111111111111111111111" as const,
};
const now = new Date("2026-08-25T12:00:00.000Z");

test("derives awaiting, attention and expired states from real invoice deadlines", () => {
  const intents = buildPaymentIntents([
    savedInvoice("inv_waiting", "2026-08-28T12:00:00.000Z"),
    savedInvoice("inv_attention", "2026-08-26T08:00:00.000Z"),
    savedInvoice("inv_expired", "2026-08-24T12:00:00.000Z"),
  ], [], now);

  assert.equal(intents.find((item) => item.invoiceId === "inv_waiting")?.state, "awaiting");
  assert.equal(intents.find((item) => item.invoiceId === "inv_attention")?.state, "attention");
  assert.equal(intents.find((item) => item.invoiceId === "inv_expired")?.state, "expired");
  assert.equal(intents[0]?.invoiceId, "inv_attention");
});

test("a matching verified receipt settles an expired invoice without inferring payer data", () => {
  const invoice = savedInvoice("inv_settled", "2026-08-20T12:00:00.000Z");
  const receipt = savedReceipt(invoice.invoice, "2026-08-19T10:00:00.000Z");
  const [settled] = buildPaymentIntents([invoice], [receipt], now);
  const [unpaid] = buildPaymentIntents([savedInvoice("inv_private", "2026-08-30T12:00:00.000Z")], [], now);

  assert.equal(settled.state, "settled");
  assert.equal(settled.payer, receipt.payer);
  assert.equal(settled.txHash, receipt.txHash);
  assert.equal(unpaid.payer, null);
  assert.equal(unpaid.txHash, null);
});

test("keeps USDC cross-chain capable while EURC remains Arc direct", () => {
  const intents = buildPaymentIntents([
    savedInvoice("inv_usdc", "2026-08-30T12:00:00.000Z", "USDC"),
    savedInvoice("inv_eurc", "2026-08-30T12:00:00.000Z", "EURC"),
  ], [], now);

  assert.equal(intents.find((item) => item.invoiceId === "inv_usdc")?.route, "arc-or-cctp");
  assert.equal(intents.find((item) => item.invoiceId === "inv_eurc")?.route, "arc-direct");
});

test("summarizes and filters the intent queue with stable ArcPass identifiers", () => {
  const invoices = [
    savedInvoice("inv_waiting", "2026-08-28T12:00:00.000Z"),
    savedInvoice("inv_attention", "2026-08-26T08:00:00.000Z"),
    savedInvoice("inv_expired", "2026-08-24T12:00:00.000Z"),
  ];
  const intents = buildPaymentIntents(invoices, [savedReceipt(invoices[0].invoice, "2026-08-25T10:00:00.000Z")], now);
  const summary = summarizePaymentIntents(intents);

  assert.equal(summary.total, 3);
  assert.equal(summary.settled, 1);
  assert.equal(summary.needsAction, 2);
  assert.equal(summary.settlementRate, 33);
  assert.equal(filterPaymentIntents(intents, "needs-action", "").length, 2);
  assert.equal(filterPaymentIntents(intents, "all", "expired").length, 1);
  assert.equal(arcPassPaymentIntentId("inv_ab-cd"), "apt_ab-cd");
});

function savedInvoice(invoiceId: string, expiresAt: string, token: ArcPassTokenSymbol = "USDC"): SavedInvoice {
  return {
    invoice: {
      amount: invoiceId.includes("expired") ? "7" : "5",
      createdAt: "2026-08-20T09:00:00.000Z",
      description: `${invoiceId} project`,
      expiresAt,
      invoiceId,
      merchant,
      token,
      version: 1,
    },
    link: `https://arcpass.example/pay/${invoiceId}`,
    payload: invoiceId,
  };
}

function savedReceipt(invoice: ArcPassInvoice, paidAt: string): SavedReceipt {
  return {
    amount: invoice.amount,
    blockNumber: "12345",
    description: invoice.description,
    explorerUrl: "https://testnet.arcscan.app/tx/0x2222222222222222222222222222222222222222222222222222222222222222",
    invoiceId: invoice.invoiceId,
    link: `https://arcpass.example/pay/${invoice.invoiceId}`,
    merchant: invoice.merchant.walletAddress,
    paidAt,
    payer: "0x3333333333333333333333333333333333333333",
    status: "verified",
    token: invoice.token,
    txHash: "0x2222222222222222222222222222222222222222222222222222222222222222",
  };
}
