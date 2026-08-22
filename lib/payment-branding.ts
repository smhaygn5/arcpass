export const PAYMENT_BRAND_ACCENTS = {
  "arc-blue": { color: "#1b66ff", label: "Arc blue", soft: "#e8f0ff" },
  emerald: { color: "#087b53", label: "Emerald", soft: "#e1f7ed" },
  violet: { color: "#6d4bd1", label: "Violet", soft: "#eee9ff" },
  amber: { color: "#a65f00", label: "Amber", soft: "#fff0d8" },
} as const;

export type PaymentBrandAccent = keyof typeof PAYMENT_BRAND_ACCENTS;
export type PaymentLinkBranding = { accent: PaymentBrandAccent; message: string; showMonogram: boolean };

export const DEFAULT_PAYMENT_LINK_BRANDING: PaymentLinkBranding = { accent: "arc-blue", message: "", showMonogram: true };

export function normalizePaymentLinkBranding(value: unknown): PaymentLinkBranding | null {
  if (!value || typeof value !== "object") return null;
  const branding = value as Partial<PaymentLinkBranding>;
  if (typeof branding.accent !== "string" || !(branding.accent in PAYMENT_BRAND_ACCENTS)) return null;
  if (typeof branding.message !== "string" || branding.message.trim().length > 120) return null;
  if (typeof branding.showMonogram !== "boolean") return null;
  return { accent: branding.accent as PaymentBrandAccent, message: branding.message.trim(), showMonogram: branding.showMonogram };
}

export function merchantMonogram(businessName: string) {
  const words = businessName.trim().split(/\s+/).filter(Boolean);
  return words.slice(0, 2).map((word) => Array.from(word)[0]?.toUpperCase() ?? "").join("") || "AP";
}
