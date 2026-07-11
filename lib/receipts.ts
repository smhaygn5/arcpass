import type { Address, Hash } from "viem";
import type { ArcPassInvoice, ArcPassTokenSymbol } from "./arcpass.ts";

export const RECEIPTS_STORAGE_KEY = "arcpass.receipts.v1";

export type SavedReceipt = {
  amount: string;
  blockNumber: string;
  description: string;
  explorerUrl: string;
  invoiceId: string;
  link: string;
  merchant: Address;
  paidAt: string;
  payer: Address;
  status: "verified";
  token: ArcPassTokenSymbol;
  txHash: Hash;
};

export type VerifiedReceiptPayload = {
  amount: string;
  blockNumber: string;
  explorerUrl: string;
  invoiceId: string;
  merchant: Address;
  payer: Address;
  token: ArcPassTokenSymbol;
  txHash: Hash;
  serverSaved?: boolean;
  verified: true;
};

export function extractInvoicePayload(input: string) {
  const trimmed = input.trim();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed);
    const segments = url.pathname.split("/").filter(Boolean);
    const payIndex = segments.indexOf("pay");
    const payload = payIndex >= 0 ? segments[payIndex + 1] : "";
    return payload ? decodeURIComponent(payload) : "";
  } catch {
    const marker = "/pay/";
    const markerIndex = trimmed.indexOf(marker);
    const payload = markerIndex >= 0 ? trimmed.slice(markerIndex + marker.length) : trimmed;
    return payload.split(/[?#]/)[0] ?? "";
  }
}

export function loadSavedReceipts(limit = 24): SavedReceipt[] {
  if (typeof window === "undefined") return [];

  const raw = window.localStorage.getItem(RECEIPTS_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as SavedReceipt[];
    return Array.isArray(parsed) ? parsed.filter(isSavedReceipt).slice(0, limit) : [];
  } catch {
    return [];
  }
}

export function mergeSavedReceipts(groups: SavedReceipt[][], limit = 24): SavedReceipt[] {
  const byHash = new Map<string, SavedReceipt>();

  for (const receipt of groups.flat()) {
    if (!isSavedReceipt(receipt)) continue;
    const key = receipt.txHash.toLowerCase();
    if (!byHash.has(key)) byHash.set(key, receipt);
  }

  return Array.from(byHash.values())
    .sort((a, b) => new Date(b.paidAt).getTime() - new Date(a.paidAt).getTime())
    .slice(0, limit);
}

export function saveVerifiedReceipt({
  invoice,
  payload,
  receipt,
}: {
  invoice: ArcPassInvoice;
  payload: string;
  receipt: VerifiedReceiptPayload;
}): SavedReceipt[] {
  if (typeof window === "undefined") return [];

  const saved: SavedReceipt = {
    amount: receipt.amount,
    blockNumber: receipt.blockNumber,
    description: invoice.description,
    explorerUrl: receipt.explorerUrl,
    invoiceId: receipt.invoiceId,
    link: `${window.location.origin}/pay/${payload}`,
    merchant: receipt.merchant,
    paidAt: new Date().toISOString(),
    payer: receipt.payer,
    status: "verified",
    token: receipt.token,
    txHash: receipt.txHash,
  };
  const existing = loadSavedReceipts(48);
  const next = mergeSavedReceipts([[saved], existing]);
  window.localStorage.setItem(RECEIPTS_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("arcpass:receipts-updated"));
  return next;
}

export function isSavedReceipt(value: unknown): value is SavedReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<SavedReceipt>;

  return (
    receipt.status === "verified" &&
    typeof receipt.amount === "string" &&
    typeof receipt.blockNumber === "string" &&
    typeof receipt.description === "string" &&
    typeof receipt.explorerUrl === "string" &&
    typeof receipt.invoiceId === "string" &&
    typeof receipt.link === "string" &&
    typeof receipt.merchant === "string" &&
    typeof receipt.paidAt === "string" &&
    typeof receipt.payer === "string" &&
    typeof receipt.token === "string" &&
    typeof receipt.txHash === "string"
  );
}
