import { and, eq, isNull } from "drizzle-orm";
import { generateApiKey, hashApiKey, newId } from "@appbazaar/core";
import type { Database } from "../client.js";
import { apiKeys, tenants } from "../schema.js";

export interface IssuedApiKey {
  id: string;
  name: string;
  displayPrefix: string;
  /** Full secret — returned exactly once at creation time. */
  plaintext: string;
  createdAt: Date;
}

export async function createApiKey(
  db: Database,
  tenantId: string,
  name: string,
  env: "live" | "test" = "live",
): Promise<IssuedApiKey> {
  const key = await generateApiKey(env);
  const id = newId("key");
  const [row] = await db
    .insert(apiKeys)
    .values({ id, tenantId, name, displayPrefix: key.displayPrefix, hash: key.hash })
    .returning();
  return {
    id: row!.id,
    name: row!.name,
    displayPrefix: row!.displayPrefix,
    plaintext: key.plaintext,
    createdAt: row!.createdAt,
  };
}

export interface ResolvedKey {
  keyId: string;
  tenantId: string;
  tenantSlug: string;
  tenantName: string;
}

/**
 * Verify a presented API key. Returns the owning tenant or null. Updates
 * `last_used_at` opportunistically. Lookup is by hash (unique, indexed).
 */
export async function verifyApiKey(db: Database, plaintext: string): Promise<ResolvedKey | null> {
  if (!plaintext.startsWith("ab_")) return null;
  const hash = await hashApiKey(plaintext);
  const rows = await db
    .select({
      keyId: apiKeys.id,
      tenantId: tenants.id,
      tenantSlug: tenants.slug,
      tenantName: tenants.name,
    })
    .from(apiKeys)
    .innerJoin(tenants, eq(apiKeys.tenantId, tenants.id))
    .where(and(eq(apiKeys.hash, hash), isNull(apiKeys.revokedAt)))
    .limit(1);
  const found = rows[0];
  if (!found) return null;
  await db.update(apiKeys).set({ lastUsedAt: new Date() }).where(eq(apiKeys.id, found.keyId));
  return found;
}

export async function listApiKeys(db: Database, tenantId: string) {
  return db
    .select({
      id: apiKeys.id,
      name: apiKeys.name,
      displayPrefix: apiKeys.displayPrefix,
      lastUsedAt: apiKeys.lastUsedAt,
      revokedAt: apiKeys.revokedAt,
      createdAt: apiKeys.createdAt,
    })
    .from(apiKeys)
    .where(eq(apiKeys.tenantId, tenantId));
}

export async function revokeApiKey(db: Database, tenantId: string, keyId: string) {
  const [row] = await db
    .update(apiKeys)
    .set({ revokedAt: new Date() })
    .where(and(eq(apiKeys.id, keyId), eq(apiKeys.tenantId, tenantId)))
    .returning();
  return row ?? null;
}
