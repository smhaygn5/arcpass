import { after, NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress, verifyMessage, type Hex } from "viem";
import { decodeInvoicePayload } from "@/lib/arcpass";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { extractInvoicePayload } from "@/lib/receipts";
import { normalizeRefundReason, refundRequestMessage } from "@/lib/refunds";
import { disputeDecisionMessage, normalizeDisputeStatement } from "@/lib/disputes";
import { requireMerchantSession } from "@/lib/server-merchant-session";
import { findServerReceiptByTxHash } from "@/lib/server-receipts";
import { createServerRefundRequest, findServerRefundRequest, findServerRefundRequestById, loadServerRefundRequests, updateServerRefundRequest } from "@/lib/server-refunds";
import { publishServerWebhookEvent } from "@/lib/server-webhooks";

export const runtime = "nodejs";
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;

export async function GET(req: NextRequest) {
  const limit = await rateLimit(`refunds-read:${clientKey(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const txHash = req.nextUrl.searchParams.get("txHash") ?? "";
  if (txHash) {
    if (!TX_HASH.test(txHash)) return NextResponse.json({ error: "Transaction hash is invalid." }, { status: 400 });
    const request = await findServerRefundRequest(txHash);
    return NextResponse.json({ refund: request });
  }
  const merchant = req.nextUrl.searchParams.get("merchant") ?? "";
  if (!isAddress(merchant)) return NextResponse.json({ error: "Merchant wallet address is invalid." }, { status: 400 });
  const session = await requireMerchantSession(req, merchant);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });
  return NextResponse.json({ refunds: await loadServerRefundRequests(getAddress(merchant)) });
}

export async function POST(req: NextRequest) {
  const limit = await rateLimit(`refunds-create:${clientKey(req)}`, 10, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const body = (await req.json().catch(() => null)) as { reason?: unknown; signature?: unknown; txHash?: unknown } | null;
  const txHash = typeof body?.txHash === "string" ? body.txHash : "";
  const signature = typeof body?.signature === "string" ? body.signature : "";
  if (!TX_HASH.test(txHash) || !/^0x[0-9a-fA-F]+$/.test(signature)) return NextResponse.json({ error: "Refund signature or transaction hash is invalid." }, { status: 400 });
  try {
    const reason = normalizeRefundReason(typeof body?.reason === "string" ? body.reason : "");
    const receipt = await findServerReceiptByTxHash(txHash);
    if (!receipt) return NextResponse.json({ error: "A verified ArcPass receipt is required." }, { status: 404 });
    const invoice = decodeInvoicePayload(extractInvoicePayload(receipt.link));
    if (!invoice || invoice.invoiceId !== receipt.invoiceId) return NextResponse.json({ error: "The registered invoice could not be verified." }, { status: 409 });
    if (invoice.merchant.refundPolicy === "none") return NextResponse.json({ error: "This merchant passport does not offer a refund request policy." }, { status: 409 });
    const message = refundRequestMessage({ invoiceId: receipt.invoiceId, payer: receipt.payer, reason, txHash: receipt.txHash });
    const verified = await verifyMessage({ address: receipt.payer, message, signature: signature as Hex });
    if (!verified) return NextResponse.json({ error: "Refund request must be signed by the payer wallet." }, { status: 401 });
    const refund = await createServerRefundRequest(receipt, reason, signature as Hex);
    after(() => publishServerWebhookEvent({
      data: {
        amount: refund.amount,
        invoiceId: refund.invoiceId,
        payer: refund.payer,
        reason: refund.reason,
        requestId: refund.requestId,
        status: refund.status,
        token: refund.token,
        txHash: refund.txHash,
      },
      merchant: refund.merchant,
      subjectId: refund.requestId,
      type: "refund.requested",
    }));
    return NextResponse.json({ refund });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Refund request could not be created." }, { status: 400 });
  }
}

export async function PATCH(req: NextRequest) {
  const limit = await rateLimit(`refunds-update:${clientKey(req)}`, 30, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const body = (await req.json().catch(() => null)) as { merchant?: unknown; note?: unknown; requestId?: unknown; signature?: unknown; signer?: unknown; status?: unknown } | null;
  const merchant = typeof body?.merchant === "string" ? body.merchant : "";
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  const signer = typeof body?.signer === "string" ? body.signer : "";
  const signature = typeof body?.signature === "string" ? body.signature : "";
  const status = body?.status === "approved" || body?.status === "declined" ? body.status : null;
  if (!isAddress(merchant) || !isAddress(signer) || !/^ref_[a-z0-9]{16}$/.test(requestId) || !status || !/^0x[0-9a-fA-F]+$/.test(signature)) return NextResponse.json({ error: "Signed refund decision is invalid." }, { status: 400 });
  const session = await requireMerchantSession(req, merchant);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });
  const current = await findServerRefundRequestById(requestId);
  if (!current || current.merchant.toLowerCase() !== merchant.toLowerCase()) return NextResponse.json({ error: "Refund request was not found." }, { status: 404 });
  if (current.status !== "pending") return NextResponse.json({ error: "A final decision has already been recorded." }, { status: 409 });
  const normalizedMerchant = getAddress(merchant);
  if (getAddress(signer) !== normalizedMerchant) return NextResponse.json({ error: "The decision must be signed by the merchant wallet." }, { status: 403 });
  let note: string;
  try {
    note = normalizeDisputeStatement(typeof body?.note === "string" ? body.note : "");
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Decision note is invalid." }, { status: 400 });
  }
  const message = disputeDecisionMessage({ invoiceId: current.invoiceId, note, requestId, signer: normalizedMerchant, status, txHash: current.txHash });
  const verified = await verifyMessage({ address: normalizedMerchant, message, signature: signature as Hex }).catch(() => false);
  if (!verified) return NextResponse.json({ error: "Merchant decision signature could not be verified." }, { status: 401 });
  const decidedAt = new Date().toISOString();
  const refund = await updateServerRefundRequest({
    decision: { decidedAt, note, signature: signature as Hex, signer: normalizedMerchant, status },
    merchant: normalizedMerchant,
    requestId,
    status,
  });
  if (!refund) return NextResponse.json({ error: "The request changed before this decision was recorded. Refresh and try again." }, { status: 409 });
  after(() => publishServerWebhookEvent({
    data: {
      invoiceId: refund.invoiceId,
      requestId: refund.requestId,
      status: refund.status,
      txHash: refund.txHash,
      updatedAt: refund.updatedAt,
    },
    merchant: refund.merchant,
    subjectId: `${refund.requestId}:${refund.status}`,
    type: "refund.updated",
  }));
  return NextResponse.json({ refund });
}
