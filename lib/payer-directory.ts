import type { Address } from "viem";
import type { ArcPassTokenSymbol } from "./arcpass.ts";
import type { SavedReceipt } from "./receipts.ts";

type PayerReceipt = Pick<SavedReceipt, "amount" | "paidAt" | "payer" | "token">;

export type PayerDirectoryEntry = {
  firstPaid: string;
  lastPaid: string;
  payer: Address;
  paymentCount: number;
  totals: Record<ArcPassTokenSymbol, number>;
};

export function buildPayerDirectory(receipts: PayerReceipt[]): PayerDirectoryEntry[] {
  const entries = new Map<string, PayerDirectoryEntry>();

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
        totals: {
          EURC: receipt.token === "EURC" ? amount : 0,
          USDC: receipt.token === "USDC" ? amount : 0,
        },
      });
      continue;
    }

    existing.paymentCount += 1;
    existing.totals[receipt.token] += amount;
    if (paidAt < new Date(existing.firstPaid).getTime()) existing.firstPaid = receipt.paidAt;
    if (paidAt > new Date(existing.lastPaid).getTime()) existing.lastPaid = receipt.paidAt;
  }

  return Array.from(entries.values()).sort((a, b) => {
    const timeDifference = new Date(b.lastPaid).getTime() - new Date(a.lastPaid).getTime();
    return timeDifference || a.payer.localeCompare(b.payer);
  });
}
