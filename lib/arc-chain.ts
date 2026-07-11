import { defineChain } from "viem";

export const ARC_TESTNET_CHAIN_ID = 5_042_002;
export const ARC_TESTNET_NETWORK = "eip155:5042002";
export const ARC_TESTNET_RPC_URL = "https://rpc.testnet.arc.network";
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
      http: [ARC_TESTNET_RPC_URL],
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

export function arcScanTxUrl(hash: string) {
  return `${ARC_TESTNET_EXPLORER_URL}/tx/${hash}`;
}

export function arcScanAddressUrl(address: string) {
  return `${ARC_TESTNET_EXPLORER_URL}/address/${address}`;
}
