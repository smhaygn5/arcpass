import assert from "node:assert/strict";
import test from "node:test";
import { paymentQrFilename } from "./payment-link-kit.ts";

test("payment QR downloads use a safe invoice filename", () => {
  assert.equal(paymentQrFilename("inv:August/2026"), "arcpass-inv-August-2026-payment-qr.png");
});
