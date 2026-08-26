import { formatUnits, parseUnits } from "viem";
import {
  ARCPASS_TOKENS,
  type ArcPassTokenSymbol,
  type InvoiceRecurring,
  type RecurringCadence,
} from "./arcpass.ts";
import type { SavedInvoice } from "./invoices.ts";
import type { SavedReceipt } from "./receipts.ts";

export type RecurringScheduleStatus = "attention" | "completed" | "ready" | "scheduled";

export type RecurringCyclePreview = {
  amount: string;
  cycleNumber: number;
  dueAt: string;
};

export type RecurringCycleItem = RecurringCyclePreview & {
  invoiceId: string;
  link: string;
  overdue: boolean;
  paidAt: string | null;
  receiptUrl: string | null;
  settled: boolean;
};

export type RecurringScheduleSummary = {
  amount: string;
  cadence: RecurringCadence;
  canIssueNext: boolean;
  cycleCount: number;
  cycles: RecurringCycleItem[];
  issuedCount: number;
  latestInvoice: SavedInvoice;
  merchantDomain: string;
  nextCycleNumber: number | null;
  nextDueAt: string | null;
  outstandingCount: number;
  paidCount: number;
  scheduleId: string;
  seriesTitle: string;
  status: RecurringScheduleStatus;
  token: ArcPassTokenSymbol;
  totalScheduled: string;
  verifiedValue: string;
};

export function createRecurringScheduleId() {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `schedule_${suffix}`;
}

export function buildRecurringPreview({
  amount,
  cadence,
  cycleCount,
  firstDueAt,
  token,
}: {
  amount: string;
  cadence: RecurringCadence;
  cycleCount: number;
  firstDueAt: string;
  token: ArcPassTokenSymbol;
}): RecurringCyclePreview[] {
  if (!Number.isInteger(cycleCount) || cycleCount < 2 || cycleCount > 24) {
    throw new Error("Recurring cycle count must be between 2 and 24.");
  }
  if (!["weekly", "monthly", "quarterly"].includes(cadence)) throw new Error("Recurring cadence is invalid.");
  const firstDue = new Date(firstDueAt);
  if (Number.isNaN(firstDue.getTime())) throw new Error("First recurring due date is invalid.");
  const decimals = ARCPASS_TOKENS[token].decimals;
  const amountInput = amount.trim().replace(/,/g, ".");
  const [, fractional = ""] = amountInput.split(".");
  if (!/^\d+(?:\.\d+)?$/.test(amountInput) || fractional.length > decimals) {
    throw new Error(`${token} recurring amount must use at most ${decimals} decimal places.`);
  }
  const normalizedAmount = formatUnits(parseUnits(amountInput, decimals), decimals);
  if (parseUnits(normalizedAmount, decimals) <= 0n) throw new Error("Recurring amount must be positive.");

  return Array.from({ length: cycleCount }, (_, index) => ({
    amount: normalizedAmount,
    cycleNumber: index + 1,
    dueAt: recurringDueAt(firstDue, cadence, index, firstDue.getUTCDate()).toISOString(),
  }));
}

export function buildRecurringSchedules(
  invoices: SavedInvoice[],
  receipts: SavedReceipt[],
  now = new Date(),
): RecurringScheduleSummary[] {
  const grouped = new Map<string, SavedInvoice[]>();
  for (const saved of invoices) {
    const scheduleId = saved.invoice.recurring?.scheduleId;
    if (!scheduleId) continue;
    grouped.set(scheduleId, [...(grouped.get(scheduleId) ?? []), saved]);
  }

  return [...grouped.entries()]
    .flatMap(([scheduleId, candidates]) => {
      try {
        const schedule = summarizeSchedule(scheduleId, candidates, receipts, now);
        return schedule ? [schedule] : [];
      } catch {
        return [];
      }
    })
    .sort((left, right) => schedulePriority(left) - schedulePriority(right));
}

export function recurringCadenceLabel(cadence: RecurringCadence) {
  if (cadence === "weekly") return "Weekly";
  if (cadence === "quarterly") return "Quarterly";
  return "Monthly";
}

export function recurringScheduleStatusLabel(status: RecurringScheduleStatus) {
  if (status === "attention") return "Needs attention";
  if (status === "completed") return "Completed";
  if (status === "ready") return "Next cycle ready";
  return "Scheduled";
}

export function recurringCycleDescription(seriesTitle: string, cycleNumber: number, cycleCount: number) {
  const suffix = ` · Cycle ${cycleNumber}/${cycleCount}`;
  return `${seriesTitle.trim().slice(0, 280 - suffix.length)}${suffix}`;
}

export function recurringMetadata({
  anchorDay,
  cadence,
  cycleCount,
  cycleNumber,
  scheduleId,
  seriesTitle,
}: InvoiceRecurring): InvoiceRecurring {
  return { anchorDay, cadence, cycleCount, cycleNumber, scheduleId, seriesTitle: seriesTitle.trim() };
}

export function recurringSeriesTotal(amount: string, cycleCount: number, token: ArcPassTokenSymbol) {
  const decimals = ARCPASS_TOKENS[token].decimals;
  return formatUnits(parseUnits(amount.trim().replace(/,/g, "."), decimals) * BigInt(cycleCount), decimals);
}

export function nextRecurringDueAt(lastDueAt: string, cadence: RecurringCadence, now = new Date(), anchorDay = new Date(lastDueAt).getUTCDate()) {
  const lastDue = new Date(lastDueAt);
  if (Number.isNaN(lastDue.getTime())) throw new Error("Recurring due date is invalid.");
  let next = recurringDueAt(lastDue, cadence, 1, anchorDay);
  while (next.getTime() <= now.getTime()) next = recurringDueAt(next, cadence, 1, anchorDay);
  return next.toISOString();
}

function summarizeSchedule(
  scheduleId: string,
  candidates: SavedInvoice[],
  receipts: SavedReceipt[],
  now: Date,
): RecurringScheduleSummary | null {
  const ordered = candidates
    .filter((candidate) => candidate.invoice.recurring?.scheduleId === scheduleId)
    .sort((left, right) => Number(left.invoice.recurring?.cycleNumber) - Number(right.invoice.recurring?.cycleNumber));
  const first = ordered[0]?.invoice;
  const recurring = first?.recurring;
  if (!first || !recurring || recurring.cycleNumber !== 1) return null;
  if (!/^schedule_[a-zA-Z0-9_-]{1,64}$/.test(recurring.scheduleId)) return null;
  if (!Number.isInteger(recurring.anchorDay) || recurring.anchorDay < 1 || recurring.anchorDay > 31) return null;
  if (!Number.isInteger(recurring.cycleCount) || recurring.cycleCount < 2 || recurring.cycleCount > 24) return null;
  if (!["weekly", "monthly", "quarterly"].includes(recurring.cadence)) return null;
  if (!recurring.seriesTitle.trim() || recurring.seriesTitle.length > 280) return null;

  const compatible = ordered.filter(({ invoice }) => {
    const item = invoice.recurring;
    return item?.scheduleId === scheduleId
      && item.cadence === recurring.cadence
      && item.cycleCount === recurring.cycleCount
      && item.seriesTitle === recurring.seriesTitle
      && invoice.amount === first.amount
      && invoice.token === first.token
      && invoice.merchant.walletAddress.toLowerCase() === first.merchant.walletAddress.toLowerCase();
  });
  const contiguous: SavedInvoice[] = [];
  for (const saved of compatible) {
    if (saved.invoice.recurring?.cycleNumber !== contiguous.length + 1) break;
    contiguous.push(saved);
  }
  if (!contiguous.length) return null;

  const cycles = contiguous.map<RecurringCycleItem>((saved) => {
    const receipt = receipts.find((candidate) => receiptMatchesInvoice(candidate, saved)) ?? null;
    return {
      amount: saved.invoice.amount,
      cycleNumber: saved.invoice.recurring!.cycleNumber,
      dueAt: saved.invoice.expiresAt,
      invoiceId: saved.invoice.invoiceId,
      link: saved.link,
      overdue: !receipt && new Date(saved.invoice.expiresAt).getTime() <= now.getTime(),
      paidAt: receipt?.paidAt ?? null,
      receiptUrl: receipt?.explorerUrl ?? null,
      settled: Boolean(receipt),
    };
  });
  const latestInvoice = contiguous[contiguous.length - 1];
  const latestCycle = cycles[cycles.length - 1];
  const paidCount = cycles.filter((cycle) => cycle.settled).length;
  const outstandingCount = cycles.length - paidCount;
  const canIssueNext = cycles.length < recurring.cycleCount && (latestCycle.settled || latestCycle.overdue);
  const completed = cycles.length === recurring.cycleCount && paidCount === recurring.cycleCount;
  const status: RecurringScheduleStatus = completed
    ? "completed"
    : cycles.some((cycle) => cycle.overdue)
      ? "attention"
      : canIssueNext
        ? "ready"
        : "scheduled";
  const nextCycleNumber = cycles.length < recurring.cycleCount ? cycles.length + 1 : null;
  const nextDueAt = nextCycleNumber ? nextRecurringDueAt(latestCycle.dueAt, recurring.cadence, now, recurring.anchorDay) : null;
  const decimals = ARCPASS_TOKENS[first.token].decimals;
  const amountRaw = parseUnits(first.amount, decimals);

  return {
    amount: first.amount,
    cadence: recurring.cadence,
    canIssueNext,
    cycleCount: recurring.cycleCount,
    cycles,
    issuedCount: cycles.length,
    latestInvoice,
    merchantDomain: first.merchant.domain,
    nextCycleNumber,
    nextDueAt,
    outstandingCount,
    paidCount,
    scheduleId,
    seriesTitle: recurring.seriesTitle,
    status,
    token: first.token,
    totalScheduled: formatUnits(amountRaw * BigInt(recurring.cycleCount), decimals),
    verifiedValue: formatUnits(amountRaw * BigInt(paidCount), decimals),
  };
}

function recurringDueAt(firstDue: Date, cadence: RecurringCadence, offset: number, anchorDay: number) {
  if (cadence === "weekly") return new Date(firstDue.getTime() + offset * 7 * 24 * 60 * 60 * 1_000);
  const monthOffset = cadence === "quarterly" ? offset * 3 : offset;
  const targetMonth = firstDue.getUTCMonth() + monthOffset;
  const targetYear = firstDue.getUTCFullYear() + Math.floor(targetMonth / 12);
  const normalizedMonth = ((targetMonth % 12) + 12) % 12;
  const lastDay = new Date(Date.UTC(targetYear, normalizedMonth + 1, 0)).getUTCDate();
  const due = new Date(firstDue);
  due.setUTCFullYear(targetYear, normalizedMonth, Math.min(anchorDay, lastDay));
  return due;
}

function receiptMatchesInvoice(receipt: SavedReceipt, saved: SavedInvoice) {
  return receipt.invoiceId === saved.invoice.invoiceId
    && receipt.amount === saved.invoice.amount
    && receipt.token === saved.invoice.token
    && receipt.merchant.toLowerCase() === saved.invoice.merchant.walletAddress.toLowerCase();
}

function schedulePriority(schedule: RecurringScheduleSummary) {
  const rank: Record<RecurringScheduleStatus, number> = { attention: 0, ready: 1, scheduled: 2, completed: 3 };
  return rank[schedule.status] * 10_000_000_000_000 + (schedule.nextDueAt ? new Date(schedule.nextDueAt).getTime() : 0);
}
