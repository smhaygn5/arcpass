import { after, NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { publishServerWebhookEvent } from "@/lib/server-webhooks";
import { findServerX402Resource, recordServerX402Access } from "@/lib/server-x402";
import { createArcX402RequestServer } from "@/lib/server-x402-gateway";
import { x402PriceToAtomic } from "@/lib/x402";

export const runtime = "nodejs";

export async function GET(req: NextRequest, context: RouteContext<"/api/x402/resources/[resourceId]">) {
  const limit = await rateLimit(`x402-access:${clientKey(req)}`, 90, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const { resourceId } = await context.params;

  try {
    const resource = await findServerX402Resource(resourceId);
    if (!resource) return NextResponse.json({ error: "Nanopayment resource was not found." }, { status: 404 });
    if (resource.status !== "active") return NextResponse.json({ error: "This nanopayment resource is paused." }, { status: 410 });

    const { context: paymentContext, server } = await createArcX402RequestServer(req, resource);
    const payment = await server.processHTTPRequest(paymentContext);
    if (payment.type === "payment-error") return instructionResponse(payment.response);
    if (payment.type === "no-payment-required") {
      return NextResponse.json({ error: "Payment policy was not applied to this resource." }, { status: 500 });
    }

    const protectedBody = {
      data: resource.responseBody,
      paid: true,
      resource: { description: resource.description, id: resource.resourceId, title: resource.title },
    };
    const responseBody = Buffer.from(JSON.stringify(protectedBody));
    const settlement = await server.processSettlement(
      payment.paymentPayload,
      payment.paymentRequirements,
      payment.declaredExtensions,
      { request: paymentContext, responseBody, responseHeaders: { "content-type": "application/json" } },
      undefined,
      payment.beforeHandlerSettlement,
    );
    if (!settlement.success) return instructionResponse(settlement.response);

    if (typeof settlement.payer !== "string" || !isAddress(settlement.payer) || !settlement.transaction || typeof settlement.network !== "string") {
      return NextResponse.json({ error: "Gateway settlement did not return a valid payer receipt." }, { status: 502 });
    }
    try {
      const access = await recordServerX402Access({
        amount: x402PriceToAtomic(resource.price),
        merchant: resource.merchant,
        network: settlement.network,
        payer: getAddress(settlement.payer),
        resourceId: resource.resourceId,
        transaction: settlement.transaction,
      });
      after(() => publishServerWebhookEvent({
        data: { accessId: access.accessId, amount: access.amount, network: access.network, payer: access.payer, resourceId: access.resourceId, transaction: access.transaction },
        merchant: resource.merchant,
        subjectId: access.accessId,
        type: "x402.payment_settled",
      }));
    } catch {
      // Payment is already final. Never withhold the purchased response because
      // a secondary analytics write failed after successful settlement.
    }

    const headers = new Headers(settlement.headers);
    headers.set("cache-control", "private, no-store");
    headers.set("content-type", "application/json");
    return new NextResponse(responseBody, { headers, status: 200 });
  } catch (error) {
    const message = error instanceof Error ? error.message : "Nanopayment request could not be completed.";
    const unavailable = /DATABASE_URL|persistent database/i.test(message);
    return NextResponse.json(
      { error: unavailable ? "Persistent storage is not configured for this deployment." : "Circle Gateway is temporarily unavailable for this resource." },
      { headers: { "cache-control": "no-store" }, status: 503 },
    );
  }
}

function instructionResponse(instructions: { body?: unknown; headers: Record<string, string>; status: number }) {
  const headers = new Headers(instructions.headers);
  headers.set("cache-control", "no-store");
  const body = typeof instructions.body === "string" ? instructions.body : JSON.stringify(instructions.body ?? {});
  return new NextResponse(body, { headers, status: instructions.status });
}
