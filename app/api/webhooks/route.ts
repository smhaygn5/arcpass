import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { requireMerchantSession } from "@/lib/server-merchant-session";
import {
  createServerWebhookEndpoint,
  deleteServerWebhookEndpoint,
  loadServerWebhookWorkspace,
  retryServerWebhookDelivery,
  setServerWebhookEndpointStatus,
  testServerWebhookEndpoint,
} from "@/lib/server-webhooks";

export const runtime = "nodejs";
export const maxDuration = 15;

export async function GET(req: NextRequest) {
  const limit = await rateLimit(`webhooks-read:${clientKey(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const merchant = req.nextUrl.searchParams.get("merchant") ?? "";
  if (!isAddress(merchant)) return NextResponse.json({ error: "Merchant wallet address is invalid." }, { status: 400 });
  const session = await requireMerchantSession(req, merchant);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });
  return NextResponse.json(await loadServerWebhookWorkspace(getAddress(merchant)));
}

export async function POST(req: NextRequest) {
  const limit = await rateLimit(`webhooks-write:${clientKey(req)}`, 20, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const merchant = typeof body?.merchant === "string" ? body.merchant : "";
  if (!isAddress(merchant)) return NextResponse.json({ error: "Merchant wallet address is invalid." }, { status: 400 });
  const session = await requireMerchantSession(req, merchant);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });

  try {
    const normalizedMerchant = getAddress(merchant);
    if (body?.action === "test") {
      const delivery = await testServerWebhookEndpoint({
        endpointId: typeof body.endpointId === "string" ? body.endpointId : "",
        merchant: normalizedMerchant,
      });
      if (!delivery) return NextResponse.json({ error: "Webhook endpoint was not found." }, { status: 404 });
      return NextResponse.json({ delivery });
    }
    if (body?.action === "retry") {
      const delivery = await retryServerWebhookDelivery({
        deliveryId: typeof body.deliveryId === "string" ? body.deliveryId : "",
        merchant: normalizedMerchant,
      });
      if (!delivery) return NextResponse.json({ error: "Webhook delivery was not found." }, { status: 404 });
      return NextResponse.json({ delivery });
    }
    const result = await createServerWebhookEndpoint({
      events: body?.events,
      merchant: normalizedMerchant,
      url: typeof body?.url === "string" ? body.url : "",
    });
    return NextResponse.json(result, { status: 201 });
  } catch (error) {
    return NextResponse.json({ error: error instanceof Error ? error.message : "Webhook operation failed." }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  const limit = await rateLimit(`webhooks-update:${clientKey(req)}`, 20, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const merchant = typeof body?.merchant === "string" ? body.merchant : "";
  const status = body?.status === "active" || body?.status === "paused" ? body.status : null;
  if (!isAddress(merchant) || !status) return NextResponse.json({ error: "Webhook endpoint update is invalid." }, { status: 400 });
  const session = await requireMerchantSession(req, merchant);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });
  const endpoint = await setServerWebhookEndpointStatus({
    endpointId: typeof body?.endpointId === "string" ? body.endpointId : "",
    merchant: getAddress(merchant),
    status,
  });
  if (!endpoint) return NextResponse.json({ error: "Webhook endpoint was not found." }, { status: 404 });
  return NextResponse.json({ endpoint });
}

export async function DELETE(req: NextRequest) {
  const limit = await rateLimit(`webhooks-delete:${clientKey(req)}`, 10, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const merchant = typeof body?.merchant === "string" ? body.merchant : "";
  if (!isAddress(merchant)) return NextResponse.json({ error: "Merchant wallet address is invalid." }, { status: 400 });
  const session = await requireMerchantSession(req, merchant);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });
  const deleted = await deleteServerWebhookEndpoint({
    endpointId: typeof body?.endpointId === "string" ? body.endpointId : "",
    merchant: getAddress(merchant),
  });
  if (!deleted) return NextResponse.json({ error: "Webhook endpoint was not found." }, { status: 404 });
  return NextResponse.json({ deleted: true });
}
