import {
  index,
  integer,
  jsonb,
  pgTable,
  text,
  timestamp,
  uniqueIndex,
} from "drizzle-orm/pg-core";
import type { Capability, Connection } from "@appbazaar/core";

/**
 * A tenant is the isolation boundary for routing, billing, and ownership.
 * A creator publishing connectors and a developer consuming them are both
 * tenants. In production a tenant maps to a Clerk org/user.
 */
export const tenants = pgTable(
  "tenants",
  {
    id: text("id").primaryKey(),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    clerkRef: text("clerk_ref"),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ slugUq: uniqueIndex("tenants_slug_uq").on(t.slug) }),
);

/** Published registry entries (connectors and agents). */
export const manifests = pgTable(
  "manifests",
  {
    id: text("id").primaryKey(),
    ownerTenantId: text("owner_tenant_id")
      .notNull()
      .references(() => tenants.id),
    slug: text("slug").notNull(),
    name: text("name").notNull(),
    description: text("description").notNull(),
    kind: text("kind").notNull(), // connector | agent
    protocol: text("protocol").notNull(), // mcp | rest | ...
    connectionMode: text("connection_mode").notNull(), // direct | tunnel
    connection: jsonb("connection").$type<Connection>().notNull(),
    pricingModel: text("pricing_model").notNull(), // free | per_call
    priceCredits: integer("price_credits").notNull().default(0),
    capabilities: jsonb("capabilities").$type<Capability[]>().notNull(),
    tags: jsonb("tags").$type<string[]>().notNull().default([]),
    homepage: text("homepage"),
    status: text("status").notNull().default("published"), // draft | published | disabled
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    slugUq: uniqueIndex("manifests_slug_uq").on(t.slug),
    ownerIdx: index("manifests_owner_idx").on(t.ownerTenantId),
    kindIdx: index("manifests_kind_idx").on(t.kind),
  }),
);

/** API keys for registered agents. Only the hash and a prefix are stored. */
export const apiKeys = pgTable(
  "api_keys",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    name: text("name").notNull(),
    displayPrefix: text("display_prefix").notNull(),
    hash: text("hash").notNull(),
    lastUsedAt: timestamp("last_used_at", { withTimezone: true }),
    revokedAt: timestamp("revoked_at", { withTimezone: true }),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ hashUq: uniqueIndex("api_keys_hash_uq").on(t.hash) }),
);

/** Prepaid credit wallet, one per tenant. */
export const wallets = pgTable(
  "wallets",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    balanceCredits: integer("balance_credits").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantUq: uniqueIndex("wallets_tenant_uq").on(t.tenantId) }),
);

/** Append-only wallet movements (top-ups, debits, refunds). */
export const walletTransactions = pgTable("wallet_transactions", {
  id: text("id").primaryKey(),
  walletId: text("wallet_id")
    .notNull()
    .references(() => wallets.id),
  kind: text("kind").notNull(), // topup | debit | refund
  amountCredits: integer("amount_credits").notNull(), // signed
  balanceAfter: integer("balance_after").notNull(),
  reference: text("reference"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

/**
 * One row per routed call. Records metadata ONLY — never request or response
 * payloads. This is what makes routing non-custodial and auditable at once.
 */
export const usageLedger = pgTable(
  "usage_ledger",
  {
    id: text("id").primaryKey(),
    callId: text("call_id").notNull(),
    requesterTenantId: text("requester_tenant_id")
      .notNull()
      .references(() => tenants.id),
    manifestId: text("manifest_id")
      .notNull()
      .references(() => manifests.id),
    creatorTenantId: text("creator_tenant_id")
      .notNull()
      .references(() => tenants.id),
    capability: text("capability").notNull(),
    status: text("status").notNull(), // ok | error
    errorCode: text("error_code"),
    requestBytes: integer("request_bytes").notNull().default(0),
    responseBytes: integer("response_bytes").notNull().default(0),
    durationMs: integer("duration_ms").notNull().default(0),
    grossCredits: integer("gross_credits").notNull().default(0),
    platformFeeCredits: integer("platform_fee_credits").notNull().default(0),
    creatorCredits: integer("creator_credits").notNull().default(0),
    feeBps: integer("fee_bps").notNull().default(0),
    createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({
    callUq: uniqueIndex("usage_ledger_call_uq").on(t.callId),
    requesterIdx: index("usage_ledger_requester_idx").on(t.requesterTenantId),
    creatorIdx: index("usage_ledger_creator_idx").on(t.creatorTenantId),
  }),
);

/** Running creator earnings balance, settled out via manual Stripe payouts. */
export const earnings = pgTable(
  "earnings",
  {
    id: text("id").primaryKey(),
    tenantId: text("tenant_id")
      .notNull()
      .references(() => tenants.id),
    balanceCredits: integer("balance_credits").notNull().default(0),
    lifetimeCredits: integer("lifetime_credits").notNull().default(0),
    paidOutCredits: integer("paid_out_credits").notNull().default(0),
    updatedAt: timestamp("updated_at", { withTimezone: true }).notNull().defaultNow(),
  },
  (t) => ({ tenantUq: uniqueIndex("earnings_tenant_uq").on(t.tenantId) }),
);

/** Manual Stripe Connect payouts. */
export const payouts = pgTable("payouts", {
  id: text("id").primaryKey(),
  tenantId: text("tenant_id")
    .notNull()
    .references(() => tenants.id),
  amountCredits: integer("amount_credits").notNull(),
  status: text("status").notNull().default("pending"), // pending | paid | failed
  stripeTransferId: text("stripe_transfer_id"),
  createdAt: timestamp("created_at", { withTimezone: true }).notNull().defaultNow(),
});

export type Tenant = typeof tenants.$inferSelect;
export type ManifestRow = typeof manifests.$inferSelect;
export type ApiKeyRow = typeof apiKeys.$inferSelect;
export type WalletRow = typeof wallets.$inferSelect;
export type UsageLedgerRow = typeof usageLedger.$inferSelect;
export type EarningsRow = typeof earnings.$inferSelect;
export type PayoutRow = typeof payouts.$inferSelect;
