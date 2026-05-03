import pg from 'pg';
import { config } from '../config.js';

export const pool = new pg.Pool({ connectionString: config.databaseUrl });

export async function query(text, params) {
  return pool.query(text, params);
}

export async function initPostgres() {
  await query('CREATE EXTENSION IF NOT EXISTS pgcrypto');
  await query(`
    CREATE TABLE IF NOT EXISTS plans (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      name TEXT UNIQUE NOT NULL,
      included_requests INT NOT NULL,
      overage_paise INT NOT NULL,
      rate_limit_per_minute INT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS users (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      email TEXT UNIQUE NOT NULL,
      password TEXT NOT NULL,
      role TEXT DEFAULT 'owner',
      plan_id UUID REFERENCES plans(id),
      spend_alert_paise INT DEFAULT 500000,
      spend_hard_cap_paise INT DEFAULT 1000000,
      stripe_customer_id TEXT,
      stripe_subscription_id TEXT,
      stripe_subscription_status TEXT,
      stripe_plan_id TEXT,
      webhook_url TEXT,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS api_configs (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      base_url TEXT NOT NULL,
      created_at TIMESTAMPTZ DEFAULT NOW()
    );

    CREATE TABLE IF NOT EXISTS api_keys (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      api_id UUID NOT NULL REFERENCES api_configs(id) ON DELETE CASCADE,
      user_id UUID NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      key_hash TEXT UNIQUE NOT NULL,
      label TEXT NOT NULL,
      environment TEXT NOT NULL DEFAULT 'test',
      status TEXT NOT NULL DEFAULT 'active',
      grace_expires_at TIMESTAMPTZ,
      created_at TIMESTAMPTZ DEFAULT NOW(),
      revoked_at TIMESTAMPTZ
    );

    CREATE TABLE IF NOT EXISTS billing_periods (
      id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
      user_id UUID REFERENCES users(id),
      starts_at TIMESTAMPTZ,
      ends_at TIMESTAMPTZ,
      total_reqs INT DEFAULT 0,
      amount_paise INT DEFAULT 0,
      status TEXT DEFAULT 'open',
      idempotency_key TEXT UNIQUE,
      stripe_invoice_id TEXT,
      payment_status TEXT DEFAULT 'pending'
    );
  `);

  await query(`
    INSERT INTO plans (name, included_requests, overage_paise, rate_limit_per_minute)
    VALUES ('Free 1000', 1000, 10, 60)
    ON CONFLICT (name) DO NOTHING
  `);
}
