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
| Router worker | https://appbazaar-router.c-bcf.workers.dev | ✅ `backplane:"upstash"` · `db:"unconfigured"` (needs DATABASE_URL wired via wrangler) |
| Registry | Not yet on Vercel | ❌ needs valid VERCEL_TOKEN + correct DATABASE_URL |

---

## 1b. Secret status

Run the secret check to see current state:

```bash
node -e "
const keys = [
  'DATABASE_URL','NEXT_PUBLIC_SUPABASE_URL','NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY',
  'UPSTASH_REDIS_REST_URL','UPSTASH_REDIS_REST_TOKEN',
  'STRIPE_SECRET_KEY','STRIPE_CONNECT_CLIENT_ID','STRIPE_WEBHOOK_SECRET',
  'CLOUDFLARE_API_TOKEN','CLOUDFLARE_ACCOUNT_ID','VERCEL_TOKEN',
];
keys.forEach(k => {
  const v = process.env[k];
  const ok = v && !v.includes('<') && !v.includes('>');
  console.log(k, ok ? '✅' : (v ? '⚠️  set but invalid' : '❌ missing'));
});
"
```

| Secret | Status | Note |
| --- | --- | --- |
| `DATABASE_URL` | ⚠️ set to wrong value | Contains `https://` (Supabase REST URL), not `postgresql://`. Registry falls back to PGlite. See **1c**. |
| `NEXT_PUBLIC_SUPABASE_URL` | ✅ set | Correct |
| `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | ✅ set | Correct |
| `UPSTASH_REDIS_REST_URL` | ✅ set | Wired into router worker — `/health` returns `"backplane":"upstash"` |
| `UPSTASH_REDIS_REST_TOKEN` | ✅ set | Wired into router worker |
| `CLOUDFLARE_API_TOKEN` | ✅ set | Used for worker deploys |
| `CLOUDFLARE_ACCOUNT_ID` | ✅ set | Used for worker deploys |
| `VERCEL_TOKEN` | ⚠️ set but invalid | Token starts with `prj_` (project-scoped) or is expired. Regenerate from Vercel → Account Settings → Tokens. |
| `STRIPE_SECRET_KEY` | ❌ missing | Needed for Stripe Checkout top-ups |
| `STRIPE_CONNECT_CLIENT_ID` | ❌ missing | Needed for creator payouts |
| `STRIPE_WEBHOOK_SECRET` | ❌ missing | Needed for webhook signature verification |

---

## 1c. DATABASE_URL — action required

The `DATABASE_URL` secret is currently set to the **Supabase REST API URL**
(`https://[ref].supabase.co/`) instead of a PostgreSQL connection string.
The registry detects this, logs a warning, and falls back to PGlite.

**Fix — three steps:**

1. **Get the correct connection string:**
   Supabase Dashboard → Project Settings → Database → Connection string (or URI tab).
   - For the **registry** (Next.js/Vercel): pick **Session mode** (port 5432)
   - For the **router worker** (Cloudflare Workers): pick **Transaction mode** (port 6543)
   
   Format: `postgresql://postgres.[project-ref]:[password]@aws-0-[region].pooler.supabase.com:5432/postgres`

2. **Update Cursor Secrets:**
   Cursor Dashboard → Cloud Agents → Secrets → `DATABASE_URL` = Session mode URL (port 5432)

3. **Wire Transaction-mode URL into the router worker:**
   ```bash
   cd apps/router
   echo "postgresql://postgres.[ref]:[pw]@aws-0-[region].pooler.supabase.com:6543/postgres" \
     | npx wrangler secret put DATABASE_URL
   npx wrangler deploy
   ```

Once DATABASE_URL is the correct `postgresql://` string, the **registry auto-applies all migrations on first boot** (idempotent). No manual `pnpm migrate` is required unless you want to pre-warm before the first request.

**Verify:** `curl https://<registry-domain>/api/health` → `{"ok":true,"db":"postgres",...}`

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

**Tip:** If `DATABASE_URL` is set to an unreachable URL, unset it first:

```bash
unset DATABASE_URL && pnpm dev:registry
```

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

### What you need (in order)

1. **Fix `DATABASE_URL`** (section 1c) — unlocks registry Postgres + migrations.
2. **Regenerate `VERCEL_TOKEN`** — Vercel Dashboard → Account Settings → Tokens → create a new token (not project-scoped). Update Cursor Dashboard → Cloud Agents → Secrets.
3. **Deploy registry to Vercel:**
   ```bash
   # Set env vars on the Vercel project first:
   #   DATABASE_URL (Session mode, port 5432)
   #   NEXT_PUBLIC_SUPABASE_URL
   #   NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY
   #   STRIPE_SECRET_KEY, STRIPE_CONNECT_CLIENT_ID, STRIPE_WEBHOOK_SECRET (when available)
   vercel --cwd apps/registry --prod --token "$VERCEL_TOKEN"
   ```
   `apps/registry/vercel.json` is pre-configured for monorepo deployment.

4. **Wire DATABASE_URL into router worker** (Transaction mode, port 6543):
   ```bash
   cd apps/router
   echo "postgresql://postgres.[ref]:[pw]@aws-0-[region].pooler.supabase.com:6543/postgres" \
     | npx wrangler secret put DATABASE_URL
   npx wrangler deploy
   ```
   ✅ Upstash secrets already wired — worker currently returns `backplane:"upstash"`.

5. **Enable Supabase Email Auth:**
   Supabase Dashboard → Authentication → Providers → Email (enable). Already configured in code via `NEXT_PUBLIC_SUPABASE_URL` + `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY`.

6. **Activate Stripe** (when `STRIPE_SECRET_KEY` is available):
   - Set `STRIPE_SECRET_KEY`, `STRIPE_CONNECT_CLIENT_ID`, `STRIPE_WEBHOOK_SECRET` in Cursor Secrets AND as Vercel env vars on the registry project.
   - Register webhook in Stripe Dashboard → Webhooks → `https://<registry-domain>/api/stripe/webhook` → events: `checkout.session.completed`, `transfer.created`.
   - No code changes needed — all routes gate on the key being present.

### Secrets table

| Secret | Used by | Get from |
| --- | --- | --- |
| `DATABASE_URL` (port 5432) | registry (Vercel) | Supabase → Project Settings → Database → Session mode |
| `DATABASE_URL` (port 6543) | router (wrangler secret) | Supabase → Transaction mode |
| `VERCEL_TOKEN` | registry deploy | Vercel → Account Settings → Tokens |
| `UPSTASH_REDIS_REST_URL` / `_TOKEN` | router worker | ✅ already wired |
| `NEXT_PUBLIC_SUPABASE_URL` / `NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY` | registry | ✅ already set |
| `STRIPE_SECRET_KEY` | billing | Stripe → Developers → API keys |
| `STRIPE_CONNECT_CLIENT_ID` | creator payouts | Stripe → Connect → Settings |
| `STRIPE_WEBHOOK_SECRET` | webhook verification | Stripe → Webhooks → signing secret |
| `CLOUDFLARE_API_TOKEN` / `CLOUDFLARE_ACCOUNT_ID` | router deploy | ✅ already set |

---

## 6. Stripe API surface

| Method | Route | Behaviour |
| --- | --- | --- |
| POST | `/api/wallet` | `STRIPE_SECRET_KEY` set → `{ checkoutUrl }` (Checkout, min 50 000 credits). Unset → direct credit grant (dev mode). Body: `{ credits }` or `{ usdCents }`. |
| POST | `/api/stripe/webhook` | Handles `checkout.session.completed` → `topUp()`. `transfer.created` → `markPayoutPaid()`. Verifies signature when `STRIPE_WEBHOOK_SECRET` set. |
| GET | `/api/stripe/connect` | Redirects creator to Stripe Connect OAuth. Requires `STRIPE_CONNECT_CLIENT_ID`. |
| GET | `/api/stripe/connect/callback` | Exchanges OAuth code → stores `stripeConnectAccountId` on tenant → redirects to `/dashboard?connect=success`. |
| POST | `/api/payouts/[id]/settle` | Creates Stripe Connect transfer for a pending payout → `markPayoutPaid()`. |

---

## 7. Architecture guarantees (don't break these)

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

## 8. Known limitations / wave 2

- **DATABASE_URL** is set to the Supabase REST API URL, not a PostgreSQL connection string; registry falls back to PGlite. Fix: see section 1c.
- **Supabase migration** auto-applied on first postgres boot (registry calls `handle.migrate()` which runs idempotent `INIT_SQL` including the `stripe_connect_account_id` column).
- **Router worker** has no DATABASE_URL secret set; non-health routes return 503. Fix: see section 5 step 4.
- **VERCEL_TOKEN** is invalid (expired or project-scoped). Regenerate from Vercel dashboard (Account Settings, not project settings).
- **Stripe** not yet configured — routes gracefully return 503 when `STRIPE_SECRET_KEY` is absent.
- **Tunnel transport** is not implemented — wire `TunnelTransport` to a real tunnel registry.
- **PGlite + production Next build:** PGlite is dev-only; production must use `DATABASE_URL`.
- **Human auth** uses a dev-tenant cookie until Supabase keys are set (✅ they are set).
- **Payouts** are manual (Stripe Connect transfer + `markPayoutPaid`).
- **Demo worker** state is ephemeral/in-memory.

---

## 9. Common commands

```bash
pnpm test            # vitest suite (18 passing)
pnpm typecheck       # typecheck every package (clean)
pnpm build           # typecheck + build registry
pnpm demo            # end-to-end demo
pnpm migrate         # apply DB migrations (requires correct postgresql:// DATABASE_URL)
pnpm --filter @appbazaar/db run seed   # seed sample data + print an API key
```

---

## 10. Key files to read first

1. `packages/router-core/src/engine.ts` — the routing engine + non-custodial guarantee.
2. `packages/core/src/manifest.ts` — the protocol-agnostic listing schema.
3. `packages/db/src/repo/billing.ts` — wallet debit + revenue split + ledger in one transaction.
4. `apps/router/src/server.ts` + `wiring.ts` — how the engine is exposed over HTTP/SSE.
5. `apps/registry/src/lib/stripe.ts` — all Stripe logic in one place.
6. `apps/registry/src/lib/db.ts` — PGlite/Postgres selection + auto-migration on first boot.
7. `README.md` — architecture overview and deployment table.
