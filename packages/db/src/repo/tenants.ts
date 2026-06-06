import { eq } from "drizzle-orm";
import { newId } from "@appbazaar/core";
import type { Database } from "../client.js";
import { earnings, tenants, wallets } from "../schema.js";

export interface CreateTenantInput {
  name: string;
  slug: string;
  clerkRef?: string;
}

/** Create a tenant and provision its wallet + earnings rows atomically. */
export async function createTenant(db: Database, input: CreateTenantInput) {
  const id = newId("tn");
  const [tenant] = await db
    .insert(tenants)
    .values({ id, name: input.name, slug: input.slug, clerkRef: input.clerkRef })
    .returning();
  await db.insert(wallets).values({ id: newId("wal"), tenantId: id, balanceCredits: 0 });
  await db.insert(earnings).values({ id: newId("ear"), tenantId: id });
  return tenant!;
}

export async function getTenant(db: Database, id: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.id, id)).limit(1);
  return rows[0] ?? null;
}

export async function getTenantBySlug(db: Database, slug: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.slug, slug)).limit(1);
  return rows[0] ?? null;
}

export async function getTenantByClerkRef(db: Database, clerkRef: string) {
  const rows = await db.select().from(tenants).where(eq(tenants.clerkRef, clerkRef)).limit(1);
  return rows[0] ?? null;
}

/** Persist the Stripe Connect account ID once the creator completes OAuth. */
export async function setStripeConnectAccountId(db: Database, tenantId: string, stripeAccountId: string) {
  const [row] = await db
    .update(tenants)
    .set({ stripeConnectAccountId: stripeAccountId })
    .where(eq(tenants.id, tenantId))
    .returning();
  return row ?? null;
}
