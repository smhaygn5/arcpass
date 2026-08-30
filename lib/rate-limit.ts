import { createHash } from "node:crypto";
import { NextResponse, type NextRequest } from "next/server";
import {
  databaseConfigured,
  getDatabase,
} from "./server-database.ts";

type Bucket = { count: number; resetAt: number };
type DatabaseBucket = { request_count: number; retry_after: number | string };

const DATABASE_PRUNE_INTERVAL_MS = 5 * 60 * 1000;
const MAX_TRACKED_KEYS = 5000;
const buckets = new Map<string, Bucket>();
let lastDatabasePruneAt = 0;

export async function rateLimit(
  key: string,
  limit: number,
  windowMs: number,
): Promise<{ ok: boolean; retryAfter: number }> {
  if (process.env.NODE_ENV === "production" && !databaseConfigured()) {
    return { ok: false, retryAfter: 0 };
  }
  if (databaseConfigured()) {
    try {
      const sql = getDatabase();
      await pruneExpiredDatabaseBuckets();
      const resetAt = new Date(Date.now() + windowMs).toISOString();
      const rows = await sql`
        insert into arcpass_rate_limits (rate_key, request_count, reset_at)
        values (${key}, 1, ${resetAt})
        on conflict (rate_key) do update set
          request_count = case
            when arcpass_rate_limits.reset_at <= now() then 1
            else arcpass_rate_limits.request_count + 1
          end,
          reset_at = case
            when arcpass_rate_limits.reset_at <= now() then excluded.reset_at
            else arcpass_rate_limits.reset_at
          end
        returning request_count, greatest(1, ceil(extract(epoch from (reset_at - now()))))::integer as retry_after
      `;
      const bucket = rows[0] as DatabaseBucket | undefined;
      const count = Number(bucket?.request_count ?? 1);
      return { ok: count <= limit, retryAfter: count <= limit ? 0 : Number(bucket?.retry_after ?? 1) };
    } catch {
      if (process.env.NODE_ENV === "production") return { ok: false, retryAfter: 0 };
      return memoryRateLimit(key, limit, windowMs);
    }
  }

  return memoryRateLimit(key, limit, windowMs);
}

export function clientKey(req: NextRequest): string {
  const forwarded =
    req.headers.get("x-vercel-forwarded-for") ??
    req.headers.get("x-forwarded-for") ??
    req.headers.get("x-real-ip") ??
    "unknown";
  const address = forwarded.split(",")[0]?.trim() || "unknown";

  return createHash("sha256").update(address).digest("hex").slice(0, 32);
}

export function tooManyRequests(retryAfter: number): NextResponse {
  if (retryAfter <= 0) {
    return NextResponse.json(
      { error: "ArcPass storage is temporarily unavailable. No payment was accepted." },
      { status: 503 },
    );
  }
  return NextResponse.json(
    { error: "Too many requests. Please slow down and try again shortly." },
    { status: 429, headers: { "retry-after": String(Math.max(1, retryAfter)) } },
  );
}

async function pruneExpiredDatabaseBuckets() {
  const now = Date.now();
  if (now - lastDatabasePruneAt < DATABASE_PRUNE_INTERVAL_MS) return;

  lastDatabasePruneAt = now;
  const sql = getDatabase();
  await sql`delete from arcpass_rate_limits where reset_at <= now()`;
}

function memoryRateLimit(key: string, limit: number, windowMs: number) {
  const now = Date.now();

  if (buckets.size >= MAX_TRACKED_KEYS) {
    pruneExpired(now);
    pruneOldest();
  }

  const bucket = buckets.get(key);
  if (!bucket || now >= bucket.resetAt) {
    buckets.set(key, { count: 1, resetAt: now + windowMs });
    return { ok: true, retryAfter: 0 };
  }

  if (bucket.count >= limit) {
    return { ok: false, retryAfter: Math.ceil((bucket.resetAt - now) / 1000) };
  }

  bucket.count += 1;
  return { ok: true, retryAfter: 0 };
}

function pruneExpired(now: number) {
  for (const [key, bucket] of buckets) {
    if (now >= bucket.resetAt) buckets.delete(key);
  }
}

function pruneOldest() {
  while (buckets.size >= MAX_TRACKED_KEYS) {
    const oldestKey = buckets.keys().next().value as string | undefined;
    if (!oldestKey) return;
    buckets.delete(oldestKey);
  }
}
