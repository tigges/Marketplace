import { NextResponse } from "next/server";
import { getWallet, topUp } from "@appbazaar/db";
import { resolveTenant } from "@/lib/auth";
import { getDb } from "@/lib/db";
import {
  MIN_TOPUP_CREDITS,
  createTopUpCheckoutSession,
  stripeConfigured,
  usdToCredits,
} from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  const tenant = await resolveTenant();
  return NextResponse.json({ wallet: await getWallet(db, tenant.id) });
}

/**
 * Prepaid top-up.
 *
 * • When `STRIPE_SECRET_KEY` is set (production): creates a Stripe Checkout
 *   session and returns `{ checkoutUrl }`.  Stripe calls `/api/stripe/webhook`
 *   on success, which credits the wallet.
 *
 * • When Stripe is not configured (local dev / demo): grants credits directly
 *   so the registry is fully usable without payment keys.
 *
 * Body: `{ credits?: number, usdCents?: number }`
 * One of the two fields is required; `credits` takes precedence.
 */
export async function POST(req: Request) {
  const db = await getDb();
  const tenant = await resolveTenant();
  const body = await req.json().catch(() => ({}));

  let credits: number;
  if (typeof body?.credits === "number" && body.credits > 0) {
    credits = Math.floor(body.credits);
  } else if (typeof body?.usdCents === "number" && body.usdCents > 0) {
    credits = usdToCredits(body.usdCents / 100);
  } else {
    return NextResponse.json(
      { error: { code: "validation", message: "provide credits (integer > 0) or usdCents (integer > 0)" } },
      { status: 422 },
    );
  }

  if (credits <= 0 || !Number.isFinite(credits)) {
    return NextResponse.json(
      { error: { code: "validation", message: "credits must be > 0" } },
      { status: 422 },
    );
  }

  // Production path — redirect to Stripe Checkout.
  if (stripeConfigured()) {
    if (credits < MIN_TOPUP_CREDITS) {
      return NextResponse.json(
        {
          error: {
            code: "validation",
            message: `minimum top-up is ${MIN_TOPUP_CREDITS} credits ($${(MIN_TOPUP_CREDITS * 0.001).toFixed(2)})`,
          },
        },
        { status: 422 },
      );
    }
    const origin = req.headers.get("origin") ?? "http://localhost:3000";
    const checkoutUrl = await createTopUpCheckoutSession(
      tenant.id,
      credits,
      `${origin}/dashboard?topup=success`,
      `${origin}/dashboard?topup=cancelled`,
    );
    return NextResponse.json({ checkoutUrl }, { status: 202 });
  }

  // Dev / demo path — direct credit grant.
  const wallet = await topUp(db, tenant.id, credits, "dashboard-topup");
  return NextResponse.json({ wallet });
}
