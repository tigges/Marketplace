import http from "node:http";
import { AppError, isAppError } from "@appbazaar/core";
import { type Database, ping, verifyApiKey } from "@appbazaar/db";
import { RouterEngine } from "@appbazaar/router-core";
import { type RouterRuntime, requireBearer } from "./wiring.js";

export interface ServerDeps {
  db: Database;
  runtime: RouterRuntime;
}

interface Ctx {
  req: http.IncomingMessage;
  res: http.ServerResponse;
  url: URL;
}

/**
 * Stateless HTTP+SSE runtime for the routing layer. Mirrors the MCP SSE
 * transport shape (open a stream, POST messages, receive events on the
 * stream) but is protocol-agnostic. Designed to run behind a load balancer:
 * any instance can serve any request because session state lives in the
 * SessionStore and event delivery goes through the Backplane.
 */
export function createServer(deps: ServerDeps): http.Server {
  return http.createServer(async (req, res) => {
    const url = new URL(req.url ?? "/", `http://${req.headers.host ?? "localhost"}`);
    const ctx: Ctx = { req, res, url };
    try {
      await route(deps, ctx);
    } catch (err) {
      sendError(res, err);
    }
  });
}

async function route(deps: ServerDeps, ctx: Ctx): Promise<void> {
  const { req, url } = ctx;
  const method = req.method ?? "GET";
  const path = url.pathname;

  if (method === "GET" && path === "/health") {
    const ok = await ping(deps.db).catch(() => false);
    return sendJson(ctx.res, 200, { ok, service: "appbazaar-router" });
  }

  if (method === "POST" && path === "/v1/sessions") {
    return openSession(deps, ctx);
  }

  const streamMatch = path.match(/^\/v1\/sessions\/([^/]+)\/stream$/);
  if (method === "GET" && streamMatch) {
    return streamSession(deps, ctx, streamMatch[1]!);
  }

  const messagesMatch = path.match(/^\/v1\/sessions\/([^/]+)\/messages$/);
  if (method === "POST" && messagesMatch) {
    return postMessage(deps, ctx, messagesMatch[1]!);
  }

  const invokeMatch = path.match(/^\/v1\/invoke\/([^/]+)$/);
  if (method === "POST" && invokeMatch) {
    return unaryInvoke(deps, ctx, invokeMatch[1]!);
  }

  sendJson(ctx.res, 404, { error: { code: "not_found", message: "no such route" } });
}

async function authTenant(deps: ServerDeps, ctx: Ctx): Promise<{ tenantId: string }> {
  const key = requireBearer(ctx.req.headers.authorization);
  const resolved = await verifyApiKey(deps.db, key);
  if (!resolved) throw new AppError("unauthorized", "invalid API key");
  return { tenantId: resolved.tenantId };
}

async function openSession(deps: ServerDeps, ctx: Ctx): Promise<void> {
  const { tenantId } = await authTenant(deps, ctx);
  const body = await readJson(ctx.req);
  const manifestId = body?.manifestId;
  if (typeof manifestId !== "string") throw new AppError("validation", "manifestId is required");

  const session = await deps.runtime.engine.openSession({ tenantId, manifestId });
  sendJson(ctx.res, 201, {
    sessionId: session.sessionId,
    streamUrl: `/v1/sessions/${session.sessionId}/stream`,
    messagesUrl: `/v1/sessions/${session.sessionId}/messages`,
  });
}

async function streamSession(deps: ServerDeps, ctx: Ctx, sessionId: string): Promise<void> {
  const { tenantId } = await authTenant(deps, ctx);
  const session = await deps.runtime.sessions.get(sessionId);
  if (!session) throw new AppError("not_found", "session not found");
  if (session.tenantId !== tenantId) throw new AppError("forbidden", "session belongs to another tenant");

  const { res } = ctx;
  res.writeHead(200, {
    "content-type": "text/event-stream",
    "cache-control": "no-cache, no-transform",
    connection: "keep-alive",
    "x-accel-buffering": "no",
  });
  res.write(`event: ready\ndata: ${JSON.stringify({ sessionId })}\n\n`);

  const channel = RouterEngine.channel(sessionId);
  const unsubscribe = await deps.runtime.backplane.subscribe(channel, (message) => {
    // Forward each envelope verbatim. The payload streams through; nothing is
    // persisted on the router.
    let eventName = "message";
    try {
      eventName = (JSON.parse(message) as { kind?: string }).kind ?? "message";
    } catch {
      /* keep default */
    }
    res.write(`event: ${eventName}\ndata: ${message}\n\n`);
  });

  const heartbeat = setInterval(() => res.write(`: ping\n\n`), 15_000);

  const cleanup = async () => {
    clearInterval(heartbeat);
    await unsubscribe();
  };
  ctx.req.on("close", () => void cleanup());
}

async function postMessage(deps: ServerDeps, ctx: Ctx, sessionId: string): Promise<void> {
  const { tenantId } = await authTenant(deps, ctx);
  const body = await readJson(ctx.req);
  const capability = body?.capability;
  if (typeof capability !== "string") throw new AppError("validation", "capability is required");

  const result = await deps.runtime.engine.invoke({
    sessionId,
    requesterTenantId: tenantId,
    invocation: {
      capability,
      input: body?.input ?? {},
      requestId: typeof body?.requestId === "string" ? body.requestId : crypto.randomUUID(),
    },
  });
  sendJson(ctx.res, 200, result);
}

async function unaryInvoke(deps: ServerDeps, ctx: Ctx, manifestId: string): Promise<void> {
  const { tenantId } = await authTenant(deps, ctx);
  const body = await readJson(ctx.req);
  const capability = body?.capability;
  if (typeof capability !== "string") throw new AppError("validation", "capability is required");

  const session = await deps.runtime.engine.openSession({ tenantId, manifestId });
  try {
    const result = await deps.runtime.engine.invoke({
      sessionId: session.sessionId,
      requesterTenantId: tenantId,
      invocation: {
        capability,
        input: body?.input ?? {},
        requestId: typeof body?.requestId === "string" ? body.requestId : crypto.randomUUID(),
      },
    });
    sendJson(ctx.res, result.status === "ok" ? 200 : 502, result);
  } finally {
    await deps.runtime.engine.closeSession(session.sessionId);
  }
}

function readJson(req: http.IncomingMessage): Promise<any> {
  return new Promise((resolve, reject) => {
    const chunks: Buffer[] = [];
    let size = 0;
    req.on("data", (c: Buffer) => {
      size += c.length;
      if (size > 5_000_000) reject(new AppError("validation", "request body too large"));
      else chunks.push(c);
    });
    req.on("end", () => {
      if (chunks.length === 0) return resolve({});
      try {
        resolve(JSON.parse(Buffer.concat(chunks).toString("utf8")));
      } catch {
        reject(new AppError("validation", "invalid JSON body"));
      }
    });
    req.on("error", reject);
  });
}

function sendJson(res: http.ServerResponse, status: number, body: unknown): void {
  const data = JSON.stringify(body);
  res.writeHead(status, { "content-type": "application/json" });
  res.end(data);
}

function sendError(res: http.ServerResponse, err: unknown): void {
  if (res.headersSent) {
    res.end();
    return;
  }
  if (isAppError(err)) {
    sendJson(res, err.status, err.toJSON());
    return;
  }
  console.error("router error:", err);
  sendJson(res, 500, { error: { code: "internal", message: "internal error" } });
}
