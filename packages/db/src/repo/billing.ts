import { AppError, computeSplit } from "@appbazaar/core";
import type { Database } from "../client.js";
import { creditEarnings } from "./earnings.js";
import { recordUsage } from "./ledger.js";
import type { ManifestRow } from "../schema.js";
import { debit, getWallet } from "./wallet.js";

/** Just the manifest fields billing actually needs. */
export type BillableManifest = Pick<
  ManifestRow,
  "id" | "ownerTenantId" | "pricingModel" | "priceCredits"
>;

export interface SettleCallInput {
  callId: string;
  requesterTenantId: string;
  manifest: BillableManifest;
  capability: string;
  status: "ok" | "error";
  errorCode?: string;
  requestBytes: number;
  responseBytes: number;
  durationMs: number;
  feeBps?: number;
}

/**
 * Pre-flight check used before a call is routed, so we never start work the
 * caller can't pay for. Free manifests always pass.
 */
export async function assertSufficientCredits(db: Database, tenantId: string, manifest: BillableManifest) {
  if (manifest.pricingModel === "free" || manifest.priceCredits <= 0) return;
  const wallet = await getWallet(db, tenantId);
  if (!wallet || wallet.balanceCredits < manifest.priceCredits) {
    throw new AppError("insufficient_credits", "wallet balance too low for this call", {
      balanceCredits: wallet?.balanceCredits ?? 0,
      requiredCredits: manifest.priceCredits,
    });
  }
}

/**
 * Settle a completed call: charge the caller (successful, paid calls only),
 * split revenue to the creator, and append the usage-ledger row — all in one
 * transaction. Errors are logged but never charged.
 */
export async function settleCall(db: Database, input: SettleCallInput) {
  const paid = input.status === "ok" && input.manifest.pricingModel === "per_call" && input.manifest.priceCredits > 0;
  const gross = paid ? input.manifest.priceCredits : 0;
  const split = computeSplit(gross, input.feeBps);

  return db.transaction(async (tx) => {
    const txdb = tx as unknown as Database;
    if (gross > 0) {
      await debit(txdb, input.requesterTenantId, gross, `call:${input.callId}`);
      await creditEarnings(txdb, input.manifest.ownerTenantId, split.creatorCredits);
    }
    const ledgerRow = await recordUsage(txdb, {
      callId: input.callId,
      requesterTenantId: input.requesterTenantId,
      manifestId: input.manifest.id,
      creatorTenantId: input.manifest.ownerTenantId,
      capability: input.capability,
      status: input.status,
      errorCode: input.errorCode,
      requestBytes: input.requestBytes,
      responseBytes: input.responseBytes,
      durationMs: input.durationMs,
      grossCredits: split.grossCredits,
      platformFeeCredits: split.platformFeeCredits,
      creatorCredits: split.creatorCredits,
      feeBps: split.feeBps,
    });
    return { ledger: ledgerRow, split };
  });
}
