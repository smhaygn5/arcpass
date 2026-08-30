import { getAddress, isAddress, type Address } from "viem";

export const ARC_X402_NETWORK = "eip155:5042002" as const;
export const ARC_X402_FACILITATOR = "https://gateway-api-testnet.circle.com" as const;
export const X402_MIN_PRICE = "0.000001";
export const X402_MAX_PRICE = "10";

export type X402ResourceStatus = "active" | "paused";

export type X402Resource = {
  createdAt: string;
  description: string;
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

export function normalizeX402ResourceInput(value: unknown, merchant: string) {
  if (!isAddress(merchant)) throw new Error("Merchant wallet address is invalid.");
  if (!isRecord(value)) throw new Error("Nanopayment resource is invalid.");

  const title = normalizeText(value.title, "Resource name", 3, 80);
  const description = normalizeText(value.description, "Description", 8, 240);
  const price = normalizeX402Price(value.price);
  const responseBody = normalizeResponseBody(value.responseBody);

  return { description, merchant: getAddress(merchant), price, responseBody, title };
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
  return {
    activeResources: resources.filter((resource) => resource.status === "active").length,
    paidRequests: accesses.length,
    resources: summaries,
    settledAmount: atomicToDecimal(settledAtomic),
  };
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
