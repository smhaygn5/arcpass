import assert from "node:assert/strict";
import test from "node:test";
import { merchantMonogram, normalizePaymentLinkBranding } from "./payment-branding.ts";

test("accepts only the checkout-safe branding palette", () => {
  assert.deepEqual(normalizePaymentLinkBranding({ accent: "emerald", message: "Thank you for your business.", showMonogram: true }), { accent: "emerald", message: "Thank you for your business.", showMonogram: true });
  assert.equal(normalizePaymentLinkBranding({ accent: "#000", message: "Unsafe custom color", showMonogram: true }), null);
  assert.equal(normalizePaymentLinkBranding({ accent: "arc-blue", message: "x".repeat(121), showMonogram: true }), null);
});

test("creates a compact merchant monogram", () => {
  assert.equal(merchantMonogram("Northstar AI Studio"), "NA");
  assert.equal(merchantMonogram("ArcPass"), "A");
});
