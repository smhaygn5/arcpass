import assert from "node:assert/strict";
import test from "node:test";
import { checkoutRecoveryPlan } from "./checkout-recovery.ts";

const ready = { balanceKnown: true, hasError: false, networkReady: true, payerSelected: true, paymentComplete: false, paymentLocked: false };

test("guides checkout recovery in dependency order", () => {
  assert.equal(checkoutRecoveryPlan({ ...ready, payerSelected: false }).kind, "connect");
  assert.equal(checkoutRecoveryPlan({ ...ready, networkReady: false }).kind, "network");
  assert.equal(checkoutRecoveryPlan({ ...ready, balanceKnown: false }).kind, "balance");
  assert.equal(checkoutRecoveryPlan(ready).kind, "healthy");
});

test("never offers wallet recovery for completed or locked checkout", () => {
  assert.equal(checkoutRecoveryPlan({ ...ready, paymentComplete: true }).actionLabel, null);
  assert.equal(checkoutRecoveryPlan({ ...ready, paymentLocked: true }).kind, "locked");
});
