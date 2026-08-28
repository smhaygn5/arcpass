import "server-only";

import { randomUUID } from "node:crypto";
import type { Address, Hex } from "viem";
import { isDisputeEvidence, type DisputeEvidence, type DisputeEvidenceRole } from "./disputes.ts";
import type { RefundRequest } from "./refunds.ts";
import { databaseConfigured, getDatabase } from "./server-database.ts";

const MAX_EVIDENCE_ITEMS = 20;
type EvidenceRow = { evidence: unknown };
const memoryEvidence = new Map<string, DisputeEvidence[]>();

export async function createServerDisputeEvidence({
  evidenceSha256,
  evidenceUrl,
  refund,
  role,
  signature,
  signer,
  statement,
}: {
  evidenceSha256: string | null;
  evidenceUrl: string | null;
  refund: RefundRequest;
  role: DisputeEvidenceRole;
  signature: Hex;
  signer: Address;
  statement: string;
}) {
  if (refund.status !== "pending") throw new Error("This evidence room is closed because a decision has already been recorded.");

  const evidence: DisputeEvidence = {
    createdAt: new Date().toISOString(),
    evidenceId: `ev_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
    evidenceSha256,
    evidenceUrl,
    requestId: refund.requestId,
    role,
    signature,
    signer,
    statement,
  };

  if (!databaseConfigured()) {
    const current = memoryEvidence.get(refund.requestId) ?? [];
    if (current.length >= MAX_EVIDENCE_ITEMS) throw new Error("This evidence room has reached its 20 item limit.");
    if (current.some((item) => item.signature.toLowerCase() === signature.toLowerCase())) return current.find((item) => item.signature.toLowerCase() === signature.toLowerCase())!;
    memoryEvidence.set(refund.requestId, [...current, evidence]);
    return evidence;
  }

  const sql = getDatabase();
  const countRows = await sql`select count(*)::int as count from arcpass_dispute_evidence where request_id = ${refund.requestId}`;
  if (Number(countRows[0]?.count ?? 0) >= MAX_EVIDENCE_ITEMS) throw new Error("This evidence room has reached its 20 item limit.");
  const rows = await sql`
    insert into arcpass_dispute_evidence (evidence_id, request_id, role, signer, signature, evidence, created_at)
    values (${evidence.evidenceId}, ${evidence.requestId}, ${evidence.role}, ${evidence.signer}, ${evidence.signature}, ${sql.json(evidence)}, ${evidence.createdAt})
    on conflict (request_id, signature) do update set signature = excluded.signature
    returning evidence
  `;
  return evidenceFromRow(rows[0] as EvidenceRow) ?? evidence;
}

export async function loadServerDisputeEvidence(requestId: string) {
  if (!databaseConfigured()) return [...(memoryEvidence.get(requestId) ?? [])].sort((a, b) => a.createdAt.localeCompare(b.createdAt));
  const sql = getDatabase();
  const rows = await sql`select evidence from arcpass_dispute_evidence where request_id = ${requestId} order by created_at asc limit ${MAX_EVIDENCE_ITEMS}`;
  return Array.from(rows).map((row) => evidenceFromRow(row as EvidenceRow)).filter((item): item is DisputeEvidence => Boolean(item));
}

function evidenceFromRow(row: EvidenceRow) {
  return isDisputeEvidence(row.evidence) ? row.evidence : null;
}
