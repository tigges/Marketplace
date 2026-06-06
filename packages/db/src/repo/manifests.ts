import { and, desc, eq, ilike, or, sql } from "drizzle-orm";
import { type Manifest, callPriceCredits, newId } from "@appbazaar/core";
import type { Database } from "../client.js";
import { manifests } from "../schema.js";

export async function createManifest(db: Database, ownerTenantId: string, m: Manifest) {
  const id = newId("mfst");
  const [row] = await db
    .insert(manifests)
    .values({
      id,
      ownerTenantId,
      slug: m.slug,
      name: m.name,
      description: m.description,
      kind: m.kind,
      protocol: m.protocol,
      connectionMode: m.connection.mode,
      connection: m.connection,
      pricingModel: m.pricing.model,
      priceCredits: callPriceCredits(m.pricing),
      capabilities: m.capabilities,
      tags: m.tags ?? [],
      homepage: m.homepage,
      status: "published",
    })
    .returning();
  return row!;
}

export async function getManifestById(db: Database, id: string) {
  const rows = await db.select().from(manifests).where(eq(manifests.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getManifestBySlug(db: Database, slug: string) {
  const rows = await db.select().from(manifests).where(eq(manifests.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export interface ListManifestsQuery {
  q?: string;
  kind?: string;
  protocol?: string;
  connectionMode?: string;
  tag?: string;
  limit?: number;
  offset?: number;
}

export async function listManifests(db: Database, query: ListManifestsQuery = {}) {
  const filters = [eq(manifests.status, "published")];
  if (query.kind) filters.push(eq(manifests.kind, query.kind));
  if (query.protocol) filters.push(eq(manifests.protocol, query.protocol));
  if (query.connectionMode) filters.push(eq(manifests.connectionMode, query.connectionMode));
  if (query.tag) filters.push(sql`${manifests.tags} @> ${JSON.stringify([query.tag])}::jsonb`);
  if (query.q) {
    const like = `%${query.q}%`;
    filters.push(or(ilike(manifests.name, like), ilike(manifests.description, like))!);
  }

  return db
    .select()
    .from(manifests)
    .where(and(...filters))
    .orderBy(desc(manifests.createdAt))
    .limit(Math.min(query.limit ?? 50, 100))
    .offset(query.offset ?? 0);
}

export async function listManifestsByOwner(db: Database, ownerTenantId: string) {
  return db
    .select()
    .from(manifests)
    .where(eq(manifests.ownerTenantId, ownerTenantId))
    .orderBy(desc(manifests.createdAt));
}

export async function setManifestStatus(db: Database, id: string, status: string) {
  const [row] = await db
    .update(manifests)
    .set({ status, updatedAt: new Date() })
    .where(eq(manifests.id, id))
    .returning();
  return row ?? null;
}
