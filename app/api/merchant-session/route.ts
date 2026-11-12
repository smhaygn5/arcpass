import { NextRequest, NextResponse } from "next/server";
import { clientKey, rateLimit, tooManyRequests, walletRateLimitKey } from "@/lib/rate-limit";
import { getRequestOrigin } from "@/lib/site";
import {
  createMerchantChallenge,
  revokeMerchantSession,
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
  const address = req.nextUrl.searchParams.get("address") ?? "";
  const limit = await rateLimit(`merchant-session-challenge:${clientKey(req)}:${walletRateLimitKey(address)}`, 8, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  try {
    return NextResponse.json(await createMerchantChallenge({ address, origin: getRequestOrigin(req.nextUrl.origin) }));
  } catch (err) {
    return NextResponse.json(
      { error: "Merchant session challenge could not be created." },
      { status: err instanceof Error && /DATABASE_URL/i.test(err.message) ? 503 : 400 },
    );
  }
}

export async function POST(req: NextRequest) {
  const body = (await req.json().catch(() => null)) as SessionBody | null;
  const address = typeof body?.address === "string" ? body.address : "";
  const limit = await rateLimit(`merchant-session-verify:${clientKey(req)}:${walletRateLimitKey(address)}`, 8, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const message = typeof body?.message === "string" ? body.message : "";
  const signature = typeof body?.signature === "string" ? body.signature : "";

  try {
    const session = await verifyMerchantChallenge({ address, message, signature });
    const response = NextResponse.json({ address: session.address, authenticated: true });
    setMerchantSessionCookie(response, session.token);
    return response;
  } catch (err) {
    return NextResponse.json(
      { error: "Merchant session could not be verified." },
      { status: err instanceof Error && /DATABASE_URL/i.test(err.message) ? 503 : 401 },
    );
  }
}

export async function DELETE(req: NextRequest) {
  const limit = await rateLimit(`merchant-session-revoke:${clientKey(req)}`, 20, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  try {
    const response = NextResponse.json({ authenticated: false });
    await revokeMerchantSession(req, response);
    return response;
  } catch {
    return NextResponse.json({ error: "The merchant session could not be disconnected." }, { status: 500 });
  }
}
