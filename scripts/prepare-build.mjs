await import("./clean-stale-types.mjs");

if (
  process.env.VERCEL === "1" &&
  process.env.VERCEL_ENV === "production" &&
  process.env.DATABASE_URL?.trim()
) {
  await import("./migrate-database.mjs");
}
