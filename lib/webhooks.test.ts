import assert from "node:assert/strict";
import { createHmac } from "node:crypto";
import test from "node:test";
import {
  WEBHOOK_EVENT_TYPES,
  isWebhookDelivery,
  isWebhookEndpoint,
  normalizeWebhookEvents,
  normalizeWebhookUrl,
} from "./webhooks.ts";
import { createWebhookSignature, webhookSignatureMessage } from "./server-webhooks.ts";

const merchant = "0x1111111111111111111111111111111111111111";

test("keeps webhook subscriptions unique and in a stable order", () => {
  assert.deepEqual(
    normalizeWebhookEvents(["payment.verified", "invoice.created", "payment.verified", "unknown"]),
    ["invoice.created", "payment.verified"],
  );
  assert.deepEqual(normalizeWebhookEvents(WEBHOOK_EVENT_TYPES), WEBHOOK_EVENT_TYPES);
});

test("accepts only credential free HTTPS webhook URLs on the standard port", () => {
  assert.equal(normalizeWebhookUrl("https://hooks.example.com/arcpass"), "https://hooks.example.com/arcpass");
  assert.throws(() => normalizeWebhookUrl("http://hooks.example.com/arcpass"), /HTTPS/);
  assert.throws(() => normalizeWebhookUrl("https://user:pass@hooks.example.com/arcpass"), /credentials/);
  assert.throws(() => normalizeWebhookUrl("https://hooks.example.com:8443/arcpass"), /standard HTTPS port/);
});

test("signs the exact timestamp and raw request body", () => {
  const secret = "whsec_test_secret_with_enough_entropy";
  const timestamp = "1787904000";
  const rawBody = JSON.stringify({ id: "evt_test", type: "invoice.created" });
  const expected = createHmac("sha256", secret).update(`${timestamp}.${rawBody}`).digest("hex");

  assert.equal(webhookSignatureMessage(timestamp, rawBody), `${timestamp}.${rawBody}`);
  assert.equal(createWebhookSignature(secret, timestamp, rawBody), `v1=${expected}`);
});

test("validates public endpoint and delivery transfer objects without secrets", () => {
  assert.equal(isWebhookEndpoint({
    createdAt: "2026-08-28T00:00:00.000Z",
    endpointId: "wh_1234567890abcdef",
    events: ["invoice.created"],
    merchant,
    secretHint: "a9Z2",
    status: "active",
    updatedAt: "2026-08-28T00:00:00.000Z",
    url: "https://hooks.example.com/arcpass",
  }), true);
  assert.equal(isWebhookDelivery({
    attemptCount: 1,
    createdAt: "2026-08-28T00:00:00.000Z",
    deliveredAt: null,
    deliveryId: "whd_1234567890abcdefghij",
    endpointId: "wh_1234567890abcdef",
    eventId: "evt_1234567890abcdefghij",
    eventType: "payment.verified",
    lastError: "Endpoint returned HTTP 500.",
    responseStatus: 500,
    status: "failed",
  }), true);
});
