import { lookup } from "node:dns/promises";
import { request } from "node:https";
import { isIP, type LookupFunction } from "node:net";
import { getAddress, isAddress } from "viem";
import { normalizeDomain } from "./arcpass.ts";

const MANIFEST_TIMEOUT_MS = 6_000;
const MAX_MANIFEST_BYTES = 32 * 1024;
const MAX_MANIFEST_BUSINESS_NAME_LENGTH = 120;
const MAX_PINNED_ADDRESSES = 4;

type ArcPassManifest = {
  businessName?: unknown;
  domain?: unknown;
  service?: unknown;
  walletAddress?: unknown;
};

type ManifestResponse = {
  body: string;
  statusCode: number;
};

type ResolvedAddress = {
  address: string;
  family: number;
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

    const response = await requestPinnedManifest(
      manifestUrl,
      addresses.slice(0, MAX_PINNED_ADDRESSES),
    );

    if (response.statusCode < 200 || response.statusCode >= 300) {
      return {
        businessName: null,
        error: "ArcPass manifest was not found.",
        manifestUrl,
        status: 200,
        verified: false,
      };
    }

    const manifest = JSON.parse(response.body) as ArcPassManifest;
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

    const businessName =
      typeof manifest.businessName === "string" &&
      manifest.businessName.trim().length > 0 &&
      manifest.businessName.trim().length <= MAX_MANIFEST_BUSINESS_NAME_LENGTH
        ? manifest.businessName.trim()
        : null;

    return {
      businessName,
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

async function requestPinnedManifest(url: string, addresses: ResolvedAddress[]) {
  let lastError: unknown = new Error("Merchant domain has no reachable public address.");

  for (const address of addresses) {
    try {
      return await requestManifestAtAddress(url, address);
    } catch (error) {
      lastError = error;
    }
  }

  throw lastError;
}

function requestManifestAtAddress(url: string, target: ResolvedAddress): Promise<ManifestResponse> {
  return new Promise((resolve, reject) => {
    const pinnedLookup: LookupFunction = (_hostname, options, callback) => {
      if (options.all) {
        callback(null, [{ address: target.address, family: target.family }]);
        return;
      }

      callback(null, target.address, target.family);
    };

    const req = request(
      url,
      {
        headers: {
          accept: "application/json",
          "user-agent": "ArcPass/1.0",
        },
        lookup: pinnedLookup,
        method: "GET",
      },
      (res) => {
        const declaredLength = Number(res.headers["content-length"] ?? 0);
        if (declaredLength > MAX_MANIFEST_BYTES) {
          res.resume();
          reject(new Error("ArcPass manifest is too large."));
          return;
        }

        const chunks: Buffer[] = [];
        let receivedBytes = 0;

        res.on("data", (chunk: Buffer) => {
          receivedBytes += chunk.length;
          if (receivedBytes > MAX_MANIFEST_BYTES) {
            res.destroy(new Error("ArcPass manifest is too large."));
            return;
          }
          chunks.push(Buffer.from(chunk));
        });
        res.on("end", () => {
          resolve({
            body: Buffer.concat(chunks).toString("utf8"),
            statusCode: res.statusCode ?? 0,
          });
        });
        res.on("error", reject);
      },
    );

    req.setTimeout(MANIFEST_TIMEOUT_MS, () => {
      req.destroy(new Error("ArcPass manifest request timed out."));
    });
    req.on("error", reject);
    req.end();
  });
}
