import { getAddress, isAddress, type Address, type Hash } from "viem";
import type { ArcPassTokenSymbol } from "./arcpass.ts";

export type RefundRequestStatus = "pending" | "approved" | "declined";

export type RefundRequest = {
  amount: string;
  createdAt: string;
  invoiceId: string;
  merchant: Address;
  payer: Address;
  reason: string;
  requestId: string;
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
    (item.status === "pending" || item.status === "approved" || item.status === "declined") &&
    typeof item.createdAt === "string" && Number.isFinite(new Date(item.createdAt).getTime()) &&
    typeof item.updatedAt === "string" && Number.isFinite(new Date(item.updatedAt).getTime())
  );
}
