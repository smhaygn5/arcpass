import { after, NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { requireMerchantSession } from "@/lib/server-merchant-session";
import { publishServerWebhookEvent } from "@/lib/server-webhooks";
import { createServerX402Resource, loadServerX402Workspace, updateServerX402Resource } from "@/lib/server-x402";
import { normalizeX402AccessExpiry, normalizeX402MaxCalls, type X402ResourceStatus } from "@/lib/x402";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limit = await rateLimit(`x402-workspace:${clientKey(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const merchant = req.nextUrl.searchParams.get("merchant") ?? "";
  if (!isAddress(merchant)) return NextResponse.json({ error: "Merchant wallet address is invalid." }, { status: 400 });
  const session = await requireMerchantSession(req, merchant);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });

  try {
    return NextResponse.json(await loadServerX402Workspace(session.address));
  } catch (error) {
    return serverError(error, "Nanopayment workspace could not be loaded.");
  }
}

export async function POST(req: NextRequest) {
  const limit = await rateLimit(`x402-create:${clientKey(req)}`, 12, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const merchant = typeof body?.merchant === "string" ? body.merchant : "";
  if (!isAddress(merchant)) return NextResponse.json({ error: "Merchant wallet address is invalid." }, { status: 400 });
  const session = await requireMerchantSession(req, merchant);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });

  try {
    const resource = await createServerX402Resource(body, session.address);
    after(() => publishServerWebhookEvent({
      data: { price: resource.price, resourceId: resource.resourceId, status: resource.status, title: resource.title },
      merchant: resource.merchant,
      subjectId: resource.resourceId,
      type: "x402.resource_created",
    }));
    return NextResponse.json({ resource }, { status: 201 });
  } catch (error) {
    return serverError(error, "Nanopayment resource could not be created.");
  }
}

export async function PATCH(req: NextRequest) {
  const limit = await rateLimit(`x402-status:${clientKey(req)}`, 20, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const merchant = typeof body?.merchant === "string" ? body.merchant : "";
  const resourceId = typeof body?.resourceId === "string" ? body.resourceId : "";
  const status: X402ResourceStatus | undefined = body?.status === "active" || body?.status === "paused" ? body.status : undefined;
  const hasExpiry = typeof body?.expiresAt === "string";
  const hasMaxCalls = body !== null && Object.hasOwn(body, "maxCalls");
  if (!isAddress(merchant) || !/^xres_[a-z0-9]{20}$/.test(resourceId) || (!status && !hasExpiry && !hasMaxCalls)) {
    return NextResponse.json({ error: "Nanopayment resource update is invalid." }, { status: 400 });
  }
  const session = await requireMerchantSession(req, merchant);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });

  try {
    const expiresAt = hasExpiry ? normalizeX402AccessExpiry(body?.expiresAt) : undefined;
    const maxCalls = hasMaxCalls && body?.maxCalls !== null && body?.maxCalls !== "" ? normalizeX402MaxCalls(body?.maxCalls) : undefined;
    const resource = await updateServerX402Resource(resourceId, getAddress(merchant), { expiresAt, maxCalls, removeMaxCalls: hasMaxCalls && maxCalls === undefined, status });
    if (expiresAt) after(() => publishServerWebhookEvent({
      data: { expiresAt, resourceId: resource.resourceId, title: resource.title },
      merchant: resource.merchant,
      subjectId: resource.resourceId,
      type: "x402.resource_renewed",
    }));
    if (hasMaxCalls) after(() => publishServerWebhookEvent({
      data: { maxCalls: resource.maxCalls ?? null, resourceId: resource.resourceId, title: resource.title },
      merchant: resource.merchant,
      subjectId: resource.resourceId,
      type: "x402.resource_limit_updated",
    }));
    return NextResponse.json({ resource });
  } catch (error) {
    return serverError(error, "Nanopayment resource could not be updated.");
  }
}

function serverError(error: unknown, fallback: string) {
  const message = error instanceof Error ? error.message : fallback;
  const unavailable = /DATABASE_URL|persistent database/i.test(message);
  return NextResponse.json({ error: unavailable ? "Persistent storage is not configured for this deployment." : message }, { status: unavailable ? 503 : 400 });
}
