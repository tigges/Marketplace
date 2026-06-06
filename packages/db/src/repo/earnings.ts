import { eq } from "drizzle-orm";
import { AppError, newId } from "@appbazaar/core";
import type { Database } from "../client.js";
import { earnings } from "../schema.js";

export async function getEarnings(db: Database, tenantId: string) {
  const rows = await db.select().from(earnings).where(eq(earnings.tenantId, tenantId)).limit(1);
  return rows[0] ?? null;
}

/** Credit a creator's earnings balance (called during call settlement). */
export async function creditEarnings(db: Database, tenantId: string, credits: number) {
  if (credits < 0) throw new AppError("validation", "earnings credit must be non-negative");
  let row = await getEarnings(db, tenantId);
  if (!row) {
    const inserted = await db
      .insert(earnings)
      .values({ id: newId("ear"), tenantId })
      .returning();
    row = inserted[0]!;
  }
  const balanceCredits = row.balanceCredits + credits;
  const lifetimeCredits = row.lifetimeCredits + credits;
  await db
    .update(earnings)
    .set({ balanceCredits, lifetimeCredits, updatedAt: new Date() })
    .where(eq(earnings.id, row.id));
  return { ...row, balanceCredits, lifetimeCredits };
}
