import type { Address, Hash } from "viem";
import type { ArcPassTokenSymbol } from "./arcpass.ts";
import type { SavedInvoice } from "./invoices.ts";
import type { SavedReceipt } from "./receipts.ts";

export const PAYMENT_INTENT_ATTENTION_WINDOW_MS = 24 * 60 * 60 * 1000;

export type PaymentIntentState = "attention" | "awaiting" | "expired" | "settled";
export type PaymentIntentRoute = "arc-direct" | "arc-or-cctp";
export type PaymentIntentFilter = "all" | "needs-action" | "awaiting" | "settled";

export type ArcPassPaymentIntent = {
  amount: string;
  createdAt: string;
  description: string;
  expiresAt: string;
  intentId: string;
  invoiceId: string;
  link: string;
  merchantDomain: string;
  nextAction: string;
  payer: Address | null;
  receiptBlock: string | null;
  receiptUrl: string | null;
  route: PaymentIntentRoute;
  state: PaymentIntentState;
  token: ArcPassTokenSymbol;
  txHash: Hash | null;
  updatedAt: string;
};

export type PaymentIntentSummary = {
  attention: number;
  awaiting: number;
  expired: number;
  needsAction: number;
  settlementRate: number;
  settled: number;
  total: number;
};

export function buildPaymentIntents(
  invoices: SavedInvoice[],
  receipts: SavedReceipt[],
  now = new Date(),
): ArcPassPaymentIntent[] {
  const nowMs = now.getTime();

  return invoices
    .map((saved) => {
      const { invoice } = saved;
      const receipt = receipts.find((candidate) => receiptMatchesInvoice(candidate, saved)) ?? null;
      const expiresAtMs = new Date(invoice.expiresAt).getTime();
      const route: PaymentIntentRoute = invoice.token === "USDC" ? "arc-or-cctp" : "arc-direct";
      const state: PaymentIntentState = receipt
        ? "settled"
        : expiresAtMs <= nowMs
          ? "expired"
          : expiresAtMs - nowMs <= PAYMENT_INTENT_ATTENTION_WINDOW_MS
            ? "attention"
            : "awaiting";

      return {
        amount: invoice.amount,
        createdAt: invoice.createdAt,
        description: invoice.description,
        expiresAt: invoice.expiresAt,
        intentId: arcPassPaymentIntentId(invoice.invoiceId),
        invoiceId: invoice.invoiceId,
        link: saved.link,
        merchantDomain: invoice.merchant.domain,
        nextAction: paymentIntentNextAction(state),
        payer: receipt?.payer ?? null,
        receiptBlock: receipt?.blockNumber ?? null,
        receiptUrl: receipt?.explorerUrl ?? null,
        route,
        state,
        token: invoice.token,
        txHash: receipt?.txHash ?? null,
        updatedAt: receipt?.paidAt ?? invoice.createdAt,
      };
    })
    .sort((a, b) => intentPriority(a, nowMs) - intentPriority(b, nowMs));
}

export function summarizePaymentIntents(intents: ArcPassPaymentIntent[]): PaymentIntentSummary {
  const summary: PaymentIntentSummary = {
    attention: 0,
    awaiting: 0,
    expired: 0,
    needsAction: 0,
    settlementRate: 0,
    settled: 0,
    total: intents.length,
  };

  for (const intent of intents) summary[intent.state] += 1;
  summary.needsAction = summary.attention + summary.expired;
  summary.settlementRate = summary.total === 0 ? 0 : Math.round((summary.settled / summary.total) * 100);
  return summary;
}

export function filterPaymentIntents(
  intents: ArcPassPaymentIntent[],
  filter: PaymentIntentFilter,
  query: string,
) {
  const normalizedQuery = query.trim().toLowerCase();

  return intents.filter((intent) => {
    if (filter === "needs-action" && intent.state !== "attention" && intent.state !== "expired") return false;
    if (filter === "awaiting" && intent.state !== "awaiting") return false;
    if (filter === "settled" && intent.state !== "settled") return false;
    if (!normalizedQuery) return true;

    return [
      intent.amount,
      intent.description,
      intent.intentId,
      intent.invoiceId,
      intent.merchantDomain,
      intent.payer ?? "",
      intent.token,
      intent.txHash ?? "",
    ].some((value) => value.toLowerCase().includes(normalizedQuery));
  });
}

export function arcPassPaymentIntentId(invoiceId: string) {
  const suffix = invoiceId.replace(/^inv_/, "").replace(/[^a-zA-Z0-9_-]/g, "").slice(0, 48);
  return `apt_${suffix || "unknown"}`;
}

export function paymentIntentStateLabel(state: PaymentIntentState) {
  if (state === "attention") return "Needs attention";
  if (state === "expired") return "Expired";
  if (state === "settled") return "Settled";
  return "Awaiting payer";
}

export function paymentIntentRouteLabel(route: PaymentIntentRoute) {
  return route === "arc-or-cctp" ? "Arc direct · CCTP ready" : "Arc direct";
}

function paymentIntentNextAction(state: PaymentIntentState) {
  if (state === "attention") return "Share or remind the payer before expiry.";
  if (state === "expired") return "Create a replacement invoice before collecting funds.";
  if (state === "settled") return "Review the verified Arc receipt.";
  return "Await payer confirmation or share the checkout link.";
}

function receiptMatchesInvoice(receipt: SavedReceipt, saved: SavedInvoice) {
  const { invoice } = saved;
  return receipt.invoiceId === invoice.invoiceId
    && receipt.amount === invoice.amount
    && receipt.token === invoice.token
    && receipt.merchant.toLowerCase() === invoice.merchant.walletAddress.toLowerCase();
}

function intentPriority(intent: ArcPassPaymentIntent, nowMs: number) {
  const stateRank: Record<PaymentIntentState, number> = {
    attention: 0,
    awaiting: 1,
    expired: 2,
    settled: 3,
  };
  const stateWeight = stateRank[intent.state] * 10_000_000_000_000;
  const relevantTime = intent.state === "settled"
    ? -new Date(intent.updatedAt).getTime()
    : Math.abs(new Date(intent.expiresAt).getTime() - nowMs);
  return stateWeight + relevantTime;
}
