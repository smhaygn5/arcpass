"use client";

import { useCallback, useEffect, useState } from "react";
import Link from "next/link";
import type { Address } from "viem";
import { ArcPassMark } from "@/components/ArcPassMark";
import { shortAddress } from "@/lib/format";
import { approvalStatusLabel, isApprovalRequestView, type ApprovalRequestView } from "@/lib/team-policies";
import { requestWalletAddress, signWalletMessage, walletErrorMessage } from "@/lib/wallet";

export function TeamApprovalPanel({ requestId }: { requestId: string }) {
  const [approver, setApprover] = useState<Address | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [isSigning, setIsSigning] = useState(false);
  const [message, setMessage] = useState("");
  const [request, setRequest] = useState<ApprovalRequestView | null>(null);

  const loadRequest = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const res = await fetch(`/api/approvals?requestId=${encodeURIComponent(requestId)}`, { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as { error?: string; message?: unknown; request?: unknown } | null;
      if (!res.ok || !isApprovalRequestView(body?.request) || typeof body?.message !== "string") throw new Error(body?.error || "Approval request could not be loaded.");
      setRequest(body.request);
      setMessage(body.message);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Approval request could not be loaded.");
      setRequest(null);
    } finally {
      setIsLoading(false);
    }
  }, [requestId]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadRequest(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadRequest]);

  async function approve() {
    if (!request || !message) return;
    setError(null);
    setIsSigning(true);
    try {
      const address = await requestWalletAddress();
      setApprover(address);
      const signature = await signWalletMessage(address, message);
      const res = await fetch("/api/approvals", { body: JSON.stringify({ action: "approve", address, requestId: request.requestId, signature }), headers: { "content-type": "application/json" }, method: "POST" });
      const body = (await res.json().catch(() => null)) as { error?: string; request?: unknown } | null;
      if (!res.ok || !isApprovalRequestView(body?.request)) throw new Error(body?.error || "Approval signature could not be recorded.");
      setRequest(body.request);
    } catch (err) {
      setError(walletErrorMessage(err));
    } finally {
      setIsSigning(false);
    }
  }

  return (
    <main className="arcpass-page arcpass-approval-page">
      <nav className="arcpass-approval-nav"><Link href="/" aria-label="Open ArcPass home"><ArcPassMark /></Link><span>Gas-free team review</span></nav>
      <section className="arcpass-approval-shell">
        {isLoading ? <div className="arcpass-panel"><p className="arcpass-muted">Loading the locked approval request.</p></div> : null}
        {!isLoading && !request ? <div className="arcpass-panel arcpass-approval-unavailable"><p className="arcpass-panel-label">Request unavailable</p><h1>This approval link cannot be verified.</h1><p>{error}</p><Link href="/" className="arcpass-dark-button">Return to ArcPass</Link></div> : null}
        {request ? (
          <>
            <header className="arcpass-approval-hero">
              <span data-status={request.status}>{request.status === "approved" ? "✓" : request.status === "expired" ? "×" : "2"}</span>
              <p className="arcpass-eyebrow">Team approval request</p>
              <h1>{request.operationLabel}</h1>
              <p>Review the exact invoice operation before signing. This signature records approval only—it cannot move funds or authorize token access.</p>
            </header>
            <div className="arcpass-approval-layout">
              <section className="arcpass-panel arcpass-approval-review">
                <div className="arcpass-approval-status"><span>{approvalStatusLabel(request.status)}</span><strong>{request.approvals.length}/{request.requiredApprovals} signatures</strong></div>
                <div className="arcpass-approval-invoices">{request.invoices.map((invoice) => <article key={invoice.invoiceId}><div><strong>{invoice.description}</strong><small>{invoice.invoiceId}</small></div><b>{invoice.amount} {invoice.token}</b></article>)}</div>
                <div className="arcpass-detail-list">
                  <ApprovalDetail label="Merchant wallet" value={shortAddress(request.merchant)} />
                  <ApprovalDetail label="Request ID" value={request.requestId} />
                  <ApprovalDetail label="Expires" value={new Date(request.expiresAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })} />
                </div>
              </section>
              <aside className="arcpass-panel arcpass-approval-action">
                <p className="arcpass-panel-label">Your decision</p>
                <h3>{request.status === "pending" ? "Sign this locked operation" : approvalStatusLabel(request.status)}</h3>
                <p>{request.status === "pending" ? "ArcPass will ask your wallet for one readable, gas-free signature. Only Owner and Approver wallets are accepted." : request.status === "approved" ? "The signature quorum is complete and the invoices are registered in the shared ArcPass ledger." : "The invoice deadline passed before the signature quorum was completed."}</p>
                {request.status === "pending" ? <button type="button" className="arcpass-dark-button" onClick={() => void approve()} disabled={isSigning}>{isSigning ? "Waiting for wallet signature" : approver ? `Sign as ${shortAddress(approver)}` : "Connect & approve"}</button> : null}
                {request.approvals.length ? <div className="arcpass-approval-signers"><span>Recorded approvals</span>{request.approvals.map((approval) => <strong key={approval.approver}>✓ {shortAddress(approval.approver)} <small>{new Date(approval.approvedAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</small></strong>)}</div> : null}
                {error ? <p className="arcpass-error" role="alert">{error}</p> : null}
              </aside>
            </div>
          </>
        ) : null}
      </section>
    </main>
  );
}

function ApprovalDetail({ label, value }: { label: string; value: string }) {
  return <div className="arcpass-detail-row"><span>{label}</span><strong>{value}</strong></div>;
}
