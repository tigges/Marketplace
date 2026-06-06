import { NextResponse } from "next/server";
import { createApiKey, listApiKeys } from "@appbazaar/db";
import { resolveTenant } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const db = await getDb();
  const tenant = await resolveTenant();
  return NextResponse.json({ keys: await listApiKeys(db, tenant.id) });
}

export async function POST(req: Request) {
  const db = await getDb();
  const tenant = await resolveTenant();
  const body = await req.json().catch(() => ({}));
  const name = typeof body?.name === "string" && body.name.trim() ? body.name.trim() : "agent-key";
  const issued = await createApiKey(db, tenant.id, name);
  // The plaintext key is returned exactly once.
  return NextResponse.json(issued, { status: 201 });
}
