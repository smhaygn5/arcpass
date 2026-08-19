import assert from "node:assert/strict";
import test from "node:test";
import { merchantRevenueInsights } from "./revenue-insights.ts";

test("groups recent revenue by settlement token without mixing currencies", () => {
  const insights = merchantRevenueInsights([
    { amount: "20", paidAt: "2026-08-19T12:00:00.000Z", payer: "0xA", token: "USDC" },
    { amount: "10", paidAt: "2026-08-18T12:00:00.000Z", payer: "0xB", token: "USDC" },
    { amount: "8", paidAt: "2026-08-17T12:00:00.000Z", payer: "0xA", token: "EURC" },
    { amount: "15", paidAt: "2026-08-10T12:00:00.000Z", payer: "0xC", token: "USDC" },
  ], new Date("2026-08-20T12:00:00.000Z"));
  assert.equal(insights.totalPayments, 3);
  assert.equal(insights.uniquePayers, 2);
  assert.equal(insights.tokens[0].total, 30);
  assert.equal(insights.tokens[0].previousTotal, 15);
  assert.equal(insights.tokens[1].total, 8);
});

test("keeps a new token's change unavailable instead of inventing a baseline", () => {
  const insights = merchantRevenueInsights([{ amount: "5", paidAt: "2026-08-20T11:00:00.000Z", payer: "0xA", token: "EURC" }], new Date("2026-08-20T12:00:00.000Z"));
  assert.equal(insights.tokens[1].changePercent, null);
  assert.equal(insights.tokens[1].dailyTotals.reduce((sum, value) => sum + value, 0), 5);
});
