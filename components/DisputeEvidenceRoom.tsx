"use client";

import { useCallback, useEffect, useState } from "react";
import type { Address } from "viem";
import {
  disputeEvidenceMessage,
  isDisputeEvidence,
  normalizeDisputeStatement,
  normalizeEvidenceSha256,
  normalizeEvidenceUrl,
  type DisputeEvidence,
  type DisputeEvidenceRole,
} from "@/lib/disputes";
import { isRefundRequest, type RefundRequest } from "@/lib/refunds";
import { shortAddress } from "@/lib/format";
import { requestVerifiedWalletAddressSelection, signWalletMessage, walletErrorMessage } from "@/lib/wallet";

type DisputeRoomResponse = {
  error?: string;
  room?: { evidence?: unknown[]; refund?: unknown } | null;
};

export function DisputeEvidenceRoom({
  defaultOpen = false,
  onRequestUpdated,
  request,
  viewerRole,
  walletAddress,
}: {
  defaultOpen?: boolean;
  onRequestUpdated?: (request: RefundRequest) => void;
  request: RefundRequest;
  viewerRole: DisputeEvidenceRole;
  walletAddress?: Address | null;
}) {
  const [evidence, setEvidence] = useState<DisputeEvidence[]>([]);
  const [evidenceSha256, setEvidenceSha256] = useState("");
  const [evidenceUrl, setEvidenceUrl] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(defaultOpen);
  const [isOpen, setIsOpen] = useState(defaultOpen);
  const [isSubmitting, setIsSubmitting] = useState(false);
  const [loaded, setLoaded] = useState(false);
  const [statement, setStatement] = useState("");

  const loadRoom = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const query = viewerRole === "merchant"
        ? `requestId=${encodeURIComponent(request.requestId)}&merchant=${encodeURIComponent(request.merchant)}`
        : `txHash=${encodeURIComponent(request.txHash)}`;
      const res = await fetch(`/api/disputes?${query}`, { cache: "no-store" });
      const body = (await res.json().catch(() => null)) as DisputeRoomResponse | null;
      if (!res.ok || !body?.room || !isRefundRequest(body.room.refund)) {
        throw new Error(body?.error || "The evidence room could not be loaded.");
      }
      setEvidence((body.room.evidence ?? []).filter(isDisputeEvidence));
      onRequestUpdated?.(body.room.refund);
      setLoaded(true);
    } catch (err) {
      setError(err instanceof Error ? err.message : "The evidence room could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [onRequestUpdated, request.merchant, request.requestId, request.txHash, viewerRole]);

  useEffect(() => {
    if (!defaultOpen) return;
    let cancelled = false;
    const query = viewerRole === "merchant"
      ? `requestId=${encodeURIComponent(request.requestId)}&merchant=${encodeURIComponent(request.merchant)}`
      : `txHash=${encodeURIComponent(request.txHash)}`;
    void fetch(`/api/disputes?${query}`, { cache: "no-store" })
      .then(async (res) => {
        const body = (await res.json().catch(() => null)) as DisputeRoomResponse | null;
        if (!res.ok || !body?.room || !isRefundRequest(body.room.refund)) {
          throw new Error(body?.error || "The evidence room could not be loaded.");
        }
        if (!cancelled) {
          setEvidence((body.room.evidence ?? []).filter(isDisputeEvidence));
          onRequestUpdated?.(body.room.refund);
          setLoaded(true);
        }
      })
      .catch((err: unknown) => {
        if (!cancelled) setError(err instanceof Error ? err.message : "The evidence room could not be loaded.");
      })
      .finally(() => {
        if (!cancelled) setIsLoading(false);
      });
    return () => { cancelled = true; };
  }, [defaultOpen, onRequestUpdated, request.merchant, request.requestId, request.txHash, viewerRole]);

  async function toggleRoom() {
    const nextOpen = !isOpen;
    setIsOpen(nextOpen);
    if (nextOpen && !loaded) await loadRoom();
  }

  async function submitEvidence() {
    setError(null);
    setIsSubmitting(true);
    try {
      const normalizedStatement = normalizeDisputeStatement(statement);
      const normalizedUrl = normalizeEvidenceUrl(evidenceUrl);
      const normalizedSha256 = normalizeEvidenceSha256(evidenceSha256);
      const signer = await requestVerifiedWalletAddressSelection();
      const expectedSigner = viewerRole === "payer" ? request.payer : request.merchant;
      if (signer.toLowerCase() !== expectedSigner.toLowerCase()) {
        throw new Error(`Connect the ${viewerRole} wallet for this dispute.`);
      }
      if (viewerRole === "merchant" && walletAddress && signer.toLowerCase() !== walletAddress.toLowerCase()) {
        throw new Error("The connected dashboard wallet changed. Reconnect the merchant wallet first.");
      }
      const message = disputeEvidenceMessage({
        evidenceSha256: normalizedSha256,
        evidenceUrl: normalizedUrl,
        invoiceId: request.invoiceId,
        requestId: request.requestId,
        role: viewerRole,
        signer,
        statement: normalizedStatement,
        txHash: request.txHash,
      });
      const signature = await signWalletMessage(signer, message);
      const res = await fetch("/api/disputes", {
        body: JSON.stringify({
          evidenceSha256: normalizedSha256,
          evidenceUrl: normalizedUrl,
          requestId: request.requestId,
          role: viewerRole,
          signature,
          signer,
          statement: normalizedStatement,
        }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await res.json().catch(() => null)) as { error?: string; evidence?: unknown } | null;
      const createdEvidence = body?.evidence;
      if (!res.ok || !isDisputeEvidence(createdEvidence)) throw new Error(body?.error || "Evidence could not be recorded.");
      setEvidence((current) => current.some((item) => item.evidenceId === createdEvidence.evidenceId) ? current : [...current, createdEvidence]);
      setStatement("");
      setEvidenceUrl("");
      setEvidenceSha256("");
      setLoaded(true);
    } catch (err) {
      setError(walletErrorMessage(err));
    } finally {
      setIsSubmitting(false);
    }
  }

  return (
    <section className="arcpass-evidence-room">
      <button type="button" className="arcpass-evidence-room-toggle" onClick={toggleRoom} aria-expanded={isOpen}>
        <span><b>Evidence room</b><small>Signed notes and delivery references</small></span>
        <span>{isOpen ? "Close" : "Open"}</span>
      </button>
      {isOpen ? (
        <div className="arcpass-evidence-room-body">
          <div className="arcpass-evidence-timeline">
            <article>
              <div><i data-role="payer">Payer</i><time>{formatDisputeDate(request.createdAt)}</time></div>
              <p>{request.reason}</p>
              <small>{request.requestSignature ? `Signed request · ${shortAddress(request.requestSignature)}` : "Signed request created before evidence receipts were stored"}</small>
            </article>
            {evidence.map((item) => (
              <article key={item.evidenceId}>
                <div><i data-role={item.role}>{item.role}</i><time>{formatDisputeDate(item.createdAt)}</time></div>
                <p>{item.statement}</p>
                {item.evidenceUrl ? <a href={item.evidenceUrl} target="_blank" rel="noreferrer">Open evidence link</a> : null}
                {item.evidenceSha256 ? <code title={item.evidenceSha256}>SHA256 {shortDigest(item.evidenceSha256)}</code> : null}
                <small>Signed by {shortAddress(item.signer)} · proof {shortAddress(item.signature)}</small>
              </article>
            ))}
            {isLoading ? <p className="arcpass-muted">Loading signed evidence.</p> : null}
            {!isLoading && loaded && evidence.length === 0 ? <p className="arcpass-muted">No additional evidence has been submitted.</p> : null}
            {request.decision ? (
              <article className="arcpass-evidence-decision">
                <div><i data-role="merchant">Merchant decision</i><time>{formatDisputeDate(request.decision.decidedAt)}</time></div>
                <strong>{request.decision.status}</strong>
                <p>{request.decision.note}</p>
                <small>Signed by {shortAddress(request.decision.signer)} · proof {shortAddress(request.decision.signature)}</small>
              </article>
            ) : null}
          </div>

          {request.status === "pending" ? (
            <div className="arcpass-evidence-form">
              <label><span>Evidence note</span><textarea value={statement} onChange={(event) => setStatement(event.target.value)} maxLength={1000} placeholder="Explain what this evidence shows and why it matters." /></label>
              <div className="arcpass-evidence-reference-grid">
                <label><span>HTTPS evidence link <small>Optional</small></span><input value={evidenceUrl} onChange={(event) => setEvidenceUrl(event.target.value)} inputMode="url" placeholder="https://..." /></label>
                <label><span>File SHA256 <small>Optional</small></span><input value={evidenceSha256} onChange={(event) => setEvidenceSha256(event.target.value)} autoCapitalize="none" spellCheck={false} placeholder="64 character digest" /></label>
              </div>
              <button type="button" className="arcpass-dark-button" onClick={submitEvidence} disabled={isSubmitting}>{isSubmitting ? "Waiting for signature" : `Sign as ${viewerRole} and add evidence`}</button>
              <p className="arcpass-muted">ArcPass stores the signed statement and reference. Linked files stay with their original host, so a SHA256 digest can be added to prove which version was reviewed.</p>
            </div>
          ) : <p className="arcpass-evidence-closed">Decision recorded. This room is now read only.</p>}
          {error ? <p className="arcpass-error" role="alert">{error}</p> : null}
        </div>
      ) : null}
    </section>
  );
}

function formatDisputeDate(value: string) {
  return new Date(value).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
}

function shortDigest(value: string) {
  return `${value.slice(0, 10)}…${value.slice(-8)}`;
}
