import assert from "node:assert/strict";
import test from "node:test";
import { normalizeX402AccessExpiry, normalizeX402MaxCalls, normalizeX402Price, normalizeX402ResourceInput, x402AccessWindow, x402Metrics, x402PayerMetrics, x402PriceToAtomic, type X402Access, type X402Resource } from "./x402.ts";

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

test("keeps an optional paid call limit within safe bounds", () => {
  const resource = normalizeX402ResourceInput({ description: "A fresh Arc network snapshot.", maxCalls: "25", price: "0.005", responseBody: { height: 1 }, title: "Arc snapshot" }, merchant);
  assert.equal(resource.maxCalls, 25);
  assert.throws(() => normalizeX402ResourceInput({ description: "A fresh Arc network snapshot.", maxCalls: "0", price: "0.005", responseBody: { height: 1 }, title: "Arc snapshot" }, merchant), /Usage limit/);
});

test("validates usage limit updates independently of resource creation", () => {
  assert.equal(normalizeX402MaxCalls("500"), 500);
  assert.throws(() => normalizeX402MaxCalls("0"), /Usage limit/);
  assert.throws(() => normalizeX402MaxCalls("10.5"), /Usage limit/);
});

test("labels timed access windows before merchants lose endpoint availability", () => {
  const now = Date.parse("2030-01-01T12:00:00.000Z");
  assert.deepEqual(x402AccessWindow(undefined, now), { label: "No expiry", state: "open" });
  assert.deepEqual(x402AccessWindow("2030-01-01T11:59:00.000Z", now), { label: "Expired", state: "expired" });
  assert.deepEqual(x402AccessWindow("2030-01-01T14:00:00.000Z", now), { label: "2h left", state: "ending" });
  assert.deepEqual(x402AccessWindow("2030-01-12T12:00:00.000Z", now), { label: "Until Jan 12", state: "scheduled" });
});

test("accepts only future expiry updates for an existing resource", () => {
  const future = new Date(Date.now() + 60_000).toISOString();
  assert.equal(normalizeX402AccessExpiry(future), future);
  assert.throws(() => normalizeX402AccessExpiry(new Date(Date.now() - 60_000).toISOString()), /future/);
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
  assert.equal(metrics.payerCount, 1);
  assert.equal(metrics.topResource?.title, "Metered API");
  assert.equal(metrics.latestAccessAt, access.createdAt);
});

test("groups settled calls by payer and keeps the highest volume first", () => {
  const first: X402Access = { accessId: "xacc_1234567890abcdefghij", amount: "500000", createdAt: "2030-01-01T00:00:00.000Z", merchant, network: "eip155:5042002", payer: "0x2222222222222222222222222222222222222222", resourceId: "xres_1234567890abcdefghij", transaction: "transfer_12345678" };
  const second: X402Access = { ...first, accessId: "xacc_abcdefghij1234567890", amount: "250000", createdAt: "2030-01-02T00:00:00.000Z", resourceId: "xres_abcdefghij1234567890", transaction: "transfer_87654321" };
  const third: X402Access = { ...first, accessId: "xacc_12abcdefghij34567890", amount: "600000", payer: "0x3333333333333333333333333333333333333333", transaction: "transfer_abcdefgh" };
  const payers = x402PayerMetrics([first, second, third]);
  assert.equal(payers[0].payer, first.payer);
  assert.equal(payers[0].settledAmount, "0.75");
  assert.equal(payers[0].resourceCount, 2);
  assert.equal(payers[1].settledAmount, "0.6");
});
