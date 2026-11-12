"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { ARC_X402_NETWORK, isX402Access, isX402Resource, x402AccessWindow, x402PayerMetrics, x402ResourceUrl, type X402Access, type X402ResourceSummary } from "@/lib/x402";
import { createX402SettlementReceipt, type X402SettlementReceipt } from "@/lib/x402-receipt";

type WorkspaceResponse = {
  activeResources?: unknown;
  accesses?: unknown[];
  error?: string;
  latestAccessAt?: unknown;
  paidRequests?: unknown;
  payerCount?: unknown;
  resources?: unknown[];
  settledAmount?: unknown;
  topResource?: unknown;
};

type Inspection = {
  rawRequirement: Record<string, unknown>;
  resourceId: string;
  status: number;
  requirement: {
    amount?: string;
    network?: string;
    scheme?: string;
    settlement?: string;
  } | null;
};

export function NanopaymentCenter({ walletAddress }: { walletAddress: Address | null }) {
  const [accesses, setAccesses] = useState<X402Access[]>([]);
  const [copied, setCopied] = useState<string | null>(null);
  const [curlCopied, setCurlCopied] = useState<string | null>(null);
  const [description, setDescription] = useState("Fresh Arc Testnet metrics returned as JSON for one paid request.");
  const [expiresAt, setExpiresAt] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [limitInput, setLimitInput] = useState("");
  const [limitResource, setLimitResource] = useState<X402ResourceSummary | null>(null);
  const [maxCalls, setMaxCalls] = useState("");
  const [pendingResource, setPendingResource] = useState<string | null>(null);
  const [price, setPrice] = useState("0.01");
  const [resources, setResources] = useState<X402ResourceSummary[]>([]);
  const [receiptCopied, setReceiptCopied] = useState<string | null>(null);
  const [renewalExpiry, setRenewalExpiry] = useState(renewalInput());
  const [renewalResource, setRenewalResource] = useState<X402ResourceSummary | null>(null);
  const [requirementCopied, setRequirementCopied] = useState<string | null>(null);
  const [selectedReceipt, setSelectedReceipt] = useState<X402SettlementReceipt | null>(null);
  const [responseBody, setResponseBody] = useState('{\n  "network": "Arc Testnet",\n  "status": "available",\n  "source": "ArcPass x402"\n}');
  const [selectedAccessResource, setSelectedAccessResource] = useState("all");
  const [stats, setStats] = useState({ activeResources: 0, latestAccessAt: null as string | null, paidRequests: 0, payerCount: 0, settledAmount: "0", topResource: null as { accessCount: number; title: string } | null });
  const [title, setTitle] = useState("Arc network snapshot");

  const loadWorkspace = useCallback(async () => {
    if (!walletAddress) {
      setAccesses([]);
      setResources([]);
      setStats({ activeResources: 0, latestAccessAt: null, paidRequests: 0, payerCount: 0, settledAmount: "0", topResource: null });
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/x402/resources?merchant=${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as WorkspaceResponse | null;
      if (!response.ok) throw new Error(body?.error || "Nanopayment workspace could not be loaded.");
      const items = (body?.resources ?? []).filter(isResourceSummary);
      setAccesses((body?.accesses ?? []).filter(isX402Access));
      setResources(items);
      setStats({
        activeResources: Number.isInteger(body?.activeResources) ? Number(body?.activeResources) : items.filter((item) => item.status === "active").length,
        latestAccessAt: typeof body?.latestAccessAt === "string" ? body.latestAccessAt : null,
        paidRequests: Number.isInteger(body?.paidRequests) ? Number(body?.paidRequests) : items.reduce((total, item) => total + item.accessCount, 0),
        payerCount: Number.isInteger(body?.payerCount) ? Number(body?.payerCount) : 0,
        settledAmount: typeof body?.settledAmount === "string" ? body.settledAmount : "0",
        topResource: isTopResource(body?.topResource) ? body.topResource : null,
      });
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Nanopayment workspace could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadWorkspace(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  const average = useMemo(() => stats.paidRequests ? Number(stats.settledAmount) / stats.paidRequests : 0, [stats]);
  const visibleAccesses = useMemo(() => selectedAccessResource === "all" ? accesses : accesses.filter((access) => access.resourceId === selectedAccessResource), [accesses, selectedAccessResource]);
  const payerInsights = useMemo(() => x402PayerMetrics(visibleAccesses), [visibleAccesses]);
  const accessAttention = useMemo(() => resources.map((resource) => ({ resource, window: x402AccessWindow(resource.expiresAt) })).filter(({ window }) => window.state === "ending" || window.state === "expired"), [resources]);
  const capacityAttention = useMemo(() => resources.filter((resource) => resource.maxCalls && resource.accessCount / resource.maxCalls >= 0.8).sort((left, right) => (right.accessCount / (right.maxCalls ?? 1)) - (left.accessCount / (left.maxCalls ?? 1))), [resources]);

  async function createResource() {
    if (!walletAddress) return;
    setError(null);
    setInspection(null);
    setIsCreating(true);
    try {
      const response = await fetch("/api/x402/resources", {
        body: JSON.stringify({ description, expiresAt: expiresAt ? new Date(expiresAt).toISOString() : undefined, maxCalls: maxCalls || undefined, merchant: walletAddress, price, responseBody, title }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as { error?: string; resource?: unknown } | null;
      if (!response.ok || !isX402Resource(body?.resource)) throw new Error(body?.error || "Nanopayment resource could not be created.");
      const resource: X402ResourceSummary = { ...body.resource, accessCount: 0, settledAmount: "0" };
      setResources((current) => [resource, ...current]);
      setStats((current) => ({ ...current, activeResources: current.activeResources + 1 }));
      setTitle("");
      setDescription("");
      setExpiresAt("");
      setMaxCalls("");
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Nanopayment resource could not be created.");
    } finally {
      setIsCreating(false);
    }
  }

  async function setResourceStatus(resource: X402ResourceSummary) {
    if (!walletAddress) return;
    setPendingResource(resource.resourceId);
    setError(null);
    const status = resource.status === "active" ? "paused" : "active";
    try {
      const response = await fetch("/api/x402/resources", {
        body: JSON.stringify({ merchant: walletAddress, resourceId: resource.resourceId, status }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      const body = (await response.json().catch(() => null)) as { error?: string; resource?: unknown } | null;
      if (!response.ok || !isX402Resource(body?.resource)) throw new Error(body?.error || "Resource status could not be changed.");
      const updatedResource = body.resource;
      setResources((current) => current.map((item) => item.resourceId === resource.resourceId ? { ...item, ...updatedResource } : item));
      setStats((current) => ({ ...current, activeResources: current.activeResources + (status === "active" ? 1 : -1) }));
    } catch (statusError) {
      setError(statusError instanceof Error ? statusError.message : "Resource status could not be changed.");
    } finally {
      setPendingResource(null);
    }
  }

  function openRenewal(resource: X402ResourceSummary) {
    setError(null);
    setRenewalResource(resource);
    setRenewalExpiry(renewalInput(resource.expiresAt));
  }

  async function renewResource() {
    if (!walletAddress || !renewalResource) return;
    setPendingResource(renewalResource.resourceId);
    setError(null);
    try {
      const response = await fetch("/api/x402/resources", {
        body: JSON.stringify({ expiresAt: new Date(renewalExpiry).toISOString(), merchant: walletAddress, resourceId: renewalResource.resourceId }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      const body = (await response.json().catch(() => null)) as { error?: string; resource?: unknown } | null;
      if (!response.ok || !isX402Resource(body?.resource)) throw new Error(body?.error || "Access expiry could not be renewed.");
      const updatedResource = body.resource;
      setResources((current) => current.map((item) => item.resourceId === renewalResource.resourceId ? { ...item, ...updatedResource } : item));
      setRenewalResource(null);
    } catch (renewError) {
      setError(renewError instanceof Error ? renewError.message : "Access expiry could not be renewed.");
    } finally {
      setPendingResource(null);
    }
  }

  function openLimitEditor(resource: X402ResourceSummary) {
    setError(null);
    setLimitResource(resource);
    setLimitInput(resource.maxCalls ? String(resource.maxCalls) : "");
  }

  async function saveUsageLimit() {
    if (!walletAddress || !limitResource) return;
    setPendingResource(limitResource.resourceId);
    setError(null);
    try {
      const response = await fetch("/api/x402/resources", {
        body: JSON.stringify({ maxCalls: limitInput.trim() || null, merchant: walletAddress, resourceId: limitResource.resourceId }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      const body = (await response.json().catch(() => null)) as { error?: string; resource?: unknown } | null;
      if (!response.ok || !isX402Resource(body?.resource)) throw new Error(body?.error || "Usage limit could not be updated.");
      const updatedResource = body.resource;
      setResources((current) => current.map((item) => item.resourceId === limitResource.resourceId ? { ...item, ...updatedResource } : item));
      setLimitResource(null);
    } catch (limitError) {
      setError(limitError instanceof Error ? limitError.message : "Usage limit could not be updated.");
    } finally {
      setPendingResource(null);
    }
  }

  async function inspectPaymentRequirement(resource: X402ResourceSummary) {
    setPendingResource(resource.resourceId);
    setError(null);
    setInspection(null);
    try {
      const response = await fetch(x402ResourceUrl("", resource.resourceId), { headers: { accept: "application/json" } });
      const encoded = response.headers.get("payment-required");
      if (response.status !== 402 || !encoded) throw new Error("The endpoint did not return a valid x402 v2 payment requirement.");
      const paymentRequired = JSON.parse(window.atob(encoded)) as unknown;
      if (!isRecord(paymentRequired)) throw new Error("The endpoint returned an unreadable x402 payment requirement.");
      const accepted = Array.isArray(paymentRequired.accepts) && isRecord(paymentRequired.accepts[0]) ? paymentRequired.accepts[0] : null;
      setInspection({
        rawRequirement: paymentRequired,
        resourceId: resource.resourceId,
        status: response.status,
        requirement: accepted ? {
          amount: typeof accepted.amount === "string" ? accepted.amount : undefined,
          network: typeof accepted.network === "string" ? accepted.network : undefined,
          scheme: typeof accepted.scheme === "string" ? accepted.scheme : undefined,
          settlement: isRecord(accepted.extra) && typeof accepted.extra.name === "string" ? accepted.extra.name : undefined,
        } : null,
      });
    } catch (inspectError) {
      setError(inspectError instanceof Error ? inspectError.message : "Payment requirement could not be inspected.");
    } finally {
      setPendingResource(null);
    }
  }

  async function copyEndpoint(resourceId: string) {
    await window.navigator.clipboard.writeText(new URL(x402ResourceUrl("", resourceId), window.location.origin).toString());
    setCopied(resourceId);
  }

  async function copyCurlCommand(resourceId: string) {
    const url = new URL(x402ResourceUrl("", resourceId), window.location.origin).toString();
    await window.navigator.clipboard.writeText(`curl -i -H "Accept: application/json" "${url}"`);
    setCurlCopied(resourceId);
  }

  async function copyPaymentRequirement() {
    if (!inspection) return;
    await window.navigator.clipboard.writeText(JSON.stringify(inspection.rawRequirement, null, 2));
    setRequirementCopied(inspection.resourceId);
  }

  function openSettlementReceipt(access: X402Access) {
    setReceiptCopied(null);
    setSelectedReceipt(createX402SettlementReceipt(access, resources.find((resource) => resource.resourceId === access.resourceId)));
  }

  async function copySettlementReceipt() {
    if (!selectedReceipt) return;
    await window.navigator.clipboard.writeText(JSON.stringify(selectedReceipt, null, 2));
    setReceiptCopied(selectedReceipt.receiptId);
  }

  function downloadSettlementReceipt() {
    if (!selectedReceipt) return;
    const blob = new Blob([JSON.stringify(selectedReceipt, null, 2)], { type: "application/json" });
    const href = URL.createObjectURL(blob);
    const anchor = document.createElement("a");
    anchor.href = href;
    anchor.download = `${selectedReceipt.receiptId}.json`;
    document.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
    URL.revokeObjectURL(href);
  }

  if (!walletAddress) {
    return <section className="arcpass-panel arcpass-nanopayment-center"><div className="arcpass-developer-empty"><span aria-hidden="true">402</span><div><strong>Connect the owner wallet to open Nanopayment Mode.</strong><p>Resources, usage totals, and controls stay inside the signed merchant workspace.</p></div></div></section>;
  }

  return (
    <section className="arcpass-panel arcpass-nanopayment-center">
      <div className="arcpass-nanopayment-heading">
        <div><p className="arcpass-panel-label">x402 Nanopayment Mode</p><h3>Charge per request, not per subscription.</h3><p>Create an HTTP 402 protected JSON resource. Circle Gateway verifies the signed USDC authorization and batches settlement on Arc Testnet.</p></div>
        <div className="arcpass-x402-protocol"><span>Protocol</span><strong>x402 v2</strong><small>{ARC_X402_NETWORK}</small></div>
      </div>

      <div className="arcpass-nanopayment-metrics">
        <Metric label="Active resources" value={String(stats.activeResources)} detail={`${resources.length} configured`} />
        <Metric label="Paid requests" value={String(stats.paidRequests)} detail="Gateway accepted calls" />
        <Metric label="Settled volume" value={`${stats.settledAmount} USDC`} detail="Recorded payment receipts" />
        <Metric label="Average request" value={`${formatUsdc(average)} USDC`} detail="Across completed calls" />
        <Metric label="Unique payers" value={String(stats.payerCount)} detail={stats.latestAccessAt ? `Last call ${formatRelativeTime(stats.latestAccessAt)}` : "No settled calls yet"} />
      </div>

      <section className="arcpass-x402-inspection" aria-label="Resource usage insight"><div><span>Usage insight</span><strong>{stats.topResource ? `${stats.topResource.title} leads with ${stats.topResource.accessCount} paid calls` : "Usage insights appear after the first settled call"}</strong></div></section>

      {accessAttention.length ? <section className="arcpass-x402-access-attention" aria-live="polite"><div><span>Access attention</span><strong>{accessAttention.length} resource{accessAttention.length === 1 ? "" : "s"} need{accessAttention.length === 1 ? "s" : ""} review</strong><p>Timed endpoints reject new requests after their access window ends.</p></div><ul>{accessAttention.map(({ resource, window }) => <li key={resource.resourceId} data-state={window.state}><strong>{resource.title}</strong><span>{window.label}</span></li>)}</ul></section> : null}

      {capacityAttention.length ? <section className="arcpass-x402-capacity-attention" aria-live="polite"><div><span>Usage capacity</span><strong>{capacityAttention.length} resource{capacityAttention.length === 1 ? " is" : "s are"} near its paid call limit</strong><p>Increase the cap before successful requests begin returning an unavailable response.</p></div><ul>{capacityAttention.map((resource) => <li key={resource.resourceId}><strong>{resource.title}</strong><span>{resource.accessCount} / {resource.maxCalls}</span></li>)}</ul></section> : null}

      {renewalResource ? <section className="arcpass-x402-renewal" aria-label="Renew resource access"><div><span>Renew access window</span><strong>{renewalResource.title}</strong><p>The protected endpoint stays the same. Only its access end time changes.</p></div><label><span>New access expiry</span><input type="datetime-local" value={renewalExpiry} onChange={(event) => setRenewalExpiry(event.target.value)} /></label><div className="arcpass-x402-resource-actions"><button type="button" className="arcpass-dark-button" onClick={() => void renewResource()} disabled={pendingResource === renewalResource.resourceId}>{pendingResource === renewalResource.resourceId ? "Saving" : "Save new expiry"}</button><button type="button" onClick={() => setRenewalResource(null)} disabled={pendingResource === renewalResource.resourceId}>Cancel</button></div></section> : null}

      {limitResource ? <section className="arcpass-x402-renewal" aria-label="Update resource usage limit"><div><span>Update paid call limit</span><strong>{limitResource.title}</strong><p>Leave the field empty to remove the cap. Existing paid calls remain recorded.</p></div><label><span>New paid call limit</span><input value={limitInput} onChange={(event) => setLimitInput(event.target.value)} inputMode="numeric" placeholder="Unlimited" /></label><div className="arcpass-x402-resource-actions"><button type="button" className="arcpass-dark-button" onClick={() => void saveUsageLimit()} disabled={pendingResource === limitResource.resourceId}>{pendingResource === limitResource.resourceId ? "Saving" : "Save limit"}</button><button type="button" onClick={() => setLimitResource(null)} disabled={pendingResource === limitResource.resourceId}>Cancel</button></div></section> : null}

      <div className="arcpass-nanopayment-grid">
        <section className="arcpass-nanopayment-builder">
          <div><p className="arcpass-panel-label">Create a paid resource</p><h3>Define the price and protected response.</h3><p>The response is released only after a valid Circle Gateway settlement. Do not place credentials or private keys in the JSON body.</p></div>
          <div className="arcpass-nanopayment-form-row"><label><span>Resource name</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="Arc network snapshot" /></label><label><span>Price per request</span><div className="arcpass-price-input"><input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" aria-label="Price per request in USDC" /><strong>USDC</strong></div></label></div>
          <div className="arcpass-nanopayment-form-row"><label><span>Description</span><input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={240} placeholder="Describe what the buyer receives" /></label><label><span>Access expires</span><input type="datetime-local" value={expiresAt} onChange={(event) => setExpiresAt(event.target.value)} /></label><label><span>Paid call limit</span><input value={maxCalls} onChange={(event) => setMaxCalls(event.target.value)} inputMode="numeric" placeholder="Unlimited" /></label></div>
          <label><span>Protected JSON response</span><textarea value={responseBody} onChange={(event) => setResponseBody(event.target.value)} rows={7} spellCheck={false} /></label>
          <button type="button" className="arcpass-dark-button" onClick={() => void createResource()} disabled={isCreating}>{isCreating ? "Creating resource" : "Create x402 resource"}</button>
        </section>

        <section className="arcpass-nanopayment-flow">
          <div><p className="arcpass-panel-label">Request lifecycle</p><h3>One HTTP exchange, four visible steps.</h3></div>
          <ol>
            <li><span>01</span><div><strong>Request</strong><p>The client calls the resource without an API key or subscription.</p></div></li>
            <li><span>02</span><div><strong>HTTP 402</strong><p>ArcPass returns price, Arc CAIP 2 network, asset, and recipient in PAYMENT REQUIRED.</p></div></li>
            <li><span>03</span><div><strong>Offchain signature</strong><p>The buyer signs an EIP 3009 authorization using a funded Circle Gateway balance.</p></div></li>
            <li><span>04</span><div><strong>Settle and unlock</strong><p>Gateway accepts the payment, ArcPass records the receipt, and the JSON response is released.</p></div></li>
          </ol>
          <div className="arcpass-nanopayment-note"><strong>Noncustodial by design</strong><p>ArcPass never asks for a merchant private key. The destination is the connected merchant wallet and payment authorization remains with the buyer.</p></div>
        </section>
      </div>

      {error ? <p className="arcpass-error" role="alert">{error}</p> : null}
      {inspection ? <section className="arcpass-x402-inspection" role="status"><div><span>Endpoint response</span><strong>HTTP {inspection.status} Payment Required</strong></div><dl><div><dt>Scheme</dt><dd>{inspection.requirement?.scheme ?? "Unavailable"}</dd></div><div><dt>Network</dt><dd>{inspection.requirement?.network ?? "Unavailable"}</dd></div><div><dt>Atomic amount</dt><dd>{inspection.requirement?.amount ?? "Unavailable"}</dd></div><div><dt>Settlement</dt><dd>{inspection.requirement?.settlement ?? "Unavailable"}</dd></div></dl><details className="arcpass-x402-requirement-json"><summary>View payment requirement JSON</summary><pre>{JSON.stringify(inspection.rawRequirement, null, 2)}</pre><button type="button" onClick={() => void copyPaymentRequirement()}>{requirementCopied === inspection.resourceId ? "Requirement copied" : "Copy payment requirement"}</button></details></section> : null}

      <section className="arcpass-x402-resource-list">
        <div className="arcpass-developer-section-head"><div><span>Metered resources</span><strong>Live endpoints and settlement totals</strong></div><button type="button" className="arcpass-ghost-button" onClick={() => void loadWorkspace()} disabled={isLoading}>{isLoading ? "Refreshing" : "Refresh"}</button></div>
        {resources.length ? <div>{resources.map((resource) => {
          const accessWindow = x402AccessWindow(resource.expiresAt);
          return <article key={resource.resourceId} data-status={resource.status} data-access-window={accessWindow.state}>
          <div className="arcpass-x402-resource-main"><div className="arcpass-x402-resource-icon" aria-hidden="true">402</div><div><strong>{resource.title}</strong><p>{resource.description}</p><code>{x402ResourceUrl("", resource.resourceId)}</code></div></div>
          <div className="arcpass-x402-resource-stats"><div><span>Price</span><strong>{resource.price} USDC</strong></div><div><span>Paid calls</span><strong>{resource.maxCalls ? `${resource.accessCount} / ${resource.maxCalls}` : resource.accessCount}</strong></div><div><span>Settled</span><strong>{resource.settledAmount} USDC</strong></div><div><span>Access</span><strong>{accessWindow.label}</strong></div><em>{resource.status}</em></div>
          <div className="arcpass-x402-resource-actions"><button type="button" onClick={() => void copyEndpoint(resource.resourceId)}>{copied === resource.resourceId ? "Endpoint copied" : "Copy endpoint"}</button><button type="button" onClick={() => void copyCurlCommand(resource.resourceId)}>{curlCopied === resource.resourceId ? "cURL copied" : "Copy cURL"}</button><button type="button" onClick={() => openRenewal(resource)}>{resource.expiresAt ? "Renew access" : "Set expiry"}</button><button type="button" onClick={() => openLimitEditor(resource)}>Edit usage limit</button><button type="button" onClick={() => void inspectPaymentRequirement(resource)} disabled={pendingResource === resource.resourceId}>{pendingResource === resource.resourceId ? "Checking" : "Inspect 402"}</button><button type="button" onClick={() => void setResourceStatus(resource)} disabled={pendingResource === resource.resourceId}>{resource.status === "active" ? "Pause" : "Activate"}</button></div>
        </article>})}</div> : <div className="arcpass-developer-empty"><span aria-hidden="true">402</span><div><strong>No nanopayment resources yet.</strong><p>Create one above to receive a standards based payment requirement endpoint.</p></div></div>}
      </section>

      <section className="arcpass-x402-resource-list">
        <div className="arcpass-developer-section-head"><div><span>Recent paid calls</span><strong>Verified x402 settlement history</strong></div><div className="arcpass-x402-resource-actions"><select aria-label="Filter paid calls by resource" value={selectedAccessResource} onChange={(event) => setSelectedAccessResource(event.target.value)}><option value="all">All resources</option>{resources.map((resource) => <option key={resource.resourceId} value={resource.resourceId}>{resource.title}</option>)}</select><button type="button" className="arcpass-ghost-button" onClick={() => exportAccessCsv(visibleAccesses, resources)} disabled={!visibleAccesses.length}>Export CSV</button></div></div>
        {visibleAccesses.length ? <div>{visibleAccesses.map((access) => <article key={access.accessId}>
          <div className="arcpass-x402-resource-main"><div className="arcpass-x402-resource-icon" aria-hidden="true">✓</div><div><strong>{resources.find((resource) => resource.resourceId === access.resourceId)?.title ?? "Protected resource"}</strong><p>{shortAddress(access.payer)} paid {atomicToUsdc(access.amount)} USDC</p><code>{access.transaction}</code></div></div>
          <div className="arcpass-x402-resource-stats"><div><span>Settled</span><strong>{formatDate(access.createdAt)}</strong></div><div><span>Network</span><strong>{access.network}</strong></div></div><div className="arcpass-x402-resource-actions"><button type="button" onClick={() => openSettlementReceipt(access)}>View receipt</button></div>
        </article>)}</div> : <div className="arcpass-developer-empty"><span aria-hidden="true">✓</span><div><strong>{accesses.length ? "No paid calls for this resource." : "No settled x402 calls yet."}</strong><p>Verified paid requests will appear here after Circle Gateway accepts them.</p></div></div>}
      </section>

      {payerInsights.length ? <section className="arcpass-x402-payer-insights"><div className="arcpass-developer-section-head"><div><span>Payer insights</span><strong>{selectedAccessResource === "all" ? "Recent payer activity across all resources" : "Recent payer activity for this resource"}</strong></div><small>{payerInsights.length} unique payer{payerInsights.length === 1 ? "" : "s"}</small></div><div>{payerInsights.slice(0, 6).map((payer) => <article key={payer.payer}><div><strong>{shortAddress(payer.payer)}</strong><span>{payer.callCount} paid call{payer.callCount === 1 ? "" : "s"} across {payer.resourceCount} resource{payer.resourceCount === 1 ? "" : "s"}</span></div><div><strong>{payer.settledAmount} USDC</strong><span>Last call {formatRelativeTime(payer.lastAccessAt)}</span></div></article>)}</div></section> : null}

      {selectedReceipt ? <section className="arcpass-x402-settlement-receipt" aria-label="x402 settlement receipt"><div><span>Settlement receipt</span><strong>{selectedReceipt.resource.title}</strong><p>{selectedReceipt.amountUsdc} USDC settled on {selectedReceipt.network}</p></div><dl><div><dt>Receipt</dt><dd>{selectedReceipt.receiptId}</dd></div><div><dt>Payer</dt><dd>{selectedReceipt.payer}</dd></div><div><dt>Transaction</dt><dd>{selectedReceipt.transaction}</dd></div><div><dt>Settled</dt><dd>{formatDate(selectedReceipt.settledAt)}</dd></div></dl><div className="arcpass-x402-resource-actions"><button type="button" onClick={() => void copySettlementReceipt()}>{receiptCopied === selectedReceipt.receiptId ? "Receipt copied" : "Copy receipt"}</button><button type="button" onClick={downloadSettlementReceipt}>Download JSON</button><button type="button" onClick={() => setSelectedReceipt(null)}>Close</button></div></section> : null}
    </section>
  );
}

function Metric({ detail, label, value }: { detail: string; label: string; value: string }) {
  return <div><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

function isResourceSummary(value: unknown): value is X402ResourceSummary {
  if (!isX402Resource(value) || !isRecord(value)) return false;
  const record = value as Record<string, unknown>;
  return Number.isInteger(record["accessCount"]) && Number(record["accessCount"]) >= 0 && typeof record["settledAmount"] === "string";
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isTopResource(value: unknown): value is { accessCount: number; title: string } {
  return isRecord(value) && Number.isInteger(value.accessCount) && Number(value.accessCount) >= 0 && typeof value.title === "string";
}

function formatRelativeTime(value: string) {
  const elapsed = Date.now() - new Date(value).getTime();
  if (!Number.isFinite(elapsed) || elapsed < 60_000) return "just now";
  const minutes = Math.floor(elapsed / 60_000);
  if (minutes < 60) return `${minutes}m ago`;
  const hours = Math.floor(minutes / 60);
  return hours < 24 ? `${hours}h ago` : `${Math.floor(hours / 24)}d ago`;
}

function formatUsdc(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0";
  return value.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 0, useGrouping: false });
}

function atomicToUsdc(value: string) {
  const amount = Number(value) / 1_000_000;
  return formatUsdc(amount);
}

function formatDate(value: string) {
  const date = new Date(value);
  return Number.isFinite(date.getTime()) ? date.toLocaleString("en-US", { dateStyle: "medium", timeStyle: "short" }) : "Unavailable";
}

function shortAddress(value: string) {
  return `${value.slice(0, 6)}…${value.slice(-4)}`;
}

function renewalInput(value?: string) {
  const existing = value ? new Date(value).getTime() : 0;
  const date = new Date(Math.max(Number.isFinite(existing) ? existing : 0, Date.now() + 7 * 24 * 60 * 60 * 1_000));
  const offset = date.getTimezoneOffset() * 60_000;
  return new Date(date.getTime() - offset).toISOString().slice(0, 16);
}

function exportAccessCsv(accesses: X402Access[], resources: X402ResourceSummary[]) {
  const resourceNames = new Map(resources.map((resource) => [resource.resourceId, resource.title]));
  const rows = [
    ["settled_at", "resource", "payer", "amount_usdc", "network", "transaction"],
    ...accesses.map((access) => [access.createdAt, resourceNames.get(access.resourceId) ?? access.resourceId, access.payer, atomicToUsdc(access.amount), access.network, access.transaction]),
  ];
  const csv = rows.map((row) => row.map(csvCell).join(",")).join("\n");
  const blob = new Blob([csv], { type: "text/csv;charset=utf-8" });
  const href = URL.createObjectURL(blob);
  const anchor = document.createElement("a");
  anchor.href = href;
  anchor.download = "arcpass-x402-paid-calls.csv";
  document.body.appendChild(anchor);
  anchor.click();
  anchor.remove();
  URL.revokeObjectURL(href);
}

function csvCell(value: string) {
  const safe = /^[=+\-@]/.test(value) ? `'${value}` : value;
  return `"${safe.replaceAll('"', '""')}"`;
}
