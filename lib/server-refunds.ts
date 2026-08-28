import { randomUUID } from "node:crypto";
import { getAddress, type Address } from "viem";
import type { SavedReceipt } from "./receipts.ts";
import { databaseConfigured, getDatabase } from "./server-database.ts";
import { isRefundRequest, type RefundDecision, type RefundRequest, type RefundRequestStatus } from "./refunds.ts";

type RefundRow = { request: unknown };
const memoryRequests = new Map<string, RefundRequest>();

export async function createServerRefundRequest(receipt: SavedReceipt, reason: string, requestSignature: `0x${string}`) {
  const existing = await findServerRefundRequest(receipt.txHash);
  if (existing) return existing;
  const now = new Date().toISOString();
  const request: RefundRequest = {
    amount: receipt.amount,
    createdAt: now,
    invoiceId: receipt.invoiceId,
    merchant: getAddress(receipt.merchant),
    payer: getAddress(receipt.payer),
    reason,
    requestId: `ref_${randomUUID().replaceAll("-", "").slice(0, 16)}`,
    requestSignature,
    status: "pending",
    token: receipt.token,
    txHash: receipt.txHash,
    updatedAt: now,
  };
  if (!databaseConfigured()) {
    memoryRequests.set(receipt.txHash.toLowerCase(), request);
    return request;
  }
  const sql = getDatabase();
  const rows = await sql`
    insert into arcpass_refund_requests (request_id, tx_hash, invoice_id, merchant, payer, status, request, created_at, updated_at)
    values (${request.requestId}, ${request.txHash.toLowerCase()}, ${request.invoiceId}, ${request.merchant}, ${request.payer}, ${request.status}, ${sql.json(request)}, ${request.createdAt}, ${request.updatedAt})
    on conflict (tx_hash) do update set tx_hash = excluded.tx_hash
    returning request
  `;
  return refundFromRow(rows[0] as RefundRow) ?? request;
}

export async function findServerRefundRequest(txHash: string) {
  if (!databaseConfigured()) return memoryRequests.get(txHash.toLowerCase()) ?? null;
  const sql = getDatabase();
  const rows = await sql`select request from arcpass_refund_requests where lower(tx_hash) = ${txHash.toLowerCase()} limit 1`;
  return rows[0] ? refundFromRow(rows[0] as RefundRow) : null;
}

export async function findServerRefundRequestById(requestId: string) {
  if (!databaseConfigured()) return Array.from(memoryRequests.values()).find((item) => item.requestId === requestId) ?? null;
  const sql = getDatabase();
  const rows = await sql`select request from arcpass_refund_requests where request_id = ${requestId} limit 1`;
  return rows[0] ? refundFromRow(rows[0] as RefundRow) : null;
}

export async function loadServerRefundRequests(merchant: Address) {
  if (!databaseConfigured()) return Array.from(memoryRequests.values()).filter((item) => item.merchant.toLowerCase() === merchant.toLowerCase());
  const sql = getDatabase();
  const rows = await sql`select request from arcpass_refund_requests where lower(merchant) = lower(${merchant}) order by created_at desc limit 50`;
  return Array.from(rows).map((row) => refundFromRow(row as RefundRow)).filter((item): item is RefundRequest => Boolean(item));
}

export async function updateServerRefundRequest({ decision, merchant, requestId, status }: { decision: RefundDecision; merchant: Address; requestId: string; status: Exclude<RefundRequestStatus, "pending"> }) {
  if (!databaseConfigured()) {
    const request = Array.from(memoryRequests.values()).find((item) => item.requestId === requestId && item.merchant.toLowerCase() === merchant.toLowerCase());
    if (!request || request.status !== "pending") return null;
    const updated = { ...request, decision, status, updatedAt: decision.decidedAt };
    memoryRequests.set(updated.txHash.toLowerCase(), updated);
    return updated;
  }
  const sql = getDatabase();
  const currentRows = await sql`select request from arcpass_refund_requests where request_id = ${requestId} and lower(merchant) = lower(${merchant}) limit 1`;
  const current = currentRows[0] ? refundFromRow(currentRows[0] as RefundRow) : null;
  if (!current || current.status !== "pending") return null;
  const updated: RefundRequest = { ...current, decision, status, updatedAt: decision.decidedAt };
  const rows = await sql`update arcpass_refund_requests set status = ${status}, request = ${sql.json(updated)}, updated_at = ${updated.updatedAt} where request_id = ${requestId} and status = 'pending' returning request`;
  return rows[0] ? refundFromRow(rows[0] as RefundRow) : null;
}

function refundFromRow(row: RefundRow) {
  return isRefundRequest(row.request) ? row.request : null;
}
