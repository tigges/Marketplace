/**
 * GET /api/stripe/connect
 *
 * Initiates Stripe Connect OAuth.  Redirects the signed-in creator to the
 * Stripe hosted onboarding page.  After completion Stripe redirects back to
 * `/api/stripe/connect/callback`.
 *
 * Requires: STRIPE_SECRET_KEY + STRIPE_CONNECT_CLIENT_ID
 */
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { resolveTenant } from "@/lib/auth";
import { connectOAuthUrl, stripeConnectConfigured } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!stripeConnectConfigured()) {
    return NextResponse.json(
      { error: { code: "not_configured", message: "Stripe Connect is not configured" } },
      { status: 503 },
    );
  }
  const tenant = await resolveTenant();
  const origin = new URL(req.url).origin;
  const redirectUri = `${origin}/api/stripe/connect/callback`;
  const url = connectOAuthUrl(tenant.id, redirectUri);
  redirect(url);
}
