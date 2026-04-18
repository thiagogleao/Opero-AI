const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:kcCpIhXXITFEtjGYpMkenUzkhdugnOpx@junction.proxy.rlwy.net:15981/railway',
  ssl: { rejectUnauthorized: false },
})

const sql = `
  CREATE TABLE IF NOT EXISTS tenants (
    id                    TEXT PRIMARY KEY,
    email                 TEXT,
    shopify_domain        TEXT,
    shopify_access_token  TEXT,
    fb_ad_account_id      TEXT,
    fb_access_token       TEXT,
    onboarded             BOOLEAN DEFAULT FALSE,
    created_at            TIMESTAMPTZ DEFAULT NOW(),
    updated_at            TIMESTAMPTZ DEFAULT NOW()
  );

  CREATE TABLE IF NOT EXISTS shopify_orders (
    id BIGINT PRIMARY KEY, tenant_id TEXT REFERENCES tenants(id),
    order_number INT, created_at TIMESTAMPTZ, processed_at TIMESTAMPTZ,
    financial_status TEXT, fulfillment_status TEXT, currency TEXT,
    total_price NUMERIC, subtotal_price NUMERIC, total_discounts NUMERIC,
    total_tax NUMERIC, total_shipping NUMERIC, customer_id BIGINT,
    customer_email TEXT, is_first_order BOOLEAN, tags TEXT,
    referring_site TEXT, landing_site TEXT, source_name TEXT,
    cancel_reason TEXT, cancelled_at TIMESTAMPTZ, refund_amount NUMERIC DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS shopify_order_items (
    id BIGINT PRIMARY KEY, tenant_id TEXT REFERENCES tenants(id),
    order_id BIGINT REFERENCES shopify_orders(id) ON DELETE CASCADE,
    product_id BIGINT, variant_id BIGINT, title TEXT, variant_title TEXT,
    sku TEXT, quantity INT, price NUMERIC, total_discount NUMERIC,
    fulfillment_status TEXT
  );

  CREATE TABLE IF NOT EXISTS shopify_daily_metrics (
    date DATE, tenant_id TEXT REFERENCES tenants(id),
    sessions INT DEFAULT 0, orders INT DEFAULT 0, revenue NUMERIC DEFAULT 0,
    conversion_rate NUMERIC DEFAULT 0, avg_order_value NUMERIC DEFAULT 0,
    returning_customer_rate NUMERIC DEFAULT 0, abandoned_checkouts INT DEFAULT 0,
    PRIMARY KEY (date, tenant_id)
  );

  CREATE TABLE IF NOT EXISTS shopify_abandoned_checkouts (
    id BIGINT, tenant_id TEXT REFERENCES tenants(id),
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
    email TEXT, total_price NUMERIC, currency TEXT, recovered BOOLEAN DEFAULT FALSE,
    PRIMARY KEY (id, tenant_id)
  );

  CREATE TABLE IF NOT EXISTS shopify_country_metrics (
    date DATE, tenant_id TEXT REFERENCES tenants(id), country_code TEXT,
    orders INT DEFAULT 0, revenue NUMERIC DEFAULT 0, customers INT DEFAULT 0,
    PRIMARY KEY (date, tenant_id, country_code)
  );

  CREATE TABLE IF NOT EXISTS shopify_products (
    id BIGINT, tenant_id TEXT REFERENCES tenants(id),
    title TEXT, product_type TEXT, vendor TEXT, status TEXT,
    created_at TIMESTAMPTZ, updated_at TIMESTAMPTZ,
    price_min NUMERIC, price_max NUMERIC, inventory_quantity INT,
    tags TEXT, image_url TEXT,
    PRIMARY KEY (id, tenant_id)
  );

  CREATE TABLE IF NOT EXISTS fb_ad_daily_metrics (
    date DATE, tenant_id TEXT REFERENCES tenants(id), ad_id TEXT,
    impressions INT DEFAULT 0, clicks INT DEFAULT 0, spend NUMERIC DEFAULT 0,
    purchases INT DEFAULT 0, purchase_value NUMERIC DEFAULT 0,
    reach INT DEFAULT 0, frequency NUMERIC DEFAULT 0,
    ctr NUMERIC DEFAULT 0, cpm NUMERIC DEFAULT 0, cpc NUMERIC DEFAULT 0,
    roas NUMERIC DEFAULT 0,
    PRIMARY KEY (date, tenant_id, ad_id)
  );

  CREATE TABLE IF NOT EXISTS fb_ads (
    id TEXT, tenant_id TEXT REFERENCES tenants(id),
    name TEXT, status TEXT, effective_status TEXT,
    adset_id TEXT, adset_name TEXT, campaign_id TEXT, campaign_name TEXT,
    created_time TIMESTAMPTZ, updated_time TIMESTAMPTZ,
    thumbnail_url TEXT, preview_url TEXT,
    PRIMARY KEY (id, tenant_id)
  );

  CREATE TABLE IF NOT EXISTS fb_ad_breakdowns (
    date DATE, tenant_id TEXT REFERENCES tenants(id),
    ad_id TEXT, breakdown_type TEXT, breakdown_value TEXT,
    impressions INT DEFAULT 0, clicks INT DEFAULT 0, spend NUMERIC DEFAULT 0,
    purchases INT DEFAULT 0, purchase_value NUMERIC DEFAULT 0,
    PRIMARY KEY (date, tenant_id, ad_id, breakdown_type, breakdown_value)
  );

  CREATE TABLE IF NOT EXISTS sync_runs (
    id SERIAL PRIMARY KEY, tenant_id TEXT REFERENCES tenants(id),
    source TEXT, status TEXT, started_at TIMESTAMPTZ DEFAULT NOW(),
    finished_at TIMESTAMPTZ, records_upserted INT DEFAULT 0, error_message TEXT
  );

  CREATE TABLE IF NOT EXISTS profit_settings (
    id SERIAL PRIMARY KEY, tenant_id TEXT REFERENCES tenants(id) UNIQUE,
    settings JSONB NOT NULL DEFAULT '{}'
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
  CREATE INDEX IF NOT EXISTS idx_shopify_order_items_tenant ON shopify_order_items(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_fb_ad_daily_tenant         ON fb_ad_daily_metrics(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_fb_ads_tenant              ON fb_ads(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_sync_runs_tenant           ON sync_runs(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_profit_settings_tenant     ON profit_settings(tenant_id);
`

pool.query(sql)
  .then(() => { console.log('[db] schema ready'); pool.end(); process.exit(0) })
  .catch(err => { console.error('[db] migration error:', err.message); pool.end(); process.exit(1) })
