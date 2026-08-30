import assert from "node:assert/strict";
import test from "node:test";
import { normalizeX402Price, normalizeX402ResourceInput, x402Metrics, x402PriceToAtomic, type X402Access, type X402Resource } from "./x402.ts";

const merchant = "0x1111111111111111111111111111111111111111";

test("normalizes sub cent USDC prices into atomic units", () => {
  assert.equal(normalizeX402Price("0.010000"), "0.01");
  assert.equal(x402PriceToAtomic("0.000001"), "1");
  assert.equal(x402PriceToAtomic("1.25"), "1250000");
  assert.throws(() => normalizeX402Price("0"), /between/);
  assert.throws(() => normalizeX402Price("0.0000001"), /6 decimals/);
});

test("accepts bounded JSON resources and rejects unsafe shapes", () => {
  const resource = normalizeX402ResourceInput({
    description: "A fresh Arc network snapshot.",
    price: "0.005",
    responseBody: "{\"height\":5042002}",
    title: "Arc snapshot",
  }, merchant);
  assert.equal(resource.price, "0.005");
  assert.deepEqual(resource.responseBody, { height: 5042002 });
  assert.throws(() => normalizeX402ResourceInput({ description: "Too short", price: "0.01", responseBody: "[]", title: "API" }, merchant), /JSON object/);
});

test("summarizes paid calls without floating point drift", () => {
  const resource: X402Resource = {
    createdAt: "2030-01-01T00:00:00.000Z",
    description: "Metered API response for testing.",
    merchant,
    price: "0.000001",
    resourceId: "xres_1234567890abcdefghij",
    responseBody: { ok: true },
    status: "active",
    title: "Metered API",
    updatedAt: "2030-01-01T00:00:00.000Z",
  };
  const access: X402Access = {
    accessId: "xacc_1234567890abcdefghij",
    amount: "1",
    createdAt: "2030-01-01T00:01:00.000Z",
    merchant,
    network: "eip155:5042002",
    payer: "0x2222222222222222222222222222222222222222",
    resourceId: resource.resourceId,
    transaction: "transfer_12345678",
  };
  const metrics = x402Metrics([resource], [access, { ...access, accessId: "xacc_abcdefghij1234567890", transaction: "transfer_87654321" }]);
  assert.equal(metrics.paidRequests, 2);
  assert.equal(metrics.settledAmount, "0.000002");
  assert.equal(metrics.resources[0].accessCount, 2);
});
