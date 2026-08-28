import { getAddress, isAddress, type Address, type Hash, type Hex } from "viem";

export type DisputeEvidenceRole = "merchant" | "payer";

export type DisputeEvidence = {
  createdAt: string;
  evidenceId: string;
  evidenceSha256: string | null;
  evidenceUrl: string | null;
  requestId: string;
  role: DisputeEvidenceRole;
  signature: Hex;
  signer: Address;
  statement: string;
};

export function normalizeDisputeStatement(value: string) {
  const statement = value.trim().replace(/\s+/g, " ");
  if (statement.length < 10 || statement.length > 1_000) {
    throw new Error("Evidence notes must be between 10 and 1,000 characters.");
  }
  return statement;
}

export function normalizeEvidenceUrl(value: string) {
  const trimmed = value.trim();
  if (!trimmed) return null;
  if (trimmed.length > 800) throw new Error("Evidence links cannot exceed 800 characters.");

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid HTTPS evidence link.");
  }

  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("Evidence links must use HTTPS without credentials or fragments.");
  }

  return url.toString();
}

export function normalizeEvidenceSha256(value: string) {
  const normalized = value.trim().toLowerCase().replace(/^sha256:/i, "");
  if (!normalized) return null;
  if (!/^[0-9a-f]{64}$/.test(normalized)) {
    throw new Error("Evidence SHA256 must contain exactly 64 hexadecimal characters.");
  }
  return normalized;
}

export function disputeEvidenceMessage({
  evidenceSha256,
  evidenceUrl,
  invoiceId,
  requestId,
  role,
  signer,
  statement,
  txHash,
}: {
  evidenceSha256: string | null;
  evidenceUrl: string | null;
  invoiceId: string;
  requestId: string;
  role: DisputeEvidenceRole;
  signer: Address;
  statement: string;
  txHash: Hash;
}) {
  return [
    "ArcPass dispute evidence",
    "",
    `Request: ${requestId}`,
    `Invoice: ${invoiceId}`,
    `Transaction: ${txHash.toLowerCase()}`,
    `Role: ${role}`,
    `Signer: ${getAddress(signer)}`,
    `Statement: ${normalizeDisputeStatement(statement)}`,
    `Evidence URL: ${evidenceUrl ?? "None"}`,
    `Evidence SHA256: ${evidenceSha256 ?? "None"}`,
    "",
    "This gas-free signature records evidence only. It does not authorize a token transfer.",
  ].join("\n");
}

export function disputeDecisionMessage({
  invoiceId,
  note,
  requestId,
  signer,
  status,
  txHash,
}: {
  invoiceId: string;
  note: string;
  requestId: string;
  signer: Address;
  status: "approved" | "declined";
  txHash: Hash;
}) {
  return [
    "ArcPass dispute decision",
    "",
    `Request: ${requestId}`,
    `Invoice: ${invoiceId}`,
    `Transaction: ${txHash.toLowerCase()}`,
    `Decision: ${status}`,
    `Merchant: ${getAddress(signer)}`,
    `Decision note: ${normalizeDisputeStatement(note)}`,
    "",
    "This gas-free signature records a dispute decision only. It does not authorize a token transfer.",
  ].join("\n");
}

export function isDisputeEvidence(value: unknown): value is DisputeEvidence {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<DisputeEvidence>;
  return Boolean(
    typeof item.evidenceId === "string" && /^ev_[a-z0-9]{20}$/.test(item.evidenceId) &&
    typeof item.requestId === "string" && /^ref_[a-z0-9]{16}$/.test(item.requestId) &&
    (item.role === "payer" || item.role === "merchant") &&
    typeof item.signer === "string" && isAddress(item.signer) &&
    typeof item.statement === "string" && item.statement.length >= 10 && item.statement.length <= 1_000 &&
    (item.evidenceUrl === null || typeof item.evidenceUrl === "string") &&
    (item.evidenceSha256 === null || (typeof item.evidenceSha256 === "string" && /^[0-9a-f]{64}$/.test(item.evidenceSha256))) &&
    typeof item.signature === "string" && /^0x[0-9a-fA-F]+$/.test(item.signature) &&
    typeof item.createdAt === "string" && Number.isFinite(new Date(item.createdAt).getTime())
  );
}
