import assert from "node:assert/strict";
import test from "node:test";
import { paymentCanProceed, paymentReadinessChecks } from "./payment-readiness.ts";

test("payment readiness only permits a fully prepared checkout", () => {
  const checks = paymentReadinessChecks({ balanceReady: true, expired: false, hasReceipt: false, invoiceRegistered: true, networkReady: true, payerMatchesMerchant: false, payerSelected: true });
  assert.equal(paymentCanProceed(checks), true);
});

test("payment readiness blocks an expired or underfunded checkout", () => {
  const checks = paymentReadinessChecks({ balanceReady: false, expired: true, hasReceipt: false, invoiceRegistered: true, networkReady: true, payerMatchesMerchant: false, payerSelected: true });
  assert.equal(checks.filter((check) => check.state === "blocked").length, 2);
  assert.equal(paymentCanProceed(checks), false);
});
