import { getAddress, isAddress, type Address } from "viem";

export const WEBHOOK_EVENT_TYPES = [
  "invoice.created",
  "payment.verified",
  "refund.requested",
  "refund.updated",
  "dispute.evidence_added",
  "approval.requested",
  "approval.completed",
] as const;

export type WebhookEventType = (typeof WEBHOOK_EVENT_TYPES)[number];
export type WebhookEventName = WebhookEventType | "endpoint.test";
export type WebhookEndpointStatus = "active" | "paused";
export type WebhookDeliveryStatus = "delivered" | "failed" | "pending";

export type WebhookEndpoint = {
  createdAt: string;
  endpointId: string;
  events: WebhookEventType[];
  merchant: Address;
  secretHint: string;
  status: WebhookEndpointStatus;
  updatedAt: string;
  url: string;
};

export type WebhookDelivery = {
  attemptCount: number;
  createdAt: string;
  deliveredAt: string | null;
  deliveryId: string;
  endpointId: string;
  eventId: string;
  eventType: WebhookEventName;
  lastError: string | null;
  responseStatus: number | null;
  status: WebhookDeliveryStatus;
};

export type WebhookEventEnvelope = {
  apiVersion: "2026-08-28";
  createdAt: string;
  data: Record<string, unknown>;
  id: string;
  merchant: Address;
  type: WebhookEventName;
};

export const WEBHOOK_EVENT_LABELS: Record<WebhookEventName, string> = {
  "approval.completed": "Approval completed",
  "approval.requested": "Approval requested",
  "endpoint.test": "Test event",
  "dispute.evidence_added": "Dispute evidence added",
  "invoice.created": "Invoice created",
  "payment.verified": "Payment verified",
  "refund.requested": "Refund requested",
  "refund.updated": "Refund updated",
};

export function normalizeWebhookEvents(value: unknown): WebhookEventType[] {
  if (!Array.isArray(value)) return [];
  return WEBHOOK_EVENT_TYPES.filter((event) => value.includes(event));
}

export function normalizeWebhookUrl(value: string) {
  const trimmed = value.trim();
  if (trimmed.length < 12 || trimmed.length > 500) {
    throw new Error("Webhook URL must be between 12 and 500 characters.");
  }

  let url: URL;
  try {
    url = new URL(trimmed);
  } catch {
    throw new Error("Enter a valid HTTPS webhook URL.");
  }

  if (url.protocol !== "https:" || url.username || url.password || url.hash) {
    throw new Error("Webhook endpoints must use HTTPS without credentials or fragments.");
  }
  if (url.port && url.port !== "443") {
    throw new Error("Webhook endpoints may only use the standard HTTPS port.");
  }

  return url.toString();
}

export function isWebhookEndpoint(value: unknown): value is WebhookEndpoint {
  if (!isRecord(value) || typeof value.merchant !== "string" || !isAddress(value.merchant)) return false;
  const events = normalizeWebhookEvents(value.events);
  return (
    /^wh_[a-z0-9]{16}$/.test(String(value.endpointId)) &&
    events.length > 0 &&
    events.length === (value.events as unknown[]).length &&
    (value.status === "active" || value.status === "paused") &&
    typeof value.url === "string" &&
    typeof value.secretHint === "string" &&
    isIsoDate(value.createdAt) &&
    isIsoDate(value.updatedAt)
  );
}

export function isWebhookDelivery(value: unknown): value is WebhookDelivery {
  if (!isRecord(value)) return false;
  return (
    /^whd_[a-z0-9]{20}$/.test(String(value.deliveryId)) &&
    /^wh_[a-z0-9]{16}$/.test(String(value.endpointId)) &&
    /^evt_[a-z0-9]{20}$/.test(String(value.eventId)) &&
    isWebhookEventName(value.eventType) &&
    (value.status === "delivered" || value.status === "failed" || value.status === "pending") &&
    Number.isInteger(value.attemptCount) &&
    Number(value.attemptCount) >= 0 &&
    (value.responseStatus === null || Number.isInteger(value.responseStatus)) &&
    (value.lastError === null || typeof value.lastError === "string") &&
    (value.deliveredAt === null || isIsoDate(value.deliveredAt)) &&
    isIsoDate(value.createdAt)
  );
}

export function isWebhookEventType(value: unknown): value is WebhookEventType {
  return typeof value === "string" && WEBHOOK_EVENT_TYPES.includes(value as WebhookEventType);
}

export function isWebhookEventName(value: unknown): value is WebhookEventName {
  return value === "endpoint.test" || isWebhookEventType(value);
}

export function normalizeWebhookMerchant(value: string) {
  if (!isAddress(value)) throw new Error("Merchant wallet address is invalid.");
  return getAddress(value);
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown) {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}
