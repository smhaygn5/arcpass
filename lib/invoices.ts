import type { Address } from "viem";
import {
  encodeInvoicePayload,
  invoiceExpired,
  type ArcPassInvoice,
} from "./arcpass.ts";
import type { SavedReceipt } from "./receipts.ts";

export const INVOICES_STORAGE_KEY = "arcpass.invoices.v1";

export type SavedInvoice = {
  invoice: ArcPassInvoice;
  link: string;
  payload: string;
};

export type InvoiceStatus = "verified" | "expired" | "awaiting";

export function createSavedInvoice({
  invoice,
  origin,
}: {
  invoice: ArcPassInvoice;
  origin: string;
}): SavedInvoice {
  const payload = encodeInvoicePayload(invoice);
  return {
    invoice,
    link: `${origin.replace(/\/$/, "")}/pay/${payload}`,
    payload,
  };
}

export function merchantPassportLink(invoice: SavedInvoice) {
  try {
    const url = new URL(invoice.link);
    url.pathname = `/passport/${invoice.payload}`;
    return url.toString();
  } catch {
    return `/passport/${invoice.payload}`;
  }
}

export function invoiceStatus(invoice: ArcPassInvoice, receipts: SavedReceipt[]): InvoiceStatus {
  if (receipts.some((receipt) => receipt.invoiceId === invoice.invoiceId)) return "verified";
  if (invoiceExpired(invoice)) return "expired";
  return "awaiting";
}

export function invoiceStatusLabel(status: InvoiceStatus) {
  if (status === "verified") return "Verified";
  if (status === "expired") return "Expired";
  return "Awaiting payment";
}

export function loadSavedInvoices(limit = 24): SavedInvoice[] {
  if (typeof window === "undefined") return [];

  const raw = window.localStorage.getItem(INVOICES_STORAGE_KEY);
  if (!raw) return [];

  try {
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? parsed.map(normalizeSavedInvoice).filter(isSavedInvoice).slice(0, limit) : [];
  } catch {
    return [];
  }
}

export function mergeSavedInvoices(groups: SavedInvoice[][], limit = 24): SavedInvoice[] {
  const byId = new Map<string, SavedInvoice>();

  for (const invoice of groups.flat()) {
    if (!isSavedInvoice(invoice)) continue;
    if (!byId.has(invoice.invoice.invoiceId)) byId.set(invoice.invoice.invoiceId, invoice);
  }

  return Array.from(byId.values())
    .sort((a, b) => new Date(b.invoice.createdAt).getTime() - new Date(a.invoice.createdAt).getTime())
    .slice(0, limit);
}

export function saveInvoiceLocally(invoice: SavedInvoice): SavedInvoice[] {
  if (typeof window === "undefined") return [];

  const existing = loadSavedInvoices(48);
  const next = mergeSavedInvoices([[invoice], existing]);
  window.localStorage.setItem(INVOICES_STORAGE_KEY, JSON.stringify(next));
  window.dispatchEvent(new Event("arcpass:invoices-updated"));
  return next;
}

export function isSavedInvoice(value: unknown): value is SavedInvoice {
  if (!value || typeof value !== "object") return false;
  const item = normalizeSavedInvoice(value);
  if (!item) return false;

  return (
    typeof item.link === "string" &&
    typeof item.payload === "string" &&
    Boolean(item.invoice?.invoiceId) &&
    typeof item.invoice.invoiceId === "string" &&
    typeof item.invoice.description === "string" &&
    typeof item.invoice.amount === "string" &&
    typeof item.invoice.createdAt === "string" &&
    typeof item.invoice.expiresAt === "string" &&
    typeof item.invoice.merchant?.walletAddress === "string"
  );
}

export function merchantMatchesInvoice(invoice: SavedInvoice, merchant: Address) {
  return invoice.invoice.merchant.walletAddress.toLowerCase() === merchant.toLowerCase();
}

function normalizeSavedInvoice(value: unknown): SavedInvoice | null {
  if (!value || typeof value !== "object") return null;
  const item = value as Partial<SavedInvoice>;
  if (!item.invoice) return null;

  const payload = typeof item.payload === "string" && item.payload
    ? item.payload
    : encodeInvoicePayload(item.invoice);
  const link = typeof item.link === "string" && item.link ? item.link : `/pay/${payload}`;

  return {
    invoice: item.invoice,
    link,
    payload,
  };
}
