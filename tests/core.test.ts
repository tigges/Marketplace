import { describe, expect, it } from "vitest";
import {
  callPriceCredits,
  clampFeeBps,
  computeSplit,
  generateApiKey,
  hashApiKey,
  parseManifest,
  safeParseManifest,
  validateManifestSemantics,
} from "@appbazaar/core";

describe("manifest schema (protocol-agnostic)", () => {
  const valid = {
    slug: "acme-weather",
    name: "Acme Weather",
    description: "weather data",
    kind: "connector",
    protocol: "rest",
    connection: { mode: "direct", baseUrl: "https://api.example.com" },
    pricing: { model: "per_call", priceCredits: 25 },
    capabilities: [{ name: "current", description: "now" }],
  };

  it("parses a valid direct REST manifest", () => {
    const m = parseManifest(valid);
    expect(m.protocol).toBe("rest");
    expect(m.connection.mode).toBe("direct");
    expect(callPriceCredits(m.pricing)).toBe(25);
  });

  it("accepts tunnel connectors today (wave-2 ready)", () => {
    const m = parseManifest({
      ...valid,
      slug: "crm-bridge",
      protocol: "mcp",
      connection: { mode: "tunnel", tunnelId: "crm-bridge-01" },
      pricing: { model: "free" },
    });
    expect(m.connection.mode).toBe("tunnel");
    expect(callPriceCredits(m.pricing)).toBe(0);
  });

  it("rejects bad slugs and empty capabilities", () => {
    expect(safeParseManifest({ ...valid, slug: "Bad Slug" }).success).toBe(false);
    expect(safeParseManifest({ ...valid, capabilities: [] }).success).toBe(false);
  });

  it("flags duplicate capability names", () => {
    const m = parseManifest({
      ...valid,
      capabilities: [
        { name: "dup", description: "" },
        { name: "dup", description: "" },
      ],
    });
    expect(validateManifestSemantics(m)).toContain("duplicate capability: dup");
  });
});

describe("revenue split (platform 5-10%)", () => {
  it("clamps fee to the 5-10% band", () => {
    expect(clampFeeBps(100)).toBe(500);
    expect(clampFeeBps(5000)).toBe(1000);
    expect(clampFeeBps(750)).toBe(750);
  });

  it("splits gross into platform + creator with no leakage", () => {
    const s = computeSplit(100, 1000);
    expect(s.platformFeeCredits).toBe(10);
    expect(s.creatorCredits).toBe(90);
    expect(s.platformFeeCredits + s.creatorCredits).toBe(s.grossCredits);
  });

  it("rounds the platform fee up on fractions", () => {
    const s = computeSplit(5, 1000); // 0.5 credit fee -> ceil -> 1
    expect(s.platformFeeCredits).toBe(1);
    expect(s.creatorCredits).toBe(4);
  });
});

describe("api keys", () => {
  it("never exposes a reversible secret and verifies by hash", async () => {
    const key = await generateApiKey("test");
    expect(key.plaintext.startsWith("ab_test_")).toBe(true);
    expect(key.displayPrefix.length).toBe(16);
    expect(await hashApiKey(key.plaintext)).toBe(key.hash);
    expect(await hashApiKey(key.plaintext + "x")).not.toBe(key.hash);
  });
});
