import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import postgres from "postgres";

const connectionString = process.env.DATABASE_URL?.trim() || process.env.DIRECT_URL?.trim();
if (!connectionString) {
  throw new Error("DIRECT_URL or DATABASE_URL is required.");
}

const schemaUrl = new URL("../database/schema.sql", import.meta.url);
const schema = await readFile(fileURLToPath(schemaUrl), "utf8");
const sql = postgres(connectionString, {
  connect_timeout: 10,
  max: 1,
  prepare: false,
  ssl: "require",
});

try {
  await sql.unsafe(schema);
  const [result] = await sql`
    select current_database() as database, now() as timestamp
  `;
  console.log(`ArcPass database is ready: ${result?.database ?? "postgres"}`);
} finally {
  await sql.end({ timeout: 5 });
}