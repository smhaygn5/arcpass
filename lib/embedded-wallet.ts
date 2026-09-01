import { getAddress, isAddress, type Address } from "viem";

export const CIRCLE_ARC_BLOCKCHAIN = "ARC-TESTNET";
export const CIRCLE_USER_WALLET_ACCOUNT_TYPE = "EOA";

export type CircleEmbeddedWallet = {
  accountType?: string;
  address: Address;
  blockchain: typeof CIRCLE_ARC_BLOCKCHAIN;
  id: string;
  state?: string;
};

export function normalizeEmbeddedEmail(value: unknown): string {
  if (typeof value !== "string") throw new Error("Enter a valid email address.");
  const email = value.trim().toLowerCase();
  if (
    email.length < 5 ||
    email.length > 254 ||
    /[\r\n]/.test(email) ||
    !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email)
  ) {
    throw new Error("Enter a valid email address.");
  }
  return email;
}

export function normalizeCircleDeviceId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,200}$/.test(value)) {
    throw new Error("The wallet device could not be verified. Refresh the page and try again.");
  }
  return value;
}

export function normalizeCircleUserToken(value: unknown): string {
  if (typeof value !== "string" || value.length < 20 || value.length > 8_000 || /[\r\n]/.test(value)) {
    throw new Error("The email wallet session is invalid or expired. Sign in again.");
  }
  return value;
}

export function normalizeCircleWalletId(value: unknown): string {
  if (typeof value !== "string" || !/^[a-zA-Z0-9_-]{8,200}$/.test(value)) {
    throw new Error("The Circle wallet identifier is invalid.");
  }
  return value;
}

export function normalizeCircleWallets(value: unknown): CircleEmbeddedWallet[] {
  const source = walletArray(value);
  const seen = new Set<string>();
  const wallets: CircleEmbeddedWallet[] = [];

  for (const candidate of source) {
    if (!candidate || typeof candidate !== "object") continue;
    const wallet = candidate as Record<string, unknown>;
    if (wallet.blockchain !== CIRCLE_ARC_BLOCKCHAIN) continue;
    if (typeof wallet.id !== "string" || !/^[a-zA-Z0-9_-]{8,200}$/.test(wallet.id)) continue;
    if (typeof wallet.address !== "string" || !isAddress(wallet.address)) continue;

    const address = getAddress(wallet.address);
    const key = `${wallet.id}:${address.toLowerCase()}`;
    if (seen.has(key)) continue;
    seen.add(key);
    wallets.push({
      accountType: typeof wallet.accountType === "string" ? wallet.accountType : undefined,
      address,
      blockchain: CIRCLE_ARC_BLOCKCHAIN,
      id: wallet.id,
      state: typeof wallet.state === "string" ? wallet.state : undefined,
    });
  }

  return wallets;
}

export function circleErrorDetails(value: unknown): { code?: number; message: string } {
  if (!value || typeof value !== "object") return { message: "Circle could not complete the wallet request." };
  const record = value as Record<string, unknown>;
  const nested = record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : null;
  const rawCode = record.code ?? nested?.code;
  const code = typeof rawCode === "number" ? rawCode : typeof rawCode === "string" && /^\d+$/.test(rawCode) ? Number(rawCode) : undefined;
  const rawMessage = record.message ?? nested?.message;
  const message = typeof rawMessage === "string"
    ? rawMessage.replace(/[\r\n]+/g, " ").trim().slice(0, 240)
    : "Circle could not complete the wallet request.";
  return { code, message: message || "Circle could not complete the wallet request." };
}

function walletArray(value: unknown): unknown[] {
  if (Array.isArray(value)) return value;
  if (!value || typeof value !== "object") return [];
  const record = value as Record<string, unknown>;
  if (Array.isArray(record.wallets)) return record.wallets;
  if (record.data && typeof record.data === "object") {
    const data = record.data as Record<string, unknown>;
    if (Array.isArray(data.wallets)) return data.wallets;
  }
  return [];
}
