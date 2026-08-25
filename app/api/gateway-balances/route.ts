import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import {
  GATEWAY_TESTNET_API_URL,
  gatewayBalanceSources,
  type GatewayBalanceRecord,
  type GatewayDepositRecord,
} from "@/lib/unified-usdc-balance";

export const runtime = "nodejs";

type GatewayBalanceRequest = {
  address?: unknown;
};

type GatewayBalancesResponse = {
  balances?: GatewayBalanceRecord[];
};

type GatewayDepositsResponse = {
  deposits?: GatewayDepositRecord[];
};

export async function POST(req: NextRequest) {
  try {
    const limit = await rateLimit(`gateway-balances:${clientKey(req)}`, 30, 60_000);
    if (!limit.ok) return tooManyRequests(limit.retryAfter);
  } catch {
    if (process.env.NODE_ENV === "production") {
      return NextResponse.json(
        { error: "ArcPass request protection is temporarily unavailable." },
        { status: 503 },
      );
    }
  }

  const body = (await req.json().catch(() => null)) as GatewayBalanceRequest | null;
  if (typeof body?.address !== "string" || !isAddress(body.address)) {
    return NextResponse.json({ error: "A valid EVM wallet address is required." }, { status: 400 });
  }

  const address = getAddress(body.address);
  const requestBody = JSON.stringify({
    sources: gatewayBalanceSources(address),
    token: "USDC",
  });
  const requestOptions = {
    body: requestBody,
    cache: "no-store" as const,
    headers: { "Content-Type": "application/json" },
    method: "POST",
    signal: AbortSignal.timeout(10_000),
  };

  try {
    const [balancesResponse, depositsResponse] = await Promise.all([
      fetch(`${GATEWAY_TESTNET_API_URL}/balances`, requestOptions),
      fetch(`${GATEWAY_TESTNET_API_URL}/deposits`, requestOptions),
    ]);

    if (!balancesResponse.ok || !depositsResponse.ok) {
      throw new Error("Circle Gateway returned an unsuccessful response.");
    }

    const balancesPayload = (await balancesResponse.json()) as GatewayBalancesResponse;
    const depositsPayload = (await depositsResponse.json()) as GatewayDepositsResponse;

    return NextResponse.json(
      {
        address,
        balances: Array.isArray(balancesPayload.balances) ? balancesPayload.balances : [],
        pendingDeposits: Array.isArray(depositsPayload.deposits) ? depositsPayload.deposits : [],
        source: "Circle Gateway Testnet",
      },
      { headers: { "Cache-Control": "no-store" } },
    );
  } catch {
    return NextResponse.json(
      { error: "Circle Gateway balance data is temporarily unavailable. Try again shortly." },
      { status: 502 },
    );
  }
}
