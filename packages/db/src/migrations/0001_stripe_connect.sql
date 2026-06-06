-- Migration 0001: Stripe Connect account ID on tenants
-- Run against Supabase (or any Postgres) after 0000_init.sql.
-- Safe to re-run (IF NOT EXISTS / IF NOT EXISTS guard).

ALTER TABLE tenants ADD COLUMN IF NOT EXISTS stripe_connect_account_id text;
