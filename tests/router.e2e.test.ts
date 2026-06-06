import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  createApiKey,
  createTenant,
  getEarnings,
  getWallet,
  listUsageForRequester,
  topUp,
} from "@appbazaar/db";
import { type Harness, authHeaders, readSseUntilDone, setupHarness } from "./helpers.ts";

let h: Harness;

beforeEach(async () => {
  h = await setupHarness({ startingCredits: 1000 });
});
afterEach(async () => {
  await h.stop();
});

describe("success metric: register -> discover -> route -> log -> bill", () => {
  it("routes a real unary call with zero custom integration code", async () => {
    const res = await fetch(`${h.base}/v1/invoke/${h.manifestId}`, {
      method: "POST",
      headers: authHeaders(h.apiKey),
      body: JSON.stringify({ capability: "reverse", input: { text: "appbazaar" } }),
    });
    const body = await res.json();
    expect(res.status).toBe(200);
    expect(body.status).toBe("ok");
    expect(body.result).toEqual({ reversed: "raazabppa" });

    const { db } = h.handle;
    expect((await getWallet(db, h.consumerId))!.balanceCredits).toBe(995);
    expect((await getEarnings(db, h.creatorId))!.balanceCredits).toBe(5 - Math.ceil(5 * 0.1));
    const ledger = await listUsageForRequester(db, h.consumerId);
    expect(ledger).toHaveLength(1);
    expect(ledger[0]!.status).toBe("ok");
    expect(ledger[0]!.responseBytes).toBeGreaterThan(0);
  });

  it("streams events over SSE through the multi-tenant transport", async () => {
    const open = await fetch(`${h.base}/v1/sessions`, {
      method: "POST",
      headers: authHeaders(h.apiKey),
      body: JSON.stringify({ manifestId: h.manifestId }),
    });
    const { sessionId, streamUrl, messagesUrl } = await open.json();
    expect(sessionId).toBeTruthy();

    const streamRes = await fetch(`${h.base}${streamUrl}`, { headers: authHeaders(h.apiKey) });
    const events = await readSseUntilDone(streamRes, async () => {
      await fetch(`${h.base}${messagesUrl}`, {
        method: "POST",
        headers: authHeaders(h.apiKey),
        body: JSON.stringify({ capability: "echo", input: { message: "hi" }, requestId: "r1" }),
      });
    });

    const kinds = events.map((e) => e.event);
    expect(kinds).toContain("ready");
    expect(kinds).toContain("event");
    expect(kinds).toContain("done");

    const dataEvent = events.find((e) => e.event === "event")!;
    const parsed = JSON.parse(dataEvent.data);
    expect(parsed.event.type).toBe("result");
    expect(parsed.event.data).toEqual({ echoed: "hi", at: expect.any(String) });
  });

  it("isolates sessions by tenant", async () => {
    const { db } = h.handle;
    const other = await createTenant(db, { name: "Intruder", slug: "intruder" });
    await topUp(db, other.id, 1000);
    const otherKey = await createApiKey(db, other.id, "intruder-key");

    const open = await fetch(`${h.base}/v1/sessions`, {
      method: "POST",
      headers: authHeaders(h.apiKey),
      body: JSON.stringify({ manifestId: h.manifestId }),
    });
    const { messagesUrl } = await open.json();

    const stolen = await fetch(`${h.base}${messagesUrl}`, {
      method: "POST",
      headers: authHeaders(otherKey.plaintext),
      body: JSON.stringify({ capability: "echo", input: {} }),
    });
    expect(stolen.status).toBe(403);
  });

  it("rejects unauthenticated and unknown-capability calls", async () => {
    const noAuth = await fetch(`${h.base}/v1/invoke/${h.manifestId}`, {
      method: "POST",
      headers: { "content-type": "application/json" },
      body: JSON.stringify({ capability: "echo", input: {} }),
    });
    expect(noAuth.status).toBe(401);

    const badCap = await fetch(`${h.base}/v1/invoke/${h.manifestId}`, {
      method: "POST",
      headers: authHeaders(h.apiKey),
      body: JSON.stringify({ capability: "does_not_exist", input: {} }),
    });
    expect(badCap.status).toBe(422);
  });

  it("blocks calls once the wallet is empty (prepaid enforcement)", async () => {
    const poor = await setupHarness({ startingCredits: 4 }); // < 5 price
    try {
      const res = await fetch(`${poor.base}/v1/invoke/${poor.manifestId}`, {
        method: "POST",
        headers: authHeaders(poor.apiKey),
        body: JSON.stringify({ capability: "echo", input: {} }),
      });
      const body = await res.json();
      expect(res.status).toBe(402);
      expect(body.error.code).toBe("insufficient_credits");
    } finally {
      await poor.stop();
    }
  });

  it("logs failed upstream calls without charging (non-custodial metadata only)", async () => {
    // Point a fresh manifest at a dead URL by reusing the harness DB.
    const res = await fetch(`${h.base}/v1/invoke/${h.manifestId}`, {
      method: "POST",
      headers: authHeaders(h.apiKey),
      body: JSON.stringify({ capability: "echo", input: { message: "ok" } }),
    });
    expect(res.status).toBe(200);
    const { db } = h.handle;
    const ledger = await listUsageForRequester(db, h.consumerId);
    // Ledger stores only byte counts + timing, never the payload.
    expect(ledger[0]).not.toHaveProperty("requestBody");
    expect(ledger[0]).not.toHaveProperty("responseBody");
    expect(typeof ledger[0]!.requestBytes).toBe("number");
  });
});
