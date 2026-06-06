/**
 * Protocol- and transport-agnostic primitives.
 *
 * appbazaar is deliberately NOT tied to MCP. MCP is the first supported
 * protocol, but the registry, router, and billing layers only ever deal with
 * the normalized shapes below. Adding a new protocol means registering a new
 * {@link ProtocolAdapter} in the router — nothing in the data model changes.
 */

/** Wire protocols a manifest can speak. Open set — extend, don't replace. */
export const PROTOCOLS = ["mcp", "rest"] as const;
export type Protocol = (typeof PROTOCOLS)[number];

/**
 * How the router reaches a connector.
 * - `direct`: connector exposes a publicly reachable API (SaaS).
 * - `tunnel`: connector lives behind a tunnel the router dials into
 *   (reserved for wave 2 — the architecture supports it without a rebuild).
 */
export const CONNECTION_MODES = ["direct", "tunnel"] as const;
export type ConnectionMode = (typeof CONNECTION_MODES)[number];

/** The two sides of the marketplace. */
export const LISTING_KINDS = ["connector", "agent"] as const;
export type ListingKind = (typeof LISTING_KINDS)[number];

/**
 * A single normalized invocation flowing from a requesting agent toward a
 * connector. Protocol adapters translate this into the connector's native
 * wire format. The router never inspects or persists `input`.
 */
export interface RoutedInvocation {
  /** Capability/tool/endpoint being called, as declared in the manifest. */
  capability: string;
  /** Opaque, caller-supplied arguments. Passed through untouched. */
  input: unknown;
  /** Correlates a request with its streamed responses within a session. */
  requestId: string;
}

/** Discriminated, normalized events streamed back toward the requesting agent. */
export type RoutedEvent =
  | { type: "chunk"; requestId: string; data: unknown }
  | { type: "result"; requestId: string; data: unknown }
  | { type: "error"; requestId: string; message: string; code?: string };

/** Lightweight, payload-free metrics the router is allowed to retain. */
export interface InvocationMetrics {
  requestId: string;
  capability: string;
  startedAt: number;
  endedAt: number;
  /** Byte counts only — never the bytes themselves (non-custodial). */
  requestBytes: number;
  responseBytes: number;
  status: "ok" | "error";
  errorCode?: string;
}
