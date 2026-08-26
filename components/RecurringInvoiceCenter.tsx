"use client";

import { useMemo, useState } from "react";
import {
  buildRecurringSchedules,
  recurringCadenceLabel,
  recurringScheduleStatusLabel,
  type RecurringScheduleSummary,
} from "@/lib/recurring-invoices";
import type { SavedInvoice } from "@/lib/invoices";
import type { SavedReceipt } from "@/lib/receipts";

export function RecurringInvoiceCenter({
  invoiceHistory,
  onCreateSchedule,
  onIssueNext,
  receiptHistory,
}: {
  invoiceHistory: SavedInvoice[];
  onCreateSchedule: () => void;
  onIssueNext: (schedule: RecurringScheduleSummary) => Promise<SavedInvoice>;
  receiptHistory: SavedReceipt[];
}) {
  const [actionError, setActionError] = useState<string | null>(null);
  const [copiedScheduleId, setCopiedScheduleId] = useState<string | null>(null);
  const [issuingScheduleId, setIssuingScheduleId] = useState<string | null>(null);
  const [selectedScheduleId, setSelectedScheduleId] = useState<string | null>(null);
  const schedules = useMemo(() => buildRecurringSchedules(invoiceHistory, receiptHistory), [invoiceHistory, receiptHistory]);
  const selected = schedules.find((schedule) => schedule.scheduleId === selectedScheduleId) ?? schedules[0] ?? null;
  const ready = schedules.filter((schedule) => schedule.status === "ready").length;
  const attention = schedules.filter((schedule) => schedule.status === "attention").length;
  const completed = schedules.filter((schedule) => schedule.status === "completed").length;

  async function issueNext(schedule: RecurringScheduleSummary) {
    setActionError(null);
    setIssuingScheduleId(schedule.scheduleId);
    try {
      await onIssueNext(schedule);
    } catch (err) {
      setActionError(err instanceof Error ? err.message : "The next recurring invoice could not be issued.");
    } finally {
      setIssuingScheduleId(null);
    }
  }

  async function copyCurrent(schedule: RecurringScheduleSummary) {
    const current = schedule.cycles.at(-1);
    if (!current || current.settled || current.overdue) return;
    await window.navigator.clipboard.writeText(current.link);
    setCopiedScheduleId(schedule.scheduleId);
  }

  return (
    <section className="arcpass-panel arcpass-recurring-center">
      <div className="arcpass-recurring-heading">
        <div>
          <p className="arcpass-panel-label">Recurring invoice scheduler</p>
          <h3>Keep repeat billing predictable without automatic wallet charges.</h3>
          <p>ArcPass calculates each billing cycle, waits for the current invoice to settle or expire, then lets the merchant issue the next locked checkout.</p>
        </div>
        <button type="button" className="arcpass-dark-button" onClick={onCreateSchedule}>Create recurring schedule</button>
      </div>

      <div className="arcpass-recurring-metrics">
        <RecurringMetric label="Schedules" value={schedules.length} detail="Registered series" />
        <RecurringMetric label="Ready" value={ready} detail="Next cycle can be issued" tone="primary" />
        <RecurringMetric label="Attention" value={attention} detail="An issued cycle expired" tone="caution" />
        <RecurringMetric label="Completed" value={completed} detail="Every cycle verified" tone="success" />
      </div>

      {schedules.length && selected ? (
        <div className="arcpass-recurring-workbench">
          <div className="arcpass-recurring-list" role="list" aria-label="Recurring invoice schedules">
            {schedules.map((schedule) => (
              <button key={schedule.scheduleId} type="button" onClick={() => setSelectedScheduleId(schedule.scheduleId)} aria-pressed={schedule.scheduleId === selected.scheduleId}>
                <span className="arcpass-recurring-list-head"><strong>{schedule.seriesTitle}</strong><i data-status={schedule.status}>{recurringScheduleStatusLabel(schedule.status)}</i></span>
                <span>{schedule.amount} {schedule.token} · {recurringCadenceLabel(schedule.cadence)}</span>
                <span className="arcpass-recurring-progress" aria-label={`${schedule.paidCount} of ${schedule.cycleCount} cycles paid`}><i style={{ width: `${(schedule.paidCount / schedule.cycleCount) * 100}%` }} /></span>
                <small>{schedule.paidCount}/{schedule.cycleCount} paid · {schedule.issuedCount} issued</small>
              </button>
            ))}
          </div>

          <aside className="arcpass-recurring-detail">
            <div className="arcpass-recurring-detail-head">
              <div><span>Selected schedule</span><strong>{selected.scheduleId}</strong></div>
              <i data-status={selected.status}>{recurringScheduleStatusLabel(selected.status)}</i>
            </div>
            <div className="arcpass-recurring-balance">
              <div><span>Series value</span><strong>{selected.totalScheduled} {selected.token}</strong></div>
              <div><span>Verified</span><strong>{selected.verifiedValue} {selected.token}</strong></div>
              <div><span>Next cycle</span><strong>{selected.nextCycleNumber ? `${selected.nextCycleNumber}/${selected.cycleCount}` : "Complete"}</strong></div>
            </div>
            {selected.nextDueAt ? <div className="arcpass-recurring-next"><span>Next scheduled due date</span><strong>{new Date(selected.nextDueAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</strong></div> : null}
            <div className="arcpass-recurring-cycles">
              {selected.cycles.map((cycle) => (
                <article key={cycle.invoiceId} data-state={cycle.settled ? "settled" : cycle.overdue ? "overdue" : "open"}>
                  <span>{cycle.settled ? "✓" : cycle.cycleNumber}</span>
                  <div><strong>Cycle {cycle.cycleNumber}/{selected.cycleCount}</strong><small>Due {new Date(cycle.dueAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</small></div>
                  <div><strong>{cycle.amount} {selected.token}</strong><a href={cycle.settled && cycle.receiptUrl ? cycle.receiptUrl : cycle.link} target="_blank" rel="noreferrer">{cycle.settled ? "Receipt" : cycle.overdue ? "Expired" : "Checkout"}</a></div>
                </article>
              ))}
            </div>
            <div className="arcpass-recurring-actions">
              {selected.canIssueNext && selected.nextCycleNumber ? <button type="button" className="arcpass-dark-button" disabled={issuingScheduleId === selected.scheduleId} onClick={() => void issueNext(selected)}>{issuingScheduleId === selected.scheduleId ? "Issuing next cycle" : `Issue cycle ${selected.nextCycleNumber}/${selected.cycleCount}`}</button> : null}
              {!selected.canIssueNext && selected.status !== "completed" && !selected.cycles.at(-1)?.overdue && !selected.cycles.at(-1)?.settled ? <button type="button" className="arcpass-ghost-button" onClick={() => void copyCurrent(selected)}>{copiedScheduleId === selected.scheduleId ? "Current link copied" : "Copy current checkout"}</button> : null}
              {selected.status === "completed" ? <p className="arcpass-success">Every recurring cycle has a verified Arc receipt.</p> : null}
            </div>
            {actionError ? <p className="arcpass-error" role="alert">{actionError}</p> : null}
          </aside>
        </div>
      ) : (
        <div className="arcpass-recurring-empty">
          <span aria-hidden="true">↻</span>
          <div><strong>No recurring schedules yet.</strong><p>Create the first cycle in the invoice builder. ArcPass will calculate and track every following billing date.</p></div>
          <button type="button" className="arcpass-ghost-button" onClick={onCreateSchedule}>Build a schedule</button>
        </div>
      )}

      <p className="arcpass-recurring-disclosure">Recurring schedules never authorize automatic transfers. The merchant issues a new locked invoice and the payer approves every cycle in their wallet.</p>
    </section>
  );
}

function RecurringMetric({ detail, label, tone = "neutral", value }: { detail: string; label: string; tone?: "caution" | "neutral" | "primary" | "success"; value: number }) {
  return <div data-tone={tone}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}
