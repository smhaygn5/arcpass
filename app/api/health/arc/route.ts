import { NextResponse } from "next/server";
import { createPublicClient } from "viem";
import { arcTestnet, arcTestnetTransport } from "@/lib/arc-chain";
import { databaseConfigured, getDatabase } from "@/lib/server-database";

export const runtime = "nodejs";

const publicClient = createPublicClient({
  chain: arcTestnet,
  transport: arcTestnetTransport(),
});

export async function GET() {
  try {
    if (!databaseConfigured()) {
      throw new Error("Persistent database is not configured.");
    }

    const [blockNumber] = await Promise.all([
      publicClient.getBlockNumber(),
      getDatabase()`select 1`,
    ]);

    return NextResponse.json({
      blockNumber: blockNumber.toString(),
      chainId: arcTestnet.id,
      database: "connected",
      network: arcTestnet.name,
      ok: true,
    });
  } catch {
    return NextResponse.json(
      {
        chainId: arcTestnet.id,
        database: "unavailable",
        network: arcTestnet.name,
        ok: false,
      },
      { status: 503 },
    );
  }
}
