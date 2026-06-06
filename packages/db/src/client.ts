import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import * as schema from "./schema.js";
import { INIT_SQL } from "./migrations/sql.js";

/**
 * A driver-agnostic Drizzle handle. Both the PGlite (local/test) and
 * postgres-js (Supabase/production) drivers extend `PgDatabase`, so the
 * repository layer never needs to know which one it's talking to.
 */
export type Database = PgDatabase<PgQueryResultHKT, typeof schema>;

export interface DbHandle {
  db: Database;
  /** Run pending migrations (idempotent). */
  migrate(): Promise<void>;
  /** Release underlying connections. */
  close(): Promise<void>;
}

/** In-process Postgres via PGlite — used for local dev and tests. */
export async function createPgliteHandle(dataDir?: string): Promise<DbHandle> {
  const { PGlite } = await import("@electric-sql/pglite");
  return createPgliteHandleFromClient(new PGlite(dataDir));
}

/**
 * Build a handle from a caller-provided PGlite instance. Useful in bundled
 * environments (e.g. Next.js) where the host app must import `@electric-sql/
 * pglite` itself so the bundler can externalize its wasm loader.
 */
export async function createPgliteHandleFromClient(client: {
  exec(sql: string): Promise<unknown>;
  close(): Promise<void>;
}): Promise<DbHandle> {
  const { drizzle } = await import("drizzle-orm/pglite");
  const db = drizzle(client as never, { schema }) as unknown as Database;
  return {
    db,
    async migrate() {
      await client.exec(INIT_SQL);
    },
    async close() {
      await client.close();
    },
  };
}

/** Managed Postgres (Supabase) via postgres-js — used in production. */
export async function createPostgresHandle(connectionString: string): Promise<DbHandle> {
  const postgres = (await import("postgres")).default;
  const { drizzle } = await import("drizzle-orm/postgres-js");
  const client = postgres(connectionString, { max: 5, prepare: false });
  const db = drizzle(client, { schema }) as unknown as Database;
  return {
    db,
    async migrate() {
      await client.unsafe(INIT_SQL);
    },
    async close() {
      await client.end({ timeout: 5 });
    },
  };
}

/**
 * Build a handle from the environment. `DATABASE_URL` selects managed
 * Postgres; otherwise an ephemeral/in-memory PGlite instance is used so the
 * stack runs with zero external dependencies.
 */
export async function createHandleFromEnv(env: NodeJS.ProcessEnv = process.env): Promise<DbHandle> {
  if (env.DATABASE_URL) return createPostgresHandle(env.DATABASE_URL);
  return createPgliteHandle(env.PGLITE_PATH);
}

/** Convenience for tests: fresh in-memory DB with the schema applied. */
export async function createTestDb(): Promise<DbHandle> {
  const handle = await createPgliteHandle();
  await handle.migrate();
  return handle;
}

/** Cheap connectivity probe for health checks. */
export async function ping(db: Database): Promise<boolean> {
  await db.execute(sql`select 1`);
  return true;
}

export { schema };
