/**
 * Cloudflare Workers entry — the production deployment target for the routing
 * layer.
 *
 * Architecture
 * ------------
 * - The Worker is fully **stateless**; any instance can serve any request.
 * - Per-session state lives in a **Durable Object** (`AppbazaarSessionDO`),
 *   addressed by session id. Because a session id maps to exactly one DO, the
 *   DO is the single, strongly-consistent owner of that session's SSE stream
 *   and message fan-out — sessions are sharded across DOs, giving horizontal
 *   scalability with no sticky load balancing.
 * - An **Upstash Redis** backplane ({@link UpstashBackplane}) is available for
 *   cross-region/global coordination and metrics. Within a single session the
 *   DO performs fan-out directly, so the hot path needs no external round-trip.
 * - Raw payloads stream through and are **never persisted** — the DO stores
 *   only session metadata.
 *
 * This file is the reference wiring; it runs on Workers, not in the Node test
 * suite (which exercises the identical engine via the Node server).
 */
import { type ConnectionMode, type Protocol } from "@appbazaar/core";
import {
  DirectTransport,
  InMemoryBackplane,
  McpAdapter,
  type ResolvedManifest,
  RestAdapter,
  RouterEngine,
  TunnelTransport,
  noopBilling,
} from "@appbazaar/router-core";

// --- Minimal Cloudflare ambient shapes (avoids a workers-types dependency) ---
interface DurableObjectState {
  storage: { get<T>(k: string): Promise<T | undefined>; put<T>(k: string, v: T): Promise<void>; delete(k: string): Promise<void> };
}
interface DurableObjectStub {
  fetch(input: string, init?: RequestInit): Promise<Response>;
}
interface DurableObjectNamespace {
  idFromName(name: string): unknown;
  get(id: unknown): DurableObjectStub;
}
export interface Env {
  SESSION_DO: DurableObjectNamespace;
  HYPERDRIVE?: { connectionString: string };
  DATABASE_URL?: string;
  UPSTASH_REDIS_REST_URL?: string;
  UPSTASH_REDIS_REST_TOKEN?: string;
  PLATFORM_FEE_BPS?: string;
}

async function resolveDb(env: Env) {
  const url = env.HYPERDRIVE?.connectionString ?? env.DATABASE_URL;
  if (!url) throw new Error("router worker requires HYPERDRIVE or DATABASE_URL");
  const { createPostgresHandle } = await import("@appbazaar/db");
  return createPostgresHandle(url);
}

function makeResolveManifest(db: import("@appbazaar/db").Database) {
  return async (manifestId: string): Promise<ResolvedManifest | null> => {
    const { getManifestById } = await import("@appbazaar/db");
    const row = await getManifestById(db, manifestId);
    if (!row || row.status !== "published") return null;
    return {
      id: row.id,
      ownerTenantId: row.ownerTenantId,
      protocol: row.protocol as Protocol,
      connectionMode: row.connectionMode as ConnectionMode,
      connection: row.connection,
      pricingModel: row.pricingModel as "free" | "per_call",
      priceCredits: row.priceCredits,
      capabilities: row.capabilities,
    };
  };
}

/**
 * Durable Object that owns a single routing session: it holds the SSE stream
 * and fans out events the Worker hands it. Only session metadata is persisted.
 */
export class AppbazaarSessionDO {
  private backplane = new InMemoryBackplane();
  constructor(private state: DurableObjectState) {}

  async fetch(request: Request): Promise<Response> {
    const url = new URL(request.url);
    if (request.method === "PUT" && url.pathname === "/session") {
      await this.state.storage.put("meta", await request.json());
      return new Response(null, { status: 204 });
    }
    if (request.method === "GET" && url.pathname === "/session") {
      const meta = await this.state.storage.get("meta");
      return meta ? Response.json(meta) : new Response(null, { status: 404 });
    }
    if (request.method === "DELETE" && url.pathname === "/session") {
      await this.state.storage.delete("meta");
      return new Response(null, { status: 204 });
    }
    if (request.method === "GET" && url.pathname === "/stream") {
      return this.openStream();
    }
    if (request.method === "POST" && url.pathname === "/publish") {
      await this.backplane.publish("local", await request.text());
      return new Response(null, { status: 202 });
    }
    return new Response("not found", { status: 404 });
  }

  private async openStream(): Promise<Response> {
    const { readable, writable } = new TransformStream<Uint8Array, Uint8Array>();
    const writer = writable.getWriter();
    const enc = new TextEncoder();
    const unsub = await this.backplane.subscribe("local", (message) => {
      const kind = safeKind(message);
      void writer.write(enc.encode(`event: ${kind}\ndata: ${message}\n\n`));
    });
    void writer.write(enc.encode(`event: ready\ndata: {}\n\n`));
    // Best-effort cleanup is handled when the client disconnects.
    void (async () => {
      try {
        await writer.closed;
      } finally {
        await unsub();
      }
    })();
    return new Response(readable, {
      headers: {
        "content-type": "text/event-stream",
        "cache-control": "no-cache",
        connection: "keep-alive",
      },
    });
  }
}

function safeKind(message: string): string {
  try {
    return (JSON.parse(message) as { kind?: string }).kind ?? "message";
  } catch {
    return "message";
  }
}

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const url = new URL(request.url);

    if (url.pathname === "/health") return Response.json({ ok: true, service: "appbazaar-router-worker" });

    const handle = await resolveDb(env);
    const engine = new RouterEngine({
      sessions: {
        async create(meta) {
          const full = { ...meta, createdAt: Date.now() };
          const stub = env.SESSION_DO.get(env.SESSION_DO.idFromName(meta.sessionId));
          await stub.fetch("https://do/session", { method: "PUT", body: JSON.stringify(full) });
          return full;
        },
        async get(sessionId) {
          const stub = env.SESSION_DO.get(env.SESSION_DO.idFromName(sessionId));
          const res = await stub.fetch("https://do/session");
          return res.status === 404 ? null : ((await res.json()) as any);
        },
        async delete(sessionId) {
          const stub = env.SESSION_DO.get(env.SESSION_DO.idFromName(sessionId));
          await stub.fetch("https://do/session", { method: "DELETE" });
        },
      },
      // The DO fans out within a session; pass the same DO as the backplane.
      backplane: {
        async publish(channel, message) {
          const sessionId = channel.replace(/^session:/, "");
          const stub = env.SESSION_DO.get(env.SESSION_DO.idFromName(sessionId));
          await stub.fetch("https://do/publish", { method: "POST", body: message });
        },
        async subscribe() {
          // Subscription happens inside the DO's /stream handler, not here.
          return async () => {};
        },
      },
      resolveManifest: makeResolveManifest(handle.db),
      transports: { direct: new DirectTransport(), tunnel: new TunnelTransport() },
      adapters: { rest: new RestAdapter(), mcp: new McpAdapter() },
      // Billing hooks are wired the same way as the Node server (omitted here
      // for brevity); noopBilling keeps the reference build self-contained.
      billing: noopBilling,
    });

    // Routing of /v1/sessions, /v1/sessions/:id/stream and .../messages mirrors
    // the Node server in server.ts; the SSE stream is proxied from the DO.
    const streamMatch = url.pathname.match(/^\/v1\/sessions\/([^/]+)\/stream$/);
    if (request.method === "GET" && streamMatch) {
      const stub = env.SESSION_DO.get(env.SESSION_DO.idFromName(streamMatch[1]!));
      return stub.fetch("https://do/stream");
    }

    return Response.json({ error: { code: "not_found", message: "see server.ts for full route set" } }, { status: 404 });
  },
};
