import type { SavedInvoice } from "./invoices.ts";
import type { SavedReceipt } from "./receipts.ts";

export type InvoiceLifecycleEvent = {
  at: string;
  detail: string;
  status: "created" | "awaiting" | "verified" | "expired";
  title: string;
};

export function invoiceLifecycle(
  savedInvoice: SavedInvoice,
  receipts: SavedReceipt[],
  now = new Date(),
): InvoiceLifecycleEvent[] {
  const invoice = savedInvoice.invoice;
  const receipt = receipts.find((item) => item.invoiceId === invoice.invoiceId);
  const events: InvoiceLifecycleEvent[] = [
    {
      at: invoice.createdAt,
      detail: `${invoice.amount} ${invoice.token} · ${invoice.description}`,
      status: "created",
      title: "Payment link created",
    },
  ];

  if (receipt) {
    events.push({
      at: receipt.paidAt,
      detail: `${receipt.amount} ${receipt.token} verified on Arc Testnet.`,
      status: "verified",
      title: "Payment verified",
    });
  } else if (new Date(invoice.expiresAt).getTime() <= now.getTime()) {
    events.push({
      at: invoice.expiresAt,
      detail: "No verified payment was recorded before the expiry time.",
      status: "expired",
      title: "Payment link expired",
    });
  } else {
    events.push({
      at: invoice.createdAt,
      detail: `Open until ${new Date(invoice.expiresAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" })}.`,
      status: "awaiting",
      title: "Awaiting payment",
    });
  }

  return events.sort((left, right) => new Date(right.at).getTime() - new Date(left.at).getTime());
}
