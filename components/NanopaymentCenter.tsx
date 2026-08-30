"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { ARC_X402_NETWORK, isX402Resource, x402ResourceUrl, type X402ResourceSummary } from "@/lib/x402";

type WorkspaceResponse = {
  activeResources?: unknown;
  error?: string;
  paidRequests?: unknown;
  resources?: unknown[];
  settledAmount?: unknown;
};

type Inspection = {
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
  const [copied, setCopied] = useState<string | null>(null);
  const [description, setDescription] = useState("Fresh Arc Testnet metrics returned as JSON for one paid request.");
  const [error, setError] = useState<string | null>(null);
  const [inspection, setInspection] = useState<Inspection | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingResource, setPendingResource] = useState<string | null>(null);
  const [price, setPrice] = useState("0.01");
  const [resources, setResources] = useState<X402ResourceSummary[]>([]);
  const [responseBody, setResponseBody] = useState('{\n  "network": "Arc Testnet",\n  "status": "available",\n  "source": "ArcPass x402"\n}');
  const [stats, setStats] = useState({ activeResources: 0, paidRequests: 0, settledAmount: "0" });
  const [title, setTitle] = useState("Arc network snapshot");

  const loadWorkspace = useCallback(async () => {
    if (!walletAddress) {
      setResources([]);
      setStats({ activeResources: 0, paidRequests: 0, settledAmount: "0" });
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/x402/resources?merchant=${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as WorkspaceResponse | null;
      if (!response.ok) throw new Error(body?.error || "Nanopayment workspace could not be loaded.");
      const items = (body?.resources ?? []).filter(isResourceSummary);
      setResources(items);
      setStats({
        activeResources: Number.isInteger(body?.activeResources) ? Number(body?.activeResources) : items.filter((item) => item.status === "active").length,
        paidRequests: Number.isInteger(body?.paidRequests) ? Number(body?.paidRequests) : items.reduce((total, item) => total + item.accessCount, 0),
        settledAmount: typeof body?.settledAmount === "string" ? body.settledAmount : "0",
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

  async function createResource() {
    if (!walletAddress) return;
    setError(null);
    setInspection(null);
    setIsCreating(true);
    try {
      const response = await fetch("/api/x402/resources", {
        body: JSON.stringify({ description, merchant: walletAddress, price, responseBody, title }),
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

  async function inspectPaymentRequirement(resource: X402ResourceSummary) {
    setPendingResource(resource.resourceId);
    setError(null);
    setInspection(null);
    try {
      const response = await fetch(x402ResourceUrl("", resource.resourceId), { headers: { accept: "application/json" } });
      const encoded = response.headers.get("payment-required");
      if (response.status !== 402 || !encoded) throw new Error("The endpoint did not return a valid x402 v2 payment requirement.");
      const paymentRequired = JSON.parse(window.atob(encoded)) as { accepts?: Array<Record<string, unknown>> };
      const accepted = paymentRequired.accepts?.[0];
      setInspection({
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
      </div>

      <div className="arcpass-nanopayment-grid">
        <section className="arcpass-nanopayment-builder">
          <div><p className="arcpass-panel-label">Create a paid resource</p><h3>Define the price and protected response.</h3><p>The response is released only after a valid Circle Gateway settlement. Do not place credentials or private keys in the JSON body.</p></div>
          <div className="arcpass-nanopayment-form-row"><label><span>Resource name</span><input value={title} onChange={(event) => setTitle(event.target.value)} maxLength={80} placeholder="Arc network snapshot" /></label><label><span>Price per request</span><div className="arcpass-price-input"><input value={price} onChange={(event) => setPrice(event.target.value)} inputMode="decimal" aria-label="Price per request in USDC" /><strong>USDC</strong></div></label></div>
          <label><span>Description</span><input value={description} onChange={(event) => setDescription(event.target.value)} maxLength={240} placeholder="Describe what the buyer receives" /></label>
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
      {inspection ? <section className="arcpass-x402-inspection" role="status"><div><span>Endpoint response</span><strong>HTTP {inspection.status} Payment Required</strong></div><dl><div><dt>Scheme</dt><dd>{inspection.requirement?.scheme ?? "Unavailable"}</dd></div><div><dt>Network</dt><dd>{inspection.requirement?.network ?? "Unavailable"}</dd></div><div><dt>Atomic amount</dt><dd>{inspection.requirement?.amount ?? "Unavailable"}</dd></div><div><dt>Settlement</dt><dd>{inspection.requirement?.settlement ?? "Unavailable"}</dd></div></dl></section> : null}

      <section className="arcpass-x402-resource-list">
        <div className="arcpass-developer-section-head"><div><span>Metered resources</span><strong>Live endpoints and settlement totals</strong></div><button type="button" className="arcpass-ghost-button" onClick={() => void loadWorkspace()} disabled={isLoading}>{isLoading ? "Refreshing" : "Refresh"}</button></div>
        {resources.length ? <div>{resources.map((resource) => <article key={resource.resourceId} data-status={resource.status}>
          <div className="arcpass-x402-resource-main"><div className="arcpass-x402-resource-icon" aria-hidden="true">402</div><div><strong>{resource.title}</strong><p>{resource.description}</p><code>{x402ResourceUrl("", resource.resourceId)}</code></div></div>
          <div className="arcpass-x402-resource-stats"><div><span>Price</span><strong>{resource.price} USDC</strong></div><div><span>Paid calls</span><strong>{resource.accessCount}</strong></div><div><span>Settled</span><strong>{resource.settledAmount} USDC</strong></div><em>{resource.status}</em></div>
          <div className="arcpass-x402-resource-actions"><button type="button" onClick={() => void copyEndpoint(resource.resourceId)}>{copied === resource.resourceId ? "Endpoint copied" : "Copy endpoint"}</button><button type="button" onClick={() => void inspectPaymentRequirement(resource)} disabled={pendingResource === resource.resourceId}>{pendingResource === resource.resourceId ? "Checking" : "Inspect 402"}</button><button type="button" onClick={() => void setResourceStatus(resource)} disabled={pendingResource === resource.resourceId}>{resource.status === "active" ? "Pause" : "Activate"}</button></div>
        </article>)}</div> : <div className="arcpass-developer-empty"><span aria-hidden="true">402</span><div><strong>No nanopayment resources yet.</strong><p>Create one above to receive a standards based payment requirement endpoint.</p></div></div>}
      </section>
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

function formatUsdc(value: number) {
  if (!Number.isFinite(value) || value === 0) return "0";
  return value.toLocaleString("en-US", { maximumFractionDigits: 6, minimumFractionDigits: 0, useGrouping: false });
}
