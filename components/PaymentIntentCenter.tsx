"use client";

import { useMemo, useState } from "react";
import type { SavedInvoice } from "@/lib/invoices";
import {
  buildPaymentIntents,
  filterPaymentIntents,
  paymentIntentRouteLabel,
  paymentIntentStateLabel,
  summarizePaymentIntents,
  type ArcPassPaymentIntent,
  type PaymentIntentFilter,
} from "@/lib/payment-intents";
import type { SavedReceipt } from "@/lib/receipts";
import { shortAddress } from "@/lib/format";

const INTENT_FILTERS: { id: PaymentIntentFilter; label: string }[] = [
  { id: "all", label: "All intents" },
  { id: "needs-action", label: "Needs action" },
  { id: "awaiting", label: "Awaiting" },
  { id: "settled", label: "Settled" },
];

export function PaymentIntentCenter({
  invoiceHistory,
  onCreateInvoice,
  receiptHistory,
}: {
  invoiceHistory: SavedInvoice[];
  onCreateInvoice: () => void;
  receiptHistory: SavedReceipt[];
}) {
  const [copiedIntentId, setCopiedIntentId] = useState<string | null>(null);
  const [filter, setFilter] = useState<PaymentIntentFilter>("all");
  const [query, setQuery] = useState("");
  const [selectedIntentId, setSelectedIntentId] = useState<string | null>(null);
  const intents = useMemo(() => buildPaymentIntents(invoiceHistory, receiptHistory), [invoiceHistory, receiptHistory]);
  const summary = useMemo(() => summarizePaymentIntents(intents), [intents]);
  const filteredIntents = useMemo(() => filterPaymentIntents(intents, filter, query), [filter, intents, query]);
  const selected = filteredIntents.find((intent) => intent.intentId === selectedIntentId) ?? filteredIntents[0] ?? null;

  async function copyCheckout(intent: ArcPassPaymentIntent) {
    await window.navigator.clipboard.writeText(intent.link);
    setCopiedIntentId(intent.intentId);
  }

  return (
    <div className="arcpass-intent-center">
      <section className="arcpass-panel arcpass-intent-command">
        <div className="arcpass-intent-heading">
          <div>
            <p className="arcpass-panel-label">ArcPass intent ledger</p>
            <h3>One operational view for every payment request.</h3>
            <p>Intent states are derived from registered invoices and verified Arc receipts. ArcPass never invents payer or settlement activity.</p>
          </div>
          <div className="arcpass-intent-heading-actions">
            <span>Ledger-derived</span>
            <button type="button" className="arcpass-dark-button" onClick={onCreateInvoice}>New invoice intent</button>
          </div>
        </div>

        <div className="arcpass-intent-summary">
          <IntentMetric label="Total intents" value={String(summary.total)} detail="Registered invoices" />
          <IntentMetric label="Active" value={String(summary.awaiting + summary.attention)} detail="Waiting for payer" />
          <IntentMetric label="Needs action" value={String(summary.needsAction)} detail="Attention or expired" tone={summary.needsAction ? "caution" : "neutral"} />
          <IntentMetric label="Settlement rate" value={`${summary.settlementRate}%`} detail={`${summary.settled} verified receipts`} tone="success" />
        </div>

        <div className="arcpass-intent-toolbar">
          <div className="arcpass-segmented-control" role="tablist" aria-label="Payment intent status">
            {INTENT_FILTERS.map((option) => (
              <button key={option.id} type="button" role="tab" aria-selected={filter === option.id} onClick={() => setFilter(option.id)}>
                {option.label}<span>{intentFilterCount(summary, option.id)}</span>
              </button>
            ))}
          </div>
          <label className="arcpass-search-field">
            <span>Search intents</span>
            <input value={query} onChange={(event) => setQuery(event.target.value)} placeholder="Intent, invoice, domain, amount" />
          </label>
        </div>

        {filteredIntents.length ? (
          <div className="arcpass-intent-workbench">
            <div className="arcpass-intent-list" role="list" aria-label="Payment intents">
              {filteredIntents.map((intent) => (
                <button key={intent.intentId} type="button" onClick={() => setSelectedIntentId(intent.intentId)} aria-pressed={selected?.intentId === intent.intentId}>
                  <span className="arcpass-intent-state-dot" data-state={intent.state} />
                  <span className="arcpass-intent-row-copy"><strong>{intent.description}</strong><small>{intent.intentId} · {intent.merchantDomain}</small></span>
                  <span className="arcpass-intent-row-meta"><strong>{intent.amount} {intent.token}</strong><small>{intentMomentLabel(intent)}</small></span>
                  <i data-state={intent.state}>{paymentIntentStateLabel(intent.state)}</i>
                </button>
              ))}
            </div>
            <IntentDetail
              copied={Boolean(selected && copiedIntentId === selected.intentId)}
              intent={selected}
              onCopy={copyCheckout}
              onCreateInvoice={onCreateInvoice}
            />
          </div>
        ) : (
          <div className="arcpass-intent-empty">
            <span aria-hidden="true">◎</span>
            <div><strong>{intents.length ? "No intents match this view." : "No payment intents yet."}</strong><p>{intents.length ? "Change the filter or search query." : "Create a registered invoice to open the first ArcPass intent."}</p></div>
            {!intents.length ? <button type="button" className="arcpass-ghost-button" onClick={onCreateInvoice}>Create invoice</button> : null}
          </div>
        )}

        <p className="arcpass-intent-disclosure">ArcPass intent IDs begin with <code>apt_</code> and are deterministic views of ArcPass invoices. They are not Circle Mint Payment Intent resources and require no Circle API key.</p>
      </section>
    </div>
  );
}

function IntentDetail({
  copied,
  intent,
  onCopy,
  onCreateInvoice,
}: {
  copied: boolean;
  intent: ArcPassPaymentIntent;
  onCopy: (intent: ArcPassPaymentIntent) => Promise<void>;
  onCreateInvoice: () => void;
}) {
  return (
    <aside className="arcpass-intent-detail">
      <div className="arcpass-intent-detail-head">
        <div><span>Selected intent</span><strong>{intent.intentId}</strong></div>
        <i data-state={intent.state}>{paymentIntentStateLabel(intent.state)}</i>
      </div>
      <div className="arcpass-intent-next-action"><span>Next action</span><strong>{intent.nextAction}</strong></div>
      <div className="arcpass-intent-detail-grid">
        <IntentFact label="Invoice" value={intent.invoiceId} />
        <IntentFact label="Route" value={paymentIntentRouteLabel(intent.route)} />
        <IntentFact label="Payer" value={intent.payer ? shortAddress(intent.payer) : "Not observed"} />
        <IntentFact label="Updated" value={formatIntentDate(intent.updatedAt)} />
      </div>
      <ol className="arcpass-intent-timeline">
        <IntentStage label="Intent created" detail={formatIntentDate(intent.createdAt)} state="complete" />
        <IntentStage label="Checkout issued" detail={`${intent.amount} ${intent.token} locked`} state="complete" />
        <IntentStage label="Payer settlement" detail={intent.payer ? shortAddress(intent.payer) : intent.state === "expired" ? "Window expired" : "Awaiting verified payer"} state={intent.state === "settled" ? "complete" : intent.state === "expired" ? "blocked" : "current"} />
        <IntentStage label="Receipt verified" detail={intent.receiptBlock ? `Arc block ${intent.receiptBlock}` : "No receipt yet"} state={intent.state === "settled" ? "complete" : "pending"} />
      </ol>
      <div className="arcpass-intent-actions">
        <button type="button" className="arcpass-dark-button" onClick={() => void onCopy(intent)}>{copied ? "Link copied" : "Copy checkout"}</button>
        <a href={intent.link} target="_blank" rel="noreferrer" className="arcpass-ghost-button">Open checkout</a>
        {intent.receiptUrl ? <a href={intent.receiptUrl} target="_blank" rel="noreferrer" className="arcpass-ghost-button">Open receipt</a> : null}
        {intent.state === "expired" ? <button type="button" className="arcpass-ghost-button" onClick={onCreateInvoice}>Replace intent</button> : null}
      </div>
      {!intent.payer ? <p className="arcpass-intent-privacy">Payer identity appears only after ArcPass verifies a matching on-chain receipt.</p> : null}
    </aside>
  );
}

function IntentMetric({ detail, label, tone = "neutral", value }: { detail: string; label: string; tone?: "caution" | "neutral" | "success"; value: string }) {
  return <div data-tone={tone}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function IntentFact({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}

function IntentStage({ detail, label, state }: { detail: string; label: string; state: "blocked" | "complete" | "current" | "pending" }) {
  return <li data-state={state}><span>{state === "complete" ? "✓" : state === "blocked" ? "!" : "·"}</span><div><strong>{label}</strong><small>{detail}</small></div></li>;
}

function intentFilterCount(summary: ReturnType<typeof summarizePaymentIntents>, filter: PaymentIntentFilter) {
  if (filter === "needs-action") return summary.needsAction;
  if (filter === "awaiting") return summary.awaiting;
  if (filter === "settled") return summary.settled;
  return summary.total;
}

function intentMomentLabel(intent: ArcPassPaymentIntent) {
  if (intent.state === "settled") return `Paid ${formatIntentDate(intent.updatedAt)}`;
  if (intent.state === "expired") return `Expired ${formatIntentDate(intent.expiresAt)}`;
  return `Expires ${formatIntentDate(intent.expiresAt)}`;
}

function formatIntentDate(value: string) {
  return new Date(value).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
}
