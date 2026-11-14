import { notFound } from "next/navigation";
import { PublicMerchantPassport } from "@/components/PublicMerchantPassport";
import { decodeInvoicePayload } from "@/lib/arcpass";
import { findServerInvoiceByReference } from "@/lib/server-invoices";

export const metadata = { title: "Merchant passport" };

export default async function MerchantPassportPage({
  params,
}: {
  params: Promise<{ payload: string }>;
}) {
  const { payload: reference } = await params;
  const saved = await findServerInvoiceByReference(reference);
  const invoice = saved?.invoice ?? decodeInvoicePayload(reference);
  if (!invoice) notFound();
  return <PublicMerchantPassport invoice={invoice} publicReference={reference} />;
}
