import { formatUnits, parseUnits, type Address, type Chain } from "viem";
import { arbitrumSepolia, baseSepolia, sepolia } from "viem/chains";
import type { ArcPassTokenSymbol } from "./arcpass.ts";

export type CrossChainSourceId = "arbitrum-sepolia" | "base-sepolia" | "ethereum-sepolia";

export type CrossChainSource = {
  bridgeChain: "Arbitrum_Sepolia" | "Base_Sepolia" | "Ethereum_Sepolia";
  chain: Chain;
  label: string;
  network: string;
  shortLabel: string;
  usdcAddress: Address;
};

export const ARC_PAYMENT_GAS_RESERVE_USDC = "0.10";

export const CROSS_CHAIN_SOURCES: Record<CrossChainSourceId, CrossChainSource> = {
  "ethereum-sepolia": {
    bridgeChain: "Ethereum_Sepolia",
    chain: sepolia,
    label: "Ethereum Sepolia",
    network: "eip155:11155111",
    shortLabel: "Ethereum",
    usdcAddress: "0x1c7D4B196Cb0C7B01d743Fbc6116a902379C7238",
  },
  "base-sepolia": {
    bridgeChain: "Base_Sepolia",
    chain: baseSepolia,
    label: "Base Sepolia",
    network: "eip155:84532",
    shortLabel: "Base",
    usdcAddress: "0x036CbD53842c5426634e7929541eC2318f3dCF7c",
  },
  "arbitrum-sepolia": {
    bridgeChain: "Arbitrum_Sepolia",
    chain: arbitrumSepolia,
    label: "Arbitrum Sepolia",
    network: "eip155:421614",
    shortLabel: "Arbitrum",
    usdcAddress: "0x75faf114eafb1BDbe2F0316DF893fd58CE46AA4d",
  },
};

export function crossChainCheckoutSupported(token: ArcPassTokenSymbol) {
  return token === "USDC";
}

export function crossChainFundingAmount(invoiceAmount: string) {
  const invoiceRaw = parseUnits(invoiceAmount, 6);
  const reserveRaw = parseUnits(ARC_PAYMENT_GAS_RESERVE_USDC, 6);
  return formatUnits(invoiceRaw + reserveRaw, 6);
}

export function crossChainPreflight({
  bridgeAmountRaw,
  sourceGasBalance,
  sourceGasRequired,
  sourceUsdcBalance,
}: {
  bridgeAmountRaw: bigint;
  sourceGasBalance: bigint | null;
  sourceGasRequired: bigint | null;
  sourceUsdcBalance: bigint | null;
}) {
  return {
    gasReady: sourceGasBalance === null
      ? null
      : sourceGasRequired === null
        ? sourceGasBalance > 0n
        : sourceGasBalance >= sourceGasRequired,
    tokenReady: sourceUsdcBalance === null ? null : sourceUsdcBalance >= bridgeAmountRaw,
  };
}
