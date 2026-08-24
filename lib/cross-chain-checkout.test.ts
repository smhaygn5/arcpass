import assert from "node:assert/strict";
import test from "node:test";
import { parseUnits } from "viem";
import {
  CROSS_CHAIN_SOURCES,
  crossChainCheckoutSupported,
  crossChainFundingAmount,
  crossChainPreflight,
} from "./cross-chain-checkout.ts";

test("adds a bounded Arc gas reserve without changing invoice precision", () => {
  assert.equal(crossChainFundingAmount("12.345678"), "12.445678");
  assert.equal(crossChainFundingAmount("2"), "2.1");
});

test("offers cross-chain funding only for Bridge Kit's supported invoice token", () => {
  assert.equal(crossChainCheckoutSupported("USDC"), true);
  assert.equal(crossChainCheckoutSupported("EURC"), false);
});

test("requires both source USDC and native gas before bridging", () => {
  const bridgeAmountRaw = parseUnits("5.1", 6);
  assert.deepEqual(crossChainPreflight({
    bridgeAmountRaw,
    sourceGasBalance: 2_000n,
    sourceGasRequired: 1_500n,
    sourceUsdcBalance: parseUnits("6", 6),
  }), { gasReady: true, tokenReady: true });
  assert.deepEqual(crossChainPreflight({
    bridgeAmountRaw,
    sourceGasBalance: 1_000n,
    sourceGasRequired: 1_500n,
    sourceUsdcBalance: parseUnits("5", 6),
  }), { gasReady: false, tokenReady: false });
});

test("keeps supported source networks unique and testnet-only", () => {
  const sources = Object.values(CROSS_CHAIN_SOURCES);
  assert.equal(new Set(sources.map((source) => source.chain.id)).size, sources.length);
  assert.equal(sources.every((source) => source.chain.testnet === true), true);
});
