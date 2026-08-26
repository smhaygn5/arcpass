import { createHash } from "node:crypto";
import { getAddress, isAddress, verifyMessage, type Address, type Hex } from "viem";
import { decodeInvoicePayload, invoiceExpired, type ArcPassInvoice } from "./arcpass.ts";
import { createSavedInvoice, type SavedInvoice } from "./invoices.ts";
import { databaseConfigured, getDatabase } from "./server-database.ts";
import { saveServerInvoice } from "./server-invoices.ts";
import { loadServerTeamWorkspace } from "./server-team.ts";
import {
  approvalRequestMessage,
  evaluateApprovalPolicy,
  isApprovalRequest,
  type ApprovalRecord,
  type ApprovalRequest,
  type ApprovalRequestStatus,
} from "./team-policies.ts";

type ApprovalRow = { request: unknown; status: string };
type SignatureRow = { approved_at: Date | string; approver: string };
type ApprovalSubmission =
  | { invoices: SavedInvoice[]; request: null; status: "registered" }
  | { invoices: []; request: ApprovalRequest; status: "pending" };

const memoryRequests = new Map<string, ApprovalRequest>();
let memoryApprovalQueue = Promise.resolve();

export async function approvalRequiredForInvoices(invoices: ArcPassInvoice[]) {
  const merchant = getAddress(invoices[0].merchant.walletAddress);
  const workspace = await loadServerTeamWorkspace(merchant);
  return evaluateApprovalPolicy(invoices, workspace.policy);
}

export async function submitInvoicesForApproval({ invoices, operationLabel, origin, payloads }: { invoices: ArcPassInvoice[]; operationLabel: string; origin: string; payloads: string[] }): Promise<ApprovalSubmission> {
  validateInvoiceGroup(invoices, payloads);
  const merchant = getAddress(invoices[0].merchant.walletAddress);
  const workspace = await loadServerTeamWorkspace(merchant);
  const decision = evaluateApprovalPolicy(invoices, workspace.policy);
  if (!decision.required) {
    return { invoices: await Promise.all(invoices.map((invoice) => saveServerInvoice({ invoice, origin }))), request: null, status: "registered" };
  }

  const requestId = approvalRequestId(merchant, payloads);
  const existing = await loadServerApprovalRequest(requestId);
  if (existing?.status === "approved") {
    return { invoices: decodeRequestInvoices(existing).map((invoice) => createSavedInvoice({ invoice, origin })), request: null, status: "registered" };
  }
  if (existing?.status === "expired") throw new Error("This approval request expired. Update the invoice deadline before submitting it again.");
  if (existing) return { invoices: [], request: existing, status: "pending" };
  const createdAt = new Date().toISOString();
  const expiresAt = new Date(Math.min(...invoices.map((invoice) => new Date(invoice.expiresAt).getTime()))).toISOString();
  const request: ApprovalRequest = {
    approvals: [],
    createdAt,
    expiresAt,
    invoices: invoices.map((invoice) => ({ amount: invoice.amount, description: invoice.description, invoiceId: invoice.invoiceId, token: invoice.token })),
    merchant,
    operationLabel: normalizeOperationLabel(operationLabel),
    payloads,
    requestId,
    requiredApprovals: decision.requiredApprovals,
    status: "pending",
    totals: decision.totals,
  };
  await saveApprovalRequest(request);
  return { invoices: [], request, status: "pending" };
}

export async function loadServerApprovalRequest(requestId: string) {
  if (!/^apr_[a-z0-9]{16}$/.test(requestId)) return null;
  if (!databaseConfigured()) {
    const request = memoryRequests.get(requestId) ?? null;
    return request ? expireRequest(request) : null;
  }
  const sql = getDatabase();
  const rows = await sql`select request, status from arcpass_approval_requests where request_id = ${requestId} limit 1`;
  if (!rows[0]) return null;
  const signatures = await sql`select approver, approved_at from arcpass_approval_signatures where request_id = ${requestId} order by approved_at asc`;
  const request = approvalFromRow(rows[0] as ApprovalRow, Array.from(signatures) as SignatureRow[]);
  if (!request) return null;
  if (request.status === "pending" && new Date(request.expiresAt).getTime() <= Date.now()) {
    await sql`update arcpass_approval_requests set status = 'expired' where request_id = ${requestId} and status = 'pending'`;
    return { ...request, status: "expired" as const };
  }
  return request;
}

export async function loadServerApprovalRequests(merchant: Address) {
  const normalizedMerchant = getAddress(merchant);
  if (!databaseConfigured()) {
    return [...memoryRequests.values()].filter((request) => request.merchant.toLowerCase() === normalizedMerchant.toLowerCase()).map(expireRequest).sort((a, b) => b.createdAt.localeCompare(a.createdAt));
  }
  const sql = getDatabase();
  const rows = await sql`select request, status from arcpass_approval_requests where lower(merchant) = lower(${normalizedMerchant}) order by created_at desc limit 50`;
  const signatures = await sql`
    select signature.approver, signature.approved_at, signature.request_id
    from arcpass_approval_signatures signature
    join arcpass_approval_requests request on request.request_id = signature.request_id
    where lower(request.merchant) = lower(${normalizedMerchant})
    order by signature.approved_at asc
  `;
  return Array.from(rows).map((row) => {
    const rawRequest = (row as ApprovalRow).request;
    const requestId = isApprovalRequest(rawRequest) ? rawRequest.requestId : "";
    const matches = Array.from(signatures).filter((signature) => String(signature.request_id) === requestId) as Array<SignatureRow & { request_id: string }>;
    return approvalFromRow(row as ApprovalRow, matches);
  }).filter((request): request is ApprovalRequest => Boolean(request)).map(expireRequest);
}

export async function approveServerRequest({ address, requestId, signature, origin }: { address: string; requestId: string; signature: string; origin: string }) {
  if (!isAddress(address) || !/^0x[0-9a-fA-F]+$/.test(signature)) throw new Error("Approval wallet or signature is invalid.");
  const approver = getAddress(address);
  const request = await loadServerApprovalRequest(requestId);
  if (!request) throw new Error("Approval request was not found.");
  if (request.status === "expired" || new Date(request.expiresAt).getTime() <= Date.now()) throw new Error("Approval request has expired.");
  const workspace = await loadServerTeamWorkspace(request.merchant);
  const member = workspace.members.find((candidate) => candidate.walletAddress.toLowerCase() === approver.toLowerCase());
  if (approver.toLowerCase() !== request.merchant.toLowerCase() && member?.role !== "approver") throw new Error("This wallet does not have the Approver role.");
  const verified = await verifyMessage({ address: approver, message: approvalRequestMessage(request), signature: signature as Hex });
  if (!verified) throw new Error("Approval signature could not be verified.");
  return databaseConfigured()
    ? approveDatabaseRequest({ approver, origin, requestId, signature })
    : approveMemoryRequest({ approver, origin, requestId });
}

async function approveDatabaseRequest({ approver, origin, requestId, signature }: { approver: Address; origin: string; requestId: string; signature: string }) {
  const sql = getDatabase();
  await sql.begin(async (transaction) => {
    const rows = await transaction`select request, status from arcpass_approval_requests where request_id = ${requestId} for update`;
    const current = rows[0] ? approvalFromRow(rows[0] as ApprovalRow, []) : null;
    if (!current) throw new Error("Approval request was not found.");
    if (current.status !== "pending") return;
    if (new Date(current.expiresAt).getTime() <= Date.now()) {
      await transaction`update arcpass_approval_requests set status = 'expired' where request_id = ${requestId}`;
      throw new Error("Approval request has expired.");
    }
    await transaction`
      insert into arcpass_approval_signatures (request_id, approver, signature, approved_at)
      values (${requestId}, ${approver}, ${signature}, ${new Date().toISOString()})
      on conflict (request_id, approver) do nothing
    `;
    const countRows = await transaction`select count(*)::int as count from arcpass_approval_signatures where request_id = ${requestId}`;
    if (Number(countRows[0]?.count ?? 0) < current.requiredApprovals) return;
    const invoices = decodeRequestInvoices(current);
    for (const invoice of invoices) {
      const saved = createSavedInvoice({ invoice, origin });
      const stored = await transaction`
        insert into arcpass_invoices (invoice_id, merchant, payload, link, invoice, created_at, expires_at)
        values (${invoice.invoiceId}, ${invoice.merchant.walletAddress}, ${saved.payload}, ${saved.link}, ${transaction.json(invoice)}, ${invoice.createdAt}, ${invoice.expiresAt})
        on conflict (invoice_id) do update set link = excluded.link
          where arcpass_invoices.payload = excluded.payload and lower(arcpass_invoices.merchant) = lower(excluded.merchant)
        returning invoice_id
      `;
      if (stored.length !== 1) throw new Error("An approved invoice conflicts with an existing invoice id.");
    }
    await transaction`update arcpass_approval_requests set status = 'approved' where request_id = ${requestId}`;
  });
  return loadServerApprovalRequest(requestId);
}

async function approveMemoryRequest({ approver, origin, requestId }: { approver: Address; origin: string; requestId: string }) {
  const previous = memoryApprovalQueue;
  let release = () => {};
  memoryApprovalQueue = new Promise<void>((resolve) => { release = resolve; });
  await previous;
  try {
    const current = memoryRequests.get(requestId);
    if (!current) throw new Error("Approval request was not found.");
    if (current.status !== "pending") return current;
    const approvals = current.approvals.some((approval) => approval.approver.toLowerCase() === approver.toLowerCase())
      ? current.approvals
      : [...current.approvals, { approvedAt: new Date().toISOString(), approver }];
    const status = approvals.length >= current.requiredApprovals ? "approved" as const : "pending" as const;
    const updated = { ...current, approvals, status };
    if (status === "approved") await Promise.all(decodeRequestInvoices(updated).map((invoice) => saveServerInvoice({ invoice, origin })));
    memoryRequests.set(requestId, updated);
    return updated;
  } finally {
    release();
  }
}

async function saveApprovalRequest(request: ApprovalRequest) {
  if (!databaseConfigured()) {
    if (!memoryRequests.has(request.requestId)) memoryRequests.set(request.requestId, request);
    return;
  }
  const sql = getDatabase();
  await sql`
    insert into arcpass_approval_requests (request_id, merchant, status, request, created_at, expires_at)
    values (${request.requestId}, ${request.merchant}, ${request.status}, ${sql.json(request)}, ${request.createdAt}, ${request.expiresAt})
    on conflict (request_id) do nothing
  `;
}

function approvalFromRow(row: ApprovalRow, signatures: SignatureRow[]): ApprovalRequest | null {
  if (!isApprovalRequest(row.request)) return null;
  const status: ApprovalRequestStatus = row.status === "approved" || row.status === "expired" ? row.status : "pending";
  const approvals = signatures.flatMap<ApprovalRecord>((signature) => isAddress(signature.approver) ? [{ approvedAt: new Date(signature.approved_at).toISOString(), approver: getAddress(signature.approver) }] : []);
  return { ...row.request, approvals, status };
}

function decodeRequestInvoices(request: ApprovalRequest) {
  const invoices = request.payloads.map(decodeInvoicePayload);
  if (invoices.some((invoice) => !invoice || invoiceExpired(invoice))) throw new Error("One or more approved invoices are invalid or expired.");
  return invoices.filter((invoice): invoice is ArcPassInvoice => Boolean(invoice));
}

function validateInvoiceGroup(invoices: ArcPassInvoice[], payloads: string[]) {
  if (invoices.length < 1 || invoices.length > 10 || invoices.length !== payloads.length) throw new Error("Submit between 1 and 10 matching invoice payloads.");
  const merchant = invoices[0].merchant.walletAddress.toLowerCase();
  if (invoices.some((invoice) => invoice.merchant.walletAddress.toLowerCase() !== merchant || invoiceExpired(invoice))) throw new Error("Approval invoices must share one merchant and remain unexpired.");
}

function approvalRequestId(merchant: Address, payloads: string[]) {
  return `apr_${createHash("sha256").update(`${merchant.toLowerCase()}:${payloads.join(":")}`).digest("hex").slice(0, 16)}`;
}

function normalizeOperationLabel(value: string) {
  const normalized = value.trim();
  if (!normalized || normalized.length > 80) throw new Error("Approval operation label must be between 1 and 80 characters.");
  return normalized;
}

function expireRequest(request: ApprovalRequest): ApprovalRequest {
  if (request.status === "pending" && new Date(request.expiresAt).getTime() <= Date.now()) return { ...request, status: "expired" as const };
  return request;
}
