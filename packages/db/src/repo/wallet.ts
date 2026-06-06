import { eq } from "drizzle-orm";
import { AppError, newId } from "@appbazaar/core";
import type { Database } from "../client.js";
import { walletTransactions, wallets } from "../schema.js";

export async function getWallet(db: Database, tenantId: string) {
  const rows = await db.select().from(wallets).where(eq(wallets.tenantId, tenantId)).limit(1);
  return rows[0] ?? null;
}

async function requireWallet(db: Database, tenantId: string) {
  const wallet = await getWallet(db, tenantId);
  if (!wallet) throw new AppError("not_found", `no wallet for tenant ${tenantId}`);
  return wallet;
}

/** Add prepaid credits to a wallet and record the movement. */
export async function topUp(db: Database, tenantId: string, credits: number, reference?: string) {
  if (credits <= 0) throw new AppError("validation", "top-up must be positive");
  const wallet = await requireWallet(db, tenantId);
  const balanceAfter = wallet.balanceCredits + credits;
  await db
    .update(wallets)
    .set({ balanceCredits: balanceAfter, updatedAt: new Date() })
    .where(eq(wallets.id, wallet.id));
  await db.insert(walletTransactions).values({
    id: newId("wtx"),
    walletId: wallet.id,
    kind: "topup",
    amountCredits: credits,
    balanceAfter,
    reference,
  });
  return { ...wallet, balanceCredits: balanceAfter };
}

/**
 * Debit a wallet, raising `insufficient_credits` if the balance is too low.
 * Designed to be called inside an outer transaction (pass `tx`).
 */
export async function debit(db: Database, tenantId: string, credits: number, reference?: string) {
  if (credits < 0) throw new AppError("validation", "debit must be non-negative");
  const wallet = await requireWallet(db, tenantId);
  if (wallet.balanceCredits < credits) {
    throw new AppError("insufficient_credits", "wallet balance too low", {
      balanceCredits: wallet.balanceCredits,
      requiredCredits: credits,
    });
  }
  const balanceAfter = wallet.balanceCredits - credits;
  await db
    .update(wallets)
    .set({ balanceCredits: balanceAfter, updatedAt: new Date() })
    .where(eq(wallets.id, wallet.id));
  if (credits > 0) {
    await db.insert(walletTransactions).values({
      id: newId("wtx"),
      walletId: wallet.id,
      kind: "debit",
      amountCredits: -credits,
      balanceAfter,
      reference,
    });
  }
  return { ...wallet, balanceCredits: balanceAfter };
}

export async function listWalletTransactions(db: Database, tenantId: string, limit = 50) {
  const wallet = await getWallet(db, tenantId);
  if (!wallet) return [];
  return db
    .select()
    .from(walletTransactions)
    .where(eq(walletTransactions.walletId, wallet.id))
    .limit(limit);
}
