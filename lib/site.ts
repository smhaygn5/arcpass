export const SITE_NAME = "ArcPass";
export const SITE_TITLE = "ArcPass - Verified Stablecoin Checkout";
export const SITE_DESCRIPTION =
  "Create verified merchant passports, signed payment links, and Arc Testnet stablecoin receipts.";

export function getSiteUrl() {
  const rawUrl =
    process.env.APP_URL ||
    process.env.VERCEL_PROJECT_PRODUCTION_URL ||
    process.env.VERCEL_URL ||
    "http://localhost:3000";
  const withProtocol = /^https?:\/\//.test(rawUrl) ? rawUrl : `https://${rawUrl}`;

  try {
    return new URL(withProtocol).origin;
  } catch {
    return "http://localhost:3000";
  }
}
