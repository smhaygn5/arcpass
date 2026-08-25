import { formatUnits, parseUnits } from "viem";
import {
  ARCPASS_TOKENS,
  type ArcPassTokenSymbol,
  type InstallmentCadence,
  type InvoiceInstallment,
} from "./arcpass.ts";
import type { SavedInvoice } from "./invoices.ts";
import type { SavedReceipt } from "./receipts.ts";

export type InstallmentScheduleItem = InvoiceInstallment & {
  amount: string;
  dueAt: string;
};

export type InstallmentPlanStatus = "completed" | "in-progress" | "overdue" | "scheduled";

export type InstallmentPlanItem = {
  amount: string;
  dueAt: string;
  invoiceId: string;
  installmentNumber: number;
  link: string;
  paidAt: string | null;
  receiptUrl: string | null;
  settled: boolean;
};

export type InstallmentPlanSummary = {
  cadence: InstallmentCadence;
  installmentCount: number;
  installments: InstallmentPlanItem[];
  merchantDomain: string;
  nextInstallment: InstallmentPlanItem | null;
  paidAmount: string;
  paidCount: number;
  planId: string;
  planTotal: string;
  progress: number;
  registeredCount: number;
  remainingAmount: string;
  status: InstallmentPlanStatus;
  token: ArcPassTokenSymbol;
};

export function createInstallmentPlanId() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `plan_${suffix}`;
}

export function buildInstallmentSchedule({
  cadence,
  firstDueAt,
  installmentCount,
  planId = createInstallmentPlanId(),
  token,
  totalAmount,
}: {
  cadence: InstallmentCadence;
  firstDueAt: string;
  installmentCount: number;
  planId?: string;
  token: ArcPassTokenSymbol;
  totalAmount: string;
}): InstallmentScheduleItem[] {
  if (!Number.isInteger(installmentCount) || installmentCount < 2 || installmentCount > 10) {
    throw new Error("Installment count must be between 2 and 10.");
  }
  if (!/^plan_[a-zA-Z0-9_-]{1,64}$/.test(planId)) throw new Error("Installment plan id is invalid.");
  if (!["weekly", "biweekly", "monthly"].includes(cadence)) throw new Error("Installment cadence is invalid.");

  const firstDue = new Date(firstDueAt);
  if (Number.isNaN(firstDue.getTime())) throw new Error("First installment due date is invalid.");

  const decimals = ARCPASS_TOKENS[token].decimals;
  const normalizedTotal = totalAmount.trim().replace(/,/g, ".");
  const totalRaw = parseUnits(normalizedTotal, decimals);
  if (totalRaw < BigInt(installmentCount)) {
    throw new Error(`Plan total must cover at least ${installmentCount} smallest ${token} units.`);
  }

  const base = totalRaw / BigInt(installmentCount);
  const remainder = totalRaw % BigInt(installmentCount);

  return Array.from({ length: installmentCount }, (_, index) => {
    const amountRaw = base + (BigInt(index) < remainder ? 1n : 0n);
    return {
      amount: formatUnits(amountRaw, decimals),
      cadence,
      dueAt: installmentDueAt(firstDue, cadence, index).toISOString(),
      installmentCount,
      installmentNumber: index + 1,
      planId,
      planTotal: formatUnits(totalRaw, decimals),
    };
  });
}

export function buildInstallmentPlans(
  invoices: SavedInvoice[],
  receipts: SavedReceipt[],
  now = new Date(),
): InstallmentPlanSummary[] {
  const grouped = new Map<string, SavedInvoice[]>();

  for (const saved of invoices) {
    const planId = saved.invoice.installment?.planId;
    if (!planId) continue;
    const current = grouped.get(planId) ?? [];
    current.push(saved);
    grouped.set(planId, current);
  }

  return [...grouped.entries()]
    .flatMap(([planId, candidates]) => {
      try {
        const plan = summarizePlan(planId, candidates, receipts, now);
        return plan ? [plan] : [];
      } catch {
        return [];
      }
    })
    .sort((left, right) => planPriority(left) - planPriority(right));
}

export function installmentCadenceLabel(cadence: InstallmentCadence) {
  if (cadence === "weekly") return "Weekly";
  if (cadence === "biweekly") return "Every 2 weeks";
  return "Monthly";
}

export function installmentPlanStatusLabel(status: InstallmentPlanStatus) {
  if (status === "completed") return "Completed";
  if (status === "in-progress") return "In progress";
  if (status === "overdue") return "Payment overdue";
  return "Scheduled";
}

function summarizePlan(
  planId: string,
  candidates: SavedInvoice[],
  receipts: SavedReceipt[],
  now: Date,
): InstallmentPlanSummary | null {
  const first = candidates.find((candidate) => candidate.invoice.installment)?.invoice;
  const plan = first?.installment;
  if (!first || !plan) return null;

  const invoices = candidates
    .filter(({ invoice }) => {
      const item = invoice.installment;
      return item?.planId === planId
        && item.planTotal === plan.planTotal
        && item.installmentCount === plan.installmentCount
        && item.cadence === plan.cadence
        && invoice.token === first.token
        && invoice.merchant.walletAddress.toLowerCase() === first.merchant.walletAddress.toLowerCase();
    })
    .sort((left, right) => Number(left.invoice.installment?.installmentNumber) - Number(right.invoice.installment?.installmentNumber));

  const decimals = ARCPASS_TOKENS[first.token].decimals;
  const totalRaw = parseUnits(plan.planTotal, decimals);
  let paidRaw = 0n;
  const seenInstallments = new Set<number>();
  const installments = invoices.flatMap<InstallmentPlanItem>((saved) => {
    const metadata = saved.invoice.installment;
    if (!metadata || seenInstallments.has(metadata.installmentNumber)) return [];
    seenInstallments.add(metadata.installmentNumber);
    const receipt = receipts.find((candidate) => receiptMatchesInvoice(candidate, saved)) ?? null;
    if (receipt) paidRaw += parseUnits(saved.invoice.amount, decimals);
    return [{
      amount: saved.invoice.amount,
      dueAt: saved.invoice.expiresAt,
      invoiceId: saved.invoice.invoiceId,
      installmentNumber: metadata.installmentNumber,
      link: saved.link,
      paidAt: receipt?.paidAt ?? null,
      receiptUrl: receipt?.explorerUrl ?? null,
      settled: Boolean(receipt),
    }];
  });
  paidRaw = paidRaw > totalRaw ? totalRaw : paidRaw;
  const remainingRaw = totalRaw - paidRaw;
  const nextInstallment = installments.find((item) => !item.settled) ?? null;
  const paidCount = installments.filter((item) => item.settled).length;
  const status: InstallmentPlanStatus = remainingRaw === 0n
    ? "completed"
    : nextInstallment && new Date(nextInstallment.dueAt).getTime() <= now.getTime()
      ? "overdue"
      : paidCount > 0
        ? "in-progress"
        : "scheduled";

  return {
    cadence: plan.cadence,
    installmentCount: plan.installmentCount,
    installments,
    merchantDomain: first.merchant.domain,
    nextInstallment,
    paidAmount: formatUnits(paidRaw, decimals),
    paidCount,
    planId,
    planTotal: formatUnits(totalRaw, decimals),
    progress: totalRaw === 0n ? 0 : Number((paidRaw * 10_000n) / totalRaw) / 100,
    registeredCount: installments.length,
    remainingAmount: formatUnits(remainingRaw, decimals),
    status,
    token: first.token,
  };
}

function installmentDueAt(firstDue: Date, cadence: InstallmentCadence, offset: number) {
  if (cadence !== "monthly") {
    const days = cadence === "weekly" ? 7 : 14;
    return new Date(firstDue.getTime() + offset * days * 24 * 60 * 60 * 1_000);
  }

  const due = new Date(firstDue);
  const targetMonth = firstDue.getUTCMonth() + offset;
  const targetYear = firstDue.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  due.setUTCFullYear(targetYear, normalizedMonth, Math.min(firstDue.getUTCDate(), lastDay));
  return due;
}

function receiptMatchesInvoice(receipt: SavedReceipt, saved: SavedInvoice) {
  return receipt.invoiceId === saved.invoice.invoiceId
    && receipt.amount === saved.invoice.amount
    && receipt.token === saved.invoice.token
    && receipt.merchant.toLowerCase() === saved.invoice.merchant.walletAddress.toLowerCase();
}

function planPriority(plan: InstallmentPlanSummary) {
  const rank: Record<InstallmentPlanStatus, number> = {
    overdue: 0,
    "in-progress": 1,
    scheduled: 2,
    completed: 3,
  };
  return rank[plan.status] * 10_000_000_000_000 + (plan.nextInstallment ? new Date(plan.nextInstallment.dueAt).getTime() : 0);
}
