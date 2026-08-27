import {
  createCipheriv,
  createDecipheriv,
  createHash,
  createHmac,
  randomBytes,
} from "node:crypto";
import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { getAddress, isAddress, type Address } from "viem";
import { databaseConfigured, getDatabase } from "./server-database.ts";
import { isPublicIpAddress, isSafePublicDomain } from "./server-domain-verification.ts";
import {
  isWebhookEventName,
  isWebhookDelivery,
  isWebhookEndpoint,
  normalizeWebhookEvents,
  normalizeWebhookMerchant,
  normalizeWebhookUrl,
  type WebhookDelivery,
  type WebhookEndpoint,
  type WebhookEndpointStatus,
  type WebhookEventEnvelope,
  type WebhookEventName,
  type WebhookEventType,
} from "./webhooks.ts";

const DELIVERY_TIMEOUT_MS = 6_000;
const MAX_ENDPOINTS_PER_MERCHANT = 5;
const MAX_PINNED_ADDRESSES = 4;
const MAX_RESPONSE_BYTES = 2 * 1024;
const memoryEndpoints = new Map<string, StoredWebhookEndpoint>();
const memoryDeliveries = new Map<string, StoredWebhookDelivery>();

type ResolvedAddress = { address: string; family: number };
type StoredWebhookEndpoint = WebhookEndpoint & { secretCiphertext: string };
type StoredWebhookDelivery = WebhookDelivery & { event: WebhookEventEnvelope };
type EndpointRow = {
  created_at: Date | string;
  endpoint_id: string;
  events: unknown;
  merchant: string;
  secret_ciphertext: string;
  secret_hint: string;
  status: string;
  updated_at: Date | string;
  url: string;
};
type DeliveryRow = {
  attempt_count: number | string;
  created_at: Date | string;
  delivered_at: Date | string | null;
  delivery_id: string;
  endpoint_id: string;
  event: unknown;
  event_id: string;
  event_type: string;
  last_error: string | null;
  response_status: number | string | null;
  status: string;
};

export async function createServerWebhookEndpoint({
  events: rawEvents,
  merchant: rawMerchant,
  url: rawUrl,
}: {
  events: unknown;
  merchant: string;
  url: string;
}) {
  const merchant = normalizeWebhookMerchant(rawMerchant);
  const events = normalizeWebhookEvents(rawEvents);
  if (events.length === 0) throw new Error("Choose at least one webhook event.");
  const { url } = await resolveWebhookDestination(rawUrl);
  const existing = await loadStoredEndpoints(merchant);
  if (existing.length >= MAX_ENDPOINTS_PER_MERCHANT) {
    throw new Error(`Each merchant workspace can register up to ${MAX_ENDPOINTS_PER_MERCHANT} webhook endpoints.`);
  }
  if (existing.some((endpoint) => endpoint.url.toLowerCase() === url.toLowerCase())) {
    throw new Error("This webhook URL is already registered for the merchant workspace.");
  }

  const now = new Date().toISOString();
  const endpointId = `wh_${randomBytes(8).toString("hex")}`;
  const signingSecret = `whsec_${randomBytes(32).toString("base64url")}`;
  const endpoint: StoredWebhookEndpoint = {
    createdAt: now,
    endpointId,
    events,
    merchant,
    secretCiphertext: encryptWebhookSecret(signingSecret),
    secretHint: signingSecret.slice(-4),
    status: "active",
    updatedAt: now,
    url,
  };

  if (databaseConfigured()) {
    const sql = getDatabase();
    await sql`
      insert into arcpass_webhook_endpoints (
        endpoint_id, merchant, url, events, status, secret_ciphertext, secret_hint, created_at, updated_at
      ) values (
        ${endpoint.endpointId}, ${endpoint.merchant}, ${endpoint.url}, ${endpoint.events}, ${endpoint.status},
        ${endpoint.secretCiphertext}, ${endpoint.secretHint}, ${endpoint.createdAt}, ${endpoint.updatedAt}
      )
    `;
  } else {
    memoryEndpoints.set(endpoint.endpointId, endpoint);
  }

  return { endpoint: publicEndpoint(endpoint), signingSecret };
}

export async function loadServerWebhookWorkspace(merchant: Address) {
  const endpoints = (await loadStoredEndpoints(getAddress(merchant))).map(publicEndpoint);
  const deliveries = await loadStoredDeliveries(getAddress(merchant));
  return { deliveries: deliveries.map(publicDelivery), endpoints };
}

export async function setServerWebhookEndpointStatus({
  endpointId,
  merchant,
  status,
}: {
  endpointId: string;
  merchant: Address;
  status: WebhookEndpointStatus;
}) {
  if (!/^wh_[a-z0-9]{16}$/.test(endpointId)) throw new Error("Webhook endpoint id is invalid.");
  const normalizedMerchant = getAddress(merchant);
  const current = await loadStoredEndpoint(endpointId);
  if (!current || current.merchant.toLowerCase() !== normalizedMerchant.toLowerCase()) return null;
  const updated = { ...current, status, updatedAt: new Date().toISOString() };

  if (databaseConfigured()) {
    const sql = getDatabase();
    const rows = await sql`
      update arcpass_webhook_endpoints
      set status = ${status}, updated_at = ${updated.updatedAt}
      where endpoint_id = ${endpointId} and lower(merchant) = lower(${normalizedMerchant})
      returning endpoint_id
    `;
    if (rows.length !== 1) return null;
  } else {
    memoryEndpoints.set(endpointId, updated);
  }

  return publicEndpoint(updated);
}

export async function deleteServerWebhookEndpoint({ endpointId, merchant }: { endpointId: string; merchant: Address }) {
  if (!/^wh_[a-z0-9]{16}$/.test(endpointId)) return false;
  const normalizedMerchant = getAddress(merchant);
  if (databaseConfigured()) {
    const sql = getDatabase();
    const rows = await sql`
      delete from arcpass_webhook_endpoints
      where endpoint_id = ${endpointId} and lower(merchant) = lower(${normalizedMerchant})
      returning endpoint_id
    `;
    return rows.length === 1;
  }
  const current = memoryEndpoints.get(endpointId);
  if (!current || current.merchant.toLowerCase() !== normalizedMerchant.toLowerCase()) return false;
  memoryEndpoints.delete(endpointId);
  for (const [deliveryId, delivery] of memoryDeliveries) {
    if (delivery.endpointId === endpointId) memoryDeliveries.delete(deliveryId);
  }
  return true;
}

export async function publishServerWebhookEvent({
  data,
  merchant,
  subjectId,
  type,
}: {
  data: Record<string, unknown>;
  merchant: Address;
  subjectId: string;
  type: WebhookEventType;
}) {
  try {
    const normalizedMerchant = getAddress(merchant);
    const endpoints = (await loadStoredEndpoints(normalizedMerchant)).filter(
      (endpoint) => endpoint.status === "active" && endpoint.events.includes(type),
    );
    const event = createWebhookEvent({ data, merchant: normalizedMerchant, subjectId, type });
    await Promise.all(endpoints.map((endpoint) => createAndDeliver(endpoint, event)));
  } catch (error) {
    console.error("ArcPass webhook publication failed.", error);
  }
}

export async function testServerWebhookEndpoint({ endpointId, merchant }: { endpointId: string; merchant: Address }) {
  const endpoint = await ownedEndpoint(endpointId, merchant);
  if (!endpoint) return null;
  const event = createWebhookEvent({
    data: { message: "ArcPass webhook endpoint test", test: true },
    merchant: endpoint.merchant,
    subjectId: randomBytes(12).toString("hex"),
    type: "endpoint.test",
  });
  return publicDelivery(await createAndDeliver(endpoint, event));
}

export async function retryServerWebhookDelivery({ deliveryId, merchant }: { deliveryId: string; merchant: Address }) {
  if (!/^whd_[a-z0-9]{20}$/.test(deliveryId)) throw new Error("Webhook delivery id is invalid.");
  const delivery = await loadStoredDelivery(deliveryId);
  if (!delivery) return null;
  const endpoint = await ownedEndpoint(delivery.endpointId, merchant);
  if (!endpoint) return null;
  return publicDelivery(await deliverStoredWebhook(endpoint, delivery));
}

export function webhookSignatureMessage(timestamp: string, rawBody: string) {
  return `${timestamp}.${rawBody}`;
}

export function createWebhookSignature(secret: string, timestamp: string, rawBody: string) {
  return `v1=${createHmac("sha256", secret).update(webhookSignatureMessage(timestamp, rawBody)).digest("hex")}`;
}

async function createAndDeliver(endpoint: StoredWebhookEndpoint, event: WebhookEventEnvelope) {
  const existing = await findDeliveryByEvent(endpoint.endpointId, event.id);
  if (existing) return existing;
  const delivery: StoredWebhookDelivery = {
    attemptCount: 0,
    createdAt: new Date().toISOString(),
    deliveredAt: null,
    deliveryId: `whd_${randomBytes(10).toString("hex")}`,
    endpointId: endpoint.endpointId,
    event,
    eventId: event.id,
    eventType: event.type,
    lastError: null,
    responseStatus: null,
    status: "pending",
  };
  const stored = await saveNewDelivery(delivery);
  return deliverStoredWebhook(endpoint, stored);
}

async function deliverStoredWebhook(endpoint: StoredWebhookEndpoint, delivery: StoredWebhookDelivery) {
  const rawBody = JSON.stringify(delivery.event);
  const timestamp = String(Math.floor(Date.now() / 1000));
  const secret = decryptWebhookSecret(endpoint.secretCiphertext);
  let responseStatus: number | null = null;
  let lastError: string | null = null;

  try {
    const destination = await resolveWebhookDestination(endpoint.url);
    responseStatus = await requestPinnedWebhook({
      addresses: destination.addresses,
      body: rawBody,
      headers: {
        "content-type": "application/json",
        "user-agent": "ArcPass-Webhooks/1.0",
        "x-arcpass-delivery": delivery.deliveryId,
        "x-arcpass-event": delivery.event.type,
        "x-arcpass-signature": createWebhookSignature(secret, timestamp, rawBody),
        "x-arcpass-timestamp": timestamp,
      },
      url: destination.url,
    });
    if (responseStatus < 200 || responseStatus >= 300) {
      lastError = `Endpoint returned HTTP ${responseStatus}.`;
    }
  } catch (error) {
    lastError = error instanceof Error ? error.message : "Webhook endpoint could not be reached.";
  }

  const updated: StoredWebhookDelivery = {
    ...delivery,
    attemptCount: delivery.attemptCount + 1,
    deliveredAt: lastError ? null : new Date().toISOString(),
    lastError: lastError?.slice(0, 240) ?? null,
    responseStatus,
    status: lastError ? "failed" : "delivered",
  };
  await saveDeliveryResult(updated);
  return updated;
}

function createWebhookEvent({
  data,
  merchant,
  subjectId,
  type,
}: {
  data: Record<string, unknown>;
  merchant: Address;
  subjectId: string;
  type: WebhookEventName;
}): WebhookEventEnvelope {
  const eventId = `evt_${createHash("sha256")
    .update(`${merchant.toLowerCase()}:${type}:${subjectId}`)
    .digest("hex")
    .slice(0, 20)}`;
  return {
    apiVersion: "2026-08-28",
    createdAt: new Date().toISOString(),
    data,
    id: eventId,
    merchant,
    type,
  };
}

async function loadStoredEndpoints(merchant: Address) {
  if (!databaseConfigured()) {
    return [...memoryEndpoints.values()]
      .filter((endpoint) => endpoint.merchant.toLowerCase() === merchant.toLowerCase())
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const sql = getDatabase();
  const rows = await sql`
    select endpoint_id, merchant, url, events, status, secret_ciphertext, secret_hint, created_at, updated_at
    from arcpass_webhook_endpoints
    where lower(merchant) = lower(${merchant})
    order by created_at desc
    limit ${MAX_ENDPOINTS_PER_MERCHANT}
  `;
  return Array.from(rows).map((row) => endpointFromRow(row as EndpointRow)).filter((item): item is StoredWebhookEndpoint => Boolean(item));
}

async function loadStoredEndpoint(endpointId: string) {
  if (!databaseConfigured()) return memoryEndpoints.get(endpointId) ?? null;
  const sql = getDatabase();
  const rows = await sql`
    select endpoint_id, merchant, url, events, status, secret_ciphertext, secret_hint, created_at, updated_at
    from arcpass_webhook_endpoints where endpoint_id = ${endpointId} limit 1
  `;
  return rows[0] ? endpointFromRow(rows[0] as EndpointRow) : null;
}

async function loadStoredDeliveries(merchant: Address) {
  if (!databaseConfigured()) {
    const endpointIds = new Set((await loadStoredEndpoints(merchant)).map((endpoint) => endpoint.endpointId));
    return [...memoryDeliveries.values()]
      .filter((delivery) => endpointIds.has(delivery.endpointId))
      .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
      .slice(0, 50);
  }
  const sql = getDatabase();
  const rows = await sql`
    select delivery.delivery_id, delivery.endpoint_id, delivery.event_id, delivery.event_type, delivery.status,
      delivery.event, delivery.attempt_count, delivery.response_status, delivery.last_error,
      delivery.created_at, delivery.delivered_at
    from arcpass_webhook_deliveries delivery
    join arcpass_webhook_endpoints endpoint on endpoint.endpoint_id = delivery.endpoint_id
    where lower(endpoint.merchant) = lower(${merchant})
    order by delivery.created_at desc
    limit 50
  `;
  return Array.from(rows).map((row) => deliveryFromRow(row as DeliveryRow)).filter((item): item is StoredWebhookDelivery => Boolean(item));
}

async function loadStoredDelivery(deliveryId: string) {
  if (!databaseConfigured()) return memoryDeliveries.get(deliveryId) ?? null;
  const sql = getDatabase();
  const rows = await sql`
    select delivery_id, endpoint_id, event_id, event_type, status, event, attempt_count,
      response_status, last_error, created_at, delivered_at
    from arcpass_webhook_deliveries where delivery_id = ${deliveryId} limit 1
  `;
  return rows[0] ? deliveryFromRow(rows[0] as DeliveryRow) : null;
}

async function findDeliveryByEvent(endpointId: string, eventId: string) {
  if (!databaseConfigured()) {
    return [...memoryDeliveries.values()].find((delivery) => delivery.endpointId === endpointId && delivery.eventId === eventId) ?? null;
  }
  const sql = getDatabase();
  const rows = await sql`
    select delivery_id, endpoint_id, event_id, event_type, status, event, attempt_count,
      response_status, last_error, created_at, delivered_at
    from arcpass_webhook_deliveries
    where endpoint_id = ${endpointId} and event_id = ${eventId}
    limit 1
  `;
  return rows[0] ? deliveryFromRow(rows[0] as DeliveryRow) : null;
}

async function saveNewDelivery(delivery: StoredWebhookDelivery) {
  if (!databaseConfigured()) {
    memoryDeliveries.set(delivery.deliveryId, delivery);
    return delivery;
  }
  const sql = getDatabase();
  const rows = await sql`
    insert into arcpass_webhook_deliveries (
      delivery_id, endpoint_id, event_id, event_type, status, event, attempt_count,
      response_status, last_error, created_at, delivered_at
    ) values (
      ${delivery.deliveryId}, ${delivery.endpointId}, ${delivery.eventId}, ${delivery.eventType}, ${delivery.status},
      ${sql.json(JSON.parse(JSON.stringify(delivery.event)))}, ${delivery.attemptCount}, ${delivery.responseStatus}, ${delivery.lastError},
      ${delivery.createdAt}, ${delivery.deliveredAt}
    )
    on conflict (endpoint_id, event_id) do nothing
    returning delivery_id
  `;
  if (rows.length === 1) return delivery;
  return (await findDeliveryByEvent(delivery.endpointId, delivery.eventId)) ?? delivery;
}

async function saveDeliveryResult(delivery: StoredWebhookDelivery) {
  if (!databaseConfigured()) {
    memoryDeliveries.set(delivery.deliveryId, delivery);
    return;
  }
  const sql = getDatabase();
  await sql`
    update arcpass_webhook_deliveries set
      status = ${delivery.status}, attempt_count = ${delivery.attemptCount},
      response_status = ${delivery.responseStatus}, last_error = ${delivery.lastError},
      delivered_at = ${delivery.deliveredAt}
    where delivery_id = ${delivery.deliveryId}
  `;
}

async function ownedEndpoint(endpointId: string, merchant: Address) {
  const endpoint = await loadStoredEndpoint(endpointId);
  return endpoint && endpoint.merchant.toLowerCase() === getAddress(merchant).toLowerCase() ? endpoint : null;
}

function endpointFromRow(row: EndpointRow): StoredWebhookEndpoint | null {
  const endpoint = {
    createdAt: new Date(row.created_at).toISOString(),
    endpointId: row.endpoint_id,
    events: normalizeWebhookEvents(row.events),
    merchant: row.merchant,
    secretHint: row.secret_hint,
    status: row.status,
    updatedAt: new Date(row.updated_at).toISOString(),
    url: row.url,
  };
  if (!isWebhookEndpoint(endpoint) || typeof row.secret_ciphertext !== "string") return null;
  return { ...endpoint, secretCiphertext: row.secret_ciphertext };
}

function deliveryFromRow(row: DeliveryRow): StoredWebhookDelivery | null {
  const delivery = {
    attemptCount: Number(row.attempt_count),
    createdAt: new Date(row.created_at).toISOString(),
    deliveredAt: row.delivered_at ? new Date(row.delivered_at).toISOString() : null,
    deliveryId: row.delivery_id,
    endpointId: row.endpoint_id,
    eventId: row.event_id,
    eventType: row.event_type,
    lastError: row.last_error,
    responseStatus: row.response_status === null ? null : Number(row.response_status),
    status: row.status,
  };
  if (!isWebhookDelivery(delivery) || !isWebhookEventEnvelope(row.event)) return null;
  return { ...delivery, event: row.event };
}

function publicEndpoint(endpoint: StoredWebhookEndpoint): WebhookEndpoint {
  const { secretCiphertext: _secretCiphertext, ...publicValue } = endpoint;
  void _secretCiphertext;
  return publicValue;
}

function publicDelivery(delivery: StoredWebhookDelivery): WebhookDelivery {
  const { event: _event, ...publicValue } = delivery;
  void _event;
  return publicValue;
}

function isWebhookEventEnvelope(value: unknown): value is WebhookEventEnvelope {
  if (typeof value !== "object" || value === null || Array.isArray(value)) return false;
  const event = value as Record<string, unknown>;
  return (
    event.apiVersion === "2026-08-28" &&
    typeof event.id === "string" &&
    /^evt_[a-z0-9]{20}$/.test(event.id) &&
    isWebhookEventName(event.type) &&
    typeof event.createdAt === "string" &&
    typeof event.merchant === "string" &&
    isAddress(event.merchant) &&
    typeof event.data === "object" &&
    event.data !== null &&
    !Array.isArray(event.data)
  );
}

function encryptionKey() {
  const configured = process.env.ARCPASS_WEBHOOK_ENCRYPTION_KEY?.trim();
  if (!configured || configured.length < 32) {
    throw new Error("ARCPASS_WEBHOOK_ENCRYPTION_KEY must contain at least 32 characters before webhooks can be configured.");
  }
  return createHash("sha256").update(configured).digest();
}

function encryptWebhookSecret(secret: string) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const encrypted = Buffer.concat([cipher.update(secret, "utf8"), cipher.final()]);
  return [iv, cipher.getAuthTag(), encrypted].map((part) => part.toString("base64url")).join(".");
}

function decryptWebhookSecret(value: string) {
  const parts = value.split(".");
  if (parts.length !== 3) throw new Error("Stored webhook signing secret is invalid.");
  const [ivValue = "", tagValue = "", encryptedValue = ""] = parts;
  const decipher = createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(ivValue, "base64url"));
  decipher.setAuthTag(Buffer.from(tagValue, "base64url"));
  return Buffer.concat([
    decipher.update(Buffer.from(encryptedValue, "base64url")),
    decipher.final(),
  ]).toString("utf8");
}

async function resolveWebhookDestination(value: string) {
  const normalizedUrl = normalizeWebhookUrl(value);
  const url = new URL(normalizedUrl);
  const hostname = url.hostname.replace(/^\[|\]$/g, "");
  const ipVersion = isIP(hostname);
  let addresses: ResolvedAddress[];

  if (ipVersion) {
    addresses = [{ address: hostname, family: ipVersion }];
  } else {
    if (!isSafePublicDomain(hostname)) throw new Error("Webhook endpoint must use a public internet domain.");
    addresses = await lookup(hostname, { all: true, verbatim: true });
  }

  if (addresses.length === 0 || addresses.some((address) => !isPublicIpAddress(address.address))) {
    throw new Error("Webhook endpoint must resolve only to public internet addresses.");
  }
  return { addresses: addresses.slice(0, MAX_PINNED_ADDRESSES), url: normalizedUrl };
}

async function requestPinnedWebhook({
  addresses,
  body,
  headers,
  url,
}: {
  addresses: ResolvedAddress[];
  body: string;
  headers: Record<string, string>;
  url: string;
}) {
  let lastError: unknown = new Error("Webhook endpoint has no reachable public address.");
  for (const address of addresses) {
    try {
      return await requestWebhookAtAddress({ address, body, headers, url });
    } catch (error) {
      lastError = error;
    }
  }
  throw lastError;
}

function requestWebhookAtAddress({
  address,
  body,
  headers,
  url,
}: {
  address: ResolvedAddress;
  body: string;
  headers: Record<string, string>;
  url: string;
}): Promise<number> {
  return new Promise((resolve, reject) => {
    const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) {
        callback(null, [{ address: address.address, family: address.family }]);
        return;
      }
      callback(null, address.address, address.family);
    };
    const webhookRequest = request(
      url,
      {
        headers: { ...headers, "content-length": String(Buffer.byteLength(body)) },
        lookup: pinnedLookup,
        method: "POST",
      },
      (response) => {
        let receivedBytes = 0;
        response.on("data", (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (receivedBytes > MAX_RESPONSE_BYTES) response.destroy(new Error("Webhook response exceeded 2 KB."));
        });
        response.on("end", () => resolve(response.statusCode ?? 0));
        response.on("error", reject);
      },
    );
    webhookRequest.setTimeout(DELIVERY_TIMEOUT_MS, () => webhookRequest.destroy(new Error("Webhook endpoint timed out.")));
    webhookRequest.on("error", reject);
    webhookRequest.end(body);
  });
}
