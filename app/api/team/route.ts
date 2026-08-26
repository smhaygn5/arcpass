import { NextRequest, NextResponse } from "next/server";
import { getAddress, isAddress } from "viem";
import { clientKey, rateLimit, tooManyRequests } from "@/lib/rate-limit";
import { requireMerchantSession } from "@/lib/server-merchant-session";
import { loadServerTeamWorkspace, saveServerTeamWorkspace } from "@/lib/server-team";
import type { ApprovalPolicy, TeamMember } from "@/lib/team-policies";

export const runtime = "nodejs";

export async function GET(req: NextRequest) {
  const limit = await rateLimit(`team-read:${clientKey(req)}`, 60, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const merchant = req.nextUrl.searchParams.get("merchant") ?? "";
  if (!isAddress(merchant)) return NextResponse.json({ error: "Merchant wallet address is invalid." }, { status: 400 });
  const session = await requireMerchantSession(req, merchant);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });
  return NextResponse.json({ workspace: await loadServerTeamWorkspace(getAddress(merchant)) });
}

export async function PUT(req: NextRequest) {
  const limit = await rateLimit(`team-update:${clientKey(req)}`, 20, 60_000);
  if (!limit.ok) return tooManyRequests(limit.retryAfter);
  const body = (await req.json().catch(() => null)) as { members?: unknown; merchant?: unknown; policy?: unknown } | null;
  const merchant = typeof body?.merchant === "string" ? body.merchant : "";
  if (!isAddress(merchant) || !Array.isArray(body?.members) || !body?.policy) return NextResponse.json({ error: "Team workspace update is invalid." }, { status: 400 });
  const session = await requireMerchantSession(req, merchant);
  if (!session.ok) return NextResponse.json({ error: session.error }, { status: session.status });
  try {
    const workspace = await saveServerTeamWorkspace({ members: body.members as TeamMember[], merchant: getAddress(merchant), policy: body.policy as ApprovalPolicy });
    return NextResponse.json({ saved: true, workspace });
  } catch (err) {
    return NextResponse.json({ error: err instanceof Error ? err.message : "Team workspace could not be saved." }, { status: 400 });
  }
}
