import { getAddress, isAddress, type Address } from "viem";

export const ARC_X402_NETWORK = "eip155:5042002" as const;
export const ARC_X402_FACILITATOR = "https://gateway-api-testnet.circle.com" as const;
export const X402_MIN_PRICE = "0.000001";
export const X402_MAX_PRICE = "10";

export type X402ResourceStatus = "active" | "paused";

export type X402Resource = {
  createdAt: string;
  description: string;
  expiresAt?: string;
  maxCalls?: number;
  merchant: Address;
  price: string;
  resourceId: string;
  responseBody: Record<string, unknown>;
  status: X402ResourceStatus;
  title: string;
  updatedAt: string;
};

export type X402Access = {
  accessId: string;
  amount: string;
  createdAt: string;
  merchant: Address;
  network: string;
  payer: Address;
  resourceId: string;
  transaction: string;
};

export type X402ResourceSummary = X402Resource & {
  accessCount: number;
  settledAmount: string;
};

export type X402AccessWindow = {
  label: string;
  state: "ending" | "expired" | "open" | "scheduled";
};

export type X402PayerSummary = {
  callCount: number;
  lastAccessAt: string;
  payer: Address;
  resourceCount: number;
  settledAmount: string;
};

export function normalizeX402ResourceInput(value: unknown, merchant: string) {
  if (!isAddress(merchant)) throw new Error("Merchant wallet address is invalid.");
  if (!isRecord(value)) throw new Error("Nanopayment resource is invalid.");

  const title = normalizeText(value.title, "Resource name", 3, 80);
  const description = normalizeText(value.description, "Description", 8, 240);
  const price = normalizeX402Price(value.price);
  const responseBody = normalizeResponseBody(value.responseBody);

  const expiresAt = normalizeExpiry(value.expiresAt);
  const maxCalls = normalizeMaxCalls(value.maxCalls);
  return { description, expiresAt, maxCalls, merchant: getAddress(merchant), price, responseBody, title };
}

export function normalizeX402Price(value: unknown) {
  const raw = typeof value === "string" || typeof value === "number" ? String(value).trim() : "";
  if (!/^(?:0|[1-9]\d*)(?:\.\d{1,6})?$/.test(raw)) {
    throw new Error("Price must be a USDC amount with no more than 6 decimals.");
  }

  const atomic = decimalToAtomic(raw);
  const minimum = decimalToAtomic(X402_MIN_PRICE);
  const maximum = decimalToAtomic(X402_MAX_PRICE);
  if (atomic < minimum || atomic > maximum) {
    throw new Error(`Price must be between ${X402_MIN_PRICE} and ${X402_MAX_PRICE} USDC.`);
  }
  return atomicToDecimal(atomic);
}

export function normalizeResponseBody(value: unknown) {
  const parsed = typeof value === "string" ? parseJson(value) : value;
  if (!isRecord(parsed)) throw new Error("Protected response must be a JSON object.");
  const serialized = JSON.stringify(parsed);
  if (serialized.length > 4_096) throw new Error("Protected response must be 4 KB or smaller.");
  return JSON.parse(serialized) as Record<string, unknown>;
}

export function x402PriceToAtomic(price: string) {
  return decimalToAtomic(normalizeX402Price(price)).toString();
}

export function x402ResourceUrl(origin: string, resourceId: string) {
  return `${origin.replace(/\/$/, "")}/api/x402/resources/${encodeURIComponent(resourceId)}`;
}

export function x402AccessWindow(expiresAt: string | undefined, now = Date.now()): X402AccessWindow {
  if (!expiresAt) return { label: "No expiry", state: "open" };
  const expiry = new Date(expiresAt).getTime();
  if (!Number.isFinite(expiry) || expiry <= now) return { label: "Expired", state: "expired" };

  const remainingMinutes = Math.ceil((expiry - now) / 60_000);
  if (remainingMinutes <= 24 * 60) {
    return { label: remainingMinutes <= 60 ? `${remainingMinutes}m left` : `${Math.ceil(remainingMinutes / 60)}h left`, state: "ending" };
  }
  if (remainingMinutes <= 7 * 24 * 60) return { label: `${Math.ceil(remainingMinutes / (24 * 60))}d left`, state: "ending" };
  return { label: `Until ${new Date(expiry).toLocaleDateString("en", { day: "numeric", month: "short" })}`, state: "scheduled" };
}

export function normalizeX402AccessExpiry(value: unknown) {
  if (!isIsoDate(value)) throw new Error("Access expiry must be a valid date and time.");
  const date = new Date(value as string);
  if (date.getTime() <= Date.now()) throw new Error("Access expiry must be in the future.");
  return date.toISOString();
}

export function normalizeX402MaxCalls(value: unknown) {
  const amount = typeof value === "number" ? value : Number(value);
  if (!Number.isInteger(amount) || amount < 1 || amount > 100_000) throw new Error("Usage limit must be a whole number between 1 and 100000.");
  return amount;
}

export function x402Metrics(resources: X402Resource[], accesses: X402Access[]) {
  const byResource = new Map<string, X402Access[]>();
  for (const access of accesses) {
    const current = byResource.get(access.resourceId) ?? [];
    current.push(access);
    byResource.set(access.resourceId, current);
  }

  const summaries = resources.map((resource) => {
    const resourceAccesses = byResource.get(resource.resourceId) ?? [];
    const settledAtomic = resourceAccesses.reduce((total, access) => total + BigInt(access.amount), BigInt(0));
    return {
      ...resource,
      accessCount: resourceAccesses.length,
      settledAmount: atomicToDecimal(settledAtomic),
    } satisfies X402ResourceSummary;
  });

  const settledAtomic = accesses.reduce((total, access) => total + BigInt(access.amount), BigInt(0));
  const payerCount = new Set(accesses.map((access) => access.payer.toLowerCase())).size;
  const latestAccess = accesses.reduce<X402Access | null>((latest, access) => !latest || new Date(access.createdAt).getTime() > new Date(latest.createdAt).getTime() ? access : latest, null);
  const topResource = [...summaries].sort((left, right) => right.accessCount - left.accessCount || left.title.localeCompare(right.title))[0] ?? null;
  return {
    activeResources: resources.filter((resource) => resource.status === "active").length,
    latestAccessAt: latestAccess?.createdAt ?? null,
    paidRequests: accesses.length,
    payerCount,
    resources: summaries,
    settledAmount: atomicToDecimal(settledAtomic),
    topResource: topResource ? { accessCount: topResource.accessCount, title: topResource.title } : null,
  };
}

export function x402PayerMetrics(accesses: X402Access[]): X402PayerSummary[] {
  const summaries = new Map<string, { callCount: number; lastAccessAt: string; payer: Address; resources: Set<string>; settledAtomic: bigint }>();
  for (const access of accesses) {
    const key = access.payer.toLowerCase();
    const current = summaries.get(key) ?? { callCount: 0, lastAccessAt: access.createdAt, payer: access.payer, resources: new Set<string>(), settledAtomic: BigInt(0) };
    current.callCount += 1;
    current.resources.add(access.resourceId);
    current.settledAtomic += BigInt(access.amount);
    if (new Date(access.createdAt).getTime() > new Date(current.lastAccessAt).getTime()) current.lastAccessAt = access.createdAt;
    summaries.set(key, current);
  }

  return [...summaries.values()]
    .sort((left, right) => left.settledAtomic === right.settledAtomic ? new Date(right.lastAccessAt).getTime() - new Date(left.lastAccessAt).getTime() : left.settledAtomic > right.settledAtomic ? -1 : 1)
    .map((payer) => ({ callCount: payer.callCount, lastAccessAt: payer.lastAccessAt, payer: payer.payer, resourceCount: payer.resources.size, settledAmount: atomicToDecimal(payer.settledAtomic) }));
}

export function isX402Resource(value: unknown): value is X402Resource {
  if (!isRecord(value) || typeof value.merchant !== "string" || !isAddress(value.merchant)) return false;
  try {
    normalizeX402Price(value.price);
    normalizeResponseBody(value.responseBody);
  } catch {
    return false;
  }
  return (
    /^xres_[a-z0-9]{20}$/.test(String(value.resourceId)) &&
    (value.status === "active" || value.status === "paused") &&
    typeof value.title === "string" &&
    typeof value.description === "string" &&
    (value.expiresAt === undefined || isIsoDate(value.expiresAt)) &&
    (value.maxCalls === undefined || (Number.isInteger(value.maxCalls) && Number(value.maxCalls) >= 1 && Number(value.maxCalls) <= 100_000)) &&
    isIsoDate(value.createdAt) &&
    isIsoDate(value.updatedAt)
  );
}

export function isX402Access(value: unknown): value is X402Access {
  if (!isRecord(value)) return false;
  return (
    /^xacc_[a-z0-9]{20}$/.test(String(value.accessId)) &&
    /^xres_[a-z0-9]{20}$/.test(String(value.resourceId)) &&
    typeof value.merchant === "string" && isAddress(value.merchant) &&
    typeof value.payer === "string" && isAddress(value.payer) &&
    typeof value.amount === "string" && /^\d+$/.test(value.amount) &&
    typeof value.network === "string" && value.network.length > 2 &&
    typeof value.transaction === "string" && value.transaction.length >= 8 && value.transaction.length <= 200 &&
    isIsoDate(value.createdAt)
  );
}

function decimalToAtomic(value: string) {
  const [whole, fraction = ""] = value.split(".");
  return BigInt(whole) * BigInt(1_000_000) + BigInt(fraction.padEnd(6, "0"));
}

function atomicToDecimal(value: bigint) {
  const whole = value / BigInt(1_000_000);
  const fraction = (value % BigInt(1_000_000)).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}

function normalizeText(value: unknown, label: string, min: number, max: number) {
  const text = typeof value === "string" ? value.trim().replace(/\s+/g, " ") : "";
  if (text.length < min || text.length > max) throw new Error(`${label} must be between ${min} and ${max} characters.`);
  return text;
}

function parseJson(value: string) {
  try {
    return JSON.parse(value);
  } catch {
    throw new Error("Protected response must contain valid JSON.");
  }
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isIsoDate(value: unknown) {
  return typeof value === "string" && Number.isFinite(new Date(value).getTime());
}

function normalizeExpiry(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  return normalizeX402AccessExpiry(value);
}

function normalizeMaxCalls(value: unknown) {
  if (value === undefined || value === null || value === "") return undefined;
  return normalizeX402MaxCalls(value);
}
