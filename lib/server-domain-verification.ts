import { lookup } from "node:dns/promises";
import { isIP } from "node:net";
import { getAddress, isAddress } from "viem";
import { normalizeDomain } from "./arcpass.ts";

type ArcPassManifest = {
  businessName?: unknown;
  domain?: unknown;
  service?: unknown;
  walletAddress?: unknown;
};

export type MerchantDomainVerification = {
  businessName: string | null;
  error?: string;
  manifestUrl: string;
  status: number;
  verified: boolean;
};

export async function verifyMerchantDomain({
  domain: domainInput,
  walletAddress,
}: {
  domain: string;
  walletAddress: string;
}): Promise<MerchantDomainVerification> {
  const domain = normalizeDomain(domainInput);
  const manifestUrl = domain ? `https://${domain}/.well-known/arcpass.json` : "";

  if (!isSafePublicDomain(domain)) {
    return {
      businessName: null,
      error: "Pass a public domain such as example.com.",
      manifestUrl,
      status: 400,
      verified: false,
    };
  }

  if (!isAddress(walletAddress)) {
    return {
      businessName: null,
      error: "Pass a valid merchant wallet.",
      manifestUrl,
      status: 400,
      verified: false,
    };
  }

  try {
    const addresses = await lookup(domain, { all: true, verbatim: true });
    if (addresses.length === 0 || addresses.some(({ address }) => !isPublicIpAddress(address))) {
      return {
        businessName: null,
        error: "Merchant domain must resolve only to public internet addresses.",
        manifestUrl,
        status: 400,
        verified: false,
      };
    }

    const res = await fetch(manifestUrl, {
      cache: "no-store",
      redirect: "error",
      signal: AbortSignal.timeout(6_000),
    });

    if (!res.ok) {
      return {
        businessName: null,
        error: "ArcPass manifest was not found.",
        manifestUrl,
        status: 200,
        verified: false,
      };
    }

    const manifest = await res.json().catch(() => null) as ArcPassManifest | null;
    const manifestWallet =
      typeof manifest?.walletAddress === "string" && isAddress(manifest.walletAddress)
        ? getAddress(manifest.walletAddress)
        : null;
    const requestedWallet = getAddress(walletAddress);
    const manifestDomain =
      typeof manifest?.domain === "string" ? normalizeDomain(manifest.domain) : domain;
    const serviceMatches = manifest?.service === "ArcPass";

    if (!manifestWallet || manifestWallet !== requestedWallet || manifestDomain !== domain || !serviceMatches) {
      return {
        businessName: null,
        error: "Manifest exists but does not match this domain, wallet, and ArcPass service.",
        manifestUrl,
        status: 200,
        verified: false,
      };
    }

    return {
      businessName: typeof manifest.businessName === "string" ? manifest.businessName : null,
      manifestUrl,
      status: 200,
      verified: true,
    };
  } catch {
    return {
      businessName: null,
      error: "Merchant domain verification could not be completed.",
      manifestUrl,
      status: 200,
      verified: false,
    };
  }
}

export function isSafePublicDomain(domain: string) {
  if (!/^(?!-)(?:[a-z0-9-]{1,63}\.)+[a-z]{2,63}$/i.test(domain)) return false;
  if (domain.endsWith(".local") || domain.endsWith(".internal")) return false;
  return true;
}

export function isPublicIpAddress(address: string) {
  const version = isIP(address);
  const normalized = address.toLowerCase();

  if (version === 4) {
    const [first = 0, second = 0] = normalized.split(".").map(Number);

    return !(
      first === 0 ||
      first === 10 ||
      first === 127 ||
      (first === 169 && second === 254) ||
      (first === 172 && second >= 16 && second <= 31) ||
      (first === 192 && second === 168) ||
      first >= 224
    );
  }

  if (version === 6) {
    return !(
      normalized === "::" ||
      normalized === "::1" ||
      normalized.startsWith("fc") ||
      normalized.startsWith("fd") ||
      /^fe[89ab]/.test(normalized) ||
      normalized.startsWith("::ffff:")
    );
  }

  return false;
}
