import assert from "node:assert/strict";
import test from "node:test";
import { createInvoice, decodeInvoicePayload, EMPTY_MERCHANT_PASSPORT } from "./arcpass.ts";
import { createSavedInvoice, type SavedInvoice } from "./invoices.ts";
import { buildInstallmentPlans, buildInstallmentSchedule } from "./installments.ts";
import type { SavedReceipt } from "./receipts.ts";

test("splits a plan into exact stablecoin units without losing the remainder", () => {
  const schedule = buildInstallmentSchedule({
    cadence: "monthly",
    firstDueAt: "2030-01-31T12:00:00.000Z",
    installmentCount: 3,
    planId: "plan_exact",
    token: "USDC",
    totalAmount: "10",
  });

  assert.deepEqual(schedule.map((item) => item.amount), ["3.333334", "3.333333", "3.333333"]);
  assert.deepEqual(schedule.map((item) => item.dueAt), [
    "2030-01-31T12:00:00.000Z",
    "2030-02-28T12:00:00.000Z",
    "2030-03-31T12:00:00.000Z",
  ]);
});

test("rejects unsafe installment counts and totals smaller than base units", () => {
  assert.throws(() => buildInstallmentSchedule({ cadence: "weekly", firstDueAt: "2030-01-01T00:00:00.000Z", installmentCount: 1, token: "USDC", totalAmount: "5" }));
  assert.throws(() => buildInstallmentSchedule({ cadence: "weekly", firstDueAt: "2030-01-01T00:00:00.000Z", installmentCount: 3, token: "USDC", totalAmount: "0.000002" }));
});

test("summarizes verified installments without counting unmatched receipts", () => {
  const invoices = planInvoices();
  assert.deepEqual(decodeInvoicePayload(invoices[0].payload)?.installment, invoices[0].invoice.installment);
  const validReceipt = receiptFor(invoices[0], "1");
  const wrongAmount = { ...receiptFor(invoices[1], "2"), amount: "99" };
  const [plan] = buildInstallmentPlans(invoices, [validReceipt, wrongAmount], new Date("2030-01-15T00:00:00.000Z"));

  assert.equal(plan.paidCount, 1);
  assert.equal(plan.paidAmount, "3");
  assert.equal(plan.remainingAmount, "6");
  assert.equal(plan.progress, 33.33);
  assert.equal(plan.status, "in-progress");
  assert.equal(plan.nextInstallment?.installmentNumber, 2);
});

test("marks overdue and completed plans from independently verified invoice receipts", () => {
  const invoices = planInvoices();
  const overdue = buildInstallmentPlans(invoices, [], new Date("2030-02-02T00:00:00.000Z"))[0];
  const completed = buildInstallmentPlans(
    invoices,
    invoices.map((invoice, index) => receiptFor(invoice, String(index + 3))),
    new Date("2030-04-01T00:00:00.000Z"),
  )[0];

  assert.equal(overdue.status, "overdue");
  assert.equal(completed.status, "completed");
  assert.equal(completed.remainingAmount, "0");
  assert.equal(completed.progress, 100);
});

test("ignores corrupted local installment metadata instead of breaking the workspace", () => {
  const [invoice] = planInvoices();
  const corrupted = { ...invoice, invoice: { ...invoice.invoice, installment: { ...invoice.invoice.installment!, planTotal: "not-a-number" } } };
  assert.deepEqual(buildInstallmentPlans([corrupted], []), []);
});

function planInvoices(): SavedInvoice[] {
  const schedule = buildInstallmentSchedule({ cadence: "monthly", firstDueAt: "2030-02-01T00:00:00.000Z", installmentCount: 3, planId: "plan_summary", token: "USDC", totalAmount: "9" });
  return schedule.map((item) => createSavedInvoice({
    invoice: createInvoice({
      amount: item.amount,
      description: `Build phase · Installment ${item.installmentNumber}/${item.installmentCount}`,
      expiresAt: item.dueAt,
      installment: item,
      merchant: { ...EMPTY_MERCHANT_PASSPORT, walletAddress: "0x0000000000000000000000000000000000000001" },
      token: "USDC",
    }),
    origin: "https://arcpass.example",
  }));
}

function receiptFor(invoice: SavedInvoice, seed: string): SavedReceipt {
  return {
    amount: invoice.invoice.amount,
    blockNumber: seed,
    description: invoice.invoice.description,
    explorerUrl: `https://testnet.arcscan.app/tx/0x${seed.repeat(64).slice(0, 64)}`,
    invoiceId: invoice.invoice.invoiceId,
    link: invoice.link,
    merchant: invoice.invoice.merchant.walletAddress,
    paidAt: "2030-01-10T00:00:00.000Z",
    payer: "0x0000000000000000000000000000000000000002",
    status: "verified",
    token: invoice.invoice.token,
    txHash: `0x${seed.repeat(64).slice(0, 64)}`,
  };
}
