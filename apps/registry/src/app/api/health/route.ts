import { NextResponse } from "next/server";
import { ping } from "@appbazaar/db";
import { getDb, getDbDriver } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET() {
  let ok = false;
  let dbError: string | undefined;
  let driver: "postgres" | "pglite" = "pglite";
  try {
    const [db, resolvedDriver] = await Promise.all([getDb(), getDbDriver()]);
    driver = resolvedDriver;
    ok = await ping(db);
  } catch (err) {
    dbError = err instanceof Error ? err.message : String(err);
  }
  return NextResponse.json({
    ok,
    service: "appbazaar-registry",
    db: driver,
    ...(dbError ? { dbError } : {}),
  });
}
