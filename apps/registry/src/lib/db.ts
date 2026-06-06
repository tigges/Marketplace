import {
  type DbHandle,
  createPgliteHandleFromClient,
  createPostgresHandle,
  isRegistryEmpty,
  seedSampleData,
} from "@appbazaar/db";

/**
 * Process-wide database handle. In dev (PGlite) we also run migrations and
 * seed sample data once so the directory isn't empty. In production set
 * `DATABASE_URL` (Supabase) and run migrations via CI instead.
 *
 * The PGlite instance is created here (in app code) rather than inside
 * `@appbazaar/db` so Next can externalize its wasm loader — see
 * `serverComponentsExternalPackages` in next.config.mjs.
 */
const globalForDb = globalThis as unknown as { __appbazaarDb?: Promise<DbHandle> };

async function buildHandle(): Promise<DbHandle> {
  const dbUrl = process.env.DATABASE_URL;
  const isPostgresUrl = dbUrl && (dbUrl.startsWith("postgresql://") || dbUrl.startsWith("postgres://"));

  if (isPostgresUrl) {
    const handle = await createPostgresHandle(dbUrl);
    // Managed Postgres (Supabase) migrations are expected to run via CI.
    return handle;
  }

  if (dbUrl && !isPostgresUrl) {
    console.warn(
      "[appbazaar] DATABASE_URL is set but does not look like a PostgreSQL connection string " +
        "(expected postgresql:// or postgres://). Falling back to in-process PGlite. " +
        "Set DATABASE_URL to the connection string from Supabase → Project Settings → Database.",
    );
  }

  const { PGlite } = await import("@electric-sql/pglite");
  const handle = await createPgliteHandleFromClient(new PGlite());
  await handle.migrate();
  return handle;
}

export function getDbHandle(): Promise<DbHandle> {
  if (!globalForDb.__appbazaarDb) {
    globalForDb.__appbazaarDb = (async () => {
      const handle = await buildHandle();
      const dbUrl = process.env.DATABASE_URL ?? "";
      const isPostgresUrl = dbUrl.startsWith("postgresql://") || dbUrl.startsWith("postgres://");
      if (!isPostgresUrl && (await isRegistryEmpty(handle.db))) {
        await seedSampleData(handle.db, {
          connectorUrl: process.env.EXAMPLE_CONNECTOR_URL ?? "http://localhost:8787",
        });
      }
      return handle;
    })();
  }
  return globalForDb.__appbazaarDb;
}

export async function getDb() {
  return (await getDbHandle()).db;
}
