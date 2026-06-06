/**
 * POST /api/payouts/[id]/settle
 *
 * Platform-side operation: creates a Stripe Connect transfer for a pending
 * payout and marks it as paid in the database.  Must be called by someone
 * with the platform's Stripe credentials (i.e., an admin action).
 *
 * Requires: STRIPE_SECRET_KEY
 * The creator must have completed Stripe Connect onboarding
 * (tenant.stripeConnectAccountId must be set).
 */
import { NextResponse } from "next/server";
import { isAppError } from "@appbazaar/core";
import { getTenant, getPayoutById, markPayoutPaid } from "@appbazaar/db";
import { getDb } from "@/lib/db";
import { createConnectTransfer, stripeConfigured } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(_req: Request, { params }: { params: { id: string } }) {
  if (!stripeConfigured()) {
    return NextResponse.json(
      { error: { code: "not_configured", message: "Stripe is not configured" } },
      { status: 503 },
    );
  }

  const db = await getDb();
  const payout = await getPayoutById(db, params.id);

  if (!payout) {
    return NextResponse.json({ error: { code: "not_found", message: "payout not found" } }, { status: 404 });
  }

  if (payout.status !== "pending") {
    return NextResponse.json(
      { error: { code: "validation", message: `payout is already ${payout.status}` } },
      { status: 422 },
    );
  }

  const tenant = await getTenant(db, payout.tenantId);
  if (!tenant?.stripeConnectAccountId) {
    return NextResponse.json(
      { error: { code: "validation", message: "creator has not completed Stripe Connect onboarding" } },
      { status: 422 },
    );
  }

  try {
    const transferId = await createConnectTransfer(
      tenant.stripeConnectAccountId,
      payout.amountCredits,
      payout.id,
    );
    const updated = await markPayoutPaid(db, payout.id, transferId);
    return NextResponse.json({ payout: updated });
  } catch (err) {
    if (isAppError(err)) return NextResponse.json(err.toJSON(), { status: err.status });
    throw err;
  }
}
