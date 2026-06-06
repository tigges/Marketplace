import { NextResponse } from "next/server";
import { ping } from "@appbazaar/db";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  const ok = await ping(db).catch(() => false);
  return NextResponse.json({ ok, service: "appbazaar-registry" });
}
