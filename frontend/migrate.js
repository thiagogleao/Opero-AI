const { Pool } = require('pg')

const pool = new Pool({
  connectionString: process.env.DATABASE_URL || 'postgresql://postgres:kcCpIhXXITFEtjGYpMkenUzkhdugnOpx@junction.proxy.rlwy.net:15981/railway',
  ssl: { rejectUnauthorized: false },
})

const sql = `
  -- ══════════════════════════════════════════════════════════════
  -- Tenants
  -- ══════════════════════════════════════════════════════════════
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

  -- ══════════════════════════════════════════════════════════════
  -- Drop tables with old incompatible schema (no data yet)
  -- ══════════════════════════════════════════════════════════════
  DO $$
  BEGIN
    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'shopify_orders' AND column_name = 'order_id'
    ) THEN
      DROP TABLE IF EXISTS shopify_order_items CASCADE;
      DROP TABLE IF EXISTS shopify_orders CASCADE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'fb_ads' AND column_name = 'ad_id'
    ) THEN
      DROP TABLE IF EXISTS fb_ads CASCADE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'shopify_products' AND column_name = 'product_id'
    ) THEN
      DROP TABLE IF EXISTS shopify_products CASCADE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'shopify_abandoned_checkouts' AND column_name = 'checkout_id'
    ) THEN
      DROP TABLE IF EXISTS shopify_abandoned_checkouts CASCADE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'shopify_daily_metrics' AND column_name = 'total_revenue'
    ) THEN
      DROP TABLE IF EXISTS shopify_daily_metrics CASCADE;
    END IF;

    IF NOT EXISTS (
      SELECT 1 FROM information_schema.columns
      WHERE table_name = 'shopify_country_metrics' AND column_name = 'orders_count'
    ) THEN
      DROP TABLE IF EXISTS shopify_country_metrics CASCADE;
    END IF;
  END $$;

  -- ══════════════════════════════════════════════════════════════
  -- Shopify tables (Python-model-compatible schema)
  -- ══════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS shopify_orders (
    id               BIGSERIAL PRIMARY KEY,
    order_id         TEXT UNIQUE NOT NULL,
    tenant_id        TEXT REFERENCES tenants(id),
    order_number     INT,
    created_at       TIMESTAMPTZ,
    processed_at     TIMESTAMPTZ,
    financial_status TEXT,
    fulfillment_status TEXT,
    currency         TEXT,
    total_price      NUMERIC,
    subtotal_price   NUMERIC,
    total_discounts  NUMERIC,
    total_tax        NUMERIC,
    total_shipping   NUMERIC,
    country_code     TEXT,
    customer_id      TEXT,
    customer_email   TEXT,
    is_first_order   BOOLEAN,
    tags             TEXT,
    referring_site   TEXT,
    landing_site     TEXT,
    source_name      TEXT,
    cancel_reason    TEXT,
    cancelled_at     TIMESTAMPTZ,
    refund_amount    NUMERIC DEFAULT 0
  );

  CREATE TABLE IF NOT EXISTS shopify_order_items (
    id               BIGSERIAL PRIMARY KEY,
    tenant_id        TEXT REFERENCES tenants(id),
    order_id         TEXT NOT NULL,
    line_item_id     TEXT NOT NULL,
    product_id       TEXT,
    variant_id       TEXT,
    product_title    TEXT,
    variant_title    TEXT,
    title            TEXT,
    sku              TEXT,
    quantity         INT DEFAULT 1,
    price            NUMERIC DEFAULT 0,
    total_discount   NUMERIC DEFAULT 0,
    fulfillment_status TEXT,
    UNIQUE (order_id, line_item_id)
  );

  CREATE TABLE IF NOT EXISTS shopify_customers (
    id               BIGSERIAL PRIMARY KEY,
    customer_id      TEXT UNIQUE NOT NULL,
    tenant_id        TEXT REFERENCES tenants(id),
    email            TEXT,
    created_at       TIMESTAMPTZ,
    total_spent      NUMERIC DEFAULT 0,
    orders_count     INT DEFAULT 0,
    avg_order_value  NUMERIC DEFAULT 0,
    first_order_at   TIMESTAMPTZ,
    last_order_at    TIMESTAMPTZ,
    country_code     TEXT,
    is_returning     BOOLEAN DEFAULT FALSE
  );

  CREATE TABLE IF NOT EXISTS shopify_daily_metrics (
    date                       DATE,
    tenant_id                  TEXT REFERENCES tenants(id),
    total_orders               INT DEFAULT 0,
    total_revenue              NUMERIC DEFAULT 0,
    avg_order_value            NUMERIC DEFAULT 0,
    new_customers              INT DEFAULT 0,
    returning_customers        INT DEFAULT 0,
    new_customer_revenue       NUMERIC DEFAULT 0,
    returning_customer_revenue NUMERIC DEFAULT 0,
    cart_abandonment_count     INT DEFAULT 0,
    cart_abandonment_value     NUMERIC DEFAULT 0,
    PRIMARY KEY (date, tenant_id)
  );

  CREATE TABLE IF NOT EXISTS shopify_abandoned_checkouts (
    id            BIGSERIAL PRIMARY KEY,
    checkout_id   TEXT UNIQUE NOT NULL,
    tenant_id     TEXT REFERENCES tenants(id),
    created_at    TIMESTAMPTZ,
    updated_at    TIMESTAMPTZ,
    customer_email TEXT,
    email         TEXT,
    total_price   NUMERIC,
    currency      TEXT,
    recovered     BOOLEAN DEFAULT FALSE
  );

  CREATE TABLE IF NOT EXISTS shopify_country_metrics (
    date            DATE,
    tenant_id       TEXT REFERENCES tenants(id),
    country_code    TEXT,
    orders_count    INT DEFAULT 0,
    revenue         NUMERIC DEFAULT 0,
    avg_order_value NUMERIC DEFAULT 0,
    new_customers   INT DEFAULT 0,
    PRIMARY KEY (date, tenant_id, country_code)
  );

  CREATE TABLE IF NOT EXISTS shopify_products (
    id               BIGSERIAL PRIMARY KEY,
    product_id       TEXT UNIQUE NOT NULL,
    tenant_id        TEXT REFERENCES tenants(id),
    title            TEXT,
    handle           TEXT,
    product_type     TEXT,
    vendor           TEXT,
    status           TEXT,
    created_at       TIMESTAMPTZ,
    updated_at       TIMESTAMPTZ,
    price_min        NUMERIC,
    price_max        NUMERIC,
    inventory_quantity INT,
    variants_count   INT DEFAULT 0,
    tags             TEXT,
    image_url        TEXT,
    synced_at        TIMESTAMPTZ
  );

  -- ══════════════════════════════════════════════════════════════
  -- Facebook tables
  -- ══════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS fb_ads (
    id               BIGSERIAL PRIMARY KEY,
    ad_id            TEXT UNIQUE NOT NULL,
    tenant_id        TEXT REFERENCES tenants(id),
    name             TEXT,
    status           TEXT,
    effective_status TEXT,
    adset_id         TEXT,
    adset_name       TEXT,
    campaign_id      TEXT,
    campaign_name    TEXT,
    creative_type    TEXT,
    creative_url     TEXT,
    thumbnail_url    TEXT,
    preview_url      TEXT,
    synced_at        TIMESTAMPTZ,
    created_time     TIMESTAMPTZ,
    updated_time     TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS fb_ad_daily_metrics (
    date                DATE,
    tenant_id           TEXT REFERENCES tenants(id),
    ad_id               TEXT,
    impressions         INT DEFAULT 0,
    clicks              INT DEFAULT 0,
    link_clicks         INT DEFAULT 0,
    landing_page_views  INT DEFAULT 0,
    add_to_cart         INT DEFAULT 0,
    initiate_checkout   INT DEFAULT 0,
    spend               NUMERIC DEFAULT 0,
    purchases           INT DEFAULT 0,
    purchase_value      NUMERIC DEFAULT 0,
    reach               INT DEFAULT 0,
    frequency           NUMERIC DEFAULT 0,
    ctr                 NUMERIC DEFAULT 0,
    cpm                 NUMERIC DEFAULT 0,
    cpc                 NUMERIC DEFAULT 0,
    roas                NUMERIC DEFAULT 0,
    PRIMARY KEY (date, tenant_id, ad_id)
  );

  CREATE TABLE IF NOT EXISTS fb_ad_breakdowns (
    date            DATE,
    tenant_id       TEXT REFERENCES tenants(id),
    ad_id           TEXT,
    breakdown_type  TEXT,
    breakdown_value TEXT,
    impressions     INT DEFAULT 0,
    clicks          INT DEFAULT 0,
    spend           NUMERIC DEFAULT 0,
    purchases       INT DEFAULT 0,
    purchase_value  NUMERIC DEFAULT 0,
    PRIMARY KEY (date, tenant_id, ad_id, breakdown_type, breakdown_value)
  );

  -- ══════════════════════════════════════════════════════════════
  -- System tables
  -- ══════════════════════════════════════════════════════════════
  CREATE TABLE IF NOT EXISTS sync_runs (
    id               SERIAL PRIMARY KEY,
    tenant_id        TEXT REFERENCES tenants(id),
    source           TEXT,
    status           TEXT,
    started_at       TIMESTAMPTZ DEFAULT NOW(),
    finished_at      TIMESTAMPTZ,
    records_collected INT DEFAULT 0,
    records_upserted  INT DEFAULT 0,
    date_from        TEXT,
    date_to          TEXT,
    error_message    TEXT
  );

  CREATE TABLE IF NOT EXISTS profit_settings (
    id        SERIAL PRIMARY KEY,
    tenant_id TEXT REFERENCES tenants(id) UNIQUE,
    settings  JSONB NOT NULL DEFAULT '{}'
  );

  -- Add missing columns to sync_runs (safe on existing tables)
  ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS date_from          TEXT;
  ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS date_to            TEXT;
  ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS records_collected  INT DEFAULT 0;
  ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS records_upserted   INT DEFAULT 0;
  ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS error_message      TEXT;

  -- ══════════════════════════════════════════════════════════════
  -- Unique indexes for Python collector conflict resolution
  -- ══════════════════════════════════════════════════════════════
  CREATE UNIQUE INDEX IF NOT EXISTS uq_fb_daily_ad_date
    ON fb_ad_daily_metrics(ad_id, date);
  CREATE UNIQUE INDEX IF NOT EXISTS uq_fb_breakdown
    ON fb_ad_breakdowns(ad_id, date, breakdown_type, breakdown_value);

  -- ══════════════════════════════════════════════════════════════
  -- Performance indexes
  -- ══════════════════════════════════════════════════════════════
  CREATE INDEX IF NOT EXISTS idx_shopify_orders_tenant      ON shopify_orders(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_shopify_orders_created     ON shopify_orders(created_at);
  CREATE INDEX IF NOT EXISTS idx_shopify_order_items_tenant ON shopify_order_items(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_shopify_order_items_order  ON shopify_order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_fb_ad_daily_tenant         ON fb_ad_daily_metrics(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_fb_ads_tenant              ON fb_ads(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_sync_runs_tenant           ON sync_runs(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_profit_settings_tenant     ON profit_settings(tenant_id);
`

pool.query(sql)
  .then(() => { console.log('[db] schema ready'); pool.end(); process.exit(0) })
  .catch(err => { console.error('[db] migration error:', err.message); pool.end(); process.exit(1) })
