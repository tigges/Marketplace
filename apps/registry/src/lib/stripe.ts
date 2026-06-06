/**
 * Stripe singleton + helpers.
 *
 * All Stripe calls are guarded by `stripeConfigured()`.  When
 * `STRIPE_SECRET_KEY` is absent (local dev) nothing breaks — callers receive
 * `null` from `getStripe()` and fall back to the in-process behaviour.
 */
import Stripe from "stripe";
import { usdToCredits, creditsToUsd } from "@appbazaar/core";

/** 1 credit = $0.001 → minimum Stripe amount is 50 cents = 50_000 credits. */
export const MIN_TOPUP_CREDITS = 50_000;

export function stripeConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY);
}

export function stripeConnectConfigured(): boolean {
  return Boolean(process.env.STRIPE_SECRET_KEY && process.env.STRIPE_CONNECT_CLIENT_ID);
}

let _stripe: Stripe | null = null;

export function getStripe(): Stripe | null {
  if (!process.env.STRIPE_SECRET_KEY) return null;
  if (!_stripe) {
    _stripe = new Stripe(process.env.STRIPE_SECRET_KEY, { apiVersion: "2026-05-27.dahlia" });
  }
  return _stripe;
}

/**
 * Create a Stripe Checkout session for a prepaid credit top-up.
 *
 * @param tenantId  Stored in session metadata so the webhook can credit the wallet.
 * @param credits   Number of credits the user is buying.
 * @param successUrl  URL Stripe redirects to after successful payment.
 * @param cancelUrl   URL Stripe redirects to on cancel.
 */
export async function createTopUpCheckoutSession(
  tenantId: string,
  credits: number,
  successUrl: string,
  cancelUrl: string,
): Promise<string> {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe is not configured (STRIPE_SECRET_KEY missing)");

  const usd = creditsToUsd(credits);
  const unitAmount = Math.round(usd * 100); // Stripe uses cents

  const session = await stripe.checkout.sessions.create({
    mode: "payment",
    payment_method_types: ["card"],
    line_items: [
      {
        price_data: {
          currency: "usd",
          product_data: {
            name: "AppBazaar Credits",
            description: `${credits.toLocaleString()} credits — $${usd.toFixed(2)} USD`,
          },
          unit_amount: unitAmount,
        },
        quantity: 1,
      },
    ],
    metadata: { tenantId, credits: String(credits) },
    success_url: successUrl,
    cancel_url: cancelUrl,
  });

  return session.url!;
}

/**
 * Initiate a Stripe Connect OAuth flow so a creator can link their Stripe account.
 */
export function connectOAuthUrl(tenantId: string, redirectUri: string): string {
  const clientId = process.env.STRIPE_CONNECT_CLIENT_ID;
  if (!clientId) throw new Error("STRIPE_CONNECT_CLIENT_ID is not configured");

  const params = new URLSearchParams({
    response_type: "code",
    client_id: clientId,
    scope: "read_write",
    redirect_uri: redirectUri,
    state: tenantId,
  });
  return `https://connect.stripe.com/oauth/authorize?${params}`;
}

/**
 * Exchange an OAuth code for a Stripe Connect account ID.
 * Returns the connected account's Stripe ID (`acct_...`).
 */
export async function exchangeConnectCode(code: string): Promise<string> {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe is not configured");

  const response = await stripe.oauth.token({ grant_type: "authorization_code", code });
  if (!response.stripe_user_id) throw new Error("Stripe OAuth response missing stripe_user_id");
  return response.stripe_user_id;
}

/**
 * Create a Stripe Connect transfer to pay out a creator.
 *
 * @param stripeAccountId  The creator's connected Stripe account (`acct_...`).
 * @param credits          Amount to pay out in credits.
 * @param payoutId         Our internal payout ID — stored as transfer metadata.
 */
export async function createConnectTransfer(
  stripeAccountId: string,
  credits: number,
  payoutId: string,
): Promise<string> {
  const stripe = getStripe();
  if (!stripe) throw new Error("Stripe is not configured");

  const usd = creditsToUsd(credits);
  const amount = Math.round(usd * 100); // cents

  const transfer = await stripe.transfers.create({
    amount,
    currency: "usd",
    destination: stripeAccountId,
    metadata: { payoutId, credits: String(credits) },
  });

  return transfer.id;
}

export { usdToCredits };
