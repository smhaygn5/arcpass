import { createHash, randomUUID } from "node:crypto";
import { getAddress, isAddress, verifyMessage, type Address, type Hex } from "viem";
import type { NextRequest, NextResponse } from "next/server";
import { databaseConfigured, getDatabase } from "./server-database.ts";

const CHALLENGE_TTL_MS = 5 * 60 * 1000;
const SESSION_TTL_MS = 8 * 60 * 60 * 1000;
const SESSION_COOKIE = "arcpass_merchant_session";

type Challenge = {
  address: Address;
  expiresAt: number;
  message: string;
};

type Session = {
  address: Address;
  expiresAt: number;
};

type ChallengeRow = { address: string; expires_at: Date | string; message: string };
type SessionRow = { address: string; expires_at: Date | string };

const challenges = new Map<string, Challenge>();
const sessions = new Map<string, Session>();

export async function createMerchantChallenge({
  address,
  origin,
}: {
  address: string;
  origin: string;
}) {
  if (!isAddress(address)) {
    throw new Error("Merchant wallet address is invalid.");
  }

  const normalizedAddress = getAddress(address);
  const nonce = randomUUID();
  const issuedAt = new Date().toISOString();
  const message = [
    "ArcPass merchant session",
    "",
    `Site: ${origin}`,
    `Address: ${normalizedAddress}`,
    `Nonce: ${nonce}`,
    `Issued: ${issuedAt}`,
    "",
    "This gas-free signature unlocks the merchant dashboard. It does not authorize a payment.",
  ].join("\n");
  const expiresAt = Date.now() + CHALLENGE_TTL_MS;

  if (databaseConfigured()) {
    const sql = getDatabase();
    await pruneDatabaseSessions();
    await sql`
      insert into arcpass_merchant_challenges (message_hash, address, message, expires_at)
      values (${hashSecret(message)}, ${normalizedAddress}, ${message}, ${new Date(expiresAt).toISOString()})
      on conflict (message_hash) do update
        set address = excluded.address, message = excluded.message, expires_at = excluded.expires_at
    `;
  } else {
    pruneMemorySessions();
    challenges.set(message, { address: normalizedAddress, expiresAt, message });
  }

  return { address: normalizedAddress, message };
}

export async function verifyMerchantChallenge({
  address,
  message,
  signature,
}: {
  address: string;
  message: string;
  signature: string;
}) {
  if (!isAddress(address)) {
    throw new Error("Merchant wallet address is invalid.");
  }

  const normalizedAddress = getAddress(address);
  const challenge = databaseConfigured()
    ? await loadDatabaseChallenge(message)
    : loadMemoryChallenge(message);

  if (!challenge || challenge.address !== normalizedAddress || Date.now() >= challenge.expiresAt) {
    throw new Error("Merchant session challenge is expired or invalid.");
  }

  const verified = await verifyMessage({
    address: normalizedAddress,
    message,
    signature: signature as Hex,
  });

  if (!verified) {
    await discardChallenge(message);
    throw new Error("Merchant wallet signature could not be verified.");
  }

  const token = randomUUID();
  const expiresAt = Date.now() + SESSION_TTL_MS;

  if (databaseConfigured()) {
    const sql = getDatabase();
    const consumed = await sql.begin(async (transaction) => {
      const deleted = await transaction`
        delete from arcpass_merchant_challenges
        where message_hash = ${hashSecret(message)}
          and lower(address) = lower(${normalizedAddress})
          and expires_at > now()
        returning address
      `;
      if (deleted.length !== 1) return false;

      await transaction`
        insert into arcpass_merchant_sessions (token_hash, address, expires_at)
        values (${hashSecret(token)}, ${normalizedAddress}, ${new Date(expiresAt).toISOString()})
      `;
      return true;
    });

    if (!consumed) {
      throw new Error("Merchant session challenge was already used.");
    }
  } else {
    challenges.delete(message);
    sessions.set(token, { address: normalizedAddress, expiresAt });
  }

  return { address: normalizedAddress, token };
}

export function setMerchantSessionCookie(response: NextResponse, token: string) {
  response.cookies.set(SESSION_COOKIE, token, {
    httpOnly: true,
    maxAge: SESSION_TTL_MS / 1000,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function revokeMerchantSession(req: NextRequest, response: NextResponse) {
  const token = req.cookies.get(SESSION_COOKIE)?.value;
  if (token) {
    if (databaseConfigured()) {
      const sql = getDatabase();
      await sql`delete from arcpass_merchant_sessions where token_hash = ${hashSecret(token)}`;
    } else {
      sessions.delete(token);
    }
  }
  response.cookies.set(SESSION_COOKIE, "", {
    httpOnly: true,
    maxAge: 0,
    path: "/",
    sameSite: "lax",
    secure: process.env.NODE_ENV === "production",
  });
}

export async function requireMerchantSession(req: NextRequest, merchant: string) {
  if (!isAddress(merchant)) {
    return { ok: false as const, error: "Merchant wallet address is invalid.", status: 400 };
  }

  const token = req.cookies.get(SESSION_COOKIE)?.value;
  const normalizedMerchant = getAddress(merchant);
  const session = token
    ? databaseConfigured()
      ? await loadDatabaseSession(token)
      : loadMemorySession(token)
    : null;

  if (!session || Date.now() >= session.expiresAt) {
    return { ok: false as const, error: "Connect and sign with the merchant wallet first.", status: 401 };
  }

  if (session.address !== normalizedMerchant) {
    return { ok: false as const, error: "Merchant session does not match this wallet.", status: 403 };
  }

  return { ok: true as const, address: normalizedMerchant };
}

async function loadDatabaseChallenge(message: string): Promise<Challenge | null> {
  const sql = getDatabase();
  const rows = await sql`
    select address, message, expires_at
    from arcpass_merchant_challenges
    where message_hash = ${hashSecret(message)}
    limit 1
  `;
  const row = rows[0] as ChallengeRow | undefined;
  if (!row || !isAddress(row.address)) return null;
  return { address: getAddress(row.address), expiresAt: new Date(row.expires_at).getTime(), message: row.message };
}

async function loadDatabaseSession(token: string): Promise<Session | null> {
  const sql = getDatabase();
  const rows = await sql`
    select address, expires_at
    from arcpass_merchant_sessions
    where token_hash = ${hashSecret(token)}
      and expires_at > now()
    limit 1
  `;
  const row = rows[0] as SessionRow | undefined;
  if (!row || !isAddress(row.address)) return null;
  return { address: getAddress(row.address), expiresAt: new Date(row.expires_at).getTime() };
}

function loadMemoryChallenge(message: string) {
  pruneMemorySessions();
  return challenges.get(message) ?? null;
}

function loadMemorySession(token: string) {
  pruneMemorySessions();
  return sessions.get(token) ?? null;
}

async function discardChallenge(message: string) {
  if (databaseConfigured()) {
    const sql = getDatabase();
    await sql`delete from arcpass_merchant_challenges where message_hash = ${hashSecret(message)}`;
  } else {
    challenges.delete(message);
  }
}

async function pruneDatabaseSessions() {
  const sql = getDatabase();
  await sql`delete from arcpass_merchant_challenges where expires_at <= now()`;
  await sql`delete from arcpass_merchant_sessions where expires_at <= now()`;
}

function pruneMemorySessions() {
  const now = Date.now();

  for (const [message, challenge] of challenges) {
    if (now >= challenge.expiresAt) challenges.delete(message);
  }

  for (const [token, session] of sessions) {
    if (now >= session.expiresAt) sessions.delete(token);
  }
}

function hashSecret(value: string) {
  return createHash("sha256").update(value).digest("hex");
}
