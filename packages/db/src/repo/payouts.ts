import { desc, eq } from "drizzle-orm";
import { AppError, newId } from "@appbazaar/core";
import type { Database } from "../client.js";
import { earnings, payouts } from "../schema.js";
import { getEarnings } from "./earnings.js";

/**
 * Move a creator's available earnings into a pending payout. Settlement
 * itself is manual via Stripe Connect in the MVP — see
 * `@appbazaar/registry` billing routes for the transfer call.
 */
export async function requestPayout(db: Database, tenantId: string, amountCredits: number) {
  const bal = await getEarnings(db, tenantId);
  if (!bal || bal.balanceCredits < amountCredits || amountCredits <= 0) {
    throw new AppError("validation", "payout amount exceeds available earnings", {
      available: bal?.balanceCredits ?? 0,
      requested: amountCredits,
    });
  }
  return db.transaction(async (tx) => {
    const txdb = tx as unknown as Database;
    await txdb
      .update(earnings)
      .set({ balanceCredits: bal.balanceCredits - amountCredits, updatedAt: new Date() })
      .where(eq(earnings.id, bal.id));
    const [row] = await txdb
      .insert(payouts)
      .values({ id: newId("pay"), tenantId, amountCredits, status: "pending" })
      .returning();
    return row!;
  });
}

export async function markPayoutPaid(db: Database, payoutId: string, stripeTransferId: string) {
  const [row] = await db
    .update(payouts)
    .set({ status: "paid", stripeTransferId })
    .where(eq(payouts.id, payoutId))
    .returning();
  if (!row) return null;
  const bal = await getEarnings(db, row.tenantId);
  if (bal) {
    await db
      .update(earnings)
      .set({ paidOutCredits: bal.paidOutCredits + row.amountCredits, updatedAt: new Date() })
      .where(eq(earnings.id, bal.id));
  }
  return row;
}

export async function listPayouts(db: Database, tenantId: string) {
  return db
    .select()
    .from(payouts)
    .where(eq(payouts.tenantId, tenantId))
    .orderBy(desc(payouts.createdAt));
}
