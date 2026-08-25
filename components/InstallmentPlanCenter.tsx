"use client";

import { useMemo, useState } from "react";
import {
  buildInstallmentPlans,
  installmentCadenceLabel,
  installmentPlanStatusLabel,
  type InstallmentPlanSummary,
} from "@/lib/installments";
import type { SavedInvoice } from "@/lib/invoices";
import type { SavedReceipt } from "@/lib/receipts";

export function InstallmentPlanCenter({
  invoiceHistory,
  onCreatePlan,
  receiptHistory,
}: {
  invoiceHistory: SavedInvoice[];
  onCreatePlan: () => void;
  receiptHistory: SavedReceipt[];
}) {
  const [copiedPlanId, setCopiedPlanId] = useState<string | null>(null);
  const [selectedPlanId, setSelectedPlanId] = useState<string | null>(null);
  const plans = useMemo(() => buildInstallmentPlans(invoiceHistory, receiptHistory), [invoiceHistory, receiptHistory]);
  const selected = plans.find((plan) => plan.planId === selectedPlanId) ?? plans[0] ?? null;
  const active = plans.filter((plan) => plan.status === "in-progress" || plan.status === "scheduled").length;
  const overdue = plans.filter((plan) => plan.status === "overdue").length;
  const completed = plans.filter((plan) => plan.status === "completed").length;

  async function copyNext(plan: InstallmentPlanSummary) {
    if (!plan.nextInstallment) return;
    await window.navigator.clipboard.writeText(plan.nextInstallment.link);
    setCopiedPlanId(plan.planId);
  }

  return (
    <section className="arcpass-panel arcpass-plan-center">
      <div className="arcpass-plan-heading">
        <div>
          <p className="arcpass-panel-label">Partial payments & installments</p>
          <h3>Collect a large invoice through independently verified stages.</h3>
          <p>Every installment has its own locked amount, expiry, transaction hash, and Arc receipt. Progress moves only after receipt verification.</p>
        </div>
        <button type="button" className="arcpass-dark-button" onClick={onCreatePlan}>Create installment plan</button>
      </div>

      <div className="arcpass-plan-metrics">
        <PlanMetric label="Plans" value={plans.length} detail="Registered schedules" />
        <PlanMetric label="Active" value={active} detail="Scheduled or in progress" />
        <PlanMetric label="Overdue" value={overdue} detail="Next payment missed" tone="caution" />
        <PlanMetric label="Completed" value={completed} detail="Balance fully verified" tone="success" />
      </div>

      {plans.length && selected ? (
        <div className="arcpass-plan-workbench">
          <div className="arcpass-plan-list" role="list" aria-label="Installment plans">
            {plans.map((plan) => (
              <button key={plan.planId} type="button" onClick={() => setSelectedPlanId(plan.planId)} aria-pressed={plan.planId === selected.planId}>
                <span className="arcpass-plan-list-head"><strong>{plan.planId}</strong><i data-status={plan.status}>{installmentPlanStatusLabel(plan.status)}</i></span>
                <span>{plan.paidAmount} of {plan.planTotal} {plan.token} verified</span>
                <span className="arcpass-plan-progress" aria-label={`${plan.progress}% paid`}><i style={{ width: `${plan.progress}%` }} /></span>
                <small>{plan.paidCount}/{plan.installmentCount} paid · {installmentCadenceLabel(plan.cadence)}</small>
              </button>
            ))}
          </div>

          <aside className="arcpass-plan-detail">
            <div className="arcpass-plan-detail-head">
              <div><span>Selected plan</span><strong>{selected.planId}</strong></div>
              <i data-status={selected.status}>{installmentPlanStatusLabel(selected.status)}</i>
            </div>
            <div className="arcpass-plan-balance">
              <div><span>Plan total</span><strong>{selected.planTotal} {selected.token}</strong></div>
              <div><span>Verified</span><strong>{selected.paidAmount} {selected.token}</strong></div>
              <div><span>Remaining</span><strong>{selected.remainingAmount} {selected.token}</strong></div>
            </div>
            <div className="arcpass-plan-installments">
              {selected.installments.map((installment) => (
                <article key={installment.invoiceId} data-settled={installment.settled}>
                  <span>{installment.settled ? "✓" : installment.installmentNumber}</span>
                  <div><strong>Installment {installment.installmentNumber}/{selected.installmentCount}</strong><small>Due {new Date(installment.dueAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</small></div>
                  <div><strong>{installment.amount} {selected.token}</strong><a href={installment.settled && installment.receiptUrl ? installment.receiptUrl : installment.link} target="_blank" rel="noreferrer">{installment.settled ? "Receipt" : "Checkout"}</a></div>
                </article>
              ))}
            </div>
            {selected.nextInstallment ? (
              <div className="arcpass-plan-actions">
                <button type="button" className="arcpass-dark-button" onClick={() => void copyNext(selected)}>{copiedPlanId === selected.planId ? "Link copied" : "Copy next payment link"}</button>
                <a className="arcpass-ghost-button" href={selected.nextInstallment.link} target="_blank" rel="noreferrer">Open next checkout</a>
              </div>
            ) : <p className="arcpass-success">All scheduled installments have verified Arc receipts.</p>}
            {selected.registeredCount < selected.installmentCount ? <p className="arcpass-error">This plan is missing registered installment links. Do not collect against an incomplete schedule.</p> : null}
          </aside>
        </div>
      ) : (
        <div className="arcpass-plan-empty">
          <span aria-hidden="true">◫</span>
          <div><strong>No installment plans yet.</strong><p>Choose installments in the invoice builder to create an exact schedule of independently payable links.</p></div>
          <button type="button" className="arcpass-ghost-button" onClick={onCreatePlan}>Build the first plan</button>
        </div>
      )}

      <p className="arcpass-plan-disclosure">Partial payment never weakens an invoice lock: each link still accepts one exact token amount and one verified transaction.</p>
    </section>
  );
}

function PlanMetric({ detail, label, tone = "neutral", value }: { detail: string; label: string; tone?: "caution" | "neutral" | "success"; value: number }) {
  return <div data-tone={tone}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}
