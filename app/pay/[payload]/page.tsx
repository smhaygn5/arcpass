import { notFound } from "next/navigation";
import { ArcPaymentPanel } from "@/components/ArcPaymentPanel";
import { decodeInvoicePayload } from "@/lib/arcpass";

export default async function PayPage({
  params,
}: {
  params: Promise<{ payload: string }>;
}) {
  const { payload } = await params;
  const invoice = decodeInvoicePayload(payload);

  if (!invoice) {
    notFound();
  }

  return (
    <main className="min-h-screen bg-background text-on-surface">
      <ArcPaymentPanel invoice={invoice} payload={payload} />
    </main>
  );
}
