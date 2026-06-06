import { desc, eq } from "drizzle-orm";
import { newId } from "@appbazaar/core";
import type { Database } from "../client.js";
import { usageLedger } from "../schema.js";

export interface UsageRecord {
  callId: string;
  requesterTenantId: string;
  manifestId: string;
  creatorTenantId: string;
  capability: string;
  status: "ok" | "error";
  errorCode?: string;
  requestBytes: number;
  responseBytes: number;
  durationMs: number;
  grossCredits: number;
  platformFeeCredits: number;
  creatorCredits: number;
  feeBps: number;
}

/**
 * Persist call metadata. NOTE: this records byte counts and timing only —
 * never payloads — which is what keeps routing non-custodial.
 */
export async function recordUsage(db: Database, rec: UsageRecord) {
  const [row] = await db
    .insert(usageLedger)
    .values({ id: newId("use"), ...rec })
    .returning();
  return row!;
}

export async function listUsageForRequester(db: Database, tenantId: string, limit = 100) {
  return db
    .select()
    .from(usageLedger)
    .where(eq(usageLedger.requesterTenantId, tenantId))
    .orderBy(desc(usageLedger.createdAt))
    .limit(limit);
}

export async function listUsageForCreator(db: Database, tenantId: string, limit = 100) {
  return db
    .select()
    .from(usageLedger)
    .where(eq(usageLedger.creatorTenantId, tenantId))
    .orderBy(desc(usageLedger.createdAt))
    .limit(limit);
}
