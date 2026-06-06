/**
 * GET /api/stripe/connect/callback?code=...&state=<tenantId>
 *
 * Completes the Stripe Connect OAuth flow.  Exchanges the authorization code
 * for the connected account's Stripe ID and persists it on the tenant row.
 *
 * Stripe sends:
 *   - `code`  — one-time authorization code
 *   - `state` — the tenantId we set in the OAuth request
 */
import { redirect } from "next/navigation";
import { NextResponse } from "next/server";
import { setStripeConnectAccountId } from "@appbazaar/db";
import { getDb } from "@/lib/db";
import { exchangeConnectCode, stripeConnectConfigured } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  if (!stripeConnectConfigured()) {
    return NextResponse.json(
      { error: { code: "not_configured", message: "Stripe Connect is not configured" } },
      { status: 503 },
    );
  }

  const url = new URL(req.url);
  const code = url.searchParams.get("code");
  const tenantId = url.searchParams.get("state");

  if (!code || !tenantId) {
    return NextResponse.json(
      { error: { code: "validation", message: "missing code or state parameter" } },
      { status: 400 },
    );
  }

  const stripeAccountId = await exchangeConnectCode(code);
  const db = await getDb();
  await setStripeConnectAccountId(db, tenantId, stripeAccountId);

  redirect("/dashboard?connect=success");
}
