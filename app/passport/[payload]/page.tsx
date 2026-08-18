import { notFound } from "next/navigation";
import { PublicMerchantPassport } from "@/components/PublicMerchantPassport";
import { decodeInvoicePayload } from "@/lib/arcpass";

export const metadata = { title: "Merchant passport" };

export default async function MerchantPassportPage({
  params,
}: {
  params: Promise<{ payload: string }>;
}) {
  const { payload } = await params;
  const invoice = decodeInvoicePayload(payload);
  if (!invoice) notFound();
  return <PublicMerchantPassport invoice={invoice} payload={payload} />;
}
