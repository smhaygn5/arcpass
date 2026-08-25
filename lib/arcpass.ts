import {
  formatUnits,
  getAddress,
  isAddress,
  keccak256,
  parseUnits,
  toBytes,
  type Address,
} from "viem";
import { arcScanAddressUrl, arcScanTxUrl } from "./arc-chain.ts";
import { normalizePaymentLinkBranding, type PaymentLinkBranding } from "./payment-branding.ts";

export const ARCPASS_VERSION = 1;
export const MAX_INVOICE_PAYLOAD_LENGTH = 16_384;

const MAX_AMOUNT_LENGTH = 64;
const MAX_BUSINESS_NAME_LENGTH = 120;
const MAX_DESCRIPTION_LENGTH = 280;
const MAX_DOMAIN_LENGTH = 253;
const MAX_ID_LENGTH = 80;

export type ArcPassTokenSymbol = "USDC" | "EURC";
export type InstallmentCadence = "weekly" | "biweekly" | "monthly";
export type PassportStatus = "verified" | "pending" | "unverified";
export type RefundPolicy = "none" | "merchant-refund" | "escrow-window";

export type InvoiceInstallment = {
  cadence: InstallmentCadence;
  installmentCount: number;
  installmentNumber: number;
  planId: string;
  planTotal: string;
};

export type MerchantPassport = {
  businessName: string;
  createdAt: string;
  domain: string;
  passportId: string;
  refundPolicy: RefundPolicy;
  status: PassportStatus;
  walletAddress: Address;
};

export type ArcPassInvoice = {
  amount: string;
  branding?: PaymentLinkBranding;
  createdAt: string;
  description: string;
  expiresAt: string;
  invoiceId: string;
  installment?: InvoiceInstallment;
  merchant: MerchantPassport;
  token: ArcPassTokenSymbol;
  version: typeof ARCPASS_VERSION;
};

export type TrustSignal = {
  active: boolean;
  label: string;
  points: number;
};

export const ARCPASS_TOKENS: Record<
  ArcPassTokenSymbol,
  {
    address: Address;
    decimals: number;
    label: string;
  }
> = {
  USDC: {
    address: "0x3600000000000000000000000000000000000000",
    decimals: 6,
    label: "USD Coin",
  },
  EURC: {
    address: "0x89B50855Aa3bE2F677cD6303Cec089B5F319D72a",
    decimals: 6,
    label: "Euro Coin",
  },
};

export const EMPTY_MERCHANT_PASSPORT: MerchantPassport = {
  businessName: "ArcPass Merchant",
  createdAt: new Date(0).toISOString(),
  domain: "example.com",
  passportId: "pass_demo",
  refundPolicy: "merchant-refund",
  status: "pending",
  walletAddress: "0x0000000000000000000000000000000000000000",
};

export function createMerchantPassport(input: {
  businessName: string;
  domain: string;
  refundPolicy: RefundPolicy;
  status?: PassportStatus;
  walletAddress: string;
}): MerchantPassport {
  if (!isAddress(input.walletAddress)) {
    throw new Error("Merchant wallet address is invalid.");
  }

  const businessName = input.businessName.trim() || "ArcPass Merchant";
  if (businessName.length > MAX_BUSINESS_NAME_LENGTH) {
    throw new Error(`Merchant name cannot exceed ${MAX_BUSINESS_NAME_LENGTH} characters.`);
  }

  const domain = normalizeDomain(input.domain);
  if (!domain || domain.length > MAX_DOMAIN_LENGTH) {
    throw new Error("Merchant domain is invalid.");
  }

  const walletAddress = getAddress(input.walletAddress);

  return {
    businessName,
    createdAt: new Date().toISOString(),
    domain,
    passportId: createShortId("pass"),
    refundPolicy: input.refundPolicy,
    status: input.status ?? "pending",
    walletAddress,
  };
}

export function createInvoice(input: {
  amount: string;
  branding?: PaymentLinkBranding;
  description: string;
  expiresAt: string;
  installment?: InvoiceInstallment;
  merchant: MerchantPassport;
  token: ArcPassTokenSymbol;
}): ArcPassInvoice {
  assertValidAmount(input.amount, input.token);

  const description = input.description.trim();
  if (!description || description.length > MAX_DESCRIPTION_LENGTH) {
    throw new Error(`Invoice description must be between 1 and ${MAX_DESCRIPTION_LENGTH} characters.`);
  }

  const expiresAt = new Date(input.expiresAt);
  if (Number.isNaN(expiresAt.getTime()) || expiresAt.getTime() <= Date.now()) {
    throw new Error("Invoice expiry date must be in the future.");
  }
  const branding = input.branding === undefined ? undefined : normalizePaymentLinkBranding(input.branding);
  if (input.branding !== undefined && !branding) throw new Error("Payment link branding is invalid.");
  const installment = input.installment === undefined ? undefined : normalizeInvoiceInstallment(input.installment, input.token);
  if (input.installment !== undefined && !installment) throw new Error("Invoice installment metadata is invalid.");
  if (installment && invoiceAmountRawValue(input.amount, input.token) > invoiceAmountRawValue(installment.planTotal, input.token)) {
    throw new Error("Installment amount cannot exceed the plan total.");
  }

  return {
    amount: normalizeAmount(input.amount),
    ...(branding ? { branding } : {}),
    createdAt: new Date().toISOString(),
    description,
    expiresAt: expiresAt.toISOString(),
    invoiceId: createShortId("inv"),
    ...(installment ? { installment } : {}),
    merchant: input.merchant,
    token: input.token,
    version: ARCPASS_VERSION,
  };
}

export function encodeInvoicePayload(invoice: ArcPassInvoice) {
  const payload = base64UrlEncode(JSON.stringify(invoice));
  if (payload.length > MAX_INVOICE_PAYLOAD_LENGTH) {
    throw new Error("Invoice payload is too large.");
  }
  return payload;
}

export function decodeInvoicePayload(payload: string): ArcPassInvoice | null {
  try {
    if (!payload || payload.length > MAX_INVOICE_PAYLOAD_LENGTH) return null;

    const invoice = JSON.parse(base64UrlDecode(payload)) as Partial<ArcPassInvoice>;
    if (invoice.version !== ARCPASS_VERSION) return null;
    if (!invoice.invoiceId || typeof invoice.invoiceId !== "string" || invoice.invoiceId.length > MAX_ID_LENGTH) return null;
    if (!invoice.description || typeof invoice.description !== "string") return null;
    if (!invoice.description.trim() || invoice.description.trim().length > MAX_DESCRIPTION_LENGTH) return null;
    if (!invoice.amount || typeof invoice.amount !== "string" || invoice.amount.length > MAX_AMOUNT_LENGTH) return null;
    if (!invoice.token || !(invoice.token in ARCPASS_TOKENS)) return null;
    if (!invoice.createdAt || Number.isNaN(new Date(invoice.createdAt).getTime())) return null;
    if (!invoice.expiresAt || Number.isNaN(new Date(invoice.expiresAt).getTime())) return null;
    if (!invoice.merchant) return null;

    const merchant = normalizeMerchantPassport(invoice.merchant);
    if (!merchant) return null;
    const branding = invoice.branding === undefined ? undefined : normalizePaymentLinkBranding(invoice.branding);
    if (invoice.branding !== undefined && !branding) return null;
    const installment = invoice.installment === undefined ? undefined : normalizeInvoiceInstallment(invoice.installment, invoice.token);
    if (invoice.installment !== undefined && !installment) return null;
    assertValidAmount(invoice.amount, invoice.token);
    if (installment && invoiceAmountRawValue(invoice.amount, invoice.token) > invoiceAmountRawValue(installment.planTotal, invoice.token)) return null;

    return {
      amount: normalizeAmount(invoice.amount),
      ...(branding ? { branding } : {}),
      createdAt: new Date(invoice.createdAt).toISOString(),
      description: invoice.description.trim(),
      expiresAt: new Date(invoice.expiresAt).toISOString(),
      invoiceId: invoice.invoiceId,
      ...(installment ? { installment } : {}),
      merchant,
      token: invoice.token,
      version: ARCPASS_VERSION,
    };
  } catch {
    return null;
  }
}

export function invoiceHash(invoice: ArcPassInvoice) {
  return keccak256(toBytes(stableInvoiceJson(invoice)));
}

export function merchantPassportHash(passport: MerchantPassport) {
  return keccak256(toBytes(stableMerchantJson(passport)));
}

export function invoiceAmountRaw(invoice: ArcPassInvoice) {
  return parseUnits(invoice.amount, ARCPASS_TOKENS[invoice.token].decimals);
}

export function formatInvoiceAmount(rawAmount: bigint, token: ArcPassTokenSymbol) {
  return formatUnits(rawAmount, ARCPASS_TOKENS[token].decimals);
}

export function invoiceExpired(invoice: ArcPassInvoice, now = new Date()) {
  return new Date(invoice.expiresAt).getTime() <= now.getTime();
}

export function trustSignals(passport: MerchantPassport): TrustSignal[] {
  return [
    {
      active: passport.status === "verified",
      label: "Domain verified",
      points: 30,
    },
    {
      active: isAddress(passport.walletAddress),
      label: "Wallet bound",
      points: 20,
    },
    {
      active: passport.refundPolicy !== "none",
      label: "Refund policy",
      points: 20,
    },
    {
      active: Boolean(passport.businessName.trim()),
      label: "Business profile",
      points: 15,
    },
    {
      active: Boolean(passport.domain.trim()),
      label: "Public domain",
      points: 15,
    },
  ];
}

export function trustScore(passport: MerchantPassport) {
  return trustSignals(passport).reduce(
    (score, signal) => score + (signal.active ? signal.points : 0),
    0,
  );
}

export function trustLabel(score: number) {
  if (score >= 85) return "High trust";
  if (score >= 60) return "Review ready";
  return "Needs verification";
}

export function normalizeDomain(domain: string) {
  const trimmed = domain.trim().toLowerCase();
  if (!trimmed) return "";

  try {
    const url = new URL(trimmed.startsWith("http") ? trimmed : `https://${trimmed}`);
    return url.hostname.replace(/^www\./, "");
  } catch {
    return trimmed.replace(/^https?:\/\//, "").split("/")[0]?.replace(/^www\./, "") ?? "";
  }
}

export function paymentReceiptUrl(hash: string) {
  return arcScanTxUrl(hash);
}

export function merchantExplorerUrl(passport: MerchantPassport) {
  return arcScanAddressUrl(passport.walletAddress);
}

function normalizeMerchantPassport(value: Partial<MerchantPassport>) {
  if (!value.walletAddress || !isAddress(value.walletAddress)) return null;
  if (!value.domain || typeof value.domain !== "string") return null;
  if (!value.businessName || typeof value.businessName !== "string") return null;
  if (!value.passportId || typeof value.passportId !== "string" || value.passportId.length > MAX_ID_LENGTH) return null;
  if (!value.createdAt || Number.isNaN(new Date(value.createdAt).getTime())) return null;

  const businessName = value.businessName.trim();
  const domain = normalizeDomain(value.domain);
  if (!businessName || businessName.length > MAX_BUSINESS_NAME_LENGTH) return null;
  if (!domain || domain.length > MAX_DOMAIN_LENGTH) return null;

  const refundPolicy = value.refundPolicy ?? "none";
  if (!["none", "merchant-refund", "escrow-window"].includes(refundPolicy)) return null;

  const status = value.status ?? "pending";
  if (!["verified", "pending", "unverified"].includes(status)) return null;

  return {
    businessName,
    createdAt: new Date(value.createdAt).toISOString(),
    domain,
    passportId: value.passportId,
    refundPolicy,
    status,
    walletAddress: getAddress(value.walletAddress),
  } satisfies MerchantPassport;
}

function assertValidAmount(amount: string, token: ArcPassTokenSymbol) {
  if (amount.length > MAX_AMOUNT_LENGTH) {
    throw new Error("Invoice amount is too large.");
  }

  const normalized = normalizeAmount(amount);
  const decimals = ARCPASS_TOKENS[token].decimals;
  const [, fractional = ""] = normalized.split(".");

  if (!/^\d+(?:\.\d+)?$/.test(normalized) || Number(normalized) <= 0) {
    throw new Error("Invoice amount must be a positive decimal.");
  }

  if (fractional.length > decimals) {
    throw new Error(`${token} supports ${decimals} decimal places on Arc.`);
  }
}

function normalizeAmount(amount: string) {
  return amount.trim().replace(/,/g, ".");
}

function stableInvoiceJson(invoice: ArcPassInvoice) {
  return JSON.stringify({
    amount: normalizeAmount(invoice.amount),
    ...(invoice.branding ? { branding: invoice.branding } : {}),
    description: invoice.description,
    expiresAt: new Date(invoice.expiresAt).toISOString(),
    invoiceId: invoice.invoiceId,
    ...(invoice.installment ? { installment: invoice.installment } : {}),
    merchantHash: merchantPassportHash(invoice.merchant),
    token: invoice.token,
    version: invoice.version,
  });
}

function normalizeInvoiceInstallment(value: Partial<InvoiceInstallment>, token: ArcPassTokenSymbol): InvoiceInstallment | null {
  if (!value || typeof value !== "object") return null;
  if (typeof value.planId !== "string" || !/^plan_[a-zA-Z0-9_-]{1,64}$/.test(value.planId)) return null;
  if (!Number.isInteger(value.installmentCount) || Number(value.installmentCount) < 2 || Number(value.installmentCount) > 10) return null;
  if (!Number.isInteger(value.installmentNumber) || Number(value.installmentNumber) < 1 || Number(value.installmentNumber) > Number(value.installmentCount)) return null;
  if (!value.cadence || !["weekly", "biweekly", "monthly"].includes(value.cadence)) return null;
  if (typeof value.planTotal !== "string") return null;

  try {
    assertValidAmount(value.planTotal, token);
  } catch {
    return null;
  }

  return {
    cadence: value.cadence,
    installmentCount: Number(value.installmentCount),
    installmentNumber: Number(value.installmentNumber),
    planId: value.planId,
    planTotal: normalizeAmount(value.planTotal),
  };
}

function invoiceAmountRawValue(amount: string, token: ArcPassTokenSymbol) {
  return parseUnits(normalizeAmount(amount), ARCPASS_TOKENS[token].decimals);
}

function stableMerchantJson(passport: MerchantPassport) {
  return JSON.stringify({
    businessName: passport.businessName,
    domain: normalizeDomain(passport.domain),
    passportId: passport.passportId,
    refundPolicy: passport.refundPolicy,
    status: passport.status,
    walletAddress: getAddress(passport.walletAddress),
  });
}

function createShortId(prefix: string) {
  const bytes = new Uint8Array(8);
  globalThis.crypto.getRandomValues(bytes);
  const suffix = Array.from(bytes, (byte) => byte.toString(16).padStart(2, "0")).join("");
  return `${prefix}_${suffix}`;
}

function base64UrlEncode(value: string) {
  const bytes = new TextEncoder().encode(value);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}

function base64UrlDecode(value: string) {
  const base64 = value.replace(/-/g, "+").replace(/_/g, "/");
  const padded = base64.padEnd(Math.ceil(base64.length / 4) * 4, "=");
  const binary = atob(padded);
  const bytes = Uint8Array.from(binary, (char) => char.charCodeAt(0));
  return new TextDecoder().decode(bytes);
}
