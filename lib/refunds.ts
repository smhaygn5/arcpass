import { getAddress, isAddress, type Address, type Hash } from "viem";
import type { ArcPassTokenSymbol } from "./arcpass.ts";

export type RefundRequestStatus = "pending" | "approved" | "declined";

export type RefundDecision = {
  decidedAt: string;
  note: string;
  signature: `0x${string}`;
  signer: Address;
  status: Exclude<RefundRequestStatus, "pending">;
};

export type RefundRequest = {
  amount: string;
  createdAt: string;
  invoiceId: string;
  merchant: Address;
  payer: Address;
  reason: string;
  requestId: string;
  requestSignature?: `0x${string}`;
  decision?: RefundDecision;
  status: RefundRequestStatus;
  token: ArcPassTokenSymbol;
  txHash: Hash;
  updatedAt: string;
};

export function normalizeRefundReason(value: string) {
  const reason = value.trim().replace(/\s+/g, " ");
  if (reason.length < 10 || reason.length > 500) {
    throw new Error("Refund reason must be between 10 and 500 characters.");
  }
  return reason;
}

export function refundRequestMessage({ invoiceId, payer, reason, txHash }: { invoiceId: string; payer: Address; reason: string; txHash: Hash }) {
  return [
    "ArcPass refund request",
    "",
    `Invoice: ${invoiceId}`,
    `Transaction: ${txHash.toLowerCase()}`,
    `Payer: ${getAddress(payer)}`,
    `Reason: ${normalizeRefundReason(reason)}`,
    "",
    "This gas-free signature only submits a refund request. It does not authorize a token transfer.",
  ].join("\n");
}

export function isRefundRequest(value: unknown): value is RefundRequest {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RefundRequest>;
  return Boolean(
    typeof item.requestId === "string" && item.requestId &&
    typeof item.invoiceId === "string" && item.invoiceId &&
    typeof item.txHash === "string" && /^0x[0-9a-fA-F]{64}$/.test(item.txHash) &&
    typeof item.merchant === "string" && isAddress(item.merchant) &&
    typeof item.payer === "string" && isAddress(item.payer) &&
    typeof item.amount === "string" &&
    (item.token === "USDC" || item.token === "EURC") &&
    typeof item.reason === "string" && item.reason.length >= 10 && item.reason.length <= 500 &&
    (item.requestSignature === undefined || (typeof item.requestSignature === "string" && /^0x[0-9a-fA-F]+$/.test(item.requestSignature))) &&
    (item.decision === undefined || isRefundDecision(item.decision)) &&
    (item.status === "pending" || item.status === "approved" || item.status === "declined") &&
    typeof item.createdAt === "string" && Number.isFinite(new Date(item.createdAt).getTime()) &&
    typeof item.updatedAt === "string" && Number.isFinite(new Date(item.updatedAt).getTime())
  );
}

function isRefundDecision(value: unknown): value is RefundDecision {
  if (!value || typeof value !== "object") return false;
  const item = value as Partial<RefundDecision>;
  return Boolean(
    (item.status === "approved" || item.status === "declined") &&
    typeof item.signer === "string" && isAddress(item.signer) &&
    typeof item.note === "string" && item.note.length >= 10 && item.note.length <= 1_000 &&
    typeof item.signature === "string" && /^0x[0-9a-fA-F]+$/.test(item.signature) &&
    typeof item.decidedAt === "string" && Number.isFinite(new Date(item.decidedAt).getTime())
  );
}
