import { cookies } from "next/headers";
import { type Tenant, createTenant, getTenantByClerkRef, getTenantBySlug } from "@appbazaar/db";
import { getDb } from "./db";

/**
 * Human (creator/consumer) identity.
 *
 * When `NEXT_PUBLIC_SUPABASE_URL` is set the signed-in Supabase user is mapped
 * to a tenant (auto-provisioned on first login). The tenant's `clerkRef` column
 * stores the Supabase `user.id` — the column is just a generic external-id
 * field regardless of the provider name.
 *
 * Without Supabase configured (local dev) we fall back to an `ab_tenant`
 * cookie defaulting to the seeded `acme-labs` tenant so the registry is
 * fully usable out of the box.
 */
const DEFAULT_TENANT = { slug: "acme-labs", name: "Acme Labs" };

export async function resolveTenant(): Promise<Tenant> {
  const db = await getDb();

  if (supabaseConfigured()) {
    const { createClient } = await import("@/utils/supabase/server");
    const cookieStore = cookies();
    const supabase = createClient(cookieStore);
    const {
      data: { user },
    } = await supabase.auth.getUser();

    if (user) {
      // Fast path: existing tenant for this Supabase user.
      const existing = await getTenantByClerkRef(db, user.id);
      if (existing) return existing;

      // First login — derive a unique slug and provision the tenant.
      const emailUser = user.email?.split("@")[0]?.replace(/[^a-z0-9]+/gi, "-").toLowerCase();
      const slug = `${emailUser ?? "user"}-${user.id.slice(0, 6)}`;
      return createTenant(db, {
        slug,
        name: user.email ?? slug,
        clerkRef: user.id,
      });
    }
  }

  // Dev fallback: cookie-based tenant switching.
  const slug = cookies().get("ab_tenant")?.value ?? DEFAULT_TENANT.slug;
  const existing = await getTenantBySlug(db, slug);
  if (existing) return existing;
  return createTenant(db, {
    slug,
    name: slug === DEFAULT_TENANT.slug ? DEFAULT_TENANT.name : slug,
  });
}

/** True when Supabase Auth is configured (production). */
export function supabaseConfigured(): boolean {
  return Boolean(
    process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  );
}

/** @deprecated Use supabaseConfigured(). Kept for backward compat. */
export function clerkConfigured(): boolean {
  return Boolean(process.env.CLERK_SECRET_KEY);
}
