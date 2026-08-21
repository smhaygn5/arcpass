import type { SavedInvoice } from "./invoices.ts";
import { invoiceStatus } from "./invoices.ts";
import type { SavedReceipt } from "./receipts.ts";

export type CollectionReminderKind = "expired" | "due-today" | "due-soon" | "follow-up";

export type CollectionReminder = {
  invoice: SavedInvoice;
  kind: CollectionReminderKind;
  label: string;
  message: string;
  priority: number;
};

const HOUR_MS = 60 * 60 * 1000;

export function collectionReminders(invoices: SavedInvoice[], receipts: SavedReceipt[], now = new Date()): CollectionReminder[] {
  const currentTime = Number.isFinite(now.getTime()) ? now.getTime() : Date.now();
  return invoices
    .flatMap((saved): CollectionReminder[] => {
      if (invoiceStatus(saved.invoice, receipts) === "verified") return [];
      const expiresAt = new Date(saved.invoice.expiresAt).getTime();
      const createdAt = new Date(saved.invoice.createdAt).getTime();
      if (!Number.isFinite(expiresAt) || !Number.isFinite(createdAt)) return [];
      const hoursLeft = (expiresAt - currentTime) / HOUR_MS;
      const ageHours = (currentTime - createdAt) / HOUR_MS;
      const merchant = saved.invoice.merchant.businessName;
      const amount = `${saved.invoice.amount} ${saved.invoice.token}`;
      if (hoursLeft <= 0) {
        return [{ invoice: saved, kind: "expired", label: "Expired", priority: 0, message: `The ArcPass invoice for ${amount} from ${merchant} has expired. Please contact the merchant if you still need a renewed payment link.` }];
      }
      const dueDate = new Date(expiresAt).toLocaleString("en", { dateStyle: "medium", timeStyle: "short" });
      if (hoursLeft <= 24) {
        return [{ invoice: saved, kind: "due-today", label: "Due today", priority: 1, message: `Friendly reminder: your ${amount} ArcPass invoice from ${merchant} expires ${dueDate}. Complete payment here: ${saved.link}` }];
      }
      if (hoursLeft <= 72) {
        return [{ invoice: saved, kind: "due-soon", label: "Due soon", priority: 2, message: `Your ${amount} ArcPass invoice from ${merchant} expires ${dueDate}. You can review and pay the verified invoice here: ${saved.link}` }];
      }
      if (ageHours >= 48) {
        return [{ invoice: saved, kind: "follow-up", label: "Follow up", priority: 3, message: `A quick reminder about the ${amount} ArcPass invoice from ${merchant}. Review the merchant passport and payment details here: ${saved.link}` }];
      }
      return [];
    })
    .sort((a, b) => a.priority - b.priority || new Date(a.invoice.invoice.expiresAt).getTime() - new Date(b.invoice.invoice.expiresAt).getTime());
}
