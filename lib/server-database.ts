import postgres, { type Sql } from "postgres";

let databaseClient: Sql | null = null;

export function databaseConfigured() {
  return Boolean(process.env.DATABASE_URL?.trim());
}

export function getDatabase() {
  const connectionString = process.env.DATABASE_URL?.trim();
  if (!connectionString) {
    throw new Error("DATABASE_URL is not configured.");
  }

  if (!databaseClient) {
    databaseClient = postgres(connectionString, {
      connect_timeout: 10,
      idle_timeout: 20,
      max: 3,
      prepare: false,
      ssl: "require",
    });
  }

  return databaseClient;
}