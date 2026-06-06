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
const globalForDb = globalThis as unknown as {
  __appbazaarDb?: Promise<{ handle: DbHandle; driver: "postgres" | "pglite" }>;
};

async function buildHandle(): Promise<{ handle: DbHandle; driver: "postgres" | "pglite" }> {
  const dbUrl = process.env.DATABASE_URL;
  const isPostgresUrl = dbUrl && (dbUrl.startsWith("postgresql://") || dbUrl.startsWith("postgres://"));

  if (isPostgresUrl) {
    try {
      const handle = await createPostgresHandle(dbUrl);
      return { handle, driver: "postgres" };
    } catch (err) {
      console.warn(
        "[appbazaar] Failed to connect to Postgres (DATABASE_URL may contain unresolved placeholders). " +
          "Falling back to in-process PGlite. Error: " +
          (err instanceof Error ? err.message : String(err)),
      );
    }
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
  return { handle, driver: "pglite" };
}

export function getDbHandle(): Promise<{ handle: DbHandle; driver: "postgres" | "pglite" }> {
  if (!globalForDb.__appbazaarDb) {
    globalForDb.__appbazaarDb = (async () => {
      const result = await buildHandle();
      if (result.driver === "pglite" && (await isRegistryEmpty(result.handle.db))) {
        await seedSampleData(result.handle.db, {
          connectorUrl: process.env.EXAMPLE_CONNECTOR_URL ?? "http://localhost:8787",
        });
      }
      return result;
    })();
  }
  return globalForDb.__appbazaarDb;
}

export async function getDb() {
  return (await getDbHandle()).handle.db;
}

/** Returns the actual database driver in use (reflects PGlite fallback if Postgres failed). */
export async function getDbDriver(): Promise<"postgres" | "pglite"> {
  return (await getDbHandle()).driver;
}
