import { defineChain, fallback, http } from "viem";

export const ARC_TESTNET_CHAIN_ID = 5_042_002;
export const ARC_TESTNET_NETWORK = "eip155:5042002";
export const ARC_TESTNET_RPC_URL = "https://rpc.testnet.arc.network";
export const ARC_TESTNET_RPC_FALLBACK_URL = "https://arc-testnet.drpc.org";
export const ARC_TESTNET_RPC_URLS = [
  ARC_TESTNET_RPC_URL,
  ARC_TESTNET_RPC_FALLBACK_URL,
] as const;
export const ARC_TESTNET_EXPLORER_URL = "https://testnet.arcscan.app";

export const arcTestnet = defineChain({
  id: ARC_TESTNET_CHAIN_ID,
  name: "Arc Testnet",
  nativeCurrency: {
    decimals: 18,
    name: "USDC",
    symbol: "USDC",
  },
  rpcUrls: {
    default: {
      http: [...ARC_TESTNET_RPC_URLS],
      webSocket: ["wss://rpc.testnet.arc.network"],
    },
  },
  blockExplorers: {
    default: {
      name: "ArcScan",
      url: ARC_TESTNET_EXPLORER_URL,
    },
  },
  testnet: true,
});

export function arcTestnetTransport() {
  return fallback(
    ARC_TESTNET_RPC_URLS.map((url) => http(url, { timeout: 12_000 })),
  );
}

export function arcScanTxUrl(hash: string) {
  return `${ARC_TESTNET_EXPLORER_URL}/tx/${hash}`;
}

export function arcScanAddressUrl(address: string) {
  return `${ARC_TESTNET_EXPLORER_URL}/address/${address}`;
}
