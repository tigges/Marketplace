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
  if (process.env.DATABASE_URL) {
    const handle = await createPostgresHandle(process.env.DATABASE_URL);
    // Managed Postgres (Supabase) migrations are expected to run via CI.
    return handle;
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
      if (!process.env.DATABASE_URL && (await isRegistryEmpty(handle.db))) {
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
