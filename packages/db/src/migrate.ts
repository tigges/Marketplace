/**
 * Standalone migration runner.
 *
 * Applies INIT_SQL (idempotent — all statements use IF NOT EXISTS) against
 * the database pointed to by DATABASE_URL.  Safe to re-run at any time;
 * also picks up additive changes like the stripe_connect_account_id column.
 *
 * Usage:
 *   DATABASE_URL="postgresql://..." pnpm --filter @appbazaar/db run migrate
 */
import { createHandleFromEnv } from "./client.js";

async function main() {
  const dbUrl = process.env.DATABASE_URL;
  if (!dbUrl) {
    console.error("DATABASE_URL is not set. Set it to a PostgreSQL connection string and retry.");
    process.exit(1);
  }

  console.log("Connecting to database…");
  const handle = await createHandleFromEnv();

  console.log("Applying migrations (idempotent)…");
  await handle.migrate();

  console.log("✅ Migrations applied.");
  await handle.close();
}

main().catch((err) => {
  console.error("Migration failed:", err);
  process.exit(1);
});
