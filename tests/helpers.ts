import type { AddressInfo } from "node:net";
import type { Server } from "node:http";
import { parseManifest, type ManifestInput } from "@appbazaar/core";
import {
  type DbHandle,
  createApiKey,
  createManifest,
  createTenant,
  createTestDb,
  topUp,
} from "@appbazaar/db";
import { createRouterRuntime, createServer } from "@appbazaar/router";
import { startEchoConnector } from "../examples/echo-connector.ts";

export interface Harness {
  handle: DbHandle;
  base: string;
  connectorUrl: string;
  creatorId: string;
  consumerId: string;
  apiKey: string;
  manifestId: string;
  stop: () => Promise<void>;
}

const echoManifest = (baseUrl: string): ManifestInput => ({
  slug: "echo-connector",
  name: "Echo Connector",
  description: "Echoes input and reverses text.",
  kind: "connector",
  protocol: "rest",
  connection: { mode: "direct", baseUrl },
  pricing: { model: "per_call", priceCredits: 5 },
  capabilities: [
    { name: "echo", description: "echo" },
    { name: "reverse", description: "reverse" },
    { name: "stream", description: "stream" },
  ],
  tags: ["reference"],
});

export async function setupHarness(options: { startingCredits?: number } = {}): Promise<Harness> {
  const connector = await startEchoConnector();
  const handle = await createTestDb();
  const { db } = handle;
  const runtime = createRouterRuntime(db);
  const server: Server = createServer({ db, runtime });
  await new Promise<void>((r) => server.listen(0, r));
  const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;

  const creator = await createTenant(db, { name: "Acme Labs", slug: "acme-labs" });
  const consumer = await createTenant(db, { name: "Builder Co", slug: "builder-co" });
  const manifest = await createManifest(db, creator.id, parseManifest(echoManifest(connector.url)));
  await topUp(db, consumer.id, options.startingCredits ?? 1000, "test-grant");
  const key = await createApiKey(db, consumer.id, "test-key");

  return {
    handle,
    base,
    connectorUrl: connector.url,
    creatorId: creator.id,
    consumerId: consumer.id,
    apiKey: key.plaintext,
    manifestId: manifest.id,
    stop: async () => {
      await new Promise<void>((r) => server.close(() => r()));
      await connector.close();
      await handle.close();
    },
  };
}

export function authHeaders(apiKey: string): Record<string, string> {
  return { authorization: `Bearer ${apiKey}`, "content-type": "application/json" };
}

export interface SseEvent {
  event: string;
  data: string;
}

/**
 * Read an SSE Response body, invoking `onReady` once the stream is live (so
 * publishes aren't missed), and resolve with all events once a `done` frame
 * arrives or the timeout elapses.
 */
export async function readSseUntilDone(
  res: Response,
  onReady: () => Promise<void> | void,
  timeoutMs = 5000,
): Promise<SseEvent[]> {
  const reader = res.body!.getReader();
  const decoder = new TextDecoder();
  const events: SseEvent[] = [];
  let buffer = "";
  let readyFired = false;
  const deadline = Date.now() + timeoutMs;

  while (Date.now() < deadline) {
    const { done, value } = await reader.read();
    if (done) break;
    buffer += decoder.decode(value, { stream: true });
    let idx: number;
    while ((idx = buffer.indexOf("\n\n")) !== -1) {
      const raw = buffer.slice(0, idx);
      buffer = buffer.slice(idx + 2);
      if (raw.startsWith(":")) continue; // heartbeat
      const frame = parseFrame(raw);
      events.push(frame);
      if (frame.event === "ready" && !readyFired) {
        readyFired = true;
        await onReady();
      }
      if (frame.event === "done") {
        await reader.cancel();
        return events;
      }
    }
  }
  await reader.cancel().catch(() => {});
  return events;
}

function parseFrame(raw: string): SseEvent {
  let event = "message";
  const data: string[] = [];
  for (const line of raw.split("\n")) {
    if (line.startsWith("event:")) event = line.slice(6).trim();
    else if (line.startsWith("data:")) data.push(line.slice(5).replace(/^ /, ""));
  }
  return { event, data: data.join("\n") };
}
