import { notFound } from "next/navigation";
import { ArcPaymentPanel } from "@/components/ArcPaymentPanel";
import { decodeInvoicePayload } from "@/lib/arcpass";
import { findServerInvoiceByReference } from "@/lib/server-invoices";

export default async function PayPage({
  params,
}: {
  params: Promise<{ payload: string }>;
}) {
  const { payload: reference } = await params;
  const saved = await findServerInvoiceByReference(reference);
  const invoice = saved?.invoice ?? decodeInvoicePayload(reference);

  if (!invoice) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-background text-on-surface">
      <ArcPaymentPanel invoice={invoice} payload={saved?.payload ?? reference} publicReference={reference} />
    </main>
  );
}
