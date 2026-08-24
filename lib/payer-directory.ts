import type { Address } from "viem";
import type { ArcPassTokenSymbol } from "./arcpass.ts";
import type { SavedReceipt } from "./receipts.ts";

type PayerReceipt = Pick<SavedReceipt, "amount" | "paidAt" | "payer" | "token">;

export type PayerSegment = "at-risk" | "new" | "returning";

export type PayerDirectoryEntry = {
  averages: Record<ArcPassTokenSymbol, number>;
  daysSinceLastPayment: number;
  firstPaid: string;
  lastPaid: string;
  payer: Address;
  paymentCount: number;
  preferredToken: ArcPassTokenSymbol | null;
  relationshipDays: number;
  segment: PayerSegment;
  totals: Record<ArcPassTokenSymbol, number>;
};

type MutablePayerEntry = Omit<PayerDirectoryEntry, "averages" | "daysSinceLastPayment" | "preferredToken" | "relationshipDays" | "segment"> & {
  tokenPaymentCounts: Record<ArcPassTokenSymbol, number>;
};

const DAY_MS = 24 * 60 * 60 * 1000;

export function buildPayerDirectory(receipts: PayerReceipt[], now = new Date()): PayerDirectoryEntry[] {
  const entries = new Map<string, MutablePayerEntry>();
  const nowTime = Number.isFinite(now.getTime()) ? now.getTime() : Date.now();

  for (const receipt of receipts) {
    const amount = Number.parseFloat(receipt.amount);
    const paidAt = new Date(receipt.paidAt).getTime();
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(paidAt)) continue;

    const key = receipt.payer.toLowerCase();
    const existing = entries.get(key);

    if (!existing) {
      entries.set(key, {
        firstPaid: receipt.paidAt,
        lastPaid: receipt.paidAt,
        payer: receipt.payer,
        paymentCount: 1,
        tokenPaymentCounts: {
          EURC: receipt.token === "EURC" ? 1 : 0,
          USDC: receipt.token === "USDC" ? 1 : 0,
        },
        totals: {
          EURC: receipt.token === "EURC" ? amount : 0,
          USDC: receipt.token === "USDC" ? amount : 0,
        },
      });
      continue;
    }

    existing.paymentCount += 1;
    existing.tokenPaymentCounts[receipt.token] += 1;
    existing.totals[receipt.token] += amount;
    if (paidAt < new Date(existing.firstPaid).getTime()) existing.firstPaid = receipt.paidAt;
    if (paidAt > new Date(existing.lastPaid).getTime()) existing.lastPaid = receipt.paidAt;
  }

  return Array.from(entries.values()).map((entry): PayerDirectoryEntry => {
    const firstPaidTime = new Date(entry.firstPaid).getTime();
    const lastPaidTime = new Date(entry.lastPaid).getTime();
    const daysSinceLastPayment = Math.max(0, Math.floor((nowTime - lastPaidTime) / DAY_MS));
    const relationshipDays = Math.max(1, Math.ceil((lastPaidTime - firstPaidTime) / DAY_MS) + 1);
    const preferredToken = preferredPayerToken(entry.tokenPaymentCounts, entry.totals);

    return {
      averages: {
        EURC: entry.tokenPaymentCounts.EURC ? entry.totals.EURC / entry.tokenPaymentCounts.EURC : 0,
        USDC: entry.tokenPaymentCounts.USDC ? entry.totals.USDC / entry.tokenPaymentCounts.USDC : 0,
      },
      daysSinceLastPayment,
      firstPaid: entry.firstPaid,
      lastPaid: entry.lastPaid,
      payer: entry.payer,
      paymentCount: entry.paymentCount,
      preferredToken,
      relationshipDays,
      segment: entry.paymentCount === 1 ? "new" : daysSinceLastPayment >= 30 ? "at-risk" : "returning",
      totals: entry.totals,
    };
  }).sort((a, b) => {
    const timeDifference = new Date(b.lastPaid).getTime() - new Date(a.lastPaid).getTime();
    return timeDifference || a.payer.localeCompare(b.payer);
  });
}

function preferredPayerToken(
  counts: Record<ArcPassTokenSymbol, number>,
  totals: Record<ArcPassTokenSymbol, number>,
): ArcPassTokenSymbol | null {
  if (counts.USDC > counts.EURC) return "USDC";
  if (counts.EURC > counts.USDC) return "EURC";
  if (totals.USDC > totals.EURC) return "USDC";
  if (totals.EURC > totals.USDC) return "EURC";
  return null;
}
