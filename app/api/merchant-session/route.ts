import { NextRequest, NextResponse } from "next/server";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import {
  createMerchantChallenge,
  setMerchantSessionCookie,
  verifyMerchantChallenge,
} from "@/lib/server-merchant-session";

export const runtime = "nodejs";

type SessionBody = {
  address?: unknown;
  message?: unknown;
  signature?: unknown;
};

export async function GET(req: NextRequest) {
  const limit = await rateLimit(`merchant-session-challenge:${clientKey(req)}`, 20, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  try {
    const address = req.nextUrl.searchParams.get("address") ?? "";
    return NextResponse.json(await createMerchantChallenge({ address, origin: requestOrigin(req) }));
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Merchant session challenge failed." },
      { status: 400 },
    );
  }
}

export async function POST(req: NextRequest) {
  const limit = await rateLimit(`merchant-session-verify:${clientKey(req)}`, 20, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const body = (await req.json().catch(() => null)) as SessionBody | null;
  const address = typeof body?.address === "string" ? body.address : "";
  const message = typeof body?.message === "string" ? body.message : "";
  const signature = typeof body?.signature === "string" ? body.signature : "";

  try {
    const session = await verifyMerchantChallenge({ address, message, signature });
    const response = NextResponse.json({ address: session.address, authenticated: true });
    setMerchantSessionCookie(response, session.token);
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: err instanceof Error ? err.message : "Merchant session could not be verified." },
      { status: 401 },
    );
  }
}

function requestOrigin(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const protocol = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");

  return host ? `${protocol}://${host}` : req.nextUrl.origin;
}
