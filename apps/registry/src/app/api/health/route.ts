import { NextResponse } from "next/server";
import { ping } from "@appbazaar/db";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  const dbUrl = process.env.DATABASE_URL ?? "";
  const usingPostgres = dbUrl.startsWith("postgresql://") || dbUrl.startsWith("postgres://");
  const db = await getDb();
  let ok = false;
  let dbError: string | undefined;
  try {
    ok = await ping(db);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }
  return NextResponse.json({
    ok,
    service: "appbazaar-registry",
    db: usingPostgres ? "postgres" : "pglite",
    ...(dbError ? { dbError } : {}),
  });
}
