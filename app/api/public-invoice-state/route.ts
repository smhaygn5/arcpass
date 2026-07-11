import { NextRequest, NextResponse } from "next/server";
import { getAddress } from "viem";
import { decodeInvoicePayload } from "@/lib/arcpass";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { findServerInvoiceByPayload } from "@/lib/server-invoices";
import { loadServerReceipts } from "@/lib/server-receipts";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limit = await rateLimit(`public-invoice-state:${clientKey(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const payload = req.nextUrl.searchParams.get("payload") ?? "";
  const invoice = decodeInvoicePayload(payload);

  if (!invoice) {
    return NextResponse.json({ error: "Invoice payload is invalid." }, { status: 400 });
  }

  const merchant = getAddress(invoice.merchant.walletAddress);
  const registeredInvoice = await findServerInvoiceByPayload({
    invoiceId: invoice.invoiceId,
    merchant,
    payload,
  });

  const receipts = await loadServerReceipts({ merchant, limit: 100 });
  const matchedReceipt = receipts.find((receipt) => receipt.invoiceId === invoice.invoiceId);

  return NextResponse.json({
    invoiceId: invoice.invoiceId,
    paid: Boolean(matchedReceipt),
    registered: Boolean(registeredInvoice),
    receipt: matchedReceipt
      ? {
          amount: matchedReceipt.amount,
          blockNumber: matchedReceipt.blockNumber,
          explorerUrl: matchedReceipt.explorerUrl,
          invoiceId: matchedReceipt.invoiceId,
          merchant: matchedReceipt.merchant,
          paidAt: matchedReceipt.paidAt,
          payer: matchedReceipt.payer,
          token: matchedReceipt.token,
          txHash: matchedReceipt.txHash,
          verified: true,
        }
      : null,
  });
}
