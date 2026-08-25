import assert from "node:assert/strict";
import test from "node:test";
import { gatewayBalanceSources, summarizeUnifiedUsdcBalance, UNIFIED_USDC_CHAINS } from "./unified-usdc-balance.ts";

test("sums Gateway balances without losing six-decimal USDC precision", () => {
  const summary = summarizeUnifiedUsdcBalance({
    balances: [
      { balance: "1.000001", domain: 0 },
      { balance: "2.999999", domain: 6 },
      { balance: "0.25", domain: 26 },
    ],
    pendingDeposits: [],
    requiredAmount: "4.1",
  });

  assert.equal(summary.total, "4.25");
  assert.equal(summary.coversRequired, true);
  assert.equal(summary.shortfall, "0");
  assert.equal(summary.allocations.find((item) => item.domain === 0)?.amount, "1.000001");
});

test("reports the exact invoice shortfall and bounded coverage", () => {
  const summary = summarizeUnifiedUsdcBalance({
    balances: [{ balance: "2", domain: 26 }],
    pendingDeposits: [],
    requiredAmount: "2.1",
  });

  assert.equal(summary.coversRequired, false);
  assert.equal(summary.shortfall, "0.1");
  assert.equal(summary.coveragePercentage, 95.23);
});

test("counts only pending deposits and supported Gateway domains", () => {
  const summary = summarizeUnifiedUsdcBalance({
    balances: [
      { balance: "4", domain: 999 },
      { balance: "invalid", domain: 0 },
      { balance: "1", domain: 3 },
    ],
    pendingDeposits: [
      { amount: "0.5", domain: 3, status: "pending" },
      { amount: "10", domain: 999, status: "pending" },
      { amount: "2", domain: 6, status: "complete" },
    ],
    requiredAmount: "1",
  });

  assert.equal(summary.total, "1");
  assert.equal(summary.pending, "0.5");
  assert.equal(summary.allocations.length, UNIFIED_USDC_CHAINS.length);
});

test("builds one address-bound request source for every displayed chain", () => {
  const depositor = "0x1111111111111111111111111111111111111111";
  const sources = gatewayBalanceSources(depositor);

  assert.equal(sources.length, UNIFIED_USDC_CHAINS.length);
  assert.equal(new Set(sources.map((source) => source.domain)).size, sources.length);
  assert.equal(sources.every((source) => source.depositor === depositor), true);
});
