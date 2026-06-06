# appbazaar.ai

**An open marketplace, registry, and non-custodial routing layer for AI agents and data connectors.**

appbazaar is a *neutral* registry and transaction clearinghouse: any AI agent can
discover, connect to, and pay for data connectors and other agents — regardless of
the technology on either side. The platform does **not** host models, run inference,
or ship a consumer chat UI. It is the plumbing between agents and the things they
need to call.

This repository contains a working MVP spanning all three phases of the plan.

```
                ┌────────────────────────┐
   creator ────▶│  Registry (Phase 1)    │   structured manifests:
                │  Next.js + Postgres    │   name, capabilities, protocol,
                └───────────┬────────────┘   connection mode, pricing
                            │ discover
                            ▼
 requesting     ┌────────────────────────┐   non-custodial SSE router:
 AI agent ─────▶│  Routing layer (P2)    │──▶ direct (public API) connector
  (API key)     │  stateless + scalable  │──▶ tunnel (wave 2, wired)
                └───────────┬────────────┘
                            │ payload-free metrics only
                            ▼
                ┌────────────────────────┐   API keys, prepaid wallet,
                │  Identity + billing(P3)│   usage ledger, revenue splits,
                │  wallet / ledger /     │   manual Stripe Connect payouts
                │  earnings / payouts    │
                └────────────────────────┘
```

## Why this design

- **Protocol-agnostic.** The registry and router only ever deal with normalized
  shapes. MCP and REST ship today; a new protocol is just a new `ProtocolAdapter`
  — nothing in the data model or billing changes. The architecture is *not* tied
  to MCP.
- **Non-custodial.** Raw request/response payloads stream straight through the
  router and are **never persisted**. The only thing retained is payload-free
  metadata (byte counts, timing, status) in the usage ledger.
- **Stateless & horizontally scalable.** The router owns no state. Session state
  lives in a `SessionStore` (Durable Objects in production), and event delivery
  goes through a pub/sub `Backplane` (Upstash Redis), so any instance can serve
  any request.
- **Two connector modes from day one.** `direct` (public SaaS APIs) is fully
  implemented; `tunnel` (firewalled connectors, wave 2) is wired end-to-end —
  the registry stores tunnel manifests and the engine selects the tunnel
  transport — so switching it on later needs no rebuild.

## Monorepo layout

| Path | Description |
| --- | --- |
| `packages/core` | Protocol-agnostic manifest schema (zod), pricing, revenue splits, API-key utilities, typed errors. No I/O. |
| `packages/db` | Drizzle schema + repositories. **PGlite** (embedded Postgres) for local/test, **postgres-js** (Supabase) for production. |
| `packages/router-core` | The stateless routing engine: protocol adapters (MCP, REST), connector transports (direct, tunnel), session store + backplane abstractions. Runtime-agnostic. |
| `apps/router` | Routing-layer runtimes: a Node SSE server (`src/server.ts`) and a Cloudflare Worker + Durable Object entry (`src/worker.ts`). |
| `apps/registry` | Phase 1 Next.js directory + Phase 3 identity/billing dashboard and API. |
| `examples` | A reference REST connector and an end-to-end demo script. |
| `tests` | Integration tests proving the MVP success metric. |

## Phase mapping

- **Phase 1 — Registry:** `apps/registry` (Next.js) + `packages/db` (Postgres/Supabase). Public directory, manifest submission, search/filter, listing detail.
- **Phase 2 — Routing layer:** `packages/router-core` + `apps/router`. Multi-tenant SSE transport, direct + tunnel modes, tenant isolation, non-custodial, Cloudflare Workers + Durable Objects + Upstash backplane.
- **Phase 3 — Identity & billing:** `packages/core` (API keys, splits) + `packages/db` (wallet/ledger/earnings/payouts) + registry dashboard. Clerk-ready auth seam, Stripe Connect payout hooks.

## Quickstart

Requirements: Node 20+ and `pnpm`. No database server needed locally — the stack
falls back to embedded PGlite.

```bash
pnpm install

# Run the whole test suite (register -> discover -> route -> log -> bill).
pnpm test

# Watch the end-to-end demo over real HTTP through the router.
pnpm demo
```

### Run the pieces

```bash
# Reference connector (the thing being called):
pnpm --filter @appbazaar/examples run connector      # http://localhost:8787

# Routing layer (Node SSE server):
pnpm dev:router                                       # http://localhost:8888

# Registry web app + dashboard:
pnpm dev:registry                                     # http://localhost:3000

# Seed sample listings + a funded tenant + an API key:
pnpm --filter @appbazaar/db run seed
```

> The registry, router, and CLI use **separate** embedded databases unless you
> point them all at the same `DATABASE_URL`. For a true cross-process run, set
> `DATABASE_URL` to a shared Postgres (e.g. Supabase). The in-process demo
> (`pnpm demo`) and the test suite exercise the full flow without external
> services.

## The success metric, demonstrated

`pnpm demo` (and `tests/router.e2e.test.ts`) prove the target flow with **zero
custom integration code**:

1. Developer A registers a connector (a structured manifest).
2. Developer B discovers it via the registry.
3. Developer B's agent connects through the routing layer with just an API key.
4. A real call is executed against the connector (the REST adapter maps the
   declared capability `reverse` → `POST /reverse` automatically).
5. The call is logged to the usage ledger and billed: caller wallet debited,
   creator earnings credited, platform fee taken — payloads never stored.

## Calling a connector

```bash
# Unary (request/response):
curl -X POST http://localhost:8888/v1/invoke/<listingId> \
  -H "Authorization: Bearer $APPBAZAAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"capability":"reverse","input":{"text":"appbazaar"}}'

# Streaming (SSE transport):
#  POST /v1/sessions            -> { sessionId, streamUrl, messagesUrl }
#  GET  {streamUrl}  (SSE)      -> events stream here
#  POST {messagesUrl}           -> drive invocations; events arrive on the stream
```

## Production deployment

| Concern | MVP (local) | Production |
| --- | --- | --- |
| Registry hosting | `next dev` | **Vercel** |
| Database | PGlite (embedded) | **Supabase Postgres** (`DATABASE_URL`) |
| Routing runtime | Node server (`apps/router`) | **Cloudflare Workers** (`apps/router/src/worker.ts`, `wrangler.toml`) |
| Session state | in-memory | **Durable Objects** |
| Pub/sub backplane | in-memory | **Upstash Redis** |
| Human auth | dev tenant cookie | **Clerk** (swap `apps/registry/src/lib/auth.ts`) |
| Payments | direct credit grants | **Stripe Connect** (wallet top-up webhook + payout transfers) |

See `.env.example` for the full list of environment variables, and
`apps/router/wrangler.toml` for the Worker bindings (Durable Object, Hyperdrive,
Upstash secrets).

## Hard constraints honored

- ❌ No AI inference / model hosting. ❌ No consumer chat UI.
- ✅ Not tied to MCP — protocol adapters are pluggable; MCP is just the first.
- ✅ Routing layer is stateless and horizontally scalable.
- ✅ Two connector modes designed in (direct implemented, tunnel wired for wave 2).
- ✅ Non-custodial — raw user data never persists on platform servers.

## Scripts

- `pnpm test` — run the vitest suite.
- `pnpm typecheck` — typecheck every package.
- `pnpm build` — typecheck + build the Next.js registry.
- `pnpm demo` — end-to-end demo over HTTP.
