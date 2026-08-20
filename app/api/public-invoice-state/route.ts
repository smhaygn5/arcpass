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
  const trustedReceipt = registeredInvoice ? matchedReceipt : null;

  return NextResponse.json({
    invoiceId: invoice.invoiceId,
    paid: Boolean(trustedReceipt),
    registered: Boolean(registeredInvoice),
    receipt: trustedReceipt
      ? {
          amount: trustedReceipt.amount,
          blockNumber: trustedReceipt.blockNumber,
          explorerUrl: trustedReceipt.explorerUrl,
          invoiceId: trustedReceipt.invoiceId,
          merchant: trustedReceipt.merchant,
          paidAt: trustedReceipt.paidAt,
          payer: trustedReceipt.payer,
          token: trustedReceipt.token,
          txHash: trustedReceipt.txHash,
          verified: true,
        }
      : null,
  });
}
