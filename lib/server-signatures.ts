import { createPublicClient, type Address, type Hex } from "viem";
import { arcTestnet, arcTestnetTransport } from "./arc-chain.ts";

const client = createPublicClient({
  chain: arcTestnet,
  transport: arcTestnetTransport(),
});

/**
 * Verifies both regular EOA signatures and ERC-1271 contract-wallet
 * signatures (for example Safe accounts) through Arc Testnet.
 */
export async function verifyArcWalletMessage({
  address,
  message,
  signature,
}: {
  address: Address;
  message: string;
  signature: Hex;
}) {
  return client.verifyMessage({ address, message, signature });
}
