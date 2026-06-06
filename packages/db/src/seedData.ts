import { parseManifest, type ManifestInput } from "@appbazaar/core";
import type { Database } from "./client.js";
import { createTenant, getTenantBySlug } from "./repo/tenants.js";
import { createManifest, getManifestBySlug, listManifests } from "./repo/manifests.js";
import { createApiKey } from "./repo/apiKeys.js";
import { topUp } from "./repo/wallet.js";

export function sampleManifests(connectorUrl: string): ManifestInput[] {
  return [
    {
      slug: "echo-connector",
      name: "Echo Connector",
      description:
        "A reference REST connector that echoes structured input and reverses text. Useful for verifying end-to-end routing.",
      kind: "connector",
      protocol: "rest",
      connection: { mode: "direct", baseUrl: connectorUrl },
      pricing: { model: "per_call", priceCredits: 5 },
      capabilities: [
        {
          name: "echo",
          description: "Return the provided payload unchanged.",
          inputSchema: { type: "object", properties: { message: { type: "string" } }, required: ["message"] },
        },
        {
          name: "reverse",
          description: "Reverse a string.",
          inputSchema: { type: "object", properties: { text: { type: "string" } }, required: ["text"] },
        },
      ],
      tags: ["reference", "testing", "rest"],
    },
    {
      slug: "acme-weather",
      name: "Acme Weather",
      description: "Current conditions and forecasts for any lat/long. SaaS connector reachable over a public API.",
      kind: "connector",
      protocol: "rest",
      connection: { mode: "direct", baseUrl: "https://weather.example.com" },
      pricing: { model: "per_call", priceCredits: 25 },
      capabilities: [
        {
          name: "current",
          description: "Current weather for coordinates.",
          inputSchema: {
            type: "object",
            properties: { lat: { type: "number" }, lon: { type: "number" } },
            required: ["lat", "lon"],
          },
        },
      ],
      tags: ["weather", "saas"],
    },
    {
      slug: "internal-crm-bridge",
      name: "Internal CRM Bridge",
      description:
        "Reads records from a private CRM behind the firewall. Tunnel connector (wave 2) — registered today, routable once tunnels ship.",
      kind: "connector",
      protocol: "mcp",
      connection: { mode: "tunnel", tunnelId: "crm-bridge-prod-01" },
      pricing: { model: "free" },
      capabilities: [{ name: "lookup_contact", description: "Find a contact by email." }],
      tags: ["crm", "tunnel", "mcp"],
    },
    {
      slug: "summarizer-agent",
      name: "Summarizer Agent",
      description:
        "An autonomous agent that consumes documents and returns structured summaries. Speaks MCP over a public endpoint.",
      kind: "agent",
      protocol: "mcp",
      connection: { mode: "direct", baseUrl: "https://summarizer.example.com/mcp" },
      pricing: { model: "per_call", priceCredits: 40 },
      capabilities: [{ name: "summarize", description: "Summarize a document." }],
      tags: ["agent", "mcp", "nlp"],
    },
  ];
}

export interface SeedResult {
  creatorId: string;
  consumerId: string;
  apiKey?: string;
}

/**
 * Idempotently seed demo data: a creator with sample listings, plus a
 * consumer tenant with a funded wallet. Returns ids (and, when a new key is
 * issued, the plaintext API key).
 */
export async function seedSampleData(
  db: Database,
  opts: { connectorUrl?: string; issueApiKey?: boolean; topUpCredits?: number } = {},
): Promise<SeedResult> {
  const connectorUrl = opts.connectorUrl ?? "http://localhost:8787";
  const creator =
    (await getTenantBySlug(db, "acme-labs")) ?? (await createTenant(db, { name: "Acme Labs", slug: "acme-labs" }));
  const consumer =
    (await getTenantBySlug(db, "builder-co")) ?? (await createTenant(db, { name: "Builder Co", slug: "builder-co" }));

  for (const input of sampleManifests(connectorUrl)) {
    if (await getManifestBySlug(db, input.slug)) continue;
    await createManifest(db, creator.id, parseManifest(input));
  }

  await topUp(db, consumer.id, opts.topUpCredits ?? 10_000, "seed-grant").catch(() => {});

  let apiKey: string | undefined;
  if (opts.issueApiKey) {
    const key = await createApiKey(db, consumer.id, "seed-cli-key");
    apiKey = key.plaintext;
  }
  return { creatorId: creator.id, consumerId: consumer.id, apiKey };
}

export async function isRegistryEmpty(db: Database): Promise<boolean> {
  const rows = await listManifests(db, { limit: 1 });
  return rows.length === 0;
}
