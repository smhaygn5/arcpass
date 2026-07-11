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
  console.log(JSON.stringify({
    connected: true,
    counts,
    tables: tables.map((row) => row.table_name),
  }));
} finally {
  await sql.end({ timeout: 5 });
}