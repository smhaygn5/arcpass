import { after, NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { decodeInvoicePayload, type ArcPassInvoice } from "@/lib/arcpass";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { approveServerRequest, loadServerApprovalRequest, loadServerApprovalRequests, submitInvoicesForApproval } from "@/lib/server-approvals";
import { requireMerchantSession } from "@/lib/server-merchant-session";
import { getRequestOrigin } from "@/lib/site";
import { approvalRequestMessage, type ApprovalRequest } from "@/lib/team-policies";
import { publishServerWebhookEvent } from "@/lib/server-webhooks";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limit = await rateLimit(`approvals-read:${clientKey(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const requestId = req.nextUrl.searchParams.get("requestId") ?? "";
  if (requestId) {
    const request = await loadServerApprovalRequest(requestId);
    if (!request) return NextResponse.json({ error: "Approval request was not found." }, { status: 404 });
    return NextResponse.json({ message: approvalRequestMessage(request), request: publicApprovalRequest(request) });
  }
  const merchant = req.nextUrl.searchParams.get("merchant") ?? "";
  if (!isAddress(merchant)) return NextResponse.json({ error: "Merchant wallet address is invalid." }, { status: 400 });
  const session = await requireMerchantSession(req, merchant);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });
  const requests = await loadServerApprovalRequests(getAddress(merchant));
  return NextResponse.json({ requests: requests.map(publicApprovalRequest) });
}

export async function POST(req: NextRequest) {
  const limit = await rateLimit(`approvals-create:${clientKey(req)}`, 30, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  try {
    if (body?.action === "approve") {
      const request = await approveServerRequest({
        address: typeof body.address === "string" ? body.address : "",
        origin: getRequestOrigin(req.nextUrl.origin),
        requestId: typeof body.requestId === "string" ? body.requestId : "",
        signature: typeof body.signature === "string" ? body.signature : "",
      });
      if (!request) throw new Error("Approval request was not found.");
      if (request.status === "approved") {
        after(() => Promise.all([
          publishServerWebhookEvent({
            data: {
              approvals: request.approvals.length,
              invoices: request.invoices,
              operationLabel: request.operationLabel,
              requestId: request.requestId,
              requiredApprovals: request.requiredApprovals,
              totals: request.totals,
            },
            merchant: request.merchant,
            subjectId: request.requestId,
            type: "approval.completed",
          }),
          ...request.invoices.map((invoice) => publishServerWebhookEvent({
            data: { ...invoice, approvalRequestId: request.requestId },
            merchant: request.merchant,
            subjectId: invoice.invoiceId,
            type: "invoice.created",
          })),
        ]));
      }
      return NextResponse.json({ approved: request.status === "approved", request: publicApprovalRequest(request) });
    }

    const rawPayloads = Array.isArray(body?.payloads) ? body.payloads : typeof body?.payload === "string" ? [body.payload] : [];
    const payloads = rawPayloads.filter((payload): payload is string => typeof payload === "string");
    const invoices = payloads.map(decodeInvoicePayload);
    if (payloads.length < 1 || payloads.length > 10 || invoices.some((invoice) => !invoice)) throw new Error("One or more approval invoice payloads are invalid.");
    const validInvoices = invoices.filter((invoice): invoice is ArcPassInvoice => Boolean(invoice));
    const merchant = validInvoices[0].merchant.walletAddress;
    const session = await requireMerchantSession(req, merchant);
    if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });
    const result = await submitInvoicesForApproval({ invoices: validInvoices, operationLabel: typeof body?.operationLabel === "string" ? body.operationLabel : "Invoice issuance", origin: getRequestOrigin(req.nextUrl.origin), payloads });
    if (result.status === "registered") {
      after(() => Promise.all(result.invoices.map((item) => publishServerWebhookEvent({
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
      return NextResponse.json({ invoices: result.invoices, saved: true, status: result.status });
    }
    after(() => publishServerWebhookEvent({
      data: {
        invoices: result.request.invoices,
        operationLabel: result.request.operationLabel,
        requestId: result.request.requestId,
        requiredApprovals: result.request.requiredApprovals,
        totals: result.request.totals,
      },
      merchant: result.request.merchant,
      subjectId: result.request.requestId,
      type: "approval.requested",
    }));
    return NextResponse.json({ request: publicApprovalRequest(result.request), saved: false, status: result.status });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Approval operation failed." }, { status: 400 });
  }
}

function publicApprovalRequest(request: ApprovalRequest) {
  return {
    approvals: request.approvals,
    createdAt: request.createdAt,
    expiresAt: request.expiresAt,
    invoices: request.invoices,
    merchant: request.merchant,
    operationLabel: request.operationLabel,
    requestId: request.requestId,
    requiredApprovals: request.requiredApprovals,
    status: request.status,
    totals: request.totals,
  };
}
