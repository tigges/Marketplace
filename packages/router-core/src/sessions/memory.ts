import { newId } from "@appbazaar/core";
import type { SessionMeta, SessionStore } from "../types.js";

/** Process-local session registry for single-instance/local/test usage. */
export class InMemorySessionStore implements SessionStore {
  private sessions = new Map<string, SessionMeta>();

  async create(meta: Omit<SessionMeta, "createdAt">): Promise<SessionMeta> {
    const full: SessionMeta = { ...meta, createdAt: Date.now() };
    this.sessions.set(full.sessionId, full);
    return full;
  }

  async get(sessionId: string): Promise<SessionMeta | null> {
    return this.sessions.get(sessionId) ?? null;
  }

  async delete(sessionId: string): Promise<void> {
    this.sessions.delete(sessionId);
  }
}

export function newSessionId(): string {
  return newId("ses");
}
