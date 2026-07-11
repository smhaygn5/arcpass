import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { decodeInvoicePayload } from "@/lib/arcpass";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { verifyMerchantDomain } from "@/lib/server-domain-verification";
import { requireMerchantSession } from "@/lib/server-merchant-session";
import { loadServerInvoices, saveServerInvoice } from "@/lib/server-invoices";

export const runtime = "nodejs";

type InvoiceBody = {
  payload?: unknown;
};

export async function GET(req: NextRequest) {
  const limit = await rateLimit(`invoices:${clientKey(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const merchant = req.nextUrl.searchParams.get("merchant") ?? "";
  if (!isAddress(merchant)) {
    return NextResponse.json({ error: "Merchant wallet address is invalid." }, { status: 400 });
  }

  const session = await requireMerchantSession(req, merchant);
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  const invoices = await loadServerInvoices({ merchant: getAddress(merchant), limit: 50 });
  return NextResponse.json({ invoices });
}

export async function POST(req: NextRequest) {
  const limit = await rateLimit(`invoices-create:${clientKey(req)}`, 30, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const body = (await req.json().catch(() => null)) as InvoiceBody | null;
  const payload = typeof body?.payload === "string" ? body.payload : "";
  const invoice = decodeInvoicePayload(payload);

  if (!invoice) {
    return NextResponse.json({ error: "Invoice payload is invalid." }, { status: 400 });
  }

  const session = await requireMerchantSession(req, invoice.merchant.walletAddress);
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  if (invoice.merchant.status === "verified") {
    const verification = await verifyMerchantDomain({
      domain: invoice.merchant.domain,
      walletAddress: invoice.merchant.walletAddress,
    });

    if (!verification.verified) {
      return NextResponse.json(
        { error: verification.error || "Merchant domain verification failed." },
        { status: 409 },
      );
    }
  }

  const saved = await saveServerInvoice({ invoice, origin: requestOrigin(req) });
  return NextResponse.json({ invoice: saved, saved: true });
}

function requestOrigin(req: NextRequest) {
  const host = req.headers.get("x-forwarded-host") ?? req.headers.get("host");
  const protocol = req.headers.get("x-forwarded-proto") ?? req.nextUrl.protocol.replace(":", "");

  return host ? `${protocol}://${host}` : req.nextUrl.origin;
}
