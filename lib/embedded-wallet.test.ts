import assert from "node:assert/strict";
import test from "node:test";
import {
  circleErrorDetails,
  normalizeCircleDeviceId,
  normalizeCircleWallets,
  normalizeEmbeddedEmail,
} from "./embedded-wallet.ts";

test("normalizes embedded wallet email addresses", () => {
  assert.equal(normalizeEmbeddedEmail("  Merchant@Example.COM "), "merchant@example.com");
  assert.throws(() => normalizeEmbeddedEmail("merchant@example"), /valid email/);
  assert.throws(() => normalizeEmbeddedEmail("merchant@example.com\nBCC:evil@example.com"), /valid email/);
});

test("validates Circle device identifiers", () => {
  assert.equal(normalizeCircleDeviceId("device_id-1234"), "device_id-1234");
  assert.throws(() => normalizeCircleDeviceId("short"), /device/);
});

test("keeps unique Arc Testnet wallets and checksums their addresses", () => {
  const wallets = normalizeCircleWallets({ data: { wallets: [
    { id: "wallet_arc_123", address: "0x1111111111111111111111111111111111111111", blockchain: "ARC-TESTNET", accountType: "EOA", state: "LIVE" },
    { id: "wallet_arc_123", address: "0x1111111111111111111111111111111111111111", blockchain: "ARC-TESTNET" },
    { id: "wallet_eth_123", address: "0x2222222222222222222222222222222222222222", blockchain: "ETH-SEPOLIA" },
    { id: "wallet_bad_123", address: "not-an-address", blockchain: "ARC-TESTNET" },
  ] } });

  assert.equal(wallets.length, 1);
  assert.equal(wallets[0]?.address, "0x1111111111111111111111111111111111111111");
  assert.equal(wallets[0]?.blockchain, "ARC-TESTNET");
});

test("sanitizes Circle errors before returning them to the client", () => {
  assert.deepEqual(circleErrorDetails({ code: "155106", message: "Already initialized\ninternal detail" }), {
    code: 155106,
    message: "Already initialized internal detail",
  });
  assert.equal(circleErrorDetails(null).message, "Circle could not complete the wallet request.");
});
