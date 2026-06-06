# AGENTS.md

Guidance for AI agents working in this repository.

## Product

**appbazaar.ai** — an open marketplace, registry, and non-custodial routing layer for AI agents and data connectors. See `README.md` and `HANDOVER.md` for architecture and deployment details.

## Tech stack

| Layer | Choice |
| --- | --- |
| Runtime | Node.js 20+ (VM has v22 via nvm) |
| Package manager | pnpm 10 (`packageManager` field in root `package.json`) |
| Monorepo | pnpm workspaces (`apps/*`, `packages/*`, `examples`) |
| Registry UI | Next.js 14 (`apps/registry`) |
| Router | Node SSE server + Cloudflare Worker (`apps/router`) |
| Local DB | Embedded PGlite (no external Postgres required) |
| Tests | Vitest |

## Common commands

Run from repo root:

```bash
pnpm install          # install all workspace deps
pnpm test             # 18 integration tests (PGlite, in-process)
pnpm typecheck        # typecheck every package
pnpm build            # typecheck packages + build Next.js registry
pnpm demo             # end-to-end demo: register → route → bill
pnpm migrate          # apply DB migrations (requires valid DATABASE_URL)
pnpm dev:registry     # Next.js registry on :3000
pnpm dev:router       # routing layer on :8888
pnpm --filter @appbazaar/examples run connector   # reference connector on :8787
pnpm --filter @appbazaar/db run seed              # sample data + API key (PGlite only)
```

## Cursor Cloud specific instructions

### Environment bootstrap

Pre-checkout user install (snapshot/Dockerfile phase) should only activate pnpm via Corepack — **do not** run `pnpm install` before the repo is checked out:

```bash
corepack enable && corepack prepare pnpm@10.0.0 --activate
```

Dependency install runs from `.cursor/environment.json` → `install` after checkout (also the VM update script): `pnpm install`.

### Branch note

`main` currently contains only a placeholder README. Application code lives on feature branches (notably `cursor/appbazaar-mvp-7dcd`). Check out the working branch before installing or running services.

**Current working branch:** `cursor/deploy-router-stripe-b726` (PR #3, base: `cursor/appbazaar-mvp-7dcd`)

### `DATABASE_URL` and local PGlite

The Cloud Agent VM may inject `DATABASE_URL` from Cursor Secrets. When set to a valid `postgresql://` URL, registry and router use remote Postgres. When absent or set to a non-postgres URL, they fall back to embedded PGlite automatically.

- **Tests and `pnpm demo`** always use in-process PGlite — they never need `DATABASE_URL`.
- **Running dev servers locally without Supabase** — unset `DATABASE_URL` so PGlite is used:

```bash
unset DATABASE_URL
pnpm dev:registry
```

If `DATABASE_URL` is set to an unreachable or misconfigured Supabase instance, health checks will report `"db":"pglite"` (fallback active). The registry logs a warning and continues.

### Services (local dev)

| Service | Port | Start command | Notes |
| --- | --- | --- | --- |
| Registry (Next.js) | 3000 | `unset DATABASE_URL && pnpm dev:registry` | Auto-seeds sample listings on first PGlite boot |
| Router (Node SSE) | 8888 | `unset DATABASE_URL && pnpm dev:router` | Separate embedded DB unless `DATABASE_URL` shared |
| Reference connector | 8787 | `pnpm --filter @appbazaar/examples run connector` | Used by router invoke demos |

No Docker, Redis, or external DB is required for tests, `pnpm demo`, or single-process registry browsing.

### Quality gates

```bash
pnpm typecheck   # must pass clean
pnpm test        # 18/18 must pass
```

There is no separate ESLint script. TypeScript strict mode + Vitest are the quality gates.

### pnpm build scripts

Root `package.json` sets `pnpm.onlyBuiltDependencies: ["esbuild"]`. If Next.js image optimization or Wrangler fail to build, you may need to add `sharp` or `workerd` to that list and run `pnpm rebuild`.

### Deployment (production)

See `HANDOVER.md` section 5 for the full deployment guide. Short version:

| Target | Command | Requires |
| --- | --- | --- |
| Registry → Vercel | `vercel --cwd apps/registry --prod` | valid `VERCEL_TOKEN` + `DATABASE_URL` |
| Router → Cloudflare | `cd apps/router && npx wrangler deploy` | `CLOUDFLARE_API_TOKEN` + `CLOUDFLARE_ACCOUNT_ID` |
| Supabase migration | `pnpm migrate` | valid `postgresql://` `DATABASE_URL` |

### Git workflow

- Default branch: `main` (placeholder README only)
- Agent feature branches: `cursor/<descriptive-name>-<suffix>`
- New branches must be based off the correct feature branch, not `main`, when extending existing work.
