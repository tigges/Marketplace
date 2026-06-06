import { AppError, type RoutedEvent, type RoutedInvocation } from "@appbazaar/core";
import type { ConnectionMode, Protocol } from "@appbazaar/core";
import { byteLength } from "./adapters/stream.js";
import { newSessionId } from "./sessions/memory.js";
import type {
  Backplane,
  BillingHooks,
  CallMetrics,
  ConnectorTransport,
  ProtocolAdapter,
  ResolvedManifest,
  SessionMeta,
  SessionStore,
} from "./types.js";

export interface RouterEngineDeps {
  sessions: SessionStore;
  backplane: Backplane;
  resolveManifest: (manifestId: string) => Promise<ResolvedManifest | null>;
  transports: Partial<Record<ConnectionMode, ConnectorTransport>>;
  adapters: Partial<Record<Protocol, ProtocolAdapter>>;
  billing: BillingHooks;
  now?: () => number;
}

/** Control envelope published on the backplane alongside data events. */
export type RouterEnvelope =
  | { kind: "event"; callId: string; event: RoutedEvent }
  | { kind: "done"; callId: string; metrics: CallMetrics };

export interface InvokeResult {
  callId: string;
  status: "ok" | "error";
  result?: unknown;
  error?: { code?: string; message: string };
  metrics: CallMetrics;
}

/**
 * Stateless routing engine. It owns no HTTP and no storage of its own: a
 * runtime (Node server or Cloudflare Worker) wires in a {@link SessionStore},
 * a {@link Backplane}, transports, adapters, and billing hooks.
 *
 * Non-custodial guarantee: raw request/response payloads pass through this
 * engine but are NEVER persisted. The only thing retained is payload-free
 * {@link CallMetrics} handed to the billing layer.
 */
export class RouterEngine {
  constructor(private readonly deps: RouterEngineDeps) {}

  private now(): number {
    return (this.deps.now ?? Date.now)();
  }

  static channel(sessionId: string): string {
    return `session:${sessionId}`;
  }

  /** Open a tenant-scoped session bound to a single connector manifest. */
  async openSession(params: { tenantId: string; manifestId: string }): Promise<SessionMeta> {
    const manifest = await this.deps.resolveManifest(params.manifestId);
    if (!manifest) throw new AppError("not_found", `manifest ${params.manifestId} not found`);
    return this.deps.sessions.create({
      sessionId: newSessionId(),
      tenantId: params.tenantId,
      manifestId: params.manifestId,
    });
  }

  async closeSession(sessionId: string): Promise<void> {
    await this.deps.sessions.delete(sessionId);
  }

  /**
   * Route one invocation through an existing session. Events are published to
   * the session's backplane channel for any attached SSE stream, and the
   * terminal result is also returned for unary callers.
   */
  async invoke(params: {
    sessionId: string;
    requesterTenantId: string;
    invocation: RoutedInvocation;
  }): Promise<InvokeResult> {
    const session = await this.deps.sessions.get(params.sessionId);
    if (!session) throw new AppError("not_found", "session not found");

    // Tenant isolation: a session may only be driven by its owning tenant.
    if (session.tenantId !== params.requesterTenantId) {
      throw new AppError("forbidden", "session belongs to another tenant");
    }

    const manifest = await this.deps.resolveManifest(session.manifestId);
    if (!manifest) throw new AppError("not_found", "manifest no longer available");

    this.assertCapability(manifest, params.invocation.capability);

    const transport = this.deps.transports[manifest.connectionMode];
    if (!transport) {
      throw new AppError("connector_unavailable", `no transport for mode '${manifest.connectionMode}'`);
    }
    const adapter = this.deps.adapters[manifest.protocol];
    if (!adapter) {
      throw new AppError("protocol_unsupported", `no adapter for protocol '${manifest.protocol}'`);
    }

    const callId = `call_${session.sessionId}_${params.invocation.requestId}`;
    const billingCtx = {
      callId,
      requesterTenantId: params.requesterTenantId,
      manifest,
      capability: params.invocation.capability,
    };

    // Never start work we can't bill for.
    await this.deps.billing.preauthorize(billingCtx);

    const channel = RouterEngine.channel(session.sessionId);
    const startedAt = this.now();
    const requestBytes = byteLength(params.invocation.input);
    let responseBytes = 0;
    let status: "ok" | "error" = "error";
    let errorCode: string | undefined;
    let result: unknown;
    let errorMessage: string | undefined;

    const controller = new AbortController();
    try {
      for await (const event of adapter.invoke({
        manifest,
        invocation: params.invocation,
        transport,
        signal: controller.signal,
      })) {
        responseBytes += byteLength((event as { data?: unknown }).data ?? (event as { message?: string }).message);
        await this.publish(channel, { kind: "event", callId, event });
        if (event.type === "result") {
          status = "ok";
          result = event.data;
        } else if (event.type === "error") {
          status = "error";
          errorCode = event.code;
          errorMessage = event.message;
        }
      }
    } catch (err) {
      status = "error";
      const appErr = err instanceof AppError ? err : new AppError("upstream_error", String(err));
      errorCode = appErr.code;
      errorMessage = appErr.message;
      const event: RoutedEvent = {
        type: "error",
        requestId: params.invocation.requestId,
        code: appErr.code,
        message: appErr.message,
      };
      await this.publish(channel, { kind: "event", callId, event });
    }

    const metrics: CallMetrics = {
      callId,
      capability: params.invocation.capability,
      status,
      errorCode,
      requestBytes,
      responseBytes,
      durationMs: Math.max(0, this.now() - startedAt),
    };

    // Settle is the ONLY place call data leaves the engine — and it's metadata
    // only (counts + timing). Payloads are never handed onward.
    await this.deps.billing.settle(billingCtx, metrics);
    await this.publish(channel, { kind: "done", callId, metrics });

    return {
      callId,
      status,
      result: status === "ok" ? result : undefined,
      error: status === "error" ? { code: errorCode, message: errorMessage ?? "call failed" } : undefined,
      metrics,
    };
  }

  private assertCapability(manifest: ResolvedManifest, capability: string): void {
    const known = manifest.capabilities.some((c) => c.name === capability);
    if (!known) {
      throw new AppError("validation", `capability '${capability}' is not declared by this manifest`, {
        available: manifest.capabilities.map((c) => c.name),
      });
    }
  }

  private async publish(channel: string, envelope: RouterEnvelope): Promise<void> {
    await this.deps.backplane.publish(channel, JSON.stringify(envelope));
  }
}
