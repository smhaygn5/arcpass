import { notFound } from "next/navigation";
import { PublicPaymentReceipt } from "@/components/PublicPaymentReceipt";
import { decodeInvoicePayload } from "@/lib/arcpass";
import { findServerInvoiceByReference } from "@/lib/server-invoices";

export const metadata = { title: "Payment receipt" };

export default async function ReceiptPage({ params }: { params: Promise<{ payload: string }> }) {
  const { payload: reference } = await params;
  const saved = await findServerInvoiceByReference(reference);
  const invoice = saved?.invoice ?? decodeInvoicePayload(reference);
  if (!invoice) notFound();
  return <PublicPaymentReceipt invoice={invoice} publicReference={reference} />;
}
