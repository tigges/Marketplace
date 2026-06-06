import { NextResponse } from "next/server";
import { safeParseManifest, validateManifestSemantics } from "@appbazaar/core";
import { createManifest, getManifestBySlug, listManifests } from "@appbazaar/db";
import { resolveTenant } from "@/lib/auth";
import { getDb } from "@/lib/db";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

export async function GET(req: Request) {
  const db = await getDb();
  const url = new URL(req.url);
  const rows = await listManifests(db, {
    q: url.searchParams.get("q") ?? undefined,
    kind: url.searchParams.get("kind") ?? undefined,
    protocol: url.searchParams.get("protocol") ?? undefined,
    connectionMode: url.searchParams.get("mode") ?? undefined,
    tag: url.searchParams.get("tag") ?? undefined,
  });
  return NextResponse.json({ listings: rows });
}

export async function POST(req: Request) {
  const db = await getDb();
  const tenant = await resolveTenant();
  const body = await req.json().catch(() => null);

  const parsed = safeParseManifest(body);
  if (!parsed.success) {
    return NextResponse.json(
      { error: { code: "validation", message: "invalid manifest", details: parsed.error.flatten() } },
      { status: 422 },
    );
  }
  const semanticIssues = validateManifestSemantics(parsed.data);
  if (semanticIssues.length) {
    return NextResponse.json(
      { error: { code: "validation", message: semanticIssues.join("; ") } },
      { status: 422 },
    );
  }
  if (await getManifestBySlug(db, parsed.data.slug)) {
    return NextResponse.json(
      { error: { code: "validation", message: `slug '${parsed.data.slug}' is already taken` } },
      { status: 409 },
    );
  }

  const row = await createManifest(db, tenant.id, parsed.data);
  return NextResponse.json({ id: row.id, slug: row.slug }, { status: 201 });
}
