import { NextResponse } from 'next/server'
import { pool } from '@/lib/db'

// One-time migration endpoint. Call once after deploying, then it becomes a no-op.
export async function POST() {
  const sql = `
    -- Tenants (one row per user)
    CREATE TABLE IF NOT EXISTS tenants (
      id          TEXT PRIMARY KEY,   -- Clerk user_id
      email       TEXT,
      shopify_domain        TEXT,
      shopify_access_token  TEXT,
      fb_ad_account_id      TEXT,
      fb_access_token       TEXT,
      onboarded   BOOLEAN DEFAULT FALSE,
      created_at  TIMESTAMPTZ DEFAULT NOW(),
      updated_at  TIMESTAMPTZ DEFAULT NOW()
    );

    -- Add tenant_id to all data tables (nullable so existing data is preserved)
    ALTER TABLE shopify_orders             ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);
    ALTER TABLE shopify_order_items        ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);
    ALTER TABLE shopify_daily_metrics      ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);
    ALTER TABLE shopify_abandoned_checkouts ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);
    ALTER TABLE shopify_country_metrics    ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);
    ALTER TABLE shopify_products           ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);
    ALTER TABLE fb_ad_daily_metrics        ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);
    ALTER TABLE fb_ads                     ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);
    ALTER TABLE fb_ad_breakdowns           ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);
    ALTER TABLE sync_runs                  ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);
    ALTER TABLE profit_settings            ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);

    -- Indexes
    CREATE INDEX IF NOT EXISTS idx_shopify_orders_tenant        ON shopify_orders(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_fb_ad_daily_metrics_tenant   ON fb_ad_daily_metrics(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_fb_ads_tenant                ON fb_ads(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_fb_ad_breakdowns_tenant      ON fb_ad_breakdowns(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_sync_runs_tenant             ON sync_runs(tenant_id);
    CREATE INDEX IF NOT EXISTS idx_profit_settings_tenant       ON profit_settings(tenant_id);
  `

  try {
    await pool.query(sql)
    return NextResponse.json({ ok: true, message: 'Migration complete' })
  } catch (err) {
    console.error('Migration error:', err)
    return NextResponse.json({ ok: false, error: String(err) }, { status: 500 })
  }
}
