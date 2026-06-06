import { NextResponse } from "next/server";
import { isAppError } from "@appbazaar/core";
import { getEarnings, listPayouts, requestPayout } from "@appbazaar/db";
import { resolveTenant } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  const tenant = await resolveTenant();
  return NextResponse.json({
    earnings: await getEarnings(db, tenant.id),
    payouts: await listPayouts(db, tenant.id),
  });
}

/** Request a manual Stripe Connect payout of available creator earnings. */
export async function POST(req: Request) {
  const db = await getDb();
  const tenant = await resolveTenant();
  const body = await req.json().catch(() => ({}));
  const amount = Number(body?.amountCredits ?? 0);
  try {
    const payout = await requestPayout(db, tenant.id, Math.floor(amount));
    return NextResponse.json({ payout }, { status: 201 });
  } catch (err) {
    if (isAppError(err)) return NextResponse.json(err.toJSON(), { status: err.status });
    throw err;
  }
}
