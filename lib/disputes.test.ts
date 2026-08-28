import assert from "node:assert/strict";
import test from "node:test";
import {
  disputeDecisionMessage,
  disputeEvidenceMessage,
  isDisputeEvidence,
  normalizeDisputeStatement,
  normalizeEvidenceSha256,
  normalizeEvidenceUrl,
} from "./disputes.ts";

const payer = "0x2222222222222222222222222222222222222222" as const;
const merchant = "0x1111111111111111111111111111111111111111" as const;
const txHash = `0x${"a".repeat(64)}` as const;

test("locks every evidence field into the signed message", () => {
  const message = disputeEvidenceMessage({
    evidenceSha256: "b".repeat(64),
    evidenceUrl: "https://example.com/delivery.pdf",
    invoiceId: "inv_demo",
    requestId: "ref_1234567890abcdef",
    role: "payer",
    signer: payer,
    statement: "  The delivered archive is incomplete. ",
    txHash,
  });
  assert.match(message, /Request: ref_1234567890abcdef/);
  assert.match(message, /Role: payer/);
  assert.match(message, /Evidence URL: https:\/\/example.com\/delivery.pdf/);
  assert.match(message, new RegExp(`Evidence SHA256: ${"b".repeat(64)}`));
  assert.match(message, /does not authorize a token transfer/);
});

test("normalizes safe evidence references and rejects unsafe input", () => {
  assert.equal(normalizeEvidenceUrl(" https://example.com/proof "), "https://example.com/proof");
  assert.equal(normalizeEvidenceUrl(""), null);
  assert.throws(() => normalizeEvidenceUrl("javascript:alert(1)"));
  assert.throws(() => normalizeEvidenceUrl("https://user:pass@example.com/file"));
  assert.equal(normalizeEvidenceSha256(`sha256:${"A".repeat(64)}`), "a".repeat(64));
  assert.throws(() => normalizeEvidenceSha256("abc"));
  assert.throws(() => normalizeDisputeStatement("too short"));
});

test("locks the merchant decision and note into a separate signature", () => {
  const message = disputeDecisionMessage({
    invoiceId: "inv_demo",
    note: "Delivery evidence satisfies the agreed scope.",
    requestId: "ref_1234567890abcdef",
    signer: merchant,
    status: "declined",
    txHash,
  });
  assert.match(message, /Decision: declined/);
  assert.match(message, /Merchant: 0x1111111111111111111111111111111111111111/);
  assert.match(message, /Decision note: Delivery evidence satisfies/);
});

test("validates immutable evidence records", () => {
  assert.equal(isDisputeEvidence({}), false);
  assert.equal(isDisputeEvidence({
    createdAt: "2026-08-28T10:00:00.000Z",
    evidenceId: `ev_${"a".repeat(20)}`,
    evidenceSha256: null,
    evidenceUrl: null,
    requestId: "ref_1234567890abcdef",
    role: "merchant",
    signature: "0x1234",
    signer: merchant,
    statement: "The delivery log is attached for review.",
  }), true);
});
