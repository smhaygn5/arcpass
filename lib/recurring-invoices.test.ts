import assert from "node:assert/strict";
import test from "node:test";
import { createInvoice, decodeInvoicePayload, EMPTY_MERCHANT_PASSPORT, type InvoiceRecurring } from "./arcpass.ts";
import { createSavedInvoice, type SavedInvoice } from "./invoices.ts";
import {
  buildRecurringPreview,
  buildRecurringSchedules,
  nextRecurringDueAt,
  recurringCycleDescription,
  recurringSeriesTotal,
} from "./recurring-invoices.ts";
import type { SavedReceipt } from "./receipts.ts";

test("keeps a monthly billing anchor through short months", () => {
  const preview = buildRecurringPreview({ amount: "12.50", cadence: "monthly", cycleCount: 3, firstDueAt: "2030-01-31T12:00:00.000Z", token: "USDC" });
  assert.deepEqual(preview.map((cycle) => cycle.dueAt), [
    "2030-01-31T12:00:00.000Z",
    "2030-02-28T12:00:00.000Z",
    "2030-03-31T12:00:00.000Z",
  ]);
  assert.equal(nextRecurringDueAt(preview[1].dueAt, "monthly", new Date("2030-02-01T00:00:00.000Z"), 31), "2030-03-31T12:00:00.000Z");
});

test("calculates the exact recurring series value", () => {
  assert.equal(recurringSeriesTotal("3.333333", 3, "USDC"), "9.999999");
  assert.throws(() => buildRecurringPreview({ amount: "1.0000001", cadence: "monthly", cycleCount: 3, firstDueAt: "2030-01-01T00:00:00.000Z", token: "USDC" }));
});

test("makes the next cycle ready only after the current receipt is verified", () => {
  const first = recurringInvoice(1, 3, "2030-01-31T12:00:00.000Z");
  assert.deepEqual(decodeInvoicePayload(first.payload)?.recurring, first.invoice.recurring);
  const scheduled = buildRecurringSchedules([first], [], new Date("2030-01-15T00:00:00.000Z"))[0];
  const ready = buildRecurringSchedules([first], [receiptFor(first, "1")], new Date("2030-01-15T00:00:00.000Z"))[0];

  assert.equal(scheduled.status, "scheduled");
  assert.equal(scheduled.canIssueNext, false);
  assert.equal(ready.status, "ready");
  assert.equal(ready.canIssueNext, true);
  assert.equal(ready.nextCycleNumber, 2);
  assert.equal(ready.nextDueAt, "2030-02-28T12:00:00.000Z");
});

test("flags missed cycles and completes only after every cycle has a receipt", () => {
  const first = recurringInvoice(1, 2, "2030-01-31T12:00:00.000Z");
  const second = recurringInvoice(2, 2, "2030-02-28T12:00:00.000Z");
  const attention = buildRecurringSchedules([first], [], new Date("2030-02-01T00:00:00.000Z"))[0];
  const completed = buildRecurringSchedules([first, second], [receiptFor(first, "2"), receiptFor(second, "3")], new Date("2030-03-01T00:00:00.000Z"))[0];

  assert.equal(attention.status, "attention");
  assert.equal(attention.canIssueNext, true);
  assert.equal(completed.status, "completed");
  assert.equal(completed.paidCount, 2);
  assert.equal(completed.verifiedValue, "10");
});

test("ignores corrupted or non-contiguous recurring series", () => {
  const first = recurringInvoice(1, 3, "2030-01-31T12:00:00.000Z");
  const third = recurringInvoice(3, 3, "2030-03-31T12:00:00.000Z");
  const corrupted = { ...first, invoice: { ...first.invoice, recurring: { ...first.invoice.recurring!, scheduleId: "bad" } } };

  assert.equal(buildRecurringSchedules([first, third], []).at(0)?.issuedCount, 1);
  assert.deepEqual(buildRecurringSchedules([corrupted], []), []);
});

function recurringInvoice(cycleNumber: number, cycleCount: number, expiresAt: string): SavedInvoice {
  const recurring: InvoiceRecurring = {
    anchorDay: 31,
    cadence: "monthly",
    cycleCount,
    cycleNumber,
    scheduleId: "schedule_retainer",
    seriesTitle: "Design retainer",
  };
  return createSavedInvoice({
    invoice: createInvoice({
      amount: "5",
      description: recurringCycleDescription(recurring.seriesTitle, cycleNumber, cycleCount),
      expiresAt,
      merchant: { ...EMPTY_MERCHANT_PASSPORT, walletAddress: "0x0000000000000000000000000000000000000001" },
      recurring,
      token: "USDC",
    }),
    origin: "https://arcpass.example",
  });
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
