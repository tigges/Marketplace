# appbazaar.ai — Handover

A neutral registry + non-custodial routing layer + billing for AI agents and
data connectors. This document is everything the next owner needs to run,
deploy, and extend the MVP.

- **Branch:** `cursor/appbazaar-mvp-7dcd` · **PR:** #1
- **Live demo:** https://appbazaar-demo.c-bcf.workers.dev (ephemeral, in-memory; resets periodically)

---

## 1. Status at a glance

| Phase | Scope | Status |
| --- | --- | --- |
| 1 — Registry | Next.js directory + manifest submission, Postgres | ✅ built, builds & runs |
| 2 — Routing layer | Stateless multi-tenant SSE router, direct + tunnel modes | ✅ direct done; tunnel wired (wave 2) |
| 3 — Identity & billing | API keys, prepaid wallet, usage ledger, revenue splits, payouts | ✅ built |
| Live demo | Public Cloudflare Worker of the end-to-end flow | ✅ deployed |
| Router Worker | Production Cloudflare Worker (`appbazaar-router`) | ✅ deployed (needs DATABASE_URL secret) |
| Stripe billing | Checkout top-ups + Connect payouts | ✅ wired (needs STRIPE_SECRET_KEY) |

**Verification (all green):** `pnpm typecheck` (all packages) · `pnpm test` (18 passing) · `pnpm --filter @appbazaar/registry build`.

---

## 1a. Deployed services

| Service | URL | Notes |
| --- | --- | --- |
| Live demo worker | https://appbazaar-demo.c-bcf.workers.dev | In-memory, ephemeral |
| Router worker | https://appbazaar-router.c-bcf.workers.dev | Needs DATABASE_URL secret wired |
| Registry | Not yet on Vercel | Needs VERCEL_TOKEN |

---

## 1b. DATABASE_URL fix required

`DATABASE_URL` is currently set to the Supabase REST API URL (`https://...`), not a PostgreSQL
connection string.  The registry detects this and falls back to PGlite (with a console warning),
so the app runs but data is ephemeral.

To connect to Supabase Postgres:
1. Go to Supabase Dashboard → Project Settings → Database → Connection string.
2. Choose **Session mode** (port 5432).
3. Copy the `postgresql://postgres.[ref]:[password]@...` string.
4. Set it as the `DATABASE_URL` secret in Cursor Dashboard → Cloud Agents → Secrets.
5. For the router worker: `wrangler secret put DATABASE_URL` (in `apps/router/`).

Apply the new Stripe Connect migration while you're there:
```sql
-- packages/db/src/migrations/0001_stripe_connect.sql
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_connect_account_id text;
```

---

## 2. Repository map

```
packages/core         types, manifest schema (zod), pricing, revenue splits, API keys
packages/db           Drizzle schema + repositories; PGlite (local) / postgres-js (Supabase)
packages/router-core  stateless routing engine: adapters (MCP/REST), transports (direct/tunnel),
                      session store + pub/sub backplane abstractions
apps/router           Node SSE server (src/server.ts) + Cloudflare Worker/DO entry (src/worker.ts)
apps/registry         Next.js directory + dashboard + billing/identity API
apps/demo-worker      the deployed live demo (self-contained Cloudflare Worker)
examples              reference REST connector + end-to-end demo script
tests                 integration tests proving the success metric
```

---

## 3. Run it locally (zero external services)

Requires Node 20+ and `pnpm`. With nothing configured it uses embedded PGlite.

```bash
pnpm install
pnpm test        # full suite: register -> discover -> route -> log -> bill
pnpm demo        # end-to-end demo over real HTTP through the router
```

Run the services individually:

```bash
pnpm --filter @appbazaar/examples run connector   # reference connector  :8787
pnpm dev:router                                    # routing layer        :8888
pnpm dev:registry                                  # registry + dashboard :3000
pnpm --filter @appbazaar/db run seed               # sample data + an API key (printed once)
```

> Each process uses its own embedded DB unless you point them all at the same
> `DATABASE_URL`. For a true cross-process run, set `DATABASE_URL` to a shared
> Postgres. The in-process `pnpm demo` and `pnpm test` exercise the full flow
> without any external service.

Call a connector:

```bash
curl -X POST http://localhost:8888/v1/invoke/<listingId> \
  -H "Authorization: Bearer $APPBAZAAR_API_KEY" \
  -H "Content-Type: application/json" \
  -d '{"capability":"reverse","input":{"text":"appbazaar"}}'
```

---

## 4. The live demo

- URL: **https://appbazaar-demo.c-bcf.workers.dev** · API key: `ab_live_demo`
- Code: `apps/demo-worker/` (self-contained, dependency-free so it bundles for Workers).
- State lives in a single **Durable Object** (`DemoStore`) — globally consistent but ephemeral.
- Redeploy:
  ```bash
  cd apps/demo-worker
  CLOUDFLARE_API_TOKEN=… CLOUDFLARE_ACCOUNT_ID=… npx wrangler deploy
  ```
- It demonstrates routing + billing faithfully but is **not** the production
  registry (no Postgres, no human auth). Use it for demos, not as the product.

---

## 5. Going to full production

Add these as secrets (Cursor Dashboard → Cloud Agents → Secrets, or your CI/host),
then deploy each piece. See `.env.example` for the full list.

| Secret | Used by | Purpose |
| --- | --- | --- |
| `DATABASE_URL` | registry + router | Supabase Postgres (shared state) |
| `VERCEL_TOKEN` | registry | Vercel deploy |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | router worker | cross-instance pub/sub backplane |
| `CLERK_SECRET_KEY` / `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY` | registry | human auth |
| `STRIPE_SECRET_KEY` / `STRIPE_CONNECT_CLIENT_ID` | billing | wallet top-ups + creator payouts |

**Registry (Phase 1/3) → Vercel**
1. Set `DATABASE_URL` (Supabase) and Clerk/Stripe keys as Vercel env vars.
2. Apply the schema once: run `packages/db/src/migrations/0000_init.sql` against Supabase (or `drizzle-kit`).
3. Deploy `apps/registry` (root dir = repo, project = `apps/registry`).
4. Wire `apps/registry/src/lib/auth.ts` to Clerk's `auth()` (a clearly marked seam; the rest of the app already uses the tenant abstraction).

**Routing layer (Phase 2) → Cloudflare Workers**
1. Use `apps/router/src/worker.ts` + `apps/router/wrangler.toml`.
2. Provide Postgres access (Supabase via Hyperdrive binding or `DATABASE_URL`), set Upstash secrets via `wrangler secret put`.
3. The Worker uses Durable Objects for session state and the Upstash backplane for fan-out. Billing hooks are wired identically to the Node server (`apps/router/src/wiring.ts`).

**Stripe**: top-ups are direct credit grants in MVP — replace `POST /api/wallet`
with a Stripe Checkout webhook; payouts are created via `requestPayout` and
should be settled with a Stripe Connect transfer, then `markPayoutPaid`.

**Stripe (wired — needs keys):**
- `POST /api/wallet` — when `STRIPE_SECRET_KEY` is set, returns `{ checkoutUrl }` (Stripe Checkout session). When absent, grants credits directly (dev/demo mode).
- `POST /api/stripe/webhook` — handles `checkout.session.completed` → credits wallet; `transfer.created` → marks payout paid. Set `STRIPE_WEBHOOK_SECRET` for signature verification.
- `GET /api/stripe/connect` — initiates Stripe Connect OAuth for creator onboarding.
- `GET /api/stripe/connect/callback` — completes OAuth, stores `stripeConnectAccountId` on the tenant.
- `POST /api/payouts/[id]/settle` — creates a Stripe Connect transfer and calls `markPayoutPaid`.

New secrets needed:
```
STRIPE_SECRET_KEY          Stripe dashboard → Developers → API keys
STRIPE_CONNECT_CLIENT_ID   Stripe dashboard → Connect → Settings
STRIPE_WEBHOOK_SECRET      Stripe dashboard → Webhooks → signing secret
```

New Supabase migration: `packages/db/src/migrations/0001_stripe_connect.sql`
```sql
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_connect_account_id text;
```

---

## 6. Architecture guarantees (don't break these)

- **Non-custodial:** payloads stream through the router and are NEVER persisted.
  Only `CallMetrics` (byte counts, timing, status) reach the ledger. The single
  place data leaves the engine is `BillingHooks.settle`, and it's metadata only.
- **Stateless router:** no engine-local state. Session state → `SessionStore`
  (Durable Objects). Event delivery → `Backplane` (Upstash). Any instance can
  serve any request.
- **Protocol-agnostic:** add a protocol = add a `ProtocolAdapter` in
  `packages/router-core/src/adapters`. The data model and billing don't change.
- **Two connector modes:** `direct` is implemented; `tunnel` is wired end-to-end
  (registry stores tunnel manifests, engine selects `TunnelTransport`). It
  raises `tunnel_not_implemented` until a `TunnelRegistry` is supplied.

---

## 7. Known limitations / wave 2

- **Tunnel transport** is not implemented — wire `TunnelTransport` to a real
  tunnel registry (`packages/router-core/src/transports/tunnel.ts`).
- **PGlite + production Next build:** PGlite is dev-only; production must use
  `DATABASE_URL`. The PGlite client is injected from app code so Next can
  externalize its wasm loader (see `apps/registry/src/lib/db.ts`).
- **Human auth** uses a dev-tenant cookie until Clerk keys are set.
- **Payouts** are manual (Stripe Connect transfer + `markPayoutPaid`).
- **Demo worker** state is ephemeral/in-memory.

---

## 8. Common commands

```bash
pnpm test            # vitest suite
pnpm typecheck       # typecheck every package
pnpm build           # typecheck + build registry
pnpm demo            # end-to-end demo
pnpm --filter @appbazaar/db run seed   # seed sample data + print an API key
```

---

## 9. Key files to read first

1. `packages/router-core/src/engine.ts` — the routing engine + non-custodial guarantee.
2. `packages/core/src/manifest.ts` — the protocol-agnostic listing schema.
3. `packages/db/src/repo/billing.ts` — wallet debit + revenue split + ledger in one transaction.
4. `apps/router/src/server.ts` + `wiring.ts` — how the engine is exposed over HTTP/SSE.
5. `README.md` — architecture overview and deployment table.
