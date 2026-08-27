import { after, NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { decodeInvoicePayload, invoiceExpired, type ArcPassInvoice } from "@/lib/arcpass";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { getRequestOrigin } from "@/lib/site";
import { verifyMerchantDomain } from "@/lib/server-domain-verification";
import { requireMerchantSession } from "@/lib/server-merchant-session";
import { loadServerInvoices, saveServerInvoice } from "@/lib/server-invoices";
import { approvalRequiredForInvoices } from "@/lib/server-approvals";
import { publishServerWebhookEvent } from "@/lib/server-webhooks";

export const runtime = "nodejs";

type InvoiceBody = {
  payload?: unknown;
  payloads?: unknown;
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
  const payloads = Array.isArray(body?.payloads) ? body.payloads.filter((item): item is string => typeof item === "string") : payload ? [payload] : [];
  if (payloads.length === 0 || payloads.length > 10) {
    return NextResponse.json({ error: "Submit between 1 and 10 invoice payloads." }, { status: 400 });
  }
  const invoices = payloads.map(decodeInvoicePayload);
  if (invoices.some((invoice) => !invoice)) {
    return NextResponse.json({ error: "One or more invoice payloads are invalid." }, { status: 400 });
  }
  const validInvoices = invoices.filter((item): item is ArcPassInvoice => Boolean(item));
  const invoice = validInvoices[0];

  if (validInvoices.some((item) => item.merchant.walletAddress.toLowerCase() !== invoice.merchant.walletAddress.toLowerCase())) {
    return NextResponse.json({ error: "All batch invoices must belong to the same merchant wallet." }, { status: 400 });
  }

  if (validInvoices.some((item) => invoiceExpired(item))) {
    return NextResponse.json({ error: "Expired invoices cannot be registered." }, { status: 410 });
  }

  const session = await requireMerchantSession(req, invoice.merchant.walletAddress);
  if (!session.ok) {
    return NextResponse.json({ error: session.error }, { status: session.status });
  }

  for (const item of validInvoices.filter((candidate) => candidate.merchant.status === "verified")) {
    const verification = await verifyMerchantDomain({ domain: item.merchant.domain, walletAddress: item.merchant.walletAddress });

    if (!verification.verified) {
      return NextResponse.json(
        { error: verification.error || "Merchant domain verification failed." },
        { status: 409 },
      );
    }
  }

  const approval = await approvalRequiredForInvoices(validInvoices);
  if (approval.required) {
    return NextResponse.json(
      { error: `Team approval is required before registering this ${approval.triggeredTokens.join("/")} invoice operation.` },
      { status: 409 },
    );
  }

  const origin = getRequestOrigin(req.nextUrl.origin);
  const savedInvoices = await Promise.all(validInvoices.map((item) => saveServerInvoice({ invoice: item, origin })));
  after(() => Promise.all(savedInvoices.map((item) => publishServerWebhookEvent({
    data: {
      amount: item.invoice.amount,
      description: item.invoice.description,
      expiresAt: item.invoice.expiresAt,
      invoiceId: item.invoice.invoiceId,
      link: item.link,
      token: item.invoice.token,
    },
    merchant: getAddress(item.invoice.merchant.walletAddress),
    subjectId: item.invoice.invoiceId,
    type: "invoice.created",
  }))));
  return NextResponse.json({ invoice: savedInvoices[0], invoices: savedInvoices, saved: true });
}
