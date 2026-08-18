export type PaymentReadinessInput = {
  balanceReady: boolean | null;
  expired: boolean;
  hasReceipt: boolean;
  invoiceRegistered: boolean | null;
  networkReady: boolean;
  payerSelected: boolean;
  payerMatchesMerchant: boolean;
};

export type PaymentReadinessCheck = {
  detail: string;
  label: string;
  state: "ready" | "pending" | "blocked";
};

export function paymentReadinessChecks(input: PaymentReadinessInput): PaymentReadinessCheck[] {
  const registration = input.invoiceRegistered === null
    ? { label: "ArcPass invoice registry", state: "pending" as const, detail: "Confirming the server-issued invoice." }
    : input.invoiceRegistered
      ? { label: "ArcPass invoice registry", state: "ready" as const, detail: "Invoice is registered and payment can be verified." }
      : { label: "ArcPass invoice registry", state: "blocked" as const, detail: "This invoice is not registered. Do not pay." };
  const expiry = input.expired
    ? { label: "Invoice window", state: "blocked" as const, detail: "This payment link has expired." }
    : { label: "Invoice window", state: "ready" as const, detail: "This payment link is still within its expiry window." };
  const wallet = !input.payerSelected
    ? { label: "Buyer wallet", state: "pending" as const, detail: "Connect the wallet that will send payment." }
    : input.payerMatchesMerchant
      ? { label: "Buyer wallet", state: "blocked" as const, detail: "Buyer and merchant wallets must be different." }
      : { label: "Buyer wallet", state: "ready" as const, detail: "A separate buyer wallet is selected." };
  const network = input.networkReady
    ? { label: "Arc Testnet", state: "ready" as const, detail: "The buyer wallet is prepared for Arc Testnet." }
    : { label: "Arc Testnet", state: "pending" as const, detail: "Connect a wallet to prepare the Arc Testnet network." };
  const balance = input.balanceReady === null
    ? { label: "Token balance", state: "pending" as const, detail: "Connect a wallet to check the required token balance." }
    : input.balanceReady
      ? { label: "Token balance", state: "ready" as const, detail: "The wallet balance covers this invoice amount." }
      : { label: "Token balance", state: "blocked" as const, detail: "The wallet balance is below the invoice amount." };
  const receipt = input.hasReceipt
    ? { label: "Payment status", state: "blocked" as const, detail: "This invoice already has a verified receipt. Do not pay it again." }
    : { label: "Payment status", state: "ready" as const, detail: "No prior verified payment exists for this invoice." };
  return [registration, expiry, wallet, network, balance, receipt];
}

export function paymentCanProceed(checks: PaymentReadinessCheck[]) {
  return checks.every((check) => check.state === "ready");
}
