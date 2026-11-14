import { NextRequest, NextResponse } from "next/server";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { findServerInvoiceByReference } from "@/lib/server-invoices";
import { loadServerReceipts } from "@/lib/server-receipts";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limit = await rateLimit(`public-invoice-state:${clientKey(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  const reference = req.nextUrl.searchParams.get("ref") ?? req.nextUrl.searchParams.get("payload") ?? "";
  const registeredInvoice = await findServerInvoiceByReference(reference);
  if (!registeredInvoice) return NextResponse.json({ error: "Invoice link is invalid or unavailable." }, { status: 404 });

  const invoice = registeredInvoice.invoice;
  const merchant = invoice.merchant.walletAddress;

  const receipts = await loadServerReceipts({ merchant, limit: 100 });
  const matchedReceipt = receipts.find((receipt) => receipt.invoiceId === invoice.invoiceId);
  const trustedReceipt = matchedReceipt;

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
