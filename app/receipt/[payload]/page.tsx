import { notFound } from "next/navigation";
import { PublicPaymentReceipt } from "@/components/PublicPaymentReceipt";
import { decodeInvoicePayload } from "@/lib/arcpass";

export const metadata = { title: "Payment receipt" };

export default async function ReceiptPage({ params }: { params: Promise<{ payload: string }> }) {
  const { payload } = await params;
  const invoice = decodeInvoicePayload(payload);
  if (!invoice) notFound();
  return <PublicPaymentReceipt invoice={invoice} payload={payload} />;
}
