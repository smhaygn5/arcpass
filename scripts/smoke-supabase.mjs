import { randomBytes } from "node:crypto";
import postgres from "postgres";
import { privateKeyToAccount } from "viem/accounts";

const baseUrl = process.env.ARCPASS_BASE_URL?.trim() || "http://127.0.0.1:3000";
const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");

const privateKey = `0x${randomBytes(32).toString("hex")}`;
const account = privateKeyToAccount(privateKey);
const now = new Date();
const invoiceId = `inv_smoke_${Date.now().toString(36)}`;
const invoice = {
  amount: "1.00",
  createdAt: now.toISOString(),
  description: "ArcPass Supabase smoke test",
  expiresAt: new Date(now.getTime() + 60 * 60 * 1000).toISOString(),
  invoiceId,
  merchant: {
    businessName: "ArcPass Smoke Merchant",
    createdAt: now.toISOString(),
    domain: "smoke.example",
    passportId: `pass_smoke_${Date.now().toString(36)}`,
    refundPolicy: "merchant-refund",
    status: "pending",
    walletAddress: account.address,
  },
  token: "USDC",
  version: 1,
};
const payload = Buffer.from(JSON.stringify(invoice), "utf8").toString("base64url");
const sql = postgres(connectionString, { max: 1, prepare: false, ssl: "require" });

try {
  const challengeRes = await fetch(`${baseUrl}/api/merchant-session?address=${account.address}`);
  const challenge = await readJson(challengeRes, "challenge");
  const signature = await account.signMessage({ message: challenge.message });

  const sessionRes = await fetch(`${baseUrl}/api/merchant-session`, {
    body: JSON.stringify({ address: account.address, message: challenge.message, signature }),
    headers: { "content-type": "application/json" },
    method: "POST",
  });
  const session = await readJson(sessionRes, "session");
  const cookie = sessionRes.headers.get("set-cookie")?.split(";")[0] ?? "";
  if (!cookie) throw new Error("Merchant session cookie was not returned.");

  const createRes = await fetch(`${baseUrl}/api/invoices`, {
    body: JSON.stringify({ payload }),
    headers: { "content-type": "application/json", cookie },
    method: "POST",
  });
  const created = await readJson(createRes, "invoice creation");

  const listRes = await fetch(`${baseUrl}/api/invoices?merchant=${account.address}`, {
    headers: { cookie },
  });
  const listed = await readJson(listRes, "invoice list");

  const stateRes = await fetch(`${baseUrl}/api/public-invoice-state?payload=${encodeURIComponent(payload)}`);
  const state = await readJson(stateRes, "public invoice state");

  console.log(JSON.stringify({
    invoiceCreated: created.saved === true,
    invoiceListed: Array.isArray(listed.invoices) && listed.invoices.some((item) => item?.invoice?.invoiceId === invoiceId),
    publicRegistrationConfirmed: state.registered === true,
    sessionAuthenticated: session.authenticated === true,
  }));
} finally {
  await sql`delete from arcpass_receipts where invoice_id = ${invoiceId}`;
  await sql`delete from arcpass_invoices where invoice_id = ${invoiceId}`;
  await sql`delete from arcpass_merchant_challenges where lower(address) = lower(${account.address})`;
  await sql`delete from arcpass_merchant_sessions where lower(address) = lower(${account.address})`;
  await sql.end({ timeout: 5 });
}

async function readJson(response, label) {
  const body = await response.json().catch(() => null);
  if (!response.ok) {
    throw new Error(`${label} failed with status ${response.status}: ${body?.error ?? "unknown error"}`);
  }
  return body;
}