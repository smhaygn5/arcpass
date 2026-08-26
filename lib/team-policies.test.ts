import assert from "node:assert/strict";
import test from "node:test";
import { createInvoice, EMPTY_MERCHANT_PASSPORT } from "./arcpass.ts";
import {
  approvalRequestMessage,
  defaultTeamWorkspace,
  evaluateApprovalPolicy,
  normalizeTeamWorkspace,
  type ApprovalRequest,
} from "./team-policies.ts";

const owner = "0x0000000000000000000000000000000000000001";
const approver = "0x0000000000000000000000000000000000000002";

test("keeps team wallets unique and the owner implicit", () => {
  const workspace = normalizeTeamWorkspace({
    members: [{ addedAt: "2030-01-01T00:00:00.000Z", label: "Finance", role: "approver", walletAddress: approver }],
    policy: { enabled: true, requiredApprovals: 2, thresholds: { EURC: "500", USDC: "1000" } },
  }, owner, new Date("2030-01-02T00:00:00.000Z"));
  assert.equal(workspace.merchant, owner);
  assert.equal(workspace.members[0].role, "approver");
  assert.equal(workspace.policy.thresholds.USDC, "1000");
  assert.throws(() => normalizeTeamWorkspace({ ...workspace, members: [...workspace.members, workspace.members[0]] }, owner));
  assert.throws(() => normalizeTeamWorkspace({ ...workspace, members: [{ ...workspace.members[0], walletAddress: owner }] }, owner));
});

test("rejects a quorum larger than eligible owner and approver wallets", () => {
  const workspace = defaultTeamWorkspace(owner);
  assert.throws(() => normalizeTeamWorkspace({ ...workspace, policy: { ...workspace.policy, requiredApprovals: 2 } }, owner));
});

test("requires approval when aggregated token value reaches its threshold", () => {
  const workspace = normalizeTeamWorkspace({
    members: [],
    policy: { enabled: true, requiredApprovals: 1, thresholds: { EURC: "1000", USDC: "10" } },
  }, owner);
  const decision = evaluateApprovalPolicy([invoice("4", "USDC"), invoice("6", "USDC")], workspace.policy);
  assert.equal(decision.required, true);
  assert.equal(decision.totals.USDC, "10");
  assert.deepEqual(decision.triggeredTokens, ["USDC"]);
});

test("does not mix USDC and EURC totals or invent an approval when disabled", () => {
  const policy = { enabled: true, requiredApprovals: 1, thresholds: { EURC: "6", USDC: "6" } } as const;
  const decision = evaluateApprovalPolicy([invoice("5", "USDC"), invoice("5", "EURC")], policy);
  assert.equal(decision.required, false);
  assert.deepEqual(decision.totals, { EURC: "5", USDC: "5" });
  assert.equal(evaluateApprovalPolicy([invoice("100", "USDC")], { ...policy, enabled: false }).required, false);
});

test("approval signatures name the exact request, merchant, invoices, quorum, and expiry", () => {
  const request = {
    expiresAt: "2030-02-01T00:00:00.000Z",
    invoices: [{ amount: "10", description: "Design", invoiceId: "inv_exact", token: "USDC" }],
    merchant: owner,
    operationLabel: "One-time invoice",
    requestId: "apr_1234567890abcdef",
    requiredApprovals: 2,
  } satisfies Pick<ApprovalRequest, "expiresAt" | "invoices" | "merchant" | "operationLabel" | "requestId" | "requiredApprovals">;
  const message = approvalRequestMessage(request);
  assert.match(message, /apr_1234567890abcdef/);
  assert.match(message, /inv_exact/);
  assert.match(message, /Required approvals: 2/);
  assert.match(message, /does not authorize a payment or token transfer/);
});

function invoice(amount: string, token: "EURC" | "USDC") {
  return createInvoice({
    amount,
    description: "Team policy test",
    expiresAt: "2030-02-01T00:00:00.000Z",
    merchant: { ...EMPTY_MERCHANT_PASSPORT, walletAddress: owner },
    token,
  });
}
