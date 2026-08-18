import assert from "node:assert/strict";
import test from "node:test";
import { expiryInputFromHours, isInvoiceTemplate } from "./invoice-templates.ts";

test("invoice templates only accept bounded, supported invoice settings", () => {
  assert.equal(isInvoiceTemplate({ id: "template", label: "Consulting", description: "Consulting service", amount: "150", token: "USDC", expiresInHours: 72 }), true);
  assert.equal(isInvoiceTemplate({ id: "template", label: "Bad", description: "Bad", amount: "1", token: "ETH", expiresInHours: 72 }), false);
});

test("invoice template expiry is rendered as a local datetime input", () => {
  assert.equal(expiryInputFromHours(24, new Date("2026-08-19T10:00:00.000Z")).length, 16);
});
