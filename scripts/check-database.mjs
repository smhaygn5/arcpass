import postgres from "postgres";

const connectionString = process.env.DATABASE_URL?.trim();
if (!connectionString) throw new Error("DATABASE_URL is required.");

const sql = postgres(connectionString, {
  connect_timeout: 10,
  max: 1,
  prepare: false,
  ssl: "require",
});

try {
  const tables = await sql.unsafe(
    "select table_name from information_schema.tables where table_schema = 'public' and table_name like 'arcpass_%' order by table_name",
  );
  const [counts] = await sql.unsafe(
    "select (select count(*)::int from arcpass_invoices) as invoices, (select count(*)::int from arcpass_receipts) as receipts, (select count(*)::int from arcpass_merchant_sessions) as sessions, (select count(*)::int from arcpass_rate_limits) as rate_limits",
  );
  const rlsRows = await sql.unsafe(
    "select c.relname as table_name, c.relrowsecurity as rls_enabled from pg_class c join pg_namespace n on n.oid = c.relnamespace where n.nspname = 'public' and c.relname like 'arcpass_%' and c.relkind = 'r' order by c.relname",
  );
  const [grantCount] = await sql.unsafe(
    "select count(*)::int as count from information_schema.role_table_grants where table_schema = 'public' and table_name like 'arcpass_%' and grantee in ('anon', 'authenticated', 'PUBLIC')",
  );
  const security = {
    exposedGrantCount: Number(grantCount?.count ?? -1),
    rlsEnabled: rlsRows.length === tables.length && rlsRows.every((row) => row.rls_enabled === true),
  };

  console.log(JSON.stringify({
    connected: true,
    counts,
    security,
    tables: tables.map((row) => row.table_name),
  }));

  if (!security.rlsEnabled || security.exposedGrantCount !== 0) {
    throw new Error("ArcPass database security checks failed.");
  }
} finally {
  await sql.end({ timeout: 5 });
}
