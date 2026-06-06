import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import type { PgDatabase, PgQueryResultHKT } from "drizzle-orm/pg-core";
import { sql } from "drizzle-orm";
import * as schema from "./schema.js";

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

function migrationSql(): string {
  const here = dirname(fileURLToPath(import.meta.url));
  return readFileSync(join(here, "migrations", "0000_init.sql"), "utf8");
}

/** In-process Postgres via PGlite — used for local dev and tests. */
export async function createPgliteHandle(dataDir?: string): Promise<DbHandle> {
  const { PGlite } = await import("@electric-sql/pglite");
  const { drizzle } = await import("drizzle-orm/pglite");
  const client = new PGlite(dataDir);
  const db = drizzle(client, { schema }) as unknown as Database;
  return {
    db,
    async migrate() {
      await client.exec(migrationSql());
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
      await client.unsafe(migrationSql());
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
