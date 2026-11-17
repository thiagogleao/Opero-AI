/**
 * Database schema, applied by start.sh before Next.js boots (and safe to run by
 * hand: `DATABASE_URL=… node frontend/migrate.js`).
 *
 * Every step is idempotent and runs on its own, in order:
 *  - one failing step (a lock that would not come within lock_timeout, say)
 *    is logged and the rest still run; the next deploy retries it;
 *  - nothing here rewrites a big table: columns are added nullable or with a
 *    constant default (instant on Postgres ≥ 11), indexes are built
 *    CONCURRENTLY, and an index left INVALID by an interrupted build is
 *    dropped and rebuilt instead of being skipped forever by IF NOT EXISTS.
 *
 * There is no fallback database: without DATABASE_URL this exits. (It used to
 * fall back to a dead Railway database, with the password in the source, and
 * then print "schema ready".)
 */

const { Pool } = require('pg')

// `--print` lists the statements without connecting (to review a change).
const PRINT = process.argv.includes('--print')

if (!PRINT && !process.env.DATABASE_URL) {
  console.error('[db] DATABASE_URL não definido — nenhuma migração aplicada')
  process.exit(1)
}

const pool = PRINT ? null : new Pool({
  connectionString: process.env.DATABASE_URL,
  ssl: { rejectUnauthorized: false },
  max: 1,
  connectionTimeoutMillis: 10_000,
  // The collectors write to these tables continuously: wait briefly for a
  // lock, then give up on that step rather than block the boot.
  options: '-c lock_timeout=8000 -c statement_timeout=30000',
})

// ─── Base schema (a fresh database is rebuilt from this) ──────────────────────

const BASE = `
  CREATE TABLE IF NOT EXISTS tenants (
    id                       TEXT PRIMARY KEY,
    email                    TEXT,
    shopify_domain           TEXT,
    shopify_access_token     TEXT,
    fb_ad_account_id         TEXT,
    fb_access_token          TEXT,
    onboarded                BOOLEAN DEFAULT FALSE,
    created_at               TIMESTAMPTZ DEFAULT NOW(),
    updated_at               TIMESTAMPTZ DEFAULT NOW()
  );
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS timezone                 TEXT NOT NULL DEFAULT 'UTC';
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS user_id                  VARCHAR;
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS facebook_app_id          VARCHAR;
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS facebook_app_secret      TEXT;
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS shop_name                TEXT;
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS shopify_client_id        TEXT;
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS shopify_client_secret    TEXT;
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS shopify_token_expires_at TIMESTAMPTZ;
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS archived_at              TIMESTAMPTZ;
  ALTER TABLE tenants ADD COLUMN IF NOT EXISTS shopify_currency         TEXT;

  CREATE TABLE IF NOT EXISTS tenant_fb_accounts (
    id               SERIAL PRIMARY KEY,
    tenant_id        TEXT NOT NULL REFERENCES tenants(id),
    fb_ad_account_id TEXT NOT NULL,
    fb_access_token  TEXT NOT NULL,
    nickname         TEXT,
    is_active        BOOLEAN NOT NULL DEFAULT TRUE,
    created_at       TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, fb_ad_account_id)
  );

  CREATE TABLE IF NOT EXISTS shopify_orders (
    id                 BIGSERIAL PRIMARY KEY,
    order_id           TEXT UNIQUE NOT NULL,
    tenant_id          TEXT REFERENCES tenants(id),
    order_number       INT,
    created_at         TIMESTAMPTZ,
    processed_at       TIMESTAMPTZ,
    financial_status   TEXT,
    fulfillment_status TEXT,
    currency           TEXT,
    total_price        NUMERIC,
    subtotal_price     NUMERIC,
    total_discounts    NUMERIC,
    total_tax          NUMERIC,
    total_shipping     NUMERIC,
    country_code       TEXT,
    customer_id        TEXT,
    customer_email     TEXT,
    is_first_order     BOOLEAN,
    tags               TEXT,
    referring_site     TEXT,
    landing_site       TEXT,
    source_name        TEXT,
    cancel_reason      TEXT,
    cancelled_at       TIMESTAMPTZ,
    refund_amount      NUMERIC DEFAULT 0
  );
  -- Checkout fingerprint: Visa CE 3.0 needs the IP on record long before a
  -- dispute exists, and it cannot be recovered afterwards.
  ALTER TABLE shopify_orders ADD COLUMN IF NOT EXISTS browser_ip      TEXT;
  ALTER TABLE shopify_orders ADD COLUMN IF NOT EXISTS user_agent      TEXT;
  ALTER TABLE shopify_orders ADD COLUMN IF NOT EXISTS accept_language TEXT;
  ALTER TABLE shopify_orders ADD COLUMN IF NOT EXISTS fx_rate         NUMERIC;

  CREATE TABLE IF NOT EXISTS shopify_order_items (
    id                 BIGSERIAL PRIMARY KEY,
    tenant_id          TEXT REFERENCES tenants(id),
    order_id           TEXT NOT NULL,
    line_item_id       TEXT NOT NULL,
    product_id         TEXT,
    variant_id         TEXT,
    product_title      TEXT,
    variant_title      TEXT,
    title              TEXT,
    sku                TEXT,
    quantity           INT DEFAULT 1,
    price              NUMERIC DEFAULT 0,
    total_discount     NUMERIC DEFAULT 0,
    fulfillment_status TEXT,
    UNIQUE (order_id, line_item_id)
  );

  CREATE TABLE IF NOT EXISTS shopify_customers (
    id              BIGSERIAL PRIMARY KEY,
    customer_id     TEXT UNIQUE NOT NULL,
    tenant_id       TEXT REFERENCES tenants(id),
    email           TEXT,
    created_at      TIMESTAMPTZ,
    total_spent     NUMERIC DEFAULT 0,
    orders_count    INT DEFAULT 0,
    avg_order_value NUMERIC DEFAULT 0,
    first_order_at  TIMESTAMPTZ,
    last_order_at   TIMESTAMPTZ,
    country_code    TEXT,
    is_returning    BOOLEAN DEFAULT FALSE
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
    id             BIGSERIAL PRIMARY KEY,
    checkout_id    TEXT UNIQUE NOT NULL,
    tenant_id      TEXT REFERENCES tenants(id),
    created_at     TIMESTAMPTZ,
    updated_at     TIMESTAMPTZ,
    customer_email TEXT,
    email          TEXT,
    total_price    NUMERIC,
    currency       TEXT,
    recovered      BOOLEAN DEFAULT FALSE
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
    id                 BIGSERIAL PRIMARY KEY,
    product_id         TEXT UNIQUE NOT NULL,
    tenant_id          TEXT REFERENCES tenants(id),
    title              TEXT,
    handle             TEXT,
    product_type       TEXT,
    vendor             TEXT,
    status             TEXT,
    created_at         TIMESTAMPTZ,
    updated_at         TIMESTAMPTZ,
    price_min          NUMERIC,
    price_max          NUMERIC,
    inventory_quantity INT,
    variants_count     INT DEFAULT 0,
    tags               TEXT,
    image_url          TEXT,
    synced_at          TIMESTAMPTZ
  );

  -- Exchange rates for stores that do not bill in dollars (Frankfurter/ECB).
  CREATE TABLE IF NOT EXISTS fx_rates (
    date       DATE NOT NULL,
    currency   TEXT NOT NULL,
    usd_rate   NUMERIC NOT NULL,
    source     TEXT,
    fetched_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (date, currency)
  );

  -- Shopify "Shop Campaigns" ad spend, billed by Shopify, not Meta.
  CREATE TABLE IF NOT EXISTS shop_campaign_daily (
    tenant_id TEXT NOT NULL,
    date      DATE NOT NULL,
    spend     NUMERIC NOT NULL DEFAULT 0,
    currency  TEXT,
    fx_rate   NUMERIC,
    synced_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tenant_id, date)
  );

  CREATE TABLE IF NOT EXISTS fb_ad_accounts (
    id             BIGSERIAL PRIMARY KEY,
    account_id     TEXT UNIQUE NOT NULL,
    tenant_id      TEXT REFERENCES tenants(id),
    name           TEXT,
    currency       TEXT,
    account_status INT,
    synced_at      TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS fb_campaigns (
    id          BIGSERIAL PRIMARY KEY,
    campaign_id TEXT NOT NULL,
    tenant_id   TEXT REFERENCES tenants(id),
    account_id  TEXT,
    name        TEXT,
    status      TEXT,
    objective   TEXT,
    synced_at   TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS fb_adsets (
    id          BIGSERIAL PRIMARY KEY,
    adset_id    TEXT NOT NULL,
    tenant_id   TEXT REFERENCES tenants(id),
    campaign_id TEXT,
    name        TEXT,
    status      TEXT,
    synced_at   TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS fb_ads (
    id               BIGSERIAL PRIMARY KEY,
    ad_id            TEXT NOT NULL,
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
    landing_url      TEXT,
    synced_at        TIMESTAMPTZ,
    created_time     TIMESTAMPTZ,
    updated_time     TIMESTAMPTZ
  );

  CREATE TABLE IF NOT EXISTS fb_ad_daily_metrics (
    date               DATE NOT NULL,
    tenant_id          TEXT NOT NULL REFERENCES tenants(id),
    ad_id              TEXT NOT NULL,
    impressions        INT DEFAULT 0,
    clicks             INT DEFAULT 0,
    link_clicks        INT DEFAULT 0,
    landing_page_views INT DEFAULT 0,
    add_to_cart        INT DEFAULT 0,
    initiate_checkout  INT DEFAULT 0,
    spend              NUMERIC DEFAULT 0,
    purchases          INT DEFAULT 0,
    purchase_value     NUMERIC DEFAULT 0,
    reach              INT DEFAULT 0,
    frequency          NUMERIC DEFAULT 0,
    ctr                NUMERIC DEFAULT 0,
    cpm                NUMERIC DEFAULT 0,
    cpc                NUMERIC DEFAULT 0,
    roas               NUMERIC DEFAULT 0,
    PRIMARY KEY (date, tenant_id, ad_id)
  );
  ALTER TABLE fb_ad_daily_metrics ADD COLUMN IF NOT EXISTS video_plays      INT;
  ALTER TABLE fb_ad_daily_metrics ADD COLUMN IF NOT EXISTS video_p25        INT;
  ALTER TABLE fb_ad_daily_metrics ADD COLUMN IF NOT EXISTS video_p50        INT;
  ALTER TABLE fb_ad_daily_metrics ADD COLUMN IF NOT EXISTS video_p75        INT;
  ALTER TABLE fb_ad_daily_metrics ADD COLUMN IF NOT EXISTS video_p100       INT;
  ALTER TABLE fb_ad_daily_metrics ADD COLUMN IF NOT EXISTS hook_rate        NUMERIC;
  ALTER TABLE fb_ad_daily_metrics ADD COLUMN IF NOT EXISTS hold_rate_25     NUMERIC;
  ALTER TABLE fb_ad_daily_metrics ADD COLUMN IF NOT EXISTS hold_rate_50     NUMERIC;
  ALTER TABLE fb_ad_daily_metrics ADD COLUMN IF NOT EXISTS hold_rate_75     NUMERIC;
  ALTER TABLE fb_ad_daily_metrics ADD COLUMN IF NOT EXISTS hold_rate_100    NUMERIC;
  ALTER TABLE fb_ad_daily_metrics ADD COLUMN IF NOT EXISTS post_engagement  INT DEFAULT 0;
  -- Which ad account a row came from (extra accounts can be excluded).
  ALTER TABLE fb_ad_daily_metrics ADD COLUMN IF NOT EXISTS fb_ad_account_id TEXT;

  CREATE TABLE IF NOT EXISTS fb_ad_breakdowns (
    date            DATE NOT NULL,
    tenant_id       TEXT NOT NULL REFERENCES tenants(id),
    ad_id           TEXT NOT NULL,
    breakdown_type  TEXT NOT NULL,
    breakdown_value TEXT NOT NULL,
    impressions     INT DEFAULT 0,
    clicks          INT DEFAULT 0,
    spend           NUMERIC DEFAULT 0,
    purchases       INT DEFAULT 0,
    purchase_value  NUMERIC DEFAULT 0,
    PRIMARY KEY (date, tenant_id, ad_id, breakdown_type, breakdown_value)
  );

  CREATE TABLE IF NOT EXISTS sync_runs (
    id                SERIAL PRIMARY KEY,
    tenant_id         TEXT REFERENCES tenants(id),
    source            TEXT,
    status            TEXT,
    started_at        TIMESTAMPTZ DEFAULT NOW(),
    finished_at       TIMESTAMPTZ,
    records_collected INT DEFAULT 0,
    records_upserted  INT DEFAULT 0,
    date_from         TEXT,
    date_to           TEXT,
    error_message     TEXT
  );

  CREATE TABLE IF NOT EXISTS profit_settings (
    id        SERIAL PRIMARY KEY,
    tenant_id TEXT REFERENCES tenants(id) UNIQUE,
    settings  JSONB NOT NULL DEFAULT '{}'
  );

  CREATE TABLE IF NOT EXISTS push_subscriptions (
    id           BIGSERIAL PRIMARY KEY,
    endpoint     TEXT UNIQUE NOT NULL,
    p256dh       TEXT NOT NULL,
    auth         TEXT NOT NULL,
    user_agent   TEXT,
    created_at   TIMESTAMPTZ DEFAULT NOW(),
    last_used_at TIMESTAMPTZ
  );

  -- Orders delivered by the Shopify webhook, for the live feed and the push.
  CREATE TABLE IF NOT EXISTS live_orders (
    id            BIGSERIAL PRIMARY KEY,
    tenant_id     TEXT REFERENCES tenants(id),
    order_id      TEXT NOT NULL,
    order_number  TEXT,
    total_price   NUMERIC,
    currency      TEXT,
    country_code  TEXT,
    customer_name TEXT,
    line_items    JSONB,
    created_at    TIMESTAMPTZ,
    received_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (tenant_id, order_id)
  );
  CREATE INDEX IF NOT EXISTS idx_live_orders_received ON live_orders (received_at DESC);

  CREATE TABLE IF NOT EXISTS alert_settings (
    id         TEXT PRIMARY KEY,
    settings   JSONB NOT NULL DEFAULT '{}',
    updated_at TIMESTAMPTZ DEFAULT NOW()
  );

  -- The UNIQUE constraint is the send lock; tenant_id is '*' (never NULL) for
  -- account-wide events because NULLs never conflict.
  CREATE TABLE IF NOT EXISTS alert_events (
    id        BIGSERIAL PRIMARY KEY,
    kind      TEXT NOT NULL,
    tenant_id TEXT NOT NULL DEFAULT '*',
    day       DATE NOT NULL,
    payload   JSONB,
    sent_at   TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (kind, tenant_id, day)
  );
  CREATE INDEX IF NOT EXISTS idx_alert_events_day ON alert_events (day DESC);

  CREATE TABLE IF NOT EXISTS order_journeys (
    tenant_id            TEXT NOT NULL REFERENCES tenants(id),
    order_id             TEXT NOT NULL,
    ready                BOOLEAN DEFAULT FALSE,
    moments_count        INT,
    moments_precision    TEXT,
    days_to_conversion   INT,
    customer_order_index INT,
    first_ad_id          TEXT,
    last_ad_id           TEXT,
    order_created_at     TIMESTAMPTZ,
    synced_at            TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (tenant_id, order_id)
  );
  CREATE INDEX IF NOT EXISTS idx_order_journeys_ready   ON order_journeys (tenant_id, ready);
  CREATE INDEX IF NOT EXISTS idx_order_journeys_created ON order_journeys (order_created_at DESC);

  CREATE TABLE IF NOT EXISTS order_touchpoints (
    tenant_id    TEXT NOT NULL REFERENCES tenants(id),
    order_id     TEXT NOT NULL,
    seq          INT  NOT NULL,
    occurred_at  TIMESTAMPTZ,
    source       TEXT,
    source_type  TEXT,
    referrer_url TEXT,
    landing_page TEXT,
    utm_source   TEXT,
    utm_medium   TEXT,
    utm_campaign TEXT,
    utm_content  TEXT,
    utm_term     TEXT,
    ad_id        TEXT,
    adset_id     TEXT,
    campaign_id  TEXT,
    PRIMARY KEY (tenant_id, order_id, seq)
  );
  CREATE INDEX IF NOT EXISTS idx_touchpoints_ad       ON order_touchpoints (ad_id) WHERE ad_id IS NOT NULL;
  CREATE INDEX IF NOT EXISTS idx_touchpoints_occurred ON order_touchpoints (occurred_at DESC);

  -- Refunds and chargebacks. Two dates on purpose: when it reached us
  -- (event_date) and when its order was placed (order_date), both in the
  -- store's timezone. amount is always US dollars; the money as Shopify
  -- reported it is kept in original_amount / original_currency.
  CREATE TABLE IF NOT EXISTS order_adjustments (
    tenant_id         TEXT NOT NULL REFERENCES tenants(id),
    kind              TEXT NOT NULL,
    external_id       TEXT NOT NULL,
    order_id          TEXT,
    event_date        DATE NOT NULL,
    order_date        DATE,
    amount            NUMERIC NOT NULL,
    fee               NUMERIC DEFAULT 0,
    currency          TEXT,
    reason            TEXT,
    status            TEXT,
    evidence_due_by   TIMESTAMPTZ,
    finalized_on      TIMESTAMPTZ,
    synced_at         TIMESTAMPTZ DEFAULT NOW(),
    original_amount   NUMERIC,
    original_currency TEXT,
    PRIMARY KEY (tenant_id, kind, external_id)
  );
  ALTER TABLE order_adjustments ADD COLUMN IF NOT EXISTS original_amount   NUMERIC;
  ALTER TABLE order_adjustments ADD COLUMN IF NOT EXISTS original_currency TEXT;
  CREATE INDEX IF NOT EXISTS idx_adjustments_event  ON order_adjustments (tenant_id, event_date DESC);
  CREATE INDEX IF NOT EXISTS idx_adjustments_order  ON order_adjustments (tenant_id, order_id);
  CREATE INDEX IF NOT EXISTS idx_adjustments_status ON order_adjustments (tenant_id, kind, status);

  CREATE TABLE IF NOT EXISTS journey_sync_state (
    tenant_id       TEXT PRIMARY KEY REFERENCES tenants(id),
    backfill_cursor TEXT,
    backfill_done   BOOLEAN DEFAULT FALSE,
    last_run_at     TIMESTAMPTZ,
    orders_synced   INT DEFAULT 0
  );

  ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS date_from         TEXT;
  ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS date_to           TEXT;
  ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS records_collected INT DEFAULT 0;
  ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS records_upserted  INT DEFAULT 0;
  ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS error_message     TEXT;
  ALTER TABLE shopify_country_metrics ADD COLUMN IF NOT EXISTS new_customers INT DEFAULT 0;
  ALTER TABLE fb_ads ADD COLUMN IF NOT EXISTS landing_url TEXT;
  ALTER TABLE shopify_daily_metrics ADD COLUMN IF NOT EXISTS new_customers              INT DEFAULT 0;
  ALTER TABLE shopify_daily_metrics ADD COLUMN IF NOT EXISTS returning_customers        INT DEFAULT 0;
  ALTER TABLE shopify_daily_metrics ADD COLUMN IF NOT EXISTS new_customer_revenue       NUMERIC DEFAULT 0;
  ALTER TABLE shopify_daily_metrics ADD COLUMN IF NOT EXISTS returning_customer_revenue NUMERIC DEFAULT 0;
  ALTER TABLE shopify_daily_metrics ADD COLUMN IF NOT EXISTS cart_abandonment_count     INT DEFAULT 0;
  ALTER TABLE shopify_daily_metrics ADD COLUMN IF NOT EXISTS cart_abandonment_value     NUMERIC DEFAULT 0;

  CREATE INDEX IF NOT EXISTS idx_shopify_orders_tenant      ON shopify_orders(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_shopify_orders_created     ON shopify_orders(created_at);
  CREATE INDEX IF NOT EXISTS idx_shopify_order_items_tenant ON shopify_order_items(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_shopify_order_items_order  ON shopify_order_items(order_id);
  CREATE INDEX IF NOT EXISTS idx_fb_ad_daily_tenant         ON fb_ad_daily_metrics(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_fb_ads_tenant              ON fb_ads(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_sync_runs_tenant           ON sync_runs(tenant_id);
  CREATE INDEX IF NOT EXISTS idx_profit_settings_tenant     ON profit_settings(tenant_id);
`

// ─── v2: sync rebuild ─────────────────────────────────────────────────────────

const V2_COLUMNS = `
  -- Orders: tax and shipping charged, the refund-aware total, the sales
  -- channel, and where the parcel goes (country_code stays the billing
  -- country, which the profit engine prices by; see shopify_mapping.py).
  ALTER TABLE shopify_orders ADD COLUMN IF NOT EXISTS current_total_price NUMERIC;
  ALTER TABLE shopify_orders ADD COLUMN IF NOT EXISTS geo_country_code    TEXT;
  ALTER TABLE shopify_orders ADD COLUMN IF NOT EXISTS province_code       TEXT;

  -- Meta: campaign and ad set on the metric row itself (campaign views no
  -- longer depend on fb_ads knowing every ad), and the phantom flag set at
  -- ingestion for purchase values above the engine's threshold.
  ALTER TABLE fb_ad_daily_metrics ADD COLUMN IF NOT EXISTS campaign_id      TEXT;
  ALTER TABLE fb_ad_daily_metrics ADD COLUMN IF NOT EXISTS adset_id         TEXT;
  ALTER TABLE fb_ad_daily_metrics ADD COLUMN IF NOT EXISTS phantom_purchase BOOLEAN NOT NULL DEFAULT FALSE;
  ALTER TABLE fb_ad_breakdowns    ADD COLUMN IF NOT EXISTS phantom_purchase BOOLEAN NOT NULL DEFAULT FALSE;
  -- The creative an ad's stored details belong to: re-fetched only on change.
  ALTER TABLE fb_ads ADD COLUMN IF NOT EXISTS creative_id TEXT;

  -- Runs: which ad account, and which kind of pass (quick, structure,
  -- repull7, repull28, backfill, scheduled, refresh, webhook).
  ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS account_id TEXT;
  ALTER TABLE sync_runs ADD COLUMN IF NOT EXISTS mode       TEXT;

  -- First day an ad account's data belongs to this store. An account that
  -- moved between stores keeps its earlier history where it was, and a
  -- backfill or a 90-day refresh never copies it over.
  ALTER TABLE tenants            ADD COLUMN IF NOT EXISTS fb_collect_from DATE;
  ALTER TABLE tenant_fb_accounts ADD COLUMN IF NOT EXISTS collect_from    DATE;
`

/** The three cuts made by hand when accounts changed stores (see
 *  cadastrar_glooty.js, cadastrar_hibikura.js, mover_conta2_para_epoch.js).
 *  Only applied while the account is still the same one and no cut is set. */
const V2_SEED_CUTS = `
  UPDATE tenants SET fb_collect_from = DATE '2026-11-04'
   WHERE id = '5071bfb6-61c8-431f-8837-1b546f7e4f38' AND fb_ad_account_id = 'act_2267479727435342'
     AND fb_collect_from IS NULL;
  UPDATE tenants SET fb_collect_from = DATE '2026-11-08'
   WHERE id = '0344f31b-bd37-4674-8696-7555f3d98417' AND fb_ad_account_id = 'act_1381311624088505'
     AND fb_collect_from IS NULL;
  UPDATE tenant_fb_accounts SET collect_from = DATE '2026-11-03'
   WHERE tenant_id = '73a1d3b1-45ff-410a-af37-93f95a591e6e' AND fb_ad_account_id = 'act_1040512874708609'
     AND collect_from IS NULL;
`

/** Indexes built CONCURRENTLY (no write lock on a live table). */
const V2_INDEXES = [
  // Tenant-safe keys: an ad, ad set or campaign belongs to a store, and the
  // same ad seen by another store is that store's own row.
  ['uq_fb_ads_tenant_ad',        'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_fb_ads_tenant_ad ON fb_ads (tenant_id, ad_id)'],
  ['uq_fb_campaigns_tenant',     'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_fb_campaigns_tenant ON fb_campaigns (tenant_id, campaign_id)'],
  ['uq_fb_adsets_tenant',        'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_fb_adsets_tenant ON fb_adsets (tenant_id, adset_id)'],
  // Freshness and status queries: newest run per store and source.
  ['idx_sync_runs_tenant_source_started',
   'CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sync_runs_tenant_source_started ON sync_runs (tenant_id, source, started_at DESC)'],
  // The sweeper that closes runs left 'running' by a killed process.
  ['idx_sync_runs_running',
   "CREATE INDEX CONCURRENTLY IF NOT EXISTS idx_sync_runs_running ON sync_runs (started_at) WHERE status = 'running'"],
  // A Shopify store can belong to one tenant only (orders would otherwise
  // flip between the two on every sync, and the webhook picks one at random).
  ['uq_tenants_shopify_domain',
   'CREATE UNIQUE INDEX CONCURRENTLY IF NOT EXISTS uq_tenants_shopify_domain ON tenants (lower(shopify_domain)) WHERE shopify_domain IS NOT NULL'],
]

/** Global keys that let a sync re-tag another store's rows. Dropped only
 *  after the tenant-safe replacement exists and is valid. */
const V2_DROP_GLOBAL = [
  { needs: 'uq_fb_ads_tenant_ad',    sql: 'ALTER TABLE fb_ads DROP CONSTRAINT IF EXISTS fb_ads_ad_id_key' },
  { needs: 'uq_fb_campaigns_tenant', sql: 'ALTER TABLE fb_campaigns DROP CONSTRAINT IF EXISTS fb_campaigns_campaign_id_key' },
  { needs: 'uq_fb_adsets_tenant',    sql: 'ALTER TABLE fb_adsets DROP CONSTRAINT IF EXISTS fb_adsets_adset_id_key' },
  // fb_ad_daily_metrics / fb_ad_breakdowns already have a primary key that
  // includes tenant_id; the extra global unique index is what blocked two
  // stores from holding the same ad-day and forced the re-tagging.
  { needs: null, metrics: true, sql: 'DROP INDEX CONCURRENTLY IF EXISTS uq_fb_daily_ad_date' },
  { needs: null, metrics: true, sql: 'DROP INDEX CONCURRENTLY IF EXISTS uq_fb_breakdown' },
]

// sync_runs keeps 30 days, plus the newest success of every store, source and
// account so "last successful sync" survives a long outage. The scheduler runs
// the same retention daily (frontend/lib/sync/runs.ts).
const RETENTION = `
  DELETE FROM sync_runs r
   WHERE r.started_at < now() - interval '30 days'
     AND r.id NOT IN (
       SELECT DISTINCT ON (tenant_id, source, COALESCE(account_id, '')) id
         FROM sync_runs
        WHERE status = 'success'
        ORDER BY tenant_id, source, COALESCE(account_id, ''), started_at DESC)
`

// ─── Runner ───────────────────────────────────────────────────────────────────

/** Split a block of SQL into statements (no semicolons inside our literals). */
const statements = (block) => block.split(/;\s*\n/).map(s => s.replace(/^\s*--.*$/gm, '').trim()).filter(Boolean)

let failures = 0

async function step(label, sql) {
  try {
    await pool.query(sql)
  } catch (err) {
    failures++
    console.error(`[db] ✗ ${label}: ${err.message}`)
  }
}

async function indexState(name) {
  const { rows } = await pool.query(
    `SELECT i.indisvalid AS valid FROM pg_class c JOIN pg_index i ON i.indexrelid = c.oid WHERE c.relname = $1`,
    [name])
  return rows[0] ? (rows[0].valid ? 'valid' : 'invalid') : 'missing'
}

/** True when each hand-made account cut is recorded (or the account has since
 *  changed, so the cut no longer applies). */
async function cutsReady() {
  try {
    const { rows } = await pool.query(`
      SELECT
        NOT EXISTS (SELECT 1 FROM tenants WHERE id = '5071bfb6-61c8-431f-8837-1b546f7e4f38'
                     AND fb_ad_account_id = 'act_2267479727435342' AND fb_collect_from IS NULL)
        AND NOT EXISTS (SELECT 1 FROM tenants WHERE id = '0344f31b-bd37-4674-8696-7555f3d98417'
                     AND fb_ad_account_id = 'act_1381311624088505' AND fb_collect_from IS NULL)
        AND NOT EXISTS (SELECT 1 FROM tenant_fb_accounts WHERE tenant_id = '73a1d3b1-45ff-410a-af37-93f95a591e6e'
                     AND fb_ad_account_id = 'act_1040512874708609' AND collect_from IS NULL) AS ready`)
    return rows[0]?.ready === true
  } catch (err) {
    console.warn('[db] cortes de conta não verificados:', err.message)
    return false
  }
}

async function ensureIndex(name, ddl) {
  const state = await indexState(name)
  if (state === 'valid') return
  if (state === 'invalid') {
    // An interrupted CONCURRENTLY build leaves an invalid index that
    // IF NOT EXISTS would skip forever.
    await step(`drop invalid ${name}`, `DROP INDEX CONCURRENTLY IF EXISTS ${name}`)
  }
  await step(`index ${name}`, ddl)
}

function printAll() {
  const all = [...statements(BASE), ...statements(V2_COLUMNS), ...statements(V2_SEED_CUTS),
    ...V2_INDEXES.map(([, ddl]) => ddl), ...V2_DROP_GLOBAL.map(d => d.sql), RETENTION.trim()]
  all.forEach((x, i) => console.log(`-- [${i + 1}]
${x};
`))
  console.log(`-- ${all.length} statements`)
}

async function main() {
  for (const s of statements(BASE)) await step(s.split('\n')[0].slice(0, 70), s)
  for (const s of statements(V2_COLUMNS)) await step(s.slice(0, 70), s)
  for (const s of statements(V2_SEED_CUTS)) await step('seed collect_from', s)
  for (const [name, ddl] of V2_INDEXES) await ensureIndex(name, ddl)
  // Without the cuts, dropping the global ad-day keys would let a 28-day
  // re-pull copy another store's history into Glooty, Hibikura or EPOCH.
  const cuts = await cutsReady()
  for (const d of V2_DROP_GLOBAL) {
    if (d.metrics && !cuts) {
      console.warn('[db] mantendo uq_fb_daily_ad_date/uq_fb_breakdown: cortes de conta (collect_from) ainda não gravados')
      continue
    }
    if (d.needs && (await indexState(d.needs)) !== 'valid') {
      console.warn(`[db] mantendo chave global: ${d.needs} ainda não existe`)
      continue
    }
    await step(d.sql, d.sql)
  }
  await step('sync_runs retention', RETENTION)
  console.log(failures ? `[db] schema aplicado com ${failures} falha(s) — a próxima subida tenta de novo` : '[db] schema ready')
}

if (PRINT) {
  printAll()
  process.exit(0)
}

main()
  .catch(err => { failures++; console.error('[db] migration error:', err.message) })
  .finally(async () => {
    await pool.end().catch(() => {})
    process.exit(failures ? 1 : 0)
  })
