import type {
  Capability,
  Connection,
  ConnectionMode,
  Protocol,
  RoutedEvent,
  RoutedInvocation,
} from "@appbazaar/core";

/**
 * The slice of a manifest the router needs to make a call. Deliberately a
 * plain value object so `router-core` never depends on the database layer.
 */
export interface ResolvedManifest {
  id: string;
  ownerTenantId: string;
  protocol: Protocol;
  connectionMode: ConnectionMode;
  connection: Connection;
  pricingModel: "free" | "per_call";
  priceCredits: number;
  capabilities: Capability[];
}

/** Immutable, payload-free metadata for one routing session. */
export interface SessionMeta {
  sessionId: string;
  tenantId: string;
  manifestId: string;
  createdAt: number;
}

/**
 * Durable session registry. Holds only metadata — never payloads. Backed by
 * an in-memory Map locally and by a Durable Object in Cloudflare Workers, so
 * sessions survive across stateless worker invocations.
 */
export interface SessionStore {
  create(meta: Omit<SessionMeta, "createdAt">): Promise<SessionMeta>;
  get(sessionId: string): Promise<SessionMeta | null>;
  delete(sessionId: string): Promise<void>;
}

/**
 * Pub/sub backplane that lets a POST handled by one stateless instance reach
 * the SSE stream held open on another. In-memory locally; Upstash Redis in
 * production. This is what makes the router horizontally scalable.
 */
export interface Backplane {
  publish(channel: string, message: string): Promise<void>;
  subscribe(channel: string, handler: (message: string) => void): Promise<Unsubscribe>;
}
export type Unsubscribe = () => Promise<void>;

/** A normalized response from a connector transport. */
export interface TransportResponse {
  status: number;
  headers: Record<string, string>;
  /** Streaming body. Adapters read this; the router never buffers it to disk. */
  body: ReadableStream<Uint8Array> | null;
}

export interface TransportRequest {
  method: string;
  path: string;
  headers: Record<string, string>;
  body?: string;
  signal?: AbortSignal;
}

/**
 * Abstracts *how* a connector is reached. `direct` dials a public API;
 * `tunnel` (wave 2) dials a registered tunnel. Adding modes never touches the
 * engine or adapters.
 */
export interface ConnectorTransport {
  readonly mode: ConnectionMode;
  request(connection: Connection, req: TransportRequest): Promise<TransportResponse>;
}

/** Context handed to a protocol adapter for a single invocation. */
export interface AdapterContext {
  manifest: ResolvedManifest;
  invocation: RoutedInvocation;
  transport: ConnectorTransport;
  signal: AbortSignal;
}

/**
 * Translates a normalized invocation into a connector's native protocol and
 * yields normalized events back. MCP and REST ship in the MVP; new protocols
 * are just new adapters.
 */
export interface ProtocolAdapter {
  readonly protocol: Protocol;
  invoke(ctx: AdapterContext): AsyncIterable<RoutedEvent>;
}

/** Final, payload-free accounting for a completed call. */
export interface CallMetrics {
  callId: string;
  capability: string;
  status: "ok" | "error";
  errorCode?: string;
  requestBytes: number;
  responseBytes: number;
  durationMs: number;
}

export interface BillingContext {
  callId: string;
  requesterTenantId: string;
  manifest: ResolvedManifest;
  capability: string;
}

/**
 * Billing seams. The router calls `preauthorize` before doing any work and
 * `settle` once metrics are known. Wired to `@appbazaar/db` by the runtime;
 * left as no-ops in tests that don't exercise billing.
 */
export interface BillingHooks {
  preauthorize(ctx: BillingContext): Promise<void>;
  settle(ctx: BillingContext, metrics: CallMetrics): Promise<void>;
}

export const noopBilling: BillingHooks = {
  async preauthorize() {},
  async settle() {},
};

export type { RoutedEvent, RoutedInvocation };
