export type CheckoutRecoveryKind = "balance" | "complete" | "connect" | "healthy" | "locked" | "network" | "retry";

export type CheckoutRecoveryPlan = {
  actionLabel: string | null;
  detail: string;
  kind: CheckoutRecoveryKind;
  title: string;
};

export function checkoutRecoveryPlan({ balanceKnown, hasError, networkReady, payerSelected, paymentComplete, paymentLocked }: { balanceKnown: boolean; hasError: boolean; networkReady: boolean; payerSelected: boolean; paymentComplete: boolean; paymentLocked: boolean }): CheckoutRecoveryPlan {
  if (paymentComplete) return { actionLabel: null, detail: "A verified receipt already closes this checkout.", kind: "complete", title: "Payment is complete." };
  if (paymentLocked) return { actionLabel: null, detail: "Wallet recovery cannot make an expired or unregistered invoice payable.", kind: "locked", title: "Checkout is locked." };
  if (!payerSelected) return { actionLabel: "Reconnect wallet", detail: "Choose the payer wallet and confirm wallet ownership again.", kind: "connect", title: "Payer wallet is not connected." };
  if (!networkReady) return { actionLabel: "Switch to Arc Testnet", detail: "Ask the connected wallet to switch or add Arc Testnet.", kind: "network", title: "Arc Testnet is not confirmed." };
  if (!balanceKnown) return { actionLabel: "Refresh balance", detail: "Reconnect to Arc RPC and load the selected settlement token balance.", kind: "balance", title: "Token balance needs a refresh." };
  if (hasError) return { actionLabel: "Recheck wallet", detail: "Clear the previous wallet error and run every connection check again.", kind: "retry", title: "Wallet checks need attention." };
  return { actionLabel: null, detail: "Wallet, Arc Testnet, and token balance are ready.", kind: "healthy", title: "Checkout connection is healthy." };
}
