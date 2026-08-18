"use client";

import { useEffect, useState } from "react";
import type { ArcPassInvoice } from "@/lib/arcpass";
import {
  merchantExplorerUrl,
  trustLabel,
  trustScore,
  trustSignals,
} from "@/lib/arcpass";
import { shortAddress } from "@/lib/format";
import { ArcPassMark } from "@/components/ArcPassMark";

type PublicState = "checking" | "verified" | "unverified";

export function PublicMerchantPassport({
  invoice,
  payload,
}: {
  invoice: ArcPassInvoice;
  payload: string;
}) {
  const [state, setState] = useState<PublicState>("checking");
  const score = trustScore(invoice.merchant);

  useEffect(() => {
    let active = true;
    void fetch(`/api/public-invoice-state?payload=${encodeURIComponent(payload)}`, { cache: "no-store" })
      .then(async (response) => {
        const body = (await response.json().catch(() => null)) as { registered?: boolean } | null;
        if (active) setState(response.ok && body?.registered === true ? "verified" : "unverified");
      })
      .catch(() => { if (active) setState("unverified"); });
    return () => { active = false; };
  }, [payload]);

  return (
    <main className="arcpass-page arcpass-public-passport-page">
      <section className="arcpass-checkout-hero">
        <div className="arcpass-hero-background" aria-hidden="true" />
        <nav className="arcpass-checkout-nav">
          <ArcPassMark />
          <span>{state === "checking" ? "Checking registry" : state === "verified" ? "Registry verified" : "Not verified"}</span>
        </nav>
        <div className="arcpass-checkout-content">
          <div className="arcpass-checkout-copy">
            <p className="arcpass-eyebrow">Shareable merchant passport</p>
            <h1>{state === "verified" ? invoice.merchant.businessName : "Merchant profile unavailable"}</h1>
            <p>{state === "verified" ? "This profile is bound to an ArcPass server-issued invoice. Review the merchant signals before continuing to checkout." : "ArcPass could not confirm this profile against a registered invoice. Do not use it as a payment instruction."}</p>
          </div>
          <aside className="arcpass-checkout-paybox">
            <p className="arcpass-panel-label">Passport status</p>
            <strong>{state === "verified" ? `${score}/100` : "—"}</strong>
            <p className="arcpass-muted">{state === "verified" ? trustLabel(score) : "Registry confirmation required"}</p>
          </aside>
        </div>
        <ArcPassMark compact className="arcpass-corner-logo" />
      </section>

      <section className="arcpass-public-passport-shell">
        {state === "checking" ? <div className="arcpass-panel"><p className="arcpass-muted">Checking the ArcPass registry before showing merchant details.</p></div> : null}
        {state === "unverified" ? <div className="arcpass-panel arcpass-public-passport-warning"><h3>Profile not verified</h3><p>Only registry-verified profiles should be used to assess a merchant or open checkout.</p></div> : null}
        {state === "verified" ? (
          <>
            <section className="arcpass-panel">
              <p className="arcpass-panel-label">Merchant identity</p>
              <h3>{invoice.merchant.businessName}</h3>
              <div className="arcpass-detail-list">
                <div className="arcpass-detail-row"><span>Domain</span><strong>{invoice.merchant.domain}</strong></div>
                <div className="arcpass-detail-row"><span>Merchant wallet</span><strong>{shortAddress(invoice.merchant.walletAddress)}</strong></div>
                <div className="arcpass-detail-row"><span>Refund policy</span><strong>{invoice.merchant.refundPolicy}</strong></div>
                <div className="arcpass-detail-row"><span>Current checkout</span><strong>{invoice.amount} {invoice.token}</strong></div>
              </div>
              <a className="arcpass-link-preview" href={merchantExplorerUrl(invoice.merchant)} rel="noreferrer" target="_blank">View merchant wallet on ArcScan</a>
            </section>
            <section className="arcpass-panel">
              <p className="arcpass-panel-label">Trust signals</p>
              <h3>What ArcPass checked</h3>
              <div className="arcpass-passport-signals">
                {trustSignals(invoice.merchant).map((signal) => <div key={signal.label}><span data-active={signal.active}>{signal.active ? "✓" : "·"}</span><strong>{signal.label}</strong><small>{signal.points} points</small></div>)}
              </div>
            </section>
            <section className="arcpass-panel arcpass-public-passport-action">
              <p className="arcpass-panel-label">Verified payment link</p>
              <h3>{invoice.description}</h3>
              <p className="arcpass-muted">This checkout keeps the amount, token, merchant wallet, and expiry in its invoice lock.</p>
              <a className="arcpass-dark-button" href={`/pay/${payload}`}>Open verified checkout</a>
            </section>
          </>
        ) : null}
      </section>
    </main>
  );
}
