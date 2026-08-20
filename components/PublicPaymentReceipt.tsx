"use client";

import { useEffect, useState } from "react";
import type { ArcPassInvoice } from "@/lib/arcpass";
import { shortAddress } from "@/lib/format";
import { isReceiptForInvoice, publicPaymentReceiptLink, type PublicPaymentReceipt } from "@/lib/payment-receipt";
import { ArcPassMark } from "@/components/ArcPassMark";

type ReceiptState = "loading" | "ready" | "unavailable";

export function PublicPaymentReceipt({ invoice, payload }: { invoice: ArcPassInvoice; payload: string }) {
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<PublicPaymentReceipt | null>(null);
  const [state, setState] = useState<ReceiptState>("loading");
  const checkoutLink = `/pay/${encodeURIComponent(payload)}`;
  const receiptLink = publicPaymentReceiptLink(payload);

  useEffect(() => {
    async function loadReceipt() {
      try {
        const res = await fetch(`/api/public-invoice-state?payload=${encodeURIComponent(payload)}`, { cache: "no-store" });
        const body = (await res.json().catch(() => null)) as { paid?: boolean; receipt?: unknown; registered?: boolean; error?: string } | null;
        if (!res.ok || body?.registered !== true || body?.paid !== true || !isReceiptForInvoice(body.receipt, invoice)) {
          throw new Error(body?.error || "A verified ArcPass receipt is not available for this invoice.");
        }
        setReceipt(body.receipt);
        setState("ready");
      } catch (err) {
        setError(err instanceof Error ? err.message : "The receipt could not be loaded.");
        setState("unavailable");
      }
    }
    void loadReceipt();
  }, [invoice, payload]);

  async function shareReceipt() {
    try {
      if (navigator.share) {
        await navigator.share({ title: `ArcPass receipt · ${invoice.invoiceId}`, text: `Verified payment for ${invoice.description}`, url: window.location.href });
        return;
      }
      await navigator.clipboard.writeText(window.location.href);
    } catch {
      // A cancelled share dialog does not affect receipt validity.
    }
  }

  return (
    <main className="arcpass-page arcpass-receipt-page">
      <section className="arcpass-public-receipt">
        <nav className="arcpass-public-receipt-nav"><ArcPassMark /><a href={checkoutLink}>View invoice</a></nav>
        {state === "loading" ? <p className="arcpass-muted">Checking the ArcPass registry for this receipt.</p> : null}
        {state === "unavailable" ? (
          <div className="arcpass-receipt-unavailable"><p className="arcpass-panel-label">Receipt unavailable</p><h1>No verified payment receipt found.</h1><p>{error}</p><a href={checkoutLink} className="arcpass-dark-button">Return to invoice</a></div>
        ) : null}
        {state === "ready" && receipt ? (
          <>
            <header className="arcpass-receipt-hero"><span aria-hidden="true">✓</span><p className="arcpass-eyebrow">Payment verified</p><h1>Receipt issued successfully.</h1><p>ArcPass matched this payment to the locked invoice and merchant wallet on Arc Testnet.</p></header>
            <section className="arcpass-receipt-card">
              <div className="arcpass-receipt-total"><span>Amount paid</span><strong>{receipt.amount} {receipt.token}</strong></div>
              <div className="arcpass-receipt-details">
                <ReceiptDetail label="Invoice" value={receipt.invoiceId} />
                <ReceiptDetail label="Payment date" value={new Date(receipt.paidAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })} />
                <ReceiptDetail label="Merchant" value={invoice.merchant.businessName} />
                <ReceiptDetail label="Buyer wallet" value={shortAddress(receipt.payer)} />
                <ReceiptDetail label="Merchant wallet" value={shortAddress(receipt.merchant)} />
                <ReceiptDetail label="Network" value="Arc Testnet" />
              </div>
              <div className="arcpass-receipt-transaction"><span>Transaction hash</span><a href={receipt.explorerUrl} target="_blank" rel="noreferrer">{shortAddress(receipt.txHash)}</a><small>Block {receipt.blockNumber} · Verified by ArcPass registry</small></div>
              <div className="arcpass-receipt-actions"><button type="button" onClick={() => window.print()} className="arcpass-ghost-button">Print receipt</button><button type="button" onClick={shareReceipt} className="arcpass-dark-button">Share receipt</button></div>
            </section>
            <p className="arcpass-receipt-note">Receipt link: {receiptLink}</p>
          </>
        ) : null}
      </section>
    </main>
  );
}

function ReceiptDetail({ label, value }: { label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong></div>;
}
