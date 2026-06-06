import { AppError, type ConnectionMode, type Protocol } from "@appbazaar/core";
import {
  type Database,
  assertSufficientCredits,
  getManifestById,
  settleCall,
} from "@appbazaar/db";
import {
  type Backplane,
  type BillingContext,
  type BillingHooks,
  type CallMetrics,
  DirectTransport,
  InMemoryBackplane,
  InMemorySessionStore,
  McpAdapter,
  RestAdapter,
  RouterEngine,
  type ResolvedManifest,
  type SessionStore,
  TunnelTransport,
  UpstashBackplane,
  type UpstashLike,
} from "@appbazaar/router-core";
import { DEFAULT_PLATFORM_FEE_BPS } from "@appbazaar/core";

const FEE_BPS = Number(process.env.PLATFORM_FEE_BPS ?? DEFAULT_PLATFORM_FEE_BPS);

/** Look up a manifest and project it into the engine's value object. */
function makeResolveManifest(db: Database) {
  return async (manifestId: string): Promise<ResolvedManifest | null> => {
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

/** Billing hooks backed by the Postgres wallet/ledger/earnings tables. */
export function createBillingHooks(db: Database): BillingHooks {
  return {
    async preauthorize(ctx: BillingContext) {
      await assertSufficientCredits(db, ctx.requesterTenantId, ctx.manifest);
    },
    async settle(ctx: BillingContext, metrics: CallMetrics) {
      await settleCall(db, {
        callId: metrics.callId,
        requesterTenantId: ctx.requesterTenantId,
        manifest: ctx.manifest,
        capability: ctx.capability,
        status: metrics.status,
        errorCode: metrics.errorCode,
        requestBytes: metrics.requestBytes,
        responseBytes: metrics.responseBytes,
        durationMs: metrics.durationMs,
        feeBps: FEE_BPS,
      });
    },
  };
}

export interface RouterRuntime {
  engine: RouterEngine;
  backplane: Backplane;
  sessions: SessionStore;
}

/**
 * Build the routing engine. By default everything is in-process (fine for a
 * single node and for tests). Pass an Upstash client and/or a Durable-Object
 * session store to scale horizontally without touching engine code.
 */
export function createRouterRuntime(
  db: Database,
  opts: { backplane?: Backplane; sessions?: SessionStore } = {},
): RouterRuntime {
  const backplane = opts.backplane ?? new InMemoryBackplane();
  const sessions = opts.sessions ?? new InMemorySessionStore();
  const engine = new RouterEngine({
    sessions,
    backplane,
    resolveManifest: makeResolveManifest(db),
    transports: {
      direct: new DirectTransport(),
      // Tunnel is wired but inactive in the MVP (wave 2). Registering a tunnel
      // registry here switches it on with no other changes.
      tunnel: new TunnelTransport(),
    },
    adapters: {
      rest: new RestAdapter(),
      mcp: new McpAdapter(),
    },
    billing: createBillingHooks(db),
  });
  return { engine, backplane, sessions };
}

/** Build an Upstash-backed backplane from env, if configured. */
export function maybeUpstashBackplane(client?: UpstashLike): Backplane | undefined {
  if (!client) return undefined;
  return new UpstashBackplane(client);
}

export function requireBearer(authorization: string | undefined | null): string {
  if (!authorization?.startsWith("Bearer ")) {
    throw new AppError("unauthorized", "missing Bearer API key");
  }
  return authorization.slice("Bearer ".length).trim();
}
