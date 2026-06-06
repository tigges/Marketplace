import type { SessionMeta, SessionStore } from "../types.js";

/**
 * Structural view of the Cloudflare Durable Object stub we need. Declared
 * locally so router-core stays dependency-free and portable.
 */
export interface DurableObjectNamespaceLike {
  idFromName(name: string): unknown;
  get(id: unknown): { fetch(input: string, init?: RequestInit): Promise<Response> };
}

/**
 * Session store backed by a Durable Object. Each session id maps to a DO
 * instance, giving every session strongly-consistent, single-owner state that
 * survives across stateless worker invocations. Payloads are never stored —
 * only the metadata in {@link SessionMeta}.
 *
 * The companion `AppbazaarSessionDO` (see apps/router worker entry) implements
 * the tiny HTTP contract used below.
 */
export class DurableObjectSessionStore implements SessionStore {
  constructor(private readonly ns: DurableObjectNamespaceLike) {}

  private stub(sessionId: string) {
    return this.ns.get(this.ns.idFromName(sessionId));
  }

  async create(meta: Omit<SessionMeta, "createdAt">): Promise<SessionMeta> {
    const full: SessionMeta = { ...meta, createdAt: Date.now() };
    await this.stub(meta.sessionId).fetch("https://do/session", {
      method: "PUT",
      body: JSON.stringify(full),
    });
    return full;
  }

  async get(sessionId: string): Promise<SessionMeta | null> {
    const res = await this.stub(sessionId).fetch("https://do/session", { method: "GET" });
    if (res.status === 404) return null;
    return (await res.json()) as SessionMeta;
  }

  async delete(sessionId: string): Promise<void> {
    await this.stub(sessionId).fetch("https://do/session", { method: "DELETE" });
  }
}
