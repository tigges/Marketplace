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

`main` currently contains only a placeholder README. Application code lives on feature branches (notably `cursor/appbazaar-mvp-7dcd`). Check out a branch with the monorepo before installing or running services.

### `DATABASE_URL` and local PGlite

The Cloud Agent VM may inject `DATABASE_URL` (Supabase). When set, registry, router, and seed scripts use remote Postgres instead of embedded PGlite.

- **Tests and `pnpm demo`** always use in-process PGlite and do not need `DATABASE_URL`.
- **Running dev servers locally without Supabase** — unset `DATABASE_URL` so PGlite is used:

```bash
unset DATABASE_URL
pnpm dev:registry
```

If `DATABASE_URL` points at an unreachable or misconfigured Supabase instance, health checks and pages will fail with `ECONNRESET`. Unset it for zero-config local dev.

Each process (registry, router, seed) uses its **own** embedded PGlite unless they share a valid `DATABASE_URL`. For cross-process routing demos, either use `pnpm demo` (in-process) or point all processes at the same working Postgres URL.

### Services (local dev)

| Service | Port | Start command | Notes |
| --- | --- | --- | --- |
| Registry (Next.js) | 3000 | `unset DATABASE_URL && pnpm dev:registry` | Auto-seeds sample listings on first PGlite boot |
| Router (Node SSE) | 8888 | `unset DATABASE_URL && pnpm dev:router` | Separate embedded DB unless `DATABASE_URL` shared |
| Reference connector | 8787 | `pnpm --filter @appbazaar/examples run connector` | Used by router invoke demos |

No Docker, Redis, or external DB is required for tests, `pnpm demo`, or single-process registry browsing.

### Lint / test / build

There is no separate ESLint script. Use:

- `pnpm typecheck` — static analysis across packages
- `pnpm test` — Vitest suite (primary quality gate)
- `pnpm build` — production build of registry (PGlite is dev-only; production needs `DATABASE_URL`)

### pnpm build scripts

Root `package.json` sets `pnpm.onlyBuiltDependencies: ["esbuild"]`. If Next.js image optimization or Wrangler fail, you may need to add `sharp` or `workerd` to that list and run `pnpm rebuild`.

### Git workflow

- Default branch: `main` (placeholder only today)
- Agent feature branches: `cursor/<descriptive-name>-7033`
