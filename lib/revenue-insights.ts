import type { ArcPassTokenSymbol } from "./arcpass.ts";

type RevenueReceipt = { amount: string; paidAt: string; payer: string; token: ArcPassTokenSymbol };

export type TokenRevenueInsight = {
  average: number;
  changePercent: number | null;
  dailyTotals: number[];
  paymentCount: number;
  previousTotal: number;
  token: ArcPassTokenSymbol;
  total: number;
};

export type RevenueInsights = { periodDays: number; tokens: TokenRevenueInsight[]; totalPayments: number; uniquePayers: number };

const TOKENS: ArcPassTokenSymbol[] = ["USDC", "EURC"];

export function merchantRevenueInsights(receipts: RevenueReceipt[], now = new Date(), periodDays = 7): RevenueInsights {
  const end = Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
  const duration = Math.max(1, Math.min(30, Math.floor(periodDays)));
  const dayMs = 24 * 60 * 60 * 1000;
  const currentStart = end - duration * dayMs;
  const previousStart = currentStart - duration * dayMs;
  const totals = new Map<ArcPassTokenSymbol, number>(TOKENS.map((token) => [token, 0]));
  const previousTotals = new Map<ArcPassTokenSymbol, number>(TOKENS.map((token) => [token, 0]));
  const paymentCounts = new Map<ArcPassTokenSymbol, number>(TOKENS.map((token) => [token, 0]));
  const daily = new Map<ArcPassTokenSymbol, number[]>(TOKENS.map((token) => [token, Array.from({ length: duration }, () => 0)]));
  const payers = new Set<string>();
  let totalPayments = 0;

  for (const receipt of receipts) {
    if (!TOKENS.includes(receipt.token)) continue;
    const amount = Number.parseFloat(receipt.amount);
    const paidAt = new Date(receipt.paidAt).getTime();
    if (!Number.isFinite(amount) || amount < 0 || !Number.isFinite(paidAt)) continue;
    if (paidAt >= currentStart && paidAt <= end) {
      const token = receipt.token;
      totals.set(token, (totals.get(token) ?? 0) + amount);
      paymentCounts.set(token, (paymentCounts.get(token) ?? 0) + 1);
      const dayIndex = Math.min(duration - 1, Math.max(0, Math.floor((paidAt - currentStart) / dayMs)));
      const points = daily.get(token)!;
      points[dayIndex] += amount;
      totalPayments += 1;
      if (receipt.payer) payers.add(receipt.payer.toLowerCase());
    } else if (paidAt >= previousStart && paidAt < currentStart) {
      previousTotals.set(receipt.token, (previousTotals.get(receipt.token) ?? 0) + amount);
    }
  }

  return {
    periodDays: duration,
    tokens: TOKENS.map((token) => {
      const total = totals.get(token) ?? 0;
      const previousTotal = previousTotals.get(token) ?? 0;
      const paymentCount = paymentCounts.get(token) ?? 0;
      return { average: paymentCount ? total / paymentCount : 0, changePercent: previousTotal ? ((total - previousTotal) / previousTotal) * 100 : total ? null : 0, dailyTotals: daily.get(token) ?? [], paymentCount, previousTotal, token, total };
    }),
    totalPayments,
    uniquePayers: payers.size,
  };
}

export function formatRevenueAmount(value: number) {
  return new Intl.NumberFormat("en-US", { maximumFractionDigits: 2, minimumFractionDigits: 2 }).format(value);
}
