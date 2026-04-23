const { Pool } = require('pg')

const pool = new Pool({
  connectionString: 'postgresql://postgres:kcCpIhXXITFEtjGYpMkenUzkhdugnOpx@junction.proxy.rlwy.net:15981/railway',
  ssl: { rejectUnauthorized: false },
})

const sql = `
  CREATE TABLE IF NOT EXISTS tenants (
    id          TEXT PRIMARY KEY,
    email       TEXT,
    shopify_domain        TEXT,
    shopify_access_token  TEXT,
    fb_ad_account_id      TEXT,
    fb_access_token       TEXT,
    onboarded   BOOLEAN DEFAULT FALSE,
    created_at  TIMESTAMPTZ DEFAULT NOW(),
    updated_at  TIMESTAMPTZ DEFAULT NOW()
  );

  ALTER TABLE shopify_orders              ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);
  ALTER TABLE shopify_order_items         ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);
  ALTER TABLE shopify_daily_metrics       ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);
  ALTER TABLE shopify_abandoned_checkouts ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);
  ALTER TABLE shopify_country_metrics     ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);
  ALTER TABLE shopify_products            ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);
  ALTER TABLE fb_ad_daily_metrics         ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);
  ALTER TABLE fb_ads                      ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);
  ALTER TABLE fb_ad_breakdowns            ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);
  ALTER TABLE sync_runs                   ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);
  ALTER TABLE profit_settings             ADD COLUMN IF NOT EXISTS tenant_id TEXT REFERENCES tenants(id);

  CREATE INDEX IF NOT EXISTS idx_shopify_orders_tenant      ON shopify_orders(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_fb_ad_daily_metrics_tenant ON fb_ad_daily_metrics(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_fb_ads_tenant              ON fb_ads(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_fb_ad_breakdowns_tenant    ON fb_ad_breakdowns(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_sync_runs_tenant           ON sync_runs(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_profit_settings_tenant     ON profit_settings(tenant_id);
`

pool.query(sql)
  .then(() => { console.log('✓ Migration complete'); process.exit(0) })
  .catch(err => { console.error('✗ Error:', err.message); process.exit(1) })
