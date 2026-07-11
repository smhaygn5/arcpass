import { NextRequest, NextResponse } from "next/server";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { verifyMerchantDomain } from "@/lib/server-domain-verification";

export async function POST(req: NextRequest) {
  const limit = await rateLimit(`passport:${clientKey(req)}`, 12, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const body = await req.json().catch(() => null) as {
    domain?: unknown;
    walletAddress?: unknown;
  } | null;
  const verification = await verifyMerchantDomain({
    domain: typeof body?.domain === "string" ? body.domain : "",
    walletAddress: typeof body?.walletAddress === "string" ? body.walletAddress : "",
  });
  const { status, ...response } = verification;

  return NextResponse.json(response, { status });
}