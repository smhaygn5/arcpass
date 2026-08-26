import { formatUnits, getAddress, isAddress, parseUnits, type Address } from "viem";
import { ARCPASS_TOKENS, type ArcPassInvoice, type ArcPassTokenSymbol } from "./arcpass.ts";

export type TeamRole = "approver" | "billing" | "viewer";
export type ApprovalRequestStatus = "approved" | "expired" | "pending";

export type TeamMember = {
  addedAt: string;
  label: string;
  role: TeamRole;
  walletAddress: Address;
};

export type ApprovalPolicy = {
  enabled: boolean;
  requiredApprovals: number;
  thresholds: Record<ArcPassTokenSymbol, string>;
};

export type TeamWorkspace = {
  members: TeamMember[];
  merchant: Address;
  policy: ApprovalPolicy;
  updatedAt: string;
  version: 1;
};

export type ApprovalRecord = {
  approvedAt: string;
  approver: Address;
};

export type ApprovalInvoiceSummary = {
  amount: string;
  description: string;
  invoiceId: string;
  token: ArcPassTokenSymbol;
};

export type ApprovalRequest = {
  approvals: ApprovalRecord[];
  createdAt: string;
  expiresAt: string;
  invoices: ApprovalInvoiceSummary[];
  merchant: Address;
  operationLabel: string;
  payloads: string[];
  requestId: string;
  requiredApprovals: number;
  status: ApprovalRequestStatus;
  totals: Partial<Record<ArcPassTokenSymbol, string>>;
};

export type ApprovalRequestView = Omit<ApprovalRequest, "payloads">;

export type ApprovalDecision = {
  required: boolean;
  requiredApprovals: number;
  totals: Partial<Record<ArcPassTokenSymbol, string>>;
  triggeredTokens: ArcPassTokenSymbol[];
};

export const DEFAULT_APPROVAL_POLICY: ApprovalPolicy = {
  enabled: false,
  requiredApprovals: 1,
  thresholds: { EURC: "1000", USDC: "1000" },
};

export const TEAM_ROLE_CAPABILITIES: Record<TeamRole | "owner", readonly string[]> = {
  approver: ["Review invoice details", "Sign approval requests", "Read approval history"],
  billing: ["Assigned billing responsibility", "No approval signature rights"],
  owner: ["Manage team and policy", "Create invoices", "Sign approvals", "Read all activity"],
  viewer: ["Assigned audit visibility", "No approval signature rights"],
};

export function defaultTeamWorkspace(merchant: Address, now = new Date()): TeamWorkspace {
  return { members: [], merchant: getAddress(merchant), policy: DEFAULT_APPROVAL_POLICY, updatedAt: now.toISOString(), version: 1 };
}

export function normalizeTeamWorkspace(value: unknown, merchant: Address, now = new Date()): TeamWorkspace {
  if (!value || typeof value !== "object") throw new Error("Team workspace is invalid.");
  const input = value as Partial<TeamWorkspace>;
  const normalizedMerchant = getAddress(merchant);
  const rawMembers = Array.isArray(input.members) ? input.members : [];
  if (rawMembers.length > 12) throw new Error("A workspace can contain up to 12 team members.");

  const members: TeamMember[] = [];
  const seen = new Set<string>();
  for (const raw of rawMembers) {
    if (!raw || typeof raw !== "object") throw new Error("Team member is invalid.");
    const member = raw as Partial<TeamMember>;
    if (!isAddress(member.walletAddress ?? "")) throw new Error("Team member wallet is invalid.");
    const walletAddress = getAddress(member.walletAddress as string);
    const key = walletAddress.toLowerCase();
    if (key === normalizedMerchant.toLowerCase()) throw new Error("The owner wallet is already part of the workspace.");
    if (seen.has(key)) throw new Error("A team wallet can only be added once.");
    if (member.role !== "approver" && member.role !== "billing" && member.role !== "viewer") throw new Error("Team member role is invalid.");
    const label = typeof member.label === "string" ? member.label.trim() : "";
    if (!label || label.length > 60) throw new Error("Team member label must be between 1 and 60 characters.");
    const addedAt = validIsoDate(member.addedAt) ? new Date(member.addedAt as string).toISOString() : now.toISOString();
    members.push({ addedAt, label, role: member.role, walletAddress });
    seen.add(key);
  }

  const policyInput = input.policy;
  if (!policyInput || typeof policyInput !== "object") throw new Error("Approval policy is invalid.");
  const requiredApprovals = Number(policyInput.requiredApprovals);
  if (!Number.isInteger(requiredApprovals) || requiredApprovals < 1 || requiredApprovals > 3) throw new Error("Required approvals must be between 1 and 3.");
  const approverCapacity = members.filter((member) => member.role === "approver").length + 1;
  if (requiredApprovals > approverCapacity) throw new Error("Required approvals exceed the number of eligible wallets.");
  const thresholds = {
    EURC: normalizeThreshold(policyInput.thresholds?.EURC, "EURC"),
    USDC: normalizeThreshold(policyInput.thresholds?.USDC, "USDC"),
  };

  return {
    members,
    merchant: normalizedMerchant,
    policy: { enabled: policyInput.enabled === true, requiredApprovals, thresholds },
    updatedAt: validIsoDate(input.updatedAt) ? new Date(input.updatedAt as string).toISOString() : now.toISOString(),
    version: 1,
  };
}

export function evaluateApprovalPolicy(invoices: ArcPassInvoice[], policy: ApprovalPolicy): ApprovalDecision {
  if (!invoices.length || invoices.length > 10) throw new Error("Approval checks require between 1 and 10 invoices.");
  const totalsRaw = new Map<ArcPassTokenSymbol, bigint>();
  for (const invoice of invoices) {
    const decimals = ARCPASS_TOKENS[invoice.token].decimals;
    totalsRaw.set(invoice.token, (totalsRaw.get(invoice.token) ?? 0n) + parseUnits(invoice.amount, decimals));
  }
  const totals = Object.fromEntries([...totalsRaw].map(([token, total]) => [token, formatUnits(total, ARCPASS_TOKENS[token].decimals)])) as Partial<Record<ArcPassTokenSymbol, string>>;
  const triggeredTokens = policy.enabled
    ? [...totalsRaw].filter(([token, total]) => total >= parseUnits(policy.thresholds[token], ARCPASS_TOKENS[token].decimals)).map(([token]) => token)
    : [];
  return { required: triggeredTokens.length > 0, requiredApprovals: policy.requiredApprovals, totals, triggeredTokens };
}

export function approvalRequestMessage(request: Pick<ApprovalRequest, "expiresAt" | "invoices" | "merchant" | "operationLabel" | "requestId" | "requiredApprovals">) {
  return [
    "ArcPass team approval",
    "",
    `Request: ${request.requestId}`,
    `Merchant: ${getAddress(request.merchant)}`,
    `Operation: ${request.operationLabel}`,
    `Invoices: ${request.invoices.map((invoice) => invoice.invoiceId).join(",")}`,
    `Required approvals: ${request.requiredApprovals}`,
    `Expires: ${new Date(request.expiresAt).toISOString()}`,
    "",
    "This gas-free signature approves only the locked invoice payloads listed above. It does not authorize a payment or token transfer.",
  ].join("\n");
}

export function isApprovalRequest(value: unknown): value is ApprovalRequest {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<ApprovalRequest>;
  return /^apr_[a-z0-9]{16}$/.test(request.requestId ?? "")
    && isAddress(request.merchant ?? "")
    && (request.status === "pending" || request.status === "approved" || request.status === "expired")
    && typeof request.operationLabel === "string"
    && validIsoDate(request.createdAt)
    && validIsoDate(request.expiresAt)
    && Number.isInteger(request.requiredApprovals)
    && (request.requiredApprovals ?? 0) >= 1
    && (request.requiredApprovals ?? 0) <= 3
    && Array.isArray(request.payloads)
    && request.payloads.length >= 1
    && request.payloads.length <= 10
    && Array.isArray(request.invoices)
    && request.invoices.length === request.payloads.length
    && Array.isArray(request.approvals);
}

export function isApprovalRequestView(value: unknown): value is ApprovalRequestView {
  if (!value || typeof value !== "object") return false;
  const request = value as Partial<ApprovalRequestView>;
  return /^apr_[a-z0-9]{16}$/.test(request.requestId ?? "")
    && isAddress(request.merchant ?? "")
    && (request.status === "pending" || request.status === "approved" || request.status === "expired")
    && typeof request.operationLabel === "string"
    && validIsoDate(request.createdAt)
    && validIsoDate(request.expiresAt)
    && Number.isInteger(request.requiredApprovals)
    && Array.isArray(request.invoices)
    && request.invoices.length >= 1
    && request.invoices.length <= 10
    && Array.isArray(request.approvals);
}

export function roleLabel(role: TeamRole | "owner") {
  if (role === "owner") return "Owner";
  if (role === "approver") return "Approver";
  if (role === "billing") return "Billing";
  return "Viewer";
}

export function approvalStatusLabel(status: ApprovalRequestStatus) {
  if (status === "approved") return "Approved";
  if (status === "expired") return "Expired";
  return "Awaiting approval";
}

function normalizeThreshold(value: unknown, token: ArcPassTokenSymbol) {
  const raw = typeof value === "string" ? value.trim().replace(/,/g, ".") : "";
  if (!/^\d+(?:\.\d+)?$/.test(raw)) throw new Error(`${token} approval threshold is invalid.`);
  const decimals = ARCPASS_TOKENS[token].decimals;
  const [, fraction = ""] = raw.split(".");
  if (fraction.length > decimals) throw new Error(`${token} approval threshold supports up to ${decimals} decimal places.`);
  const parsed = parseUnits(raw, decimals);
  if (parsed <= 0n) throw new Error(`${token} approval threshold must be positive.`);
  return formatUnits(parsed, decimals);
}

function validIsoDate(value: unknown) {
  return typeof value === "string" && !Number.isNaN(new Date(value).getTime());
}
