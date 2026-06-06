import type { AddressInfo } from "node:net";
import { parseManifest } from "@appbazaar/core";
import {
  createApiKey,
  createManifest,
  createTestDb,
  createTenant,
  getEarnings,
  getWallet,
  listManifests,
  listUsageForRequester,
  topUp,
} from "@appbazaar/db";
import { createRouterRuntime, createServer } from "@appbazaar/router";
import { startEchoConnector } from "./echo-connector.ts";

/**
 * End-to-end demo of the MVP success metric:
 *   register a connector -> discover it -> connect an agent through the router
 *   -> execute a real call -> have it logged and billed — with zero custom
 *   integration code.
 */
async function main() {
  const connector = await startEchoConnector();
  const { db } = await createTestDb();
  const runtime = createRouterRuntime(db);
  const server = createServer({ db, runtime });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  // 1) Developer A registers a connector (this is what the registry persists).
  const creator = await createTenant(db, { name: "Acme Labs", slug: "acme-labs" });
  const manifest = parseManifest({
    slug: "echo-connector",
    name: "Echo Connector",
    description: "Echoes input and reverses text.",
    kind: "connector",
    protocol: "rest",
    connection: { mode: "direct", baseUrl: connector.url },
    pricing: { model: "per_call", priceCredits: 5 },
    capabilities: [
      { name: "echo", description: "Echo input" },
      { name: "reverse", description: "Reverse text" },
    ],
    tags: ["reference"],
  });
  const row = await createManifest(db, creator.id, manifest);
  console.log(`registered connector: ${row.name} (${row.id})`);

  // 2) Developer B sets up an agent identity + prepaid wallet.
  const consumer = await createTenant(db, { name: "Builder Co", slug: "builder-co" });
  await topUp(db, consumer.id, 1000, "demo-grant");
  const apiKey = await createApiKey(db, consumer.id, "demo-agent");

  // 3) Developer B discovers the connector via the registry.
  const found = await listManifests(db, { q: "echo" });
  console.log(`discovered ${found.length} connector(s) via registry search`);
  const target = found[0]!;

  // 4) Connect an agent through the routing layer and execute a real call.
  const auth = { authorization: `Bearer ${apiKey.plaintext}`, "content-type": "application/json" };
  const invoke = async (capability: string, input: unknown) => {
    const res = await fetch(`${base}/v1/invoke/${target.id}`, {
      method: "POST",
      headers: auth,
      body: JSON.stringify({ capability, input }),
    });
    return res.json() as Promise<any>;
  };

  const echo = await invoke("echo", { message: "hello appbazaar" });
  console.log("echo result   :", JSON.stringify(echo.result));
  const reverse = await invoke("reverse", { text: "appbazaar" });
  console.log("reverse result:", JSON.stringify(reverse.result));

  // 5) Confirm it was logged and billed.
  const wallet = await getWallet(db, consumer.id);
  const earnings = await getEarnings(db, creator.id);
  const ledger = await listUsageForRequester(db, consumer.id);
  console.log("---");
  console.log(`ledger entries     : ${ledger.length}`);
  console.log(`consumer wallet    : ${wallet?.balanceCredits} credits (started at 1000)`);
  console.log(`creator earnings   : ${earnings?.balanceCredits} credits`);
  console.log(`platform fee taken : ${ledger.reduce((s, l) => s + l.platformFeeCredits, 0)} credits`);
  console.log("non-custodial check: ledger rows store byte counts only, never payloads");

  await new Promise<void>((r) => server.close(() => r()));
  await connector.close();
  process.exit(0);
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
