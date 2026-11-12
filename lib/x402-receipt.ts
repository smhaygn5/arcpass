import type { X402Access, X402ResourceSummary } from "./x402.ts";

export type X402SettlementReceipt = {
  amountAtomic: string;
  amountUsdc: string;
  merchant: string;
  network: string;
  payer: string;
  receiptId: string;
  resource: { id: string; title: string };
  settledAt: string;
  status: "settled";
  transaction: string;
  type: "arcpass.x402.settlement";
  version: "1";
};

export function createX402SettlementReceipt(access: X402Access, resource?: X402ResourceSummary): X402SettlementReceipt {
  return {
    amountAtomic: access.amount,
    amountUsdc: atomicToUsdc(access.amount),
    merchant: access.merchant,
    network: access.network,
    payer: access.payer,
    receiptId: `x402rcpt_${access.accessId.slice(5)}`,
    resource: { id: access.resourceId, title: resource?.title ?? "Protected resource" },
    settledAt: access.createdAt,
    status: "settled",
    transaction: access.transaction,
    type: "arcpass.x402.settlement",
    version: "1",
  };
}

function atomicToUsdc(value: string) {
  const amount = BigInt(value);
  const whole = amount / BigInt(1_000_000);
  const fraction = (amount % BigInt(1_000_000)).toString().padStart(6, "0").replace(/0+$/, "");
  return fraction ? `${whole}.${fraction}` : whole.toString();
}
