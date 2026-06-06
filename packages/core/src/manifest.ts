import { z } from "zod";
import { CONNECTION_MODES, LISTING_KINDS, PROTOCOLS } from "./protocol.js";

/**
 * A capability is one callable unit a connector/agent exposes (an MCP tool,
 * a REST endpoint, etc.). Input/output schemas are stored as opaque JSON
 * Schema objects so the registry stays protocol-agnostic.
 */
export const capabilitySchema = z.object({
  name: z
    .string()
    .min(1)
    .max(128)
    .regex(/^[a-zA-Z0-9_.-]+$/, "use letters, numbers, '.', '_' or '-'"),
  description: z.string().max(2000).default(""),
  inputSchema: z.record(z.unknown()).optional(),
  outputSchema: z.record(z.unknown()).optional(),
});
export type Capability = z.infer<typeof capabilitySchema>;

export const pricingSchema = z.discriminatedUnion("model", [
  z.object({ model: z.literal("free") }),
  z.object({
    model: z.literal("per_call"),
    /** Price per successful call, in integer credits (1 credit = $0.001). */
    priceCredits: z.number().int().positive().max(10_000_000),
  }),
]);
export type Pricing = z.infer<typeof pricingSchema>;

/**
 * Direct connectors are reachable at a public HTTPS base URL. Tunnel
 * connectors only carry a tunnel id — the router resolves the live tunnel at
 * call time (wave 2). Validated as a discriminated union on `mode` so the
 * registry can accept tunnel manifests today without any router changes.
 */
export const connectionSchema = z.discriminatedUnion("mode", [
  z.object({
    mode: z.literal("direct"),
    baseUrl: z.string().url().refine((u) => u.startsWith("https://") || u.startsWith("http://"), {
      message: "baseUrl must be http(s)",
    }),
    /** Optional header name the connector expects its own upstream key in. */
    authHeader: z.string().max(128).optional(),
  }),
  z.object({
    mode: z.literal("tunnel"),
    /** Stable id the connector's tunnel client registers under. */
    tunnelId: z.string().min(8).max(128),
  }),
]);
export type Connection = z.infer<typeof connectionSchema>;

const slugSchema = z
  .string()
  .min(3)
  .max(64)
  .regex(/^[a-z0-9]+(?:-[a-z0-9]+)*$/, "lowercase kebab-case slug");

/** The structured manifest a creator submits to the registry. */
export const manifestSchema = z.object({
  schemaVersion: z.literal(1).default(1),
  slug: slugSchema,
  name: z.string().min(2).max(120),
  description: z.string().min(1).max(4000),
  kind: z.enum(LISTING_KINDS),
  protocol: z.enum(PROTOCOLS),
  connection: connectionSchema,
  pricing: pricingSchema,
  capabilities: z.array(capabilitySchema).min(1).max(200),
  homepage: z.string().url().optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).default([]),
});
export type Manifest = z.infer<typeof manifestSchema>;

/** Input accepted from the submit form / API (defaults applied on parse). */
export const manifestInputSchema = manifestSchema.extend({
  schemaVersion: z.literal(1).optional(),
  tags: z.array(z.string().min(1).max(40)).max(20).optional(),
});
export type ManifestInput = z.input<typeof manifestInputSchema>;

export function parseManifest(input: unknown): Manifest {
  return manifestSchema.parse(input);
}

export function safeParseManifest(input: unknown) {
  return manifestSchema.safeParse(input);
}

/** Cross-protocol sanity checks the zod schema can't express on its own. */
export function validateManifestSemantics(m: Manifest): string[] {
  const problems: string[] = [];
  const names = new Set<string>();
  for (const cap of m.capabilities) {
    if (names.has(cap.name)) problems.push(`duplicate capability: ${cap.name}`);
    names.add(cap.name);
  }
  if (m.protocol === "rest" && m.connection.mode === "direct" && !m.connection.baseUrl) {
    problems.push("REST direct connectors require a baseUrl");
  }
  return problems;
}

export { CONNECTION_MODES, LISTING_KINDS, PROTOCOLS };
