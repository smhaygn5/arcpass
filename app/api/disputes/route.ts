import { after, NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress, verifyMessage, type Hex } from "viem";
import {
  disputeEvidenceMessage,
  normalizeDisputeStatement,
  normalizeEvidenceSha256,
  normalizeEvidenceUrl,
  type DisputeEvidenceRole,
} from "@/lib/disputes";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { createServerDisputeEvidence, loadServerDisputeEvidence } from "@/lib/server-disputes";
import { requireMerchantSession } from "@/lib/server-merchant-session";
import { findServerRefundRequest, findServerRefundRequestById } from "@/lib/server-refunds";
import { publishServerWebhookEvent } from "@/lib/server-webhooks";

export const runtime = "nodejs";
const TX_HASH = /^0x[0-9a-fA-F]{64}$/;
const REQUEST_ID = /^ref_[a-z0-9]{16}$/;

export async function GET(req: NextRequest) {
  const limit = await rateLimit(`disputes-read:${clientKey(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const txHash = req.nextUrl.searchParams.get("txHash") ?? "";
  const requestId = req.nextUrl.searchParams.get("requestId") ?? "";
  const merchant = req.nextUrl.searchParams.get("merchant") ?? "";

  if (txHash) {
    if (!TX_HASH.test(txHash)) return NextResponse.json({ error: "Transaction hash is invalid." }, { status: 400 });
    const refund = await findServerRefundRequest(txHash);
    if (!refund) return NextResponse.json({ room: null });
    return NextResponse.json({ room: { evidence: await loadServerDisputeEvidence(refund.requestId), refund } });
  }

  if (!REQUEST_ID.test(requestId) || !isAddress(merchant)) {
    return NextResponse.json({ error: "Dispute room reference is invalid." }, { status: 400 });
  }
  const session = await requireMerchantSession(req, merchant);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });
  const refund = await findServerRefundRequestById(requestId);
  if (!refund || refund.merchant.toLowerCase() !== merchant.toLowerCase()) {
    return NextResponse.json({ error: "Dispute room was not found." }, { status: 404 });
  }
  return NextResponse.json({ room: { evidence: await loadServerDisputeEvidence(refund.requestId), refund } });
}

export async function POST(req: NextRequest) {
  const limit = await rateLimit(`disputes-create:${clientKey(req)}`, 20, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const body = (await req.json().catch(() => null)) as Record<string, unknown> | null;
  const requestId = typeof body?.requestId === "string" ? body.requestId : "";
  const signer = typeof body?.signer === "string" ? body.signer : "";
  const signature = typeof body?.signature === "string" ? body.signature : "";
  const role: DisputeEvidenceRole | null = body?.role === "payer" || body?.role === "merchant" ? body.role : null;
  if (!REQUEST_ID.test(requestId) || !isAddress(signer) || !role || !/^0x[0-9a-fA-F]+$/.test(signature)) {
    return NextResponse.json({ error: "Signed evidence submission is invalid." }, { status: 400 });
  }

  try {
    const refund = await findServerRefundRequestById(requestId);
    if (!refund) return NextResponse.json({ error: "Dispute room was not found." }, { status: 404 });
    if (refund.status !== "pending") return NextResponse.json({ error: "This evidence room is closed because a decision has already been recorded." }, { status: 409 });

    const normalizedSigner = getAddress(signer);
    const expectedSigner = role === "payer" ? refund.payer : refund.merchant;
    if (normalizedSigner !== expectedSigner) {
      return NextResponse.json({ error: `Evidence must be signed by the ${role} wallet.` }, { status: 403 });
    }
    if (role === "merchant") {
      const session = await requireMerchantSession(req, normalizedSigner);
      if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });
    }

    const statement = normalizeDisputeStatement(typeof body?.statement === "string" ? body.statement : "");
    const evidenceUrl = normalizeEvidenceUrl(typeof body?.evidenceUrl === "string" ? body.evidenceUrl : "");
    const evidenceSha256 = normalizeEvidenceSha256(typeof body?.evidenceSha256 === "string" ? body.evidenceSha256 : "");
    const message = disputeEvidenceMessage({ evidenceSha256, evidenceUrl, invoiceId: refund.invoiceId, requestId, role, signer: normalizedSigner, statement, txHash: refund.txHash });
    const verified = await verifyMessage({ address: normalizedSigner, message, signature: signature as Hex });
    if (!verified) return NextResponse.json({ error: "Evidence signature could not be verified." }, { status: 401 });

    const evidence = await createServerDisputeEvidence({ evidenceSha256, evidenceUrl, refund, role, signature: signature as Hex, signer: normalizedSigner, statement });
    after(() => publishServerWebhookEvent({
      data: {
        evidenceId: evidence.evidenceId,
        invoiceId: refund.invoiceId,
        requestId: refund.requestId,
        role: evidence.role,
        signer: evidence.signer,
        txHash: refund.txHash,
      },
      merchant: refund.merchant,
      subjectId: evidence.evidenceId,
      type: "dispute.evidence_added",
    }));
    return NextResponse.json({ evidence });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Evidence could not be recorded." }, { status: 400 });
  }
}
