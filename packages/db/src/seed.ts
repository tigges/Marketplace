import { parseManifest, type ManifestInput } from "@appbazaar/core";
import { createHandleFromEnv } from "./client.js";
import { createTenant, getTenantBySlug } from "./repo/tenants.js";
import { createManifest, getManifestBySlug } from "./repo/manifests.js";
import { createApiKey } from "./repo/apiKeys.js";
import { topUp } from "./repo/wallet.js";

const EXAMPLE_CONNECTOR_URL = process.env.EXAMPLE_CONNECTOR_URL ?? "http://localhost:8787";

const sampleManifests: ManifestInput[] = [
  {
    slug: "echo-connector",
    name: "Echo Connector",
    description:
      "A reference REST connector that echoes structured input and reverses text. Useful for verifying end-to-end routing.",
    kind: "connector",
    protocol: "rest",
    connection: { mode: "direct", baseUrl: EXAMPLE_CONNECTOR_URL },
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
    capabilities: [
      { name: "lookup_contact", description: "Find a contact by email." },
    ],
    tags: ["crm", "tunnel", "mcp"],
  },
];

async function main() {
  const handle = await createHandleFromEnv();
  await handle.migrate();
  const { db } = handle;

  const creator =
    (await getTenantBySlug(db, "acme-labs")) ??
    (await createTenant(db, { name: "Acme Labs", slug: "acme-labs" }));

  const consumer =
    (await getTenantBySlug(db, "builder-co")) ??
    (await createTenant(db, { name: "Builder Co", slug: "builder-co" }));

  for (const input of sampleManifests) {
    if (await getManifestBySlug(db, input.slug)) continue;
    const manifest = parseManifest(input);
    await createManifest(db, creator.id, manifest);
  }

  await topUp(db, consumer.id, 10_000, "seed-grant");
  const key = await createApiKey(db, consumer.id, "seed-cli-key");

  console.log("Seed complete.");
  console.log(`  creator tenant : ${creator.slug} (${creator.id})`);
  console.log(`  consumer tenant: ${consumer.slug} (${consumer.id})`);
  console.log(`  wallet topped up: 10000 credits`);
  console.log(`  API key (save this — shown once): ${key.plaintext}`);

  await handle.close();
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
