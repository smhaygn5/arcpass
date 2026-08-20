import { isAddress } from "viem";
import type { ArcPassInvoice } from "./arcpass.ts";

export type PublicPaymentReceipt = {
  amount: string;
  blockNumber: string;
  explorerUrl: string;
  invoiceId: string;
  merchant: string;
  paidAt: string;
  payer: string;
  token: string;
  txHash: string;
  verified: true;
};

export function publicPaymentReceiptLink(payload: string) {
  return `/receipt/${encodeURIComponent(payload)}`;
}

export function isReceiptForInvoice(value: unknown, invoice: ArcPassInvoice): value is PublicPaymentReceipt {
  if (!value || typeof value !== "object") return false;
  const receipt = value as Partial<PublicPaymentReceipt>;
  return (
    receipt.verified === true &&
    receipt.invoiceId === invoice.invoiceId &&
    receipt.amount === invoice.amount &&
    receipt.token === invoice.token &&
    typeof receipt.paidAt === "string" &&
    Number.isFinite(new Date(receipt.paidAt).getTime()) &&
    typeof receipt.txHash === "string" &&
    /^0x[0-9a-fA-F]{64}$/.test(receipt.txHash) &&
    typeof receipt.blockNumber === "string" &&
    typeof receipt.explorerUrl === "string" &&
    /^https?:\/\//.test(receipt.explorerUrl) &&
    typeof receipt.merchant === "string" &&
    isAddress(receipt.merchant) &&
    receipt.merchant.toLowerCase() === invoice.merchant.walletAddress.toLowerCase() &&
    typeof receipt.payer === "string" &&
    isAddress(receipt.payer)
  );
}
