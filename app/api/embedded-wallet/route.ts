import { randomUUID } from "node:crypto";
import { NextRequest, NextResponse } from "next/server";
import {
  CIRCLE_ARC_BLOCKCHAIN,
  CIRCLE_USER_WALLET_ACCOUNT_TYPE,
  circleErrorDetails,
  normalizeCircleDeviceId,
  normalizeCircleUserToken,
  normalizeCircleWalletId,
  normalizeCircleWallets,
  normalizeEmbeddedEmail,
} from "@/lib/embedded-wallet";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";

export const runtime = "nodejs";

const CIRCLE_API_ORIGIN = "https://api.circle.com";
const CIRCLE_REQUEST_TIMEOUT_MS = 15_000;
const USER_ALREADY_INITIALIZED_CODE = 155106;

type EmbeddedWalletAction = "createWallet" | "initializeUser" | "listWallets" | "requestEmailOtp" | "signMessage";
type EmbeddedWalletBody = {
  action?: unknown;
  deviceId?: unknown;
  email?: unknown;
  message?: unknown;
  userToken?: unknown;
  walletId?: unknown;
};

export async function GET() {
  const config = circleConfig();
  return NextResponse.json(
    {
      appId: config?.appId ?? null,
      custody: "user-controlled",
      enabled: Boolean(config),
      network: "Arc Testnet",
    },
    { headers: { "cache-control": "no-store" } },
  );
}

export async function POST(req: NextRequest) {
  const config = circleConfig();
  if (!config) {
    return NextResponse.json(
      { error: "Email wallet onboarding is not configured yet. Add the Circle API key and App ID." },
      { status: 503 },
    );
  }

  const body = (await req.json().catch(() => null)) as EmbeddedWalletBody | null;
  const action = body?.action as EmbeddedWalletAction | undefined;
  if (!action || !["createWallet", "initializeUser", "listWallets", "requestEmailOtp", "signMessage"].includes(action)) {
    return NextResponse.json({ error: "The embedded wallet action is invalid." }, { status: 400 });
  }

  const limit = await rateLimit(
    `embedded-wallet:${action}:${clientKey(req)}`,
    action === "requestEmailOtp" ? 5 : 30,
    action === "requestEmailOtp" ? 10 * 60_000 : 60_000,
  );
  if (!limit.ok) return tooManyRequests(limit.retryAfter);

  try {
    if (action === "requestEmailOtp") {
      const email = normalizeEmbeddedEmail(body?.email);
      const deviceId = normalizeCircleDeviceId(body?.deviceId);
      const response = await circleRequest("/v1/w3s/users/email/token", config.apiKey, {
        body: { deviceId, email, idempotencyKey: randomUUID() },
        method: "POST",
      });
      const data = circleData(response);
      if (!isNonEmptyString(data.deviceToken) || !isNonEmptyString(data.deviceEncryptionKey) || !isNonEmptyString(data.otpToken)) {
        throw new Error("Circle did not return a complete email verification session.");
      }
      return NextResponse.json({
        deviceEncryptionKey: data.deviceEncryptionKey,
        deviceToken: data.deviceToken,
        email,
        otpToken: data.otpToken,
      });
    }

    const userToken = normalizeCircleUserToken(body?.userToken);

    if (action === "listWallets") {
      const response = await circleRequest("/v1/w3s/wallets", config.apiKey, { userToken });
      return NextResponse.json({ wallets: normalizeCircleWallets(response) });
    }

    if (action === "createWallet") {
      const response = await circleRequest("/v1/w3s/user/wallets", config.apiKey, {
        body: {
          accountType: CIRCLE_USER_WALLET_ACCOUNT_TYPE,
          blockchains: [CIRCLE_ARC_BLOCKCHAIN],
          idempotencyKey: randomUUID(),
        },
        method: "POST",
        userToken,
      });
      const data = circleData(response);
      if (!isNonEmptyString(data.challengeId)) throw new Error("Circle did not return a wallet creation challenge.");
      return NextResponse.json({ challengeId: data.challengeId });
    }

    if (action === "initializeUser") {
      try {
        const response = await circleRequest("/v1/w3s/user/initialize", config.apiKey, {
          body: {
            accountType: CIRCLE_USER_WALLET_ACCOUNT_TYPE,
            blockchains: [CIRCLE_ARC_BLOCKCHAIN],
            idempotencyKey: randomUUID(),
          },
          method: "POST",
          userToken,
        });
        const data = circleData(response);
        if (!isNonEmptyString(data.challengeId)) {
          throw new Error("Circle did not return a wallet creation challenge.");
        }
        return NextResponse.json({ challengeId: data.challengeId, wallets: normalizeCircleWallets(response) });
      } catch (error) {
        if (error instanceof CircleApiError && error.code === USER_ALREADY_INITIALIZED_CODE) {
          const response = await circleRequest("/v1/w3s/wallets", config.apiKey, { userToken });
          return NextResponse.json({ alreadyInitialized: true, wallets: normalizeCircleWallets(response) });
        }
        throw error;
      }
    }

    const walletId = normalizeCircleWalletId(body?.walletId);
    const message = typeof body?.message === "string" ? body.message : "";
    if (!message || message.length > 4_000 || /\0/.test(message)) {
      throw new Error("The wallet signature message is invalid.");
    }
    const response = await circleRequest("/v1/w3s/user/sign/message", config.apiKey, {
      body: {
        encodedByHex: false,
        memo: "Authorize ArcPass merchant session",
        message,
        walletId,
      },
      method: "POST",
      userToken,
    });
    const data = circleData(response);
    if (!isNonEmptyString(data.challengeId)) throw new Error("Circle did not return a signature challenge.");
    return NextResponse.json({ challengeId: data.challengeId });
  } catch (error) {
    const status = error instanceof CircleApiError ? error.status : 400;
    return NextResponse.json(
      { error: error instanceof Error ? error.message : "The email wallet request could not be completed." },
      { status: status >= 400 && status < 500 ? status : 502 },
    );
  }
}

function circleConfig() {
  const apiKey = process.env.CIRCLE_API_KEY?.trim();
  const appId = process.env.NEXT_PUBLIC_CIRCLE_APP_ID?.trim();
  return apiKey && appId ? { apiKey, appId } : null;
}

async function circleRequest(
  path: string,
  apiKey: string,
  options: { body?: Record<string, unknown>; method?: "GET" | "POST"; userToken?: string } = {},
) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), CIRCLE_REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(`${CIRCLE_API_ORIGIN}${path}`, {
      body: options.body ? JSON.stringify(options.body) : undefined,
      cache: "no-store",
      headers: {
        accept: "application/json",
        authorization: `Bearer ${apiKey}`,
        ...(options.body ? { "content-type": "application/json" } : {}),
        ...(options.userToken ? { "x-user-token": options.userToken } : {}),
      },
      method: options.method ?? "GET",
      signal: controller.signal,
    });
    const payload = await response.json().catch(() => null);
    if (!response.ok) {
      const details = circleErrorDetails(payload);
      throw new CircleApiError(details.message, response.status, details.code);
    }
    return payload;
  } catch (error) {
    if (error instanceof CircleApiError) throw error;
    if (error instanceof Error && error.name === "AbortError") {
      throw new CircleApiError("Circle took too long to respond. Try again.", 504);
    }
    throw new CircleApiError("Circle could not be reached. Try again shortly.", 502);
  } finally {
    clearTimeout(timeout);
  }
}

function circleData(value: unknown): Record<string, unknown> {
  if (!value || typeof value !== "object") return {};
  const record = value as Record<string, unknown>;
  return record.data && typeof record.data === "object" ? record.data as Record<string, unknown> : record;
}

function isNonEmptyString(value: unknown): value is string {
  return typeof value === "string" && value.length > 0;
}

class CircleApiError extends Error {
  constructor(message: string, readonly status: number, readonly code?: number) {
    super(message);
    this.name = "CircleApiError";
  }
}
