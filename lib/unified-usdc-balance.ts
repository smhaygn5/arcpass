import { formatUnits, parseUnits } from "viem";

export const GATEWAY_TESTNET_API_URL = "https://gateway-api-testnet.circle.com/v1";

export const UNIFIED_USDC_CHAINS = [
  { domain: 0, id: "ethereum-sepolia", label: "Ethereum Sepolia", shortLabel: "Ethereum" },
  { domain: 6, id: "base-sepolia", label: "Base Sepolia", shortLabel: "Base" },
  { domain: 3, id: "arbitrum-sepolia", label: "Arbitrum Sepolia", shortLabel: "Arbitrum" },
  { domain: 26, id: "arc-testnet", label: "Arc Testnet", shortLabel: "Arc" },
] as const;

export type GatewayBalanceRecord = {
  balance?: unknown;
  domain?: unknown;
};

export type GatewayDepositRecord = {
  amount?: unknown;
  domain?: unknown;
  status?: unknown;
};

export type UnifiedUsdcAllocation = {
  amount: string;
  amountRaw: bigint;
  domain: number;
  id: (typeof UNIFIED_USDC_CHAINS)[number]["id"];
  label: string;
  percentage: number;
  shortLabel: string;
};

export type UnifiedUsdcSummary = {
  allocations: UnifiedUsdcAllocation[];
  coversRequired: boolean;
  coveragePercentage: number;
  pending: string;
  pendingRaw: bigint;
  required: string;
  requiredRaw: bigint;
  shortfall: string;
  shortfallRaw: bigint;
  total: string;
  totalRaw: bigint;
};

export function summarizeUnifiedUsdcBalance({
  balances,
  pendingDeposits,
  requiredAmount,
}: {
  balances: GatewayBalanceRecord[];
  pendingDeposits: GatewayDepositRecord[];
  requiredAmount: string;
}): UnifiedUsdcSummary {
  const supportedDomains = new Set<number>(UNIFIED_USDC_CHAINS.map((chain) => chain.domain));
  const amountsByDomain = new Map<number, bigint>();

  for (const balance of balances) {
    const domain = normalizeDomain(balance.domain);
    if (domain === null || !supportedDomains.has(domain)) continue;
    amountsByDomain.set(domain, (amountsByDomain.get(domain) ?? 0n) + parseUsdcAmount(balance.balance));
  }

  const totalRaw = [...amountsByDomain.values()].reduce((sum, amount) => sum + amount, 0n);
  const pendingRaw = pendingDeposits.reduce((sum, deposit) => {
    const domain = normalizeDomain(deposit.domain);
    if (domain === null || !supportedDomains.has(domain) || deposit.status !== "pending") return sum;
    return sum + parseUsdcAmount(deposit.amount);
  }, 0n);
  const requiredRaw = parseUsdcAmount(requiredAmount);
  const shortfallRaw = requiredRaw > totalRaw ? requiredRaw - totalRaw : 0n;
  const coveragePercentage = requiredRaw === 0n
    ? 100
    : Number((minBigInt(totalRaw, requiredRaw) * 10_000n) / requiredRaw) / 100;
  const allocations = UNIFIED_USDC_CHAINS.map((chain) => {
    const amountRaw = amountsByDomain.get(chain.domain) ?? 0n;
    const percentage = totalRaw === 0n ? 0 : Number((amountRaw * 10_000n) / totalRaw) / 100;
    return { ...chain, amount: formatUsdcAmount(amountRaw), amountRaw, percentage };
  });

  return {
    allocations,
    coversRequired: totalRaw >= requiredRaw,
    coveragePercentage,
    pending: formatUsdcAmount(pendingRaw),
    pendingRaw,
    required: formatUsdcAmount(requiredRaw),
    requiredRaw,
    shortfall: formatUsdcAmount(shortfallRaw),
    shortfallRaw,
    total: formatUsdcAmount(totalRaw),
    totalRaw,
  };
}

export function gatewayBalanceSources(depositor: string) {
  return UNIFIED_USDC_CHAINS.map(({ domain }) => ({ depositor, domain }));
}

function normalizeDomain(value: unknown) {
  return typeof value === "number" && Number.isSafeInteger(value) ? value : null;
}

function parseUsdcAmount(value: unknown) {
  if (typeof value !== "string" || !/^\d+(?:\.\d{1,6})?$/.test(value)) return 0n;

  try {
    return parseUnits(value, 6);
  } catch {
    return 0n;
  }
}

function formatUsdcAmount(value: bigint) {
  return formatUnits(value, 6);
}

function minBigInt(a: bigint, b: bigint) {
  return a < b ? a : b;
}
