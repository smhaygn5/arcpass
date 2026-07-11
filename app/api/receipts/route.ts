import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { requireMerchantSession } from "@/lib/server-merchant-session";
import { loadServerReceipts } from "@/lib/server-receipts";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limit = await rateLimit(`receipts:${clientKey(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const merchant = req.nextUrl.searchParams.get("merchant") ?? "";
  if (!isAddress(merchant)) {
    return NextResponse.json({ error: "Merchant wallet address is invalid." }, { status: 400 });
  }

  const session = await requireMerchantSession(req, merchant);
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const receipts = await loadServerReceipts({ merchant: getAddress(merchant), limit: 50 });
  return NextResponse.json({ receipts });
}
