import "server-only";

import { randomUUID } from "node:crypto";
import { getAddress, type Address } from "viem";
import { databaseConfigured, getDatabase, requirePersistentDatabase } from "./server-database.ts";
import {
  isX402Access,
  isX402Resource,
  normalizeX402ResourceInput,
  x402Metrics,
  type X402Access,
  type X402Resource,
  type X402ResourceStatus,
} from "./x402.ts";

type ResourceRow = { resource: unknown };
type AccessRow = { access: unknown };
const memoryResources = new Map<string, X402Resource>();
const memoryAccesses = new Map<string, X402Access>();

export async function createServerX402Resource(input: unknown, merchant: string) {
  requirePersistentDatabase();
  const normalized = normalizeX402ResourceInput(input, merchant);
  const now = new Date().toISOString();
  const resource: X402Resource = {
    ...normalized,
    createdAt: now,
    resourceId: `xres_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
    status: "active",
    updatedAt: now,
  };

  if (!databaseConfigured()) {
    memoryResources.set(resource.resourceId, resource);
    return resource;
  }

  const sql = getDatabase();
  const rows = await sql`
    insert into arcpass_x402_resources (resource_id, merchant, status, resource, created_at, updated_at)
    values (${resource.resourceId}, ${resource.merchant}, ${resource.status}, ${sql.json(JSON.parse(JSON.stringify(resource)))}, ${resource.createdAt}, ${resource.updatedAt})
    returning resource
  `;
  return resourceFromRow(rows[0] as ResourceRow) ?? resource;
}

export async function loadServerX402Workspace(merchant: string) {
  requirePersistentDatabase();
  const normalized = getAddress(merchant);
  let resources: X402Resource[];
  let accesses: X402Access[];

  if (!databaseConfigured()) {
    resources = [...memoryResources.values()].filter((resource) => resource.merchant === normalized);
    accesses = [...memoryAccesses.values()].filter((access) => access.merchant === normalized);
  } else {
    const sql = getDatabase();
    const [resourceRows, accessRows] = await Promise.all([
      sql`select resource from arcpass_x402_resources where lower(merchant) = lower(${normalized}) order by created_at desc limit 50`,
      sql`select access from arcpass_x402_accesses where lower(merchant) = lower(${normalized}) order by created_at desc limit 250`,
    ]);
    resources = Array.from(resourceRows).map((row) => resourceFromRow(row as ResourceRow)).filter((item): item is X402Resource => Boolean(item));
    accesses = Array.from(accessRows).map((row) => accessFromRow(row as AccessRow)).filter((item): item is X402Access => Boolean(item));
  }

  return { ...x402Metrics(resources, accesses), accesses: accesses.slice(0, 50) };
}

export async function findServerX402Resource(resourceId: string) {
  requirePersistentDatabase();
  if (!/^xres_[a-z0-9]{20}$/.test(resourceId)) return null;
  if (!databaseConfigured()) return memoryResources.get(resourceId) ?? null;
  const sql = getDatabase();
  const rows = await sql`select resource from arcpass_x402_resources where resource_id = ${resourceId} limit 1`;
  return rows[0] ? resourceFromRow(rows[0] as ResourceRow) : null;
}

export async function updateServerX402ResourceStatus(resourceId: string, merchant: Address, status: X402ResourceStatus) {
  requirePersistentDatabase();
  const current = await findServerX402Resource(resourceId);
  if (!current || current.merchant !== merchant) throw new Error("Nanopayment resource was not found.");
  const updated: X402Resource = { ...current, status, updatedAt: new Date().toISOString() };

  if (!databaseConfigured()) {
    memoryResources.set(resourceId, updated);
    return updated;
  }
  const sql = getDatabase();
  const rows = await sql`
    update arcpass_x402_resources
    set status = ${updated.status}, resource = ${sql.json(JSON.parse(JSON.stringify(updated)))}, updated_at = ${updated.updatedAt}
    where resource_id = ${resourceId} and lower(merchant) = lower(${merchant})
    returning resource
  `;
  return resourceFromRow(rows[0] as ResourceRow) ?? updated;
}

export async function recordServerX402Access({
  amount,
  merchant,
  network,
  payer,
  resourceId,
  transaction,
}: {
  amount: string;
  merchant: Address;
  network: string;
  payer: Address;
  resourceId: string;
  transaction: string;
}) {
  requirePersistentDatabase();
  const access: X402Access = {
    accessId: `xacc_${randomUUID().replaceAll("-", "").slice(0, 20)}`,
    amount,
    createdAt: new Date().toISOString(),
    merchant,
    network,
    payer,
    resourceId,
    transaction,
  };

  if (!databaseConfigured()) {
    const existing = [...memoryAccesses.values()].find((item) => item.transaction === transaction);
    if (existing && existing.resourceId !== resourceId) throw new Error("This x402 settlement is already assigned to another resource.");
    if (existing) return existing;
    memoryAccesses.set(transaction, access);
    return access;
  }

  const sql = getDatabase();
  const rows = await sql`
    insert into arcpass_x402_accesses (access_id, resource_id, merchant, payer, transaction, access, created_at)
    values (${access.accessId}, ${access.resourceId}, ${access.merchant}, ${access.payer}, ${access.transaction}, ${sql.json(access)}, ${access.createdAt})
    on conflict (transaction) do update set transaction = excluded.transaction
    returning access
  `;
  const stored = accessFromRow(rows[0] as AccessRow);
  if (!stored || stored.resourceId !== resourceId) throw new Error("This x402 settlement is already assigned to another resource.");
  return stored;
}

function resourceFromRow(row: ResourceRow) {
  return isX402Resource(row.resource) ? row.resource : null;
}

function accessFromRow(row: AccessRow) {
  return isX402Access(row.access) ? row.access : null;
}
