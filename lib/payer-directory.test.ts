import assert from "node:assert/strict";
import test from "node:test";
import type { Address } from "viem";
import { buildPayerDirectory } from "./payer-directory.ts";

const PAYER_A = "0xabcdefabcdefabcdefabcdefabcdefabcdefabcd" as Address;
const PAYER_A_UPPER = "0xABCDEFABCDEFABCDEFABCDEFABCDEFABCDEFABCD" as Address;
const PAYER_B = "0x1111111111111111111111111111111111111111" as Address;

test("groups verified payments by payer wallet without mixing settlement tokens", () => {
  const directory = buildPayerDirectory([
    { amount: "12.5", paidAt: "2026-08-20T12:00:00.000Z", payer: PAYER_A, token: "USDC" },
    { amount: "7", paidAt: "2026-08-21T12:00:00.000Z", payer: PAYER_A_UPPER, token: "EURC" },
    { amount: "2.5", paidAt: "2026-08-22T12:00:00.000Z", payer: PAYER_A, token: "USDC" },
  ]);

  assert.equal(directory.length, 1);
  assert.equal(directory[0].paymentCount, 3);
  assert.equal(directory[0].totals.USDC, 15);
  assert.equal(directory[0].totals.EURC, 7);
  assert.equal(directory[0].firstPaid, "2026-08-20T12:00:00.000Z");
  assert.equal(directory[0].lastPaid, "2026-08-22T12:00:00.000Z");
});

test("orders payer wallets by their most recent verified payment", () => {
  const directory = buildPayerDirectory([
    { amount: "5", paidAt: "2026-08-20T12:00:00.000Z", payer: PAYER_A, token: "USDC" },
    { amount: "3", paidAt: "2026-08-23T12:00:00.000Z", payer: PAYER_B, token: "EURC" },
    { amount: "invalid", paidAt: "2026-08-24T12:00:00.000Z", payer: PAYER_A, token: "USDC" },
  ]);

  assert.deepEqual(directory.map((entry) => entry.payer), [PAYER_B, PAYER_A]);
});

test("creates explainable new, returning and at-risk payer segments", () => {
  const now = new Date("2026-08-24T12:00:00.000Z");
  const newPayer = buildPayerDirectory([
    { amount: "5", paidAt: "2026-08-23T12:00:00.000Z", payer: PAYER_A, token: "USDC" },
  ], now)[0];
  const returningPayer = buildPayerDirectory([
    { amount: "5", paidAt: "2026-08-20T12:00:00.000Z", payer: PAYER_A, token: "USDC" },
    { amount: "9", paidAt: "2026-08-23T12:00:00.000Z", payer: PAYER_A, token: "USDC" },
  ], now)[0];
  const atRiskPayer = buildPayerDirectory([
    { amount: "5", paidAt: "2026-06-01T12:00:00.000Z", payer: PAYER_A, token: "EURC" },
    { amount: "7", paidAt: "2026-06-20T12:00:00.000Z", payer: PAYER_A, token: "EURC" },
  ], now)[0];

  assert.equal(newPayer.segment, "new");
  assert.equal(returningPayer.segment, "returning");
  assert.equal(atRiskPayer.segment, "at-risk");
  assert.equal(atRiskPayer.daysSinceLastPayment, 65);
});

test("calculates a preferred settlement token and average payment per token", () => {
  const entry = buildPayerDirectory([
    { amount: "10", paidAt: "2026-08-20T12:00:00.000Z", payer: PAYER_A, token: "USDC" },
    { amount: "20", paidAt: "2026-08-21T12:00:00.000Z", payer: PAYER_A, token: "USDC" },
    { amount: "100", paidAt: "2026-08-22T12:00:00.000Z", payer: PAYER_A, token: "EURC" },
  ], new Date("2026-08-24T12:00:00.000Z"))[0];

  assert.equal(entry.preferredToken, "USDC");
  assert.equal(entry.averages.USDC, 15);
  assert.equal(entry.averages.EURC, 100);
  assert.equal(entry.relationshipDays, 3);
});
