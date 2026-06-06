import { beforeEach, describe, expect, it } from "vitest";
import { parseManifest } from "@appbazaar/core";
import {
  type DbHandle,
  createManifest,
  createTenant,
  createTestDb,
  getEarnings,
  getWallet,
  requestPayout,
  settleCall,
  topUp,
} from "@appbazaar/db";

describe("wallet + ledger + earnings", () => {
  let handle: DbHandle;
  let consumerId: string;
  let creatorId: string;
  let manifestRow: Awaited<ReturnType<typeof createManifest>>;

  beforeEach(async () => {
    handle = await createTestDb();
    const { db } = handle;
    const creator = await createTenant(db, { name: "Creator", slug: "creator" });
    const consumer = await createTenant(db, { name: "Consumer", slug: "consumer" });
    creatorId = creator.id;
    consumerId = consumer.id;
    manifestRow = await createManifest(
      db,
      creator.id,
      parseManifest({
        slug: "paid-connector",
        name: "Paid",
        description: "paid",
        kind: "connector",
        protocol: "rest",
        connection: { mode: "direct", baseUrl: "https://x.example.com" },
        pricing: { model: "per_call", priceCredits: 100 },
        capabilities: [{ name: "do", description: "" }],
      }),
    );
  });

  it("charges successful calls and splits revenue", async () => {
    const { db } = handle;
    await topUp(db, consumerId, 1000);
    const { split } = await settleCall(db, {
      callId: "call_1",
      requesterTenantId: consumerId,
      manifest: manifestRow,
      capability: "do",
      status: "ok",
      requestBytes: 10,
      responseBytes: 20,
      durationMs: 5,
      feeBps: 1000,
    });
    expect(split.platformFeeCredits).toBe(10);
    expect(split.creatorCredits).toBe(90);
    expect((await getWallet(db, consumerId))!.balanceCredits).toBe(900);
    expect((await getEarnings(db, creatorId))!.balanceCredits).toBe(90);
  });

  it("does not charge failed calls but still logs them", async () => {
    const { db } = handle;
    await topUp(db, consumerId, 1000);
    await settleCall(db, {
      callId: "call_err",
      requesterTenantId: consumerId,
      manifest: manifestRow,
      capability: "do",
      status: "error",
      errorCode: "upstream_error",
      requestBytes: 10,
      responseBytes: 0,
      durationMs: 5,
    });
    expect((await getWallet(db, consumerId))!.balanceCredits).toBe(1000);
    expect((await getEarnings(db, creatorId))!.balanceCredits).toBe(0);
  });

  it("rejects calls when the wallet cannot cover them", async () => {
    const { db } = handle;
    await topUp(db, consumerId, 50); // < 100 price
    await expect(
      settleCall(db, {
        callId: "call_broke",
        requesterTenantId: consumerId,
        manifest: manifestRow,
        capability: "do",
        status: "ok",
        requestBytes: 1,
        responseBytes: 1,
        durationMs: 1,
      }),
    ).rejects.toMatchObject({ code: "insufficient_credits" });
    // Transaction rolled back: balance untouched.
    expect((await getWallet(db, consumerId))!.balanceCredits).toBe(50);
  });

  it("moves creator earnings into a pending payout", async () => {
    const { db } = handle;
    await topUp(db, consumerId, 1000);
    await settleCall(db, {
      callId: "call_payout",
      requesterTenantId: consumerId,
      manifest: manifestRow,
      capability: "do",
      status: "ok",
      requestBytes: 1,
      responseBytes: 1,
      durationMs: 1,
      feeBps: 1000,
    });
    const payout = await requestPayout(db, creatorId, 90);
    expect(payout.status).toBe("pending");
    expect((await getEarnings(db, creatorId))!.balanceCredits).toBe(0);
  });
});
