"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import type { Address } from "viem";
import { shortAddress } from "@/lib/format";
import {
  WEBHOOK_EVENT_LABELS,
  WEBHOOK_EVENT_TYPES,
  isWebhookDelivery,
  isWebhookEndpoint,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEventType,
} from "@/lib/webhooks";

export function DeveloperCenter({ walletAddress }: { walletAddress: Address | null }) {
  const [copied, setCopied] = useState<string | null>(null);
  const [deliveries, setDeliveries] = useState<WebhookDelivery[]>([]);
  const [endpointUrl, setEndpointUrl] = useState("");
  const [endpoints, setEndpoints] = useState<WebhookEndpoint[]>([]);
  const [error, setError] = useState<string | null>(null);
  const [isCreating, setIsCreating] = useState(false);
  const [isLoading, setIsLoading] = useState(false);
  const [pendingAction, setPendingAction] = useState<string | null>(null);
  const [revealedSecret, setRevealedSecret] = useState<{ endpointId: string; value: string } | null>(null);
  const [selectedEvents, setSelectedEvents] = useState<WebhookEventType[]>([...WEBHOOK_EVENT_TYPES]);

  const loadWorkspace = useCallback(async () => {
    if (!walletAddress) {
      setDeliveries([]);
      setEndpoints([]);
      return;
    }
    setIsLoading(true);
    setError(null);
    try {
      const response = await fetch(`/api/webhooks?merchant=${encodeURIComponent(walletAddress)}`, { cache: "no-store" });
      const body = (await response.json().catch(() => null)) as { deliveries?: unknown[]; endpoints?: unknown[]; error?: string } | null;
      if (!response.ok) throw new Error(body?.error || "Developer workspace could not be loaded.");
      setEndpoints((body?.endpoints ?? []).filter(isWebhookEndpoint));
      setDeliveries((body?.deliveries ?? []).filter(isWebhookDelivery));
    } catch (loadError) {
      setError(loadError instanceof Error ? loadError.message : "Developer workspace could not be loaded.");
    } finally {
      setIsLoading(false);
    }
  }, [walletAddress]);

  useEffect(() => {
    const timer = window.setTimeout(() => { void loadWorkspace(); }, 0);
    return () => window.clearTimeout(timer);
  }, [loadWorkspace]);

  const metrics = useMemo(() => {
    const delivered = deliveries.filter((delivery) => delivery.status === "delivered").length;
    const failed = deliveries.filter((delivery) => delivery.status === "failed").length;
    return { active: endpoints.filter((endpoint) => endpoint.status === "active").length, delivered, failed };
  }, [deliveries, endpoints]);

  async function createEndpoint() {
    if (!walletAddress) return;
    setError(null);
    setIsCreating(true);
    setRevealedSecret(null);
    try {
      const response = await fetch("/api/webhooks", {
        body: JSON.stringify({ events: selectedEvents, merchant: walletAddress, url: endpointUrl }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as { endpoint?: unknown; error?: string; signingSecret?: unknown } | null;
      if (!response.ok || !isWebhookEndpoint(body?.endpoint) || typeof body?.signingSecret !== "string") {
        throw new Error(body?.error || "Webhook endpoint could not be created.");
      }
      setEndpoints((current) => [body.endpoint as WebhookEndpoint, ...current]);
      setEndpointUrl("");
      setRevealedSecret({ endpointId: body.endpoint.endpointId, value: body.signingSecret });
    } catch (createError) {
      setError(createError instanceof Error ? createError.message : "Webhook endpoint could not be created.");
    } finally {
      setIsCreating(false);
    }
  }

  async function setEndpointStatus(endpoint: WebhookEndpoint) {
    if (!walletAddress) return;
    setPendingAction(endpoint.endpointId);
    setError(null);
    try {
      const response = await fetch("/api/webhooks", {
        body: JSON.stringify({ endpointId: endpoint.endpointId, merchant: walletAddress, status: endpoint.status === "active" ? "paused" : "active" }),
        headers: { "content-type": "application/json" },
        method: "PATCH",
      });
      const body = (await response.json().catch(() => null)) as { endpoint?: unknown; error?: string } | null;
      if (!response.ok || !isWebhookEndpoint(body?.endpoint)) throw new Error(body?.error || "Webhook endpoint could not be updated.");
      setEndpoints((current) => current.map((item) => item.endpointId === endpoint.endpointId ? body.endpoint as WebhookEndpoint : item));
    } catch (updateError) {
      setError(updateError instanceof Error ? updateError.message : "Webhook endpoint could not be updated.");
    } finally {
      setPendingAction(null);
    }
  }

  async function deleteEndpoint(endpoint: WebhookEndpoint) {
    if (!walletAddress || !window.confirm(`Remove the webhook endpoint at ${endpoint.url}? Delivery history for this endpoint will also be removed.`)) return;
    setPendingAction(endpoint.endpointId);
    setError(null);
    try {
      const response = await fetch("/api/webhooks", {
        body: JSON.stringify({ endpointId: endpoint.endpointId, merchant: walletAddress }),
        headers: { "content-type": "application/json" },
        method: "DELETE",
      });
      const body = (await response.json().catch(() => null)) as { deleted?: boolean; error?: string } | null;
      if (!response.ok || body?.deleted !== true) throw new Error(body?.error || "Webhook endpoint could not be removed.");
      setEndpoints((current) => current.filter((item) => item.endpointId !== endpoint.endpointId));
      setDeliveries((current) => current.filter((delivery) => delivery.endpointId !== endpoint.endpointId));
      if (revealedSecret?.endpointId === endpoint.endpointId) setRevealedSecret(null);
    } catch (deleteError) {
      setError(deleteError instanceof Error ? deleteError.message : "Webhook endpoint could not be removed.");
    } finally {
      setPendingAction(null);
    }
  }

  async function sendTest(endpointId: string) {
    await runDeliveryAction({ action: "test", endpointId, pendingId: endpointId });
  }

  async function retryDelivery(deliveryId: string) {
    await runDeliveryAction({ action: "retry", deliveryId, pendingId: deliveryId });
  }

  async function runDeliveryAction({ action, deliveryId, endpointId, pendingId }: { action: "retry" | "test"; deliveryId?: string; endpointId?: string; pendingId: string }) {
    if (!walletAddress) return;
    setPendingAction(pendingId);
    setError(null);
    try {
      const response = await fetch("/api/webhooks", {
        body: JSON.stringify({ action, deliveryId, endpointId, merchant: walletAddress }),
        headers: { "content-type": "application/json" },
        method: "POST",
      });
      const body = (await response.json().catch(() => null)) as { delivery?: unknown; error?: string } | null;
      if (!response.ok || !isWebhookDelivery(body?.delivery)) throw new Error(body?.error || "Webhook delivery could not be completed.");
      const delivery = body.delivery;
      setDeliveries((current) => [delivery, ...current.filter((item) => item.deliveryId !== delivery.deliveryId)]);
    } catch (deliveryError) {
      setError(deliveryError instanceof Error ? deliveryError.message : "Webhook delivery could not be completed.");
    } finally {
      setPendingAction(null);
    }
  }

  async function copyValue(id: string, value: string) {
    await window.navigator.clipboard.writeText(value);
    setCopied(id);
  }

  function toggleEvent(event: WebhookEventType) {
    setSelectedEvents((current) => current.includes(event) ? current.filter((item) => item !== event) : [...current, event]);
  }

  if (!walletAddress) {
    return <section className="arcpass-panel arcpass-developer-center"><div className="arcpass-developer-empty"><span aria-hidden="true">{`{ }`}</span><div><strong>Connect the owner wallet to open Developer Center.</strong><p>Webhook endpoints are protected by the signed merchant session and belong to one wallet workspace.</p></div></div></section>;
  }

  return (
    <section className="arcpass-panel arcpass-developer-center">
      <div className="arcpass-developer-heading">
        <div><p className="arcpass-panel-label">Webhook and Developer Center</p><h3>Bring ArcPass events into your own product.</h3><p>Subscribe to invoice, payment, refund, and approval events without delaying the checkout flow.</p></div>
        <button type="button" className="arcpass-ghost-button" onClick={() => void loadWorkspace()} disabled={isLoading}>{isLoading ? "Refreshing" : "Refresh"}</button>
      </div>

      <div className="arcpass-developer-metrics">
        <DeveloperMetric label="Active endpoints" value={String(metrics.active)} detail={`${endpoints.length}/5 configured`} />
        <DeveloperMetric label="Delivered" value={String(metrics.delivered)} detail="Recent successful calls" tone="success" />
        <DeveloperMetric label="Needs attention" value={String(metrics.failed)} detail="Available for manual retry" tone={metrics.failed ? "caution" : "neutral"} />
        <DeveloperMetric label="Security" value="HMAC SHA256" detail="Timestamped request signatures" tone="primary" />
      </div>

      <div className="arcpass-developer-grid">
        <section className="arcpass-developer-section arcpass-webhook-builder">
          <div><p className="arcpass-panel-label">Add an endpoint</p><h3>Choose where events should arrive.</h3><p>ArcPass accepts public HTTPS URLs only. Local, private, and credential bearing destinations are blocked.</p></div>
          <label className="arcpass-webhook-url"><span>Endpoint URL</span><input value={endpointUrl} onChange={(event) => setEndpointUrl(event.target.value)} placeholder="https://api.example.com/webhooks/arcpass" inputMode="url" /></label>
          <fieldset><legend>Subscribed events</legend><div className="arcpass-webhook-events">{WEBHOOK_EVENT_TYPES.map((event) => <label key={event}><input type="checkbox" checked={selectedEvents.includes(event)} onChange={() => toggleEvent(event)} /><span>{WEBHOOK_EVENT_LABELS[event]}</span><small>{event}</small></label>)}</div></fieldset>
          <button type="button" className="arcpass-dark-button" onClick={() => void createEndpoint()} disabled={isCreating || selectedEvents.length === 0}>{isCreating ? "Creating endpoint" : "Create webhook endpoint"}</button>
        </section>

        <section className="arcpass-developer-section arcpass-webhook-docs">
          <div><p className="arcpass-panel-label">Verify every request</p><h3>Signatures cover the raw body and timestamp.</h3><p>Reject old timestamps, recreate the HMAC value, then compare it with the signature header using a constant time comparison.</p></div>
          <div className="arcpass-code-block"><div><span>Node.js example</span><button type="button" onClick={() => void copyValue("code", SIGNATURE_EXAMPLE)}>{copied === "code" ? "Copied" : "Copy"}</button></div><pre>{SIGNATURE_EXAMPLE}</pre></div>
          <dl><div><dt>Event</dt><dd>x-arcpass-event</dd></div><div><dt>Delivery</dt><dd>x-arcpass-delivery</dd></div><div><dt>Timestamp</dt><dd>x-arcpass-timestamp</dd></div><div><dt>Signature</dt><dd>x-arcpass-signature</dd></div></dl>
        </section>
      </div>

      {revealedSecret ? <section className="arcpass-webhook-secret" role="status"><div><span>Signing secret created</span><strong>{revealedSecret.value}</strong><p>Copy this secret now. ArcPass encrypts it for delivery signing and will not reveal it again.</p></div><div><button type="button" className="arcpass-ghost-button" onClick={() => void copyValue("secret", revealedSecret.value)}>{copied === "secret" ? "Secret copied" : "Copy secret"}</button><button type="button" className="arcpass-text-button" onClick={() => setRevealedSecret(null)}>I saved it</button></div></section> : null}
      {error ? <p className="arcpass-error" role="alert">{error}</p> : null}

      <section className="arcpass-endpoint-list">
        <div className="arcpass-developer-section-head"><div><span>Registered endpoints</span><strong>Merchant owned destinations</strong></div><small>{endpoints.length} total</small></div>
        {endpoints.length ? <div>{endpoints.map((endpoint) => <article key={endpoint.endpointId} data-status={endpoint.status}>
          <div className="arcpass-endpoint-identity"><span aria-hidden="true">↗</span><div><strong>{endpoint.url}</strong><small>{endpoint.endpointId} · secret ending {endpoint.secretHint}</small></div></div>
          <div className="arcpass-endpoint-events">{endpoint.events.map((event) => <span key={event}>{WEBHOOK_EVENT_LABELS[event]}</span>)}</div>
          <div className="arcpass-endpoint-actions"><em>{endpoint.status}</em><button type="button" onClick={() => void sendTest(endpoint.endpointId)} disabled={pendingAction === endpoint.endpointId}>{pendingAction === endpoint.endpointId ? "Sending" : "Send test"}</button><button type="button" onClick={() => void setEndpointStatus(endpoint)} disabled={pendingAction === endpoint.endpointId}>{endpoint.status === "active" ? "Pause" : "Resume"}</button><button type="button" onClick={() => void deleteEndpoint(endpoint)} disabled={pendingAction === endpoint.endpointId}>Remove</button></div>
        </article>)}</div> : <div className="arcpass-developer-empty"><span aria-hidden="true">↗</span><div><strong>No webhook endpoints yet.</strong><p>Create one to receive signed ArcPass events in your backend.</p></div></div>}
      </section>

      <section className="arcpass-delivery-log">
        <div className="arcpass-developer-section-head"><div><span>Recent deliveries</span><strong>Response and retry history</strong></div><small>{deliveries.length} recent</small></div>
        {deliveries.length ? <div>{deliveries.map((delivery) => <article key={delivery.deliveryId} data-status={delivery.status}>
          <span className="arcpass-delivery-dot" aria-hidden="true" />
          <div><strong>{WEBHOOK_EVENT_LABELS[delivery.eventType]}</strong><small>{delivery.deliveryId} · {shortAddress(delivery.endpointId)}</small></div>
          <div><span>{delivery.responseStatus ? `HTTP ${delivery.responseStatus}` : delivery.status}</span><small>{delivery.attemptCount} attempt{delivery.attemptCount === 1 ? "" : "s"}</small></div>
          <div><span>{new Date(delivery.createdAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}</span>{delivery.lastError ? <small>{delivery.lastError}</small> : <small>Delivered successfully</small>}</div>
          <button type="button" className="arcpass-ghost-button" onClick={() => void retryDelivery(delivery.deliveryId)} disabled={pendingAction === delivery.deliveryId}>{pendingAction === delivery.deliveryId ? "Retrying" : "Retry"}</button>
        </article>)}</div> : <div className="arcpass-developer-empty"><span aria-hidden="true">✓</span><div><strong>No deliveries recorded.</strong><p>Send a test event after registering an endpoint to inspect the complete flow.</p></div></div>}
      </section>
    </section>
  );
}

function DeveloperMetric({ detail, label, tone = "neutral", value }: { detail: string; label: string; tone?: "caution" | "neutral" | "primary" | "success"; value: string }) {
  return <div data-tone={tone}><span>{label}</span><strong>{value}</strong><small>{detail}</small></div>;
}

const SIGNATURE_EXAMPLE = `const crypto = require("node:crypto");

const timestamp = request.headers["x-arcpass-timestamp"];
const received = request.headers["x-arcpass-signature"];
const signed = timestamp + "." + rawRequestBody;
const expected = "v1=" + crypto
  .createHmac("sha256", process.env.ARCPASS_WEBHOOK_SECRET)
  .update(signed)
  .digest("hex");

const receivedBuffer = Buffer.from(received);
const expectedBuffer = Buffer.from(expected);
const fresh = Math.abs(Date.now() / 1000 - Number(timestamp)) <= 300;
const valid = fresh &&
  receivedBuffer.length === expectedBuffer.length &&
  crypto.timingSafeEqual(receivedBuffer, expectedBuffer);`;
