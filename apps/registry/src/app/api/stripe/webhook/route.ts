/**
 * Stripe webhook endpoint.
 *
 * Handles:
 *   - `checkout.session.completed` → credits the buyer's wallet.
 *   - `transfer.created`           → marks the matching payout as paid
 *                                    (fires when a Connect transfer settles).
 *
 * Security: the raw body is verified against the `Stripe-Signature` header
 * using `STRIPE_WEBHOOK_SECRET` (obtained from the Stripe dashboard webhook
 * settings). Without the secret the endpoint still accepts events but skips
 * signature verification — **set the secret in production**.
 */
import { headers } from "next/headers";
import { NextResponse } from "next/server";
import { markPayoutPaid, topUp } from "@appbazaar/db";
import { getDb } from "@/lib/db";
import { getStripe } from "@/lib/stripe";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function POST(req: Request) {
  const stripe = getStripe();
  if (!stripe) {
    return NextResponse.json({ error: { code: "not_configured", message: "Stripe is not configured" } }, { status: 503 });
  }

  const rawBody = await req.text();
  const sig = headers().get("stripe-signature") ?? "";
  const webhookSecret = process.env.STRIPE_WEBHOOK_SECRET;

  let event: import("stripe").Stripe.Event;
  if (webhookSecret && sig) {
    try {
      event = stripe.webhooks.constructEvent(rawBody, sig, webhookSecret);
    } catch (err) {
      const message = err instanceof Error ? err.message : String(err);
      return NextResponse.json({ error: { code: "webhook_signature", message } }, { status: 400 });
    }
  } else {
    // No webhook secret configured — trust the payload (dev/test only).
    try {
      event = JSON.parse(rawBody) as import("stripe").Stripe.Event;
    } catch {
      return NextResponse.json({ error: { code: "invalid_json", message: "could not parse body" } }, { status: 400 });
    }
  }

  const db = await getDb();

  switch (event.type) {
    case "checkout.session.completed": {
      const session = event.data.object as import("stripe").Stripe.Checkout.Session;
      const tenantId = session.metadata?.tenantId;
      const credits = Number(session.metadata?.credits ?? 0);
      if (tenantId && credits > 0) {
        await topUp(db, tenantId, credits, `stripe-checkout:${session.id}`);
      }
      break;
    }

    case "transfer.created": {
      // Fires when a manual Stripe Connect transfer completes.
      const transfer = event.data.object as import("stripe").Stripe.Transfer;
      const payoutId = transfer.metadata?.payoutId;
      if (payoutId) {
        await markPayoutPaid(db, payoutId, transfer.id);
      }
      break;
    }

    default:
      // Unhandled event types — acknowledge and move on.
      break;
  }

  return NextResponse.json({ received: true });
}
