import { NextResponse } from "next/server";
import { getWallet, topUp } from "@appbazaar/db";
import { resolveTenant } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  const tenant = await resolveTenant();
  return NextResponse.json({ wallet: await getWallet(db, tenant.id) });
}

/** Prepaid top-up. In production this is a Stripe Checkout webhook; here it's
 * a direct credit grant for demo/testing. */
export async function POST(req: Request) {
  const db = await getDb();
  const tenant = await resolveTenant();
  const body = await req.json().catch(() => ({}));
  const credits = Number(body?.credits ?? 0);
  if (!Number.isFinite(credits) || credits <= 0) {
    return NextResponse.json({ error: { code: "validation", message: "credits must be > 0" } }, { status: 422 });
  }
  const wallet = await topUp(db, tenant.id, Math.floor(credits), "dashboard-topup");
  return NextResponse.json({ wallet });
}
