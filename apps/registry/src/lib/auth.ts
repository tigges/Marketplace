import { cookies } from "next/headers";
import { type Tenant, createTenant, getTenantBySlug } from "@appbazaar/db";
import { getDb } from "./db";

/**
 * Human (creator/consumer) identity.
 *
 * Production: replace the body of {@link resolveTenant} with Clerk —
 * `const { userId, orgId } = auth()` from `@clerk/nextjs/server`, then map the
 * Clerk principal to a tenant via `getTenantByClerkRef`. The rest of the app
 * is written against the tenant abstraction, so swapping in Clerk is local to
 * this file.
 *
 * Dev (no Clerk keys): we use an `ab_tenant` cookie, defaulting to the seeded
 * `acme-labs` tenant, so the registry is fully usable out of the box.
 */
const DEFAULT_TENANT = { slug: "acme-labs", name: "Acme Labs" };

export async function resolveTenant(): Promise<Tenant> {
  const db = await getDb();
  const slug = cookies().get("ab_tenant")?.value ?? DEFAULT_TENANT.slug;
  const existing = await getTenantBySlug(db, slug);
  if (existing) return existing;
  // First run with a custom slug — provision it.
  return createTenant(db, { slug, name: slug === DEFAULT_TENANT.slug ? DEFAULT_TENANT.name : slug });
}

export function clerkConfigured(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY);
}
