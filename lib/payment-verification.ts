import type { Address, Hash } from "viem";
import type { ArcPassInvoice } from "./arcpass.ts";

/** A wallet-signed claim binds the actor requesting verification to the onchain payer. */
export function paymentVerificationMessage({ invoice, payer, txHash }: { invoice: ArcPassInvoice; payer: Address; txHash: Hash }) {
  return [
    "ArcPass payment receipt verification",
    `Invoice: ${invoice.invoiceId}`,
    `Transaction: ${txHash}`,
    `Payer: ${payer}`,
    `Merchant: ${invoice.merchant.walletAddress}`,
    `Amount: ${invoice.amount} ${invoice.token}`,
    "Purpose: authorize ArcPass to associate this Arc transaction with this invoice.",
  ].join("\n");
}
