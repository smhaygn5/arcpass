import { getAddress, type Address } from "viem";
import { databaseConfigured, getDatabase } from "./server-database.ts";
import { defaultTeamWorkspace, normalizeTeamWorkspace, type ApprovalPolicy, type TeamMember, type TeamWorkspace } from "./team-policies.ts";

type TeamRow = { workspace: unknown };
const memoryWorkspaces = new Map<string, TeamWorkspace>();

export async function loadServerTeamWorkspace(merchant: Address) {
  const normalizedMerchant = getAddress(merchant);
  if (!databaseConfigured()) return memoryWorkspaces.get(normalizedMerchant.toLowerCase()) ?? defaultTeamWorkspace(normalizedMerchant);
  const sql = getDatabase();
  const rows = await sql`select workspace from arcpass_team_workspaces where lower(merchant) = lower(${normalizedMerchant}) limit 1`;
  return rows[0] ? teamFromRow(rows[0] as TeamRow, normalizedMerchant) ?? defaultTeamWorkspace(normalizedMerchant) : defaultTeamWorkspace(normalizedMerchant);
}

export async function saveServerTeamWorkspace({ members, merchant, policy }: { members: TeamMember[]; merchant: Address; policy: ApprovalPolicy }) {
  const normalizedMerchant = getAddress(merchant);
  const workspace = normalizeTeamWorkspace({ members, policy }, normalizedMerchant);
  if (!databaseConfigured()) {
    memoryWorkspaces.set(normalizedMerchant.toLowerCase(), workspace);
    return workspace;
  }
  const sql = getDatabase();
  const rows = await sql`
    insert into arcpass_team_workspaces (merchant, workspace, updated_at)
    values (${normalizedMerchant}, ${sql.json(workspace)}, ${workspace.updatedAt})
    on conflict (merchant) do update set workspace = excluded.workspace, updated_at = excluded.updated_at
    returning workspace
  `;
  return teamFromRow(rows[0] as TeamRow, normalizedMerchant) ?? workspace;
}

function teamFromRow(row: TeamRow, merchant: Address) {
  try {
    return normalizeTeamWorkspace(row.workspace, merchant);
  } catch {
    return null;
  }
}
