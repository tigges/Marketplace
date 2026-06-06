# appbazaar.ai — Handover

A neutral registry + non-custodial routing layer + billing for AI agents and
data connectors. This document is everything the next owner needs to run,
deploy, and extend the MVP.

- **Branch:** `cursor/deploy-router-stripe-b726` · **PR:** #3 (base: `cursor/appbazaar-mvp-7dcd` → PR #1)
- **Supabase project:** `hdxigqtrybduehpxgpyp` (ref only; URL in env `NEXT_PUBLIC_SUPABASE_URL`)
- **Live demo:** https://appbazaar-demo.c-bcf.workers.dev (ephemeral, in-memory; resets periodically)
- **Router worker:** https://appbazaar-router.c-bcf.workers.dev

---

## 1. Status at a glance

| Phase | Scope | Status |
| --- | --- | --- |
| 1 — Registry | Next.js directory + manifest submission, Postgres | ✅ built, builds & runs |
| 2 — Routing layer | Stateless multi-tenant SSE router, direct + tunnel modes | ✅ direct done; tunnel wired (wave 2) |
| 3 — Identity & billing | API keys, prepaid wallet, usage ledger, revenue splits, payouts | ✅ built |
| Live demo | Public Cloudflare Worker of the end-to-end flow | ✅ deployed |
| Router Worker | Production Cloudflare Worker (`appbazaar-router`) | ✅ deployed |
| Stripe billing | Checkout top-ups + Connect payouts | ✅ wired (needs STRIPE_SECRET_KEY) |

**Verification (all green):**
- `pnpm typecheck` — clean across all packages
- `pnpm test` — 18/18 passing

---

## 1a. Deployed services

| Service | URL | Status |
| --- | --- | --- |
| Live demo worker | https://appbazaar-demo.c-bcf.workers.dev | ✅ in-memory, ephemeral |
| Router worker | https://appbazaar-router.c-bcf.workers.dev | ✅ `backplane:"upstash"` · `db:"unconfigured"` (DATABASE_URL not yet wired) |
| Registry | Not yet on Vercel | ❌ VERCEL_TOKEN in secrets is invalid — regenerate from Vercel dashboard |

---

## 1b. DATABASE_URL — action required

The `DATABASE_URL` secret is currently set to the **Supabase REST API URL**
(`https://[ref].supabase.co/`) instead of a PostgreSQL connection string.
The registry detects this, logs a warning, and falls back to PGlite (confirmed
via `GET /api/health` → `"db":"pglite"`).

**Fix — three steps:**

1. **Get the correct connection string:**
   Supabase Dashboard → Project Settings → Database → Connection string (or URI tab).
   - For the **registry** (Next.js/Vercel): pick **Session mode** (port 5432)
   - For the **router worker** (Cloudflare Workers): pick **Transaction mode** (port 6543)
   
   Format: `postgresql://postgres.[project-ref]:[db-password]@aws-0-[region].pooler.supabase.com:5432/postgres`

2. **Update secrets:**
   - Cursor Dashboard → Cloud Agents → Secrets → `DATABASE_URL` (Session mode URL)
   - Router worker (Transaction mode URL):
     ```bash
     cd apps/router
     echo "postgresql://postgres.[ref]:[pw]@aws-0-[region].pooler.supabase.com:6543/postgres" \
       | npx wrangler secret put DATABASE_URL
     npx wrangler deploy
     ```

3. **Apply migration** — the `stripe_connect_account_id` column is missing from the live DB.
   Once DATABASE_URL is the correct `postgresql://` string, either:
   - Paste into Supabase SQL Editor: `ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_connect_account_id text;`
   - Or run: `DATABASE_URL="postgresql://..." pnpm migrate`
   - Or just redeploy the registry — it now **auto-applies idempotent migrations on first boot** when connected to Postgres.

4. **Verify:** `curl https://<registry-domain>/api/health` → `{"ok":true,"db":"postgres",...}`

**Note on VERCEL_TOKEN:** the token in Cursor Secrets starts with `prj_` which is a Vercel
project-scoped token but appears to be expired or from a different team. Regenerate from
Vercel Dashboard → Account Settings → Tokens, then update the secret.

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
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | registry | Supabase Auth (✅ already set) |
| `STRIPE_SECRET_KEY` / `STRIPE_CONNECT_CLIENT_ID` | billing | wallet top-ups + creator payouts |
| `STRIPE_WEBHOOK_SECRET` | billing | Stripe webhook signature verification |

**Registry (Phase 1/3) → Vercel**
1. Set `DATABASE_URL` (Session mode, port 5432), Supabase keys, and Stripe keys as Vercel env vars.
2. Apply the schema: run `pnpm migrate` with correct `DATABASE_URL`, or paste `0000_init.sql` + `0001_stripe_connect.sql` into Supabase SQL Editor.
3. Deploy `apps/registry` (root dir = repo, project dir = `apps/registry`):
   ```bash
   vercel --cwd apps/registry --prod
   ```

**Routing layer (Phase 2) → Cloudflare Workers**
1. Worker is deployed at https://appbazaar-router.c-bcf.workers.dev.
2. ✅ Upstash secrets are wired — `/health` now returns `"backplane":"upstash"`.
3. Still needed: DATABASE_URL (Transaction mode, port 6543):
   ```bash
   cd apps/router
   echo "postgresql://postgres.[ref]:[pw]@aws-0-[region].pooler.supabase.com:6543/postgres" \
     | npx wrangler secret put DATABASE_URL
   npx wrangler deploy
   ```

**Stripe**:
- `POST /api/wallet` — when `STRIPE_SECRET_KEY` is set, returns `{ checkoutUrl }` (Stripe Checkout, min 50 000 credits). When absent, grants credits directly (dev/demo mode).
- `POST /api/stripe/webhook` — handles `checkout.session.completed` → credits wallet; `transfer.created` → marks payout paid. Set `STRIPE_WEBHOOK_SECRET` for signature verification.
- `GET /api/stripe/connect` — initiates Stripe Connect OAuth for creator onboarding.
- `GET /api/stripe/connect/callback` — completes OAuth, stores `stripeConnectAccountId` on the tenant.
- `POST /api/payouts/[id]/settle` — creates a Stripe Connect transfer and calls `markPayoutPaid`.
- Register webhook in Stripe Dashboard → Webhooks → `https://<registry-domain>/api/stripe/webhook` → events: `checkout.session.completed`, `transfer.created`.

**Supabase Auth**: enabled via `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`
(both already set). Make sure Email provider is enabled in Supabase Dashboard → Authentication → Providers.

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

- **DATABASE_URL** is set to the Supabase REST API URL, not a PostgreSQL connection string; registry falls back to PGlite. Fix: see section 1b.
- **Supabase migration 0001** not yet applied to live DB: `stripe_connect_account_id` column missing. Fix: see section 1b (registry now auto-applies on first postgres boot).
- **Router worker** has no DATABASE_URL secret set; non-health routes return 503. Fix: see section 5.
- **VERCEL_TOKEN** is invalid (expired or wrong team). Regenerate from Vercel dashboard.
- **Tunnel transport** is not implemented — wire `TunnelTransport` to a real tunnel registry.
- **PGlite + production Next build:** PGlite is dev-only; production must use `DATABASE_URL`.
- **Human auth** uses a dev-tenant cookie until Supabase keys are set (they are ✅).
- **Payouts** are manual (Stripe Connect transfer + `markPayoutPaid`).
- **Demo worker** state is ephemeral/in-memory.

---

## 8. Common commands

```bash
pnpm test            # vitest suite (18 passing)
pnpm typecheck       # typecheck every package (clean)
pnpm build           # typecheck + build registry
pnpm demo            # end-to-end demo
pnpm migrate         # apply DB migrations (requires correct DATABASE_URL)
pnpm --filter @appbazaar/db run seed   # seed sample data + print an API key
```

---

## 9. Key files to read first

1. `packages/router-core/src/engine.ts` — the routing engine + non-custodial guarantee.
2. `packages/core/src/manifest.ts` — the protocol-agnostic listing schema.
3. `packages/db/src/repo/billing.ts` — wallet debit + revenue split + ledger in one transaction.
4. `apps/router/src/server.ts` + `wiring.ts` — how the engine is exposed over HTTP/SSE.
5. `apps/registry/src/lib/stripe.ts` — all Stripe logic in one place.
6. `README.md` — architecture overview and deployment table.
