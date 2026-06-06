/**
 * Initial schema as an inlined string so it bundles cleanly everywhere
 * (Node, Next serverless, Cloudflare Workers) with no filesystem access.
 * Kept identical to `0000_init.sql`, which exists for drizzle-kit / manual ops.
 */
export const INIT_SQL = /* sql */ `
CREATE TABLE IF NOT EXISTS tenants (
  id          text PRIMARY KEY,
  slug        text NOT NULL,
  name        text NOT NULL,
  clerk_ref   text,
  created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS tenants_slug_uq ON tenants (slug);

CREATE TABLE IF NOT EXISTS manifests (
  id               text PRIMARY KEY,
  owner_tenant_id  text NOT NULL REFERENCES tenants(id),
  slug             text NOT NULL,
  name             text NOT NULL,
  description      text NOT NULL,
  kind             text NOT NULL,
  protocol         text NOT NULL,
  connection_mode  text NOT NULL,
  connection       jsonb NOT NULL,
  pricing_model    text NOT NULL,
  price_credits    integer NOT NULL DEFAULT 0,
  capabilities     jsonb NOT NULL,
  tags             jsonb NOT NULL DEFAULT '[]'::jsonb,
  homepage         text,
  status           text NOT NULL DEFAULT 'published',
  created_at       timestamptz NOT NULL DEFAULT now(),
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS manifests_slug_uq ON manifests (slug);
CREATE INDEX IF NOT EXISTS manifests_owner_idx ON manifests (owner_tenant_id);
CREATE INDEX IF NOT EXISTS manifests_kind_idx ON manifests (kind);

CREATE TABLE IF NOT EXISTS api_keys (
  id             text PRIMARY KEY,
  tenant_id      text NOT NULL REFERENCES tenants(id),
  name           text NOT NULL,
  display_prefix text NOT NULL,
  hash           text NOT NULL,
  last_used_at   timestamptz,
  revoked_at     timestamptz,
  created_at     timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS api_keys_hash_uq ON api_keys (hash);

CREATE TABLE IF NOT EXISTS wallets (
  id              text PRIMARY KEY,
  tenant_id       text NOT NULL REFERENCES tenants(id),
  balance_credits integer NOT NULL DEFAULT 0,
  updated_at      timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS wallets_tenant_uq ON wallets (tenant_id);

CREATE TABLE IF NOT EXISTS wallet_transactions (
  id             text PRIMARY KEY,
  wallet_id      text NOT NULL REFERENCES wallets(id),
  kind           text NOT NULL,
  amount_credits integer NOT NULL,
  balance_after  integer NOT NULL,
  reference      text,
  created_at     timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE IF NOT EXISTS usage_ledger (
  id                   text PRIMARY KEY,
  call_id              text NOT NULL,
  requester_tenant_id  text NOT NULL REFERENCES tenants(id),
  manifest_id          text NOT NULL REFERENCES manifests(id),
  creator_tenant_id    text NOT NULL REFERENCES tenants(id),
  capability           text NOT NULL,
  status               text NOT NULL,
  error_code           text,
  request_bytes        integer NOT NULL DEFAULT 0,
  response_bytes       integer NOT NULL DEFAULT 0,
  duration_ms          integer NOT NULL DEFAULT 0,
  gross_credits        integer NOT NULL DEFAULT 0,
  platform_fee_credits integer NOT NULL DEFAULT 0,
  creator_credits      integer NOT NULL DEFAULT 0,
  fee_bps              integer NOT NULL DEFAULT 0,
  created_at           timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS usage_ledger_call_uq ON usage_ledger (call_id);
CREATE INDEX IF NOT EXISTS usage_ledger_requester_idx ON usage_ledger (requester_tenant_id);
CREATE INDEX IF NOT EXISTS usage_ledger_creator_idx ON usage_ledger (creator_tenant_id);

CREATE TABLE IF NOT EXISTS earnings (
  id               text PRIMARY KEY,
  tenant_id        text NOT NULL REFERENCES tenants(id),
  balance_credits  integer NOT NULL DEFAULT 0,
  lifetime_credits integer NOT NULL DEFAULT 0,
  paid_out_credits integer NOT NULL DEFAULT 0,
  updated_at       timestamptz NOT NULL DEFAULT now()
);
CREATE UNIQUE INDEX IF NOT EXISTS earnings_tenant_uq ON earnings (tenant_id);

CREATE TABLE IF NOT EXISTS payouts (
  id                 text PRIMARY KEY,
  tenant_id          text NOT NULL REFERENCES tenants(id),
  amount_credits     integer NOT NULL,
  status             text NOT NULL DEFAULT 'pending',
  stripe_transfer_id text,
  created_at         timestamptz NOT NULL DEFAULT now()
);

-- Idempotent additions for Stripe Connect support
ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_connect_account_id text;
`;
