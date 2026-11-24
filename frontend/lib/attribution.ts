import { query } from './db'
import { KEPT_ORDER_SQL, PHANTOM_PURCHASE_VALUE, purchaseValueSql, purchasesSql } from './engine/pnl'
import type { DateRange } from './engine/dates'
import { formatCount } from './format'
// Types and labels live apart so the client can import them without pulling
// this module — and its database pool — into the browser bundle.
import type {
  AttributionReport, AttributionTotals, Coverage, CreativeAttribution, JourneyFilter,
  JourneyOrder, JourneyPage, JourneyTouch, Model, PhantomDisclosure, SharedAdAccount, SourceRow,
} from './attributionModels'

export type {
  AttributionReport, AttributionTotals, Coverage, CreativeAttribution, JourneyFilter,
  JourneyOrder, JourneyPage, JourneyTouch, Model, PhantomDisclosure, SharedAdAccount, SourceRow,
}

/**
 * Reading the collected journeys.
 *
 * Every number here comes from Shopify's own record of the visits that preceded
 * an order, joined to the ad that the visit's utm identifies. It is kept apart
 * from what Meta reports about itself: the point is to put the two side by side.
 *
 * Three rules hold everywhere in this file:
 *  - Dates are the store's own calendar (each order converted once, in its
 *    store's timezone), the same days the profit engine uses.
 *  - Meta's purchase figures go through the engine's phantom filter: one EPOCH
 *    ad-day claims a $183,000 sale on $4 of spend, and left in it turns every
 *    "Meta vs journey" comparison into nonsense.
 *  - Ads are matched to spend by ad, across the stores of one login. CAMP
 *    HALLOW's ads run in EPOCH's account, so filtering spend and sales by the
 *    same store showed EPOCH paying for ads that "sold nothing" and CAMP selling
 *    on ads that "cost nothing". Both halves are now shown, and named.
 */

const num = (v: unknown): number => Number(v) || 0

/** The stores of the same login as $1 (itself included), with timezones.
 *  Cross-store matching never reaches beyond one login: another account's
 *  store name must never appear on a partner's screen. */
const ACCOUNT_CTE = `
  acct AS (
    SELECT t2.id, COALESCE(t2.timezone, 'UTC') AS tz
      FROM tenants s
      JOIN tenants t2 ON t2.id = s.id OR (s.user_id IS NOT NULL AND t2.user_id = s.user_id)
     WHERE s.id = $1
  )`

/** Kept orders of the `acct` stores placed on [$2, $3] in each store's own
 *  calendar. The coarse UTC bound lets the created_at index do the work. */
const PERIOD_ORDERS_CTE = `
  period_orders AS (
    SELECT o.tenant_id, o.order_id, o.total_price::numeric AS total
      FROM shopify_orders o
      JOIN acct a ON a.id = o.tenant_id
     WHERE o.created_at >= ($2::date - 2)::timestamptz
       AND o.created_at <  ($3::date + 3)::timestamptz
       AND (o.created_at AT TIME ZONE a.tz)::date BETWEEN $2::date AND $3::date
       AND ${KEPT_ORDER_SQL}
  )`

/**
 * The SQL that turns one order into credited ads, per model:
 * (tenant_id, order_id, ad_id, weight, revenue). Weights of one order sum to 1.
 */
function creditsCte(model: Model): string {
  if (model === 'linear') {
    // Split evenly between the distinct ads touched, so an order that met three
    // ads gives a third to each rather than counting three whole sales.
    return `
  credits AS (
    SELECT d.tenant_id, d.order_id, d.ad_id,
           1.0 / count(*) OVER (PARTITION BY d.tenant_id, d.order_id)     AS weight,
           d.total / count(*) OVER (PARTITION BY d.tenant_id, d.order_id) AS revenue
      FROM (SELECT DISTINCT o.tenant_id, o.order_id, o.total, p.ad_id
              FROM period_orders o
              JOIN order_touchpoints p ON p.tenant_id = o.tenant_id AND p.order_id = o.order_id
             WHERE p.ad_id IS NOT NULL) d
  )`
  }
  const column = model === 'first' ? 'first_ad_id' : 'last_ad_id'
  return `
  credits AS (
    SELECT o.tenant_id, o.order_id, j.${column} AS ad_id, 1.0::numeric AS weight, o.total AS revenue
      FROM period_orders o
      JOIN order_journeys j ON j.tenant_id = o.tenant_id AND j.order_id = o.order_id
     WHERE j.${column} IS NOT NULL
  )`
}

/** Shared by the attribution and product screens: the window's orders of one
 *  login and the ads each one credits. Parameters: $1 store, $2 from, $3 to. */
export function accountCreditsSql(model: Model): string {
  return `${ACCOUNT_CTE},${PERIOD_ORDERS_CTE},${creditsCte(model)}`
}

// ─── Coverage ─────────────────────────────────────────────────────────────────

/**
 * How much of the period is actually measured.
 *
 * Shown next to every table on purpose: a ranking built from a tenth of the
 * orders looks authoritative and is not, and the only defence is to say so.
 */
export async function getCoverage(storeId: string, from: string, to: string): Promise<Coverage> {
  const [row] = await query<{
    orders: number; with_journey: number; with_ad: number; pending: number; updated: string | null
  }>(
    `SELECT count(*)::int                                                   AS orders,
            count(j.order_id)::int                                          AS with_journey,
            count(j.order_id) FILTER (WHERE j.first_ad_id IS NOT NULL)::int AS with_ad,
            count(j.order_id) FILTER (WHERE NOT j.ready)::int               AS pending,
            (SELECT to_char(s.last_run_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')
               FROM journey_sync_state s WHERE s.tenant_id = $1)            AS updated
       FROM shopify_orders o
       JOIN tenants t ON t.id = o.tenant_id
       LEFT JOIN order_journeys j ON j.tenant_id = o.tenant_id AND j.order_id = o.order_id
      WHERE o.tenant_id = $1
        AND o.created_at >= ($2::date - 2)::timestamptz
        AND o.created_at <  ($3::date + 3)::timestamptz
        AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
        AND ${KEPT_ORDER_SQL}`,
    [storeId, from, to],
  )
  const orders = num(row?.orders)
  const withJourney = num(row?.with_journey)
  const withAd = num(row?.with_ad)
  return {
    orders,
    withJourney,
    withAd,
    pct: orders > 0 ? Math.round((withJourney / orders) * 100) : 0,
    attributablePct: orders > 0 ? Math.round((withAd / orders) * 100) : 0,
    pending: num(row?.pending),
    journeysUpdatedAt: row?.updated ?? null,
  }
}

// ─── Creatives ────────────────────────────────────────────────────────────────

interface CreativeRow {
  ad_id: string; ad_store_id: string | null
  name: string | null; campaign_name: string | null; thumbnail_url: string | null
  orders_here: number; revenue_here: number; orders_sib: number; revenue_sib: number
  spend: number; meta_purchases: number; meta_revenue: number
  phantom_rows: number; phantom_value: number
}

/** Every ad with activity for the store in the window — no LIMIT here, so the
 *  header can be the sum of all of them. */
async function creativeRows(storeId: string, from: string, to: string, model: Model): Promise<CreativeRow[]> {
  return query<CreativeRow>(`
    WITH ${accountCreditsSql(model)},
    by_ad AS (
      SELECT ad_id,
             COALESCE(SUM(weight)  FILTER (WHERE tenant_id =  $1), 0) AS orders_here,
             COALESCE(SUM(revenue) FILTER (WHERE tenant_id =  $1), 0) AS revenue_here,
             COALESCE(SUM(weight)  FILTER (WHERE tenant_id <> $1), 0) AS orders_sib,
             COALESCE(SUM(revenue) FILTER (WHERE tenant_id <> $1), 0) AS revenue_sib
        FROM credits GROUP BY ad_id
    ),
    spend AS (
      SELECT m.ad_id,
             SUM(m.spend)                                                      AS spend,
             SUM(${purchasesSql('m.purchase_value', 'm.purchases')})           AS meta_purchases,
             SUM(${purchaseValueSql('m.purchase_value')})                      AS meta_revenue,
             COUNT(*) FILTER (WHERE m.purchase_value > ${PHANTOM_PURCHASE_VALUE}) AS phantom_rows,
             COALESCE(SUM(m.purchase_value) FILTER (WHERE m.purchase_value > ${PHANTOM_PURCHASE_VALUE}), 0) AS phantom_value
        FROM fb_ad_daily_metrics m
        JOIN acct a ON a.id = m.tenant_id
       WHERE m.date BETWEEN $2::date AND $3::date
       GROUP BY m.ad_id
    ),
    ads AS (SELECT ad_id FROM by_ad UNION SELECT ad_id FROM spend),
    -- Which store's account runs the ad, from its whole spend history, so an
    -- ad paused before the window still has an owner.
    owner AS (
      SELECT DISTINCT ON (m.ad_id) m.ad_id, m.tenant_id
        FROM fb_ad_daily_metrics m
        JOIN ads ON ads.ad_id = m.ad_id
        JOIN acct a ON a.id = m.tenant_id
       ORDER BY m.ad_id, m.date DESC
    )
    SELECT ads.ad_id, ow.tenant_id AS ad_store_id,
           f.name, f.campaign_name, f.thumbnail_url,
           COALESCE(b.orders_here, 0)::float8    AS orders_here,
           COALESCE(b.revenue_here, 0)::float8   AS revenue_here,
           COALESCE(b.orders_sib, 0)::float8     AS orders_sib,
           COALESCE(b.revenue_sib, 0)::float8    AS revenue_sib,
           COALESCE(s.spend, 0)::float8          AS spend,
           COALESCE(s.meta_purchases, 0)::float8 AS meta_purchases,
           COALESCE(s.meta_revenue, 0)::float8   AS meta_revenue,
           COALESCE(s.phantom_rows, 0)::int      AS phantom_rows,
           COALESCE(s.phantom_value, 0)::float8  AS phantom_value
      FROM ads
      LEFT JOIN by_ad b  ON b.ad_id  = ads.ad_id
      LEFT JOIN spend s  ON s.ad_id  = ads.ad_id
      LEFT JOIN owner ow ON ow.ad_id = ads.ad_id
      -- fb_ads is one table for every login; a stray utm id must never put
      -- another login's ad name or thumbnail on this store's screen.
      LEFT JOIN fb_ads f ON f.ad_id  = ads.ad_id AND f.tenant_id IN (SELECT id FROM acct)
     WHERE COALESCE(b.orders_here, 0) > 0
        OR (ow.tenant_id = $1 AND (COALESCE(s.spend, 0) > 0 OR COALESCE(s.meta_purchases, 0) > 0
                                   OR COALESCE(b.orders_sib, 0) > 0
                                   OR COALESCE(s.phantom_rows, 0) > 0))
  `, [storeId, from, to])
}

function toCreative(r: CreativeRow): CreativeAttribution {
  const spend = num(r.spend)
  const metaRevenue = num(r.meta_revenue)
  const journeyRevenue = num(r.revenue_here) + num(r.revenue_sib)
  return {
    adId: r.ad_id,
    name: r.name,
    campaignName: r.campaign_name,
    thumbnail: r.thumbnail_url,
    orders: num(r.orders_here),
    revenue: num(r.revenue_here),
    siblingOrders: num(r.orders_sib),
    siblingRevenue: num(r.revenue_sib),
    spend,
    adStoreId: r.ad_store_id,
    metaPurchases: num(r.meta_purchases),
    metaRevenue,
    roasJourney: spend > 0 ? journeyRevenue / spend : null,
    roasMeta: spend > 0 ? metaRevenue / spend : null,
  }
}

/** Header totals over every row. Exported for the tests. */
export function attributionTotals(storeId: string, rows: CreativeAttribution[]): AttributionTotals {
  const t = {
    orders: 0, revenue: 0, spend: 0, metaPurchases: 0, metaRevenue: 0,
    journeyRevenueOwnAds: 0, journeyOrdersOwnAds: 0, siblingRevenue: 0, siblingOrders: 0,
    sharedSpend: 0, unknownAdRevenue: 0,
  }
  for (const r of rows) {
    t.orders += r.orders
    t.revenue += r.revenue
    if (r.adStoreId === storeId) {
      t.spend += r.spend
      t.metaPurchases += r.metaPurchases
      t.metaRevenue += r.metaRevenue
      t.journeyRevenueOwnAds += r.revenue + r.siblingRevenue
      t.journeyOrdersOwnAds += r.orders + r.siblingOrders
      t.siblingRevenue += r.siblingRevenue
      t.siblingOrders += r.siblingOrders
    } else if (r.adStoreId) {
      t.sharedSpend += r.spend
    } else {
      t.unknownAdRevenue += r.revenue
    }
  }
  return {
    ...t,
    roasJourney: t.spend > 0 ? t.journeyRevenueOwnAds / t.spend : null,
    roasMeta: t.spend > 0 ? t.metaRevenue / t.spend : null,
    metaGapPct: t.journeyRevenueOwnAds > 0 ? ((t.metaRevenue - t.journeyRevenueOwnAds) / t.journeyRevenueOwnAds) * 100 : null,
    adsWithActivity: rows.length,
  }
}

/** Most spend first; among ads with no spend (paused, credited by an old
 *  click), most revenue first. */
function byWeight(a: CreativeAttribution, b: CreativeAttribution): number {
  return b.spend - a.spend || (b.revenue + b.siblingRevenue) - (a.revenue + a.siblingRevenue)
}

/** Rows below the cut, summed, so the table still adds up to the header. */
export function othersRow(rest: CreativeAttribution[]): (CreativeAttribution & { count: number }) | null {
  if (!rest.length) return null
  const s = rest.reduce((a, r) => ({
    orders: a.orders + r.orders, revenue: a.revenue + r.revenue,
    siblingOrders: a.siblingOrders + r.siblingOrders, siblingRevenue: a.siblingRevenue + r.siblingRevenue,
    spend: a.spend + r.spend, metaPurchases: a.metaPurchases + r.metaPurchases, metaRevenue: a.metaRevenue + r.metaRevenue,
  }), { orders: 0, revenue: 0, siblingOrders: 0, siblingRevenue: 0, spend: 0, metaPurchases: 0, metaRevenue: 0 })
  return {
    // "Outros 1.478 anúncios", beside "Todos os 1.518 anúncios".
    adId: 'outros', name: `Outros ${formatCount(rest.length)} anúncios`, campaignName: null, thumbnail: null, adStoreId: null,
    ...s,
    roasJourney: s.spend > 0 ? (s.revenue + s.siblingRevenue) / s.spend : null,
    roasMeta: s.spend > 0 ? s.metaRevenue / s.spend : null,
    count: rest.length,
  }
}

/**
 * Sales credited to each ad by the journey, beside the ad's spend and beside
 * what Meta claims for itself. Every ad with activity, sorted by spend.
 *
 * Kept with its old name and shape for the current attribution page; it now
 * returns every row (no LIMIT 100), so a header summed from it is complete.
 * New code should use getAttributionReport, whose totals are computed apart.
 */
export async function getCreativeAttribution(
  storeId: string, from: string, to: string, model: Model,
): Promise<CreativeAttribution[]> {
  return (await creativeRows(storeId, from, to, model)).map(toCreative).sort(byWeight)
}

// ─── Sources ──────────────────────────────────────────────────────────────────

/** Where sales come from when there is no ad to name — direct, search, social.
 *  First visit of any kind (SOURCE_RULE), not the first ad click. */
export async function getSourceBreakdown(storeId: string, from: string, to: string): Promise<SourceRow[]> {
  const rows = await query<{ source: string; orders: number; revenue: number }>(`
    WITH mine AS (
      SELECT o.order_id, o.total_price::numeric AS total
        FROM shopify_orders o
        JOIN tenants t ON t.id = o.tenant_id
       WHERE o.tenant_id = $1
         AND o.created_at >= ($2::date - 2)::timestamptz
         AND o.created_at <  ($3::date + 3)::timestamptz
         AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
         AND ${KEPT_ORDER_SQL}
    ),
    first_touch AS (
      SELECT DISTINCT ON (p.order_id)
             p.order_id,
             CASE
               WHEN p.ad_id IS NOT NULL          THEN 'Anúncio pago'
               WHEN p.utm_medium = 'paid'        THEN 'Pago sem identificação'
               WHEN p.source ILIKE '%google%'    THEN 'Google'
               WHEN p.source ILIKE '%instagram%' THEN 'Instagram orgânico'
               WHEN p.source ILIKE '%facebook%'  THEN 'Facebook orgânico'
               WHEN p.source = 'direct'          THEN 'Direto'
               ELSE COALESCE(p.source, 'Desconhecido')
             END AS source
        FROM order_touchpoints p
        JOIN mine m ON m.order_id = p.order_id
       WHERE p.tenant_id = $1
       ORDER BY p.order_id, p.seq
    )
    SELECT COALESCE(f.source, 'Sem rastreio') AS source,
           count(*)::int                      AS orders,
           SUM(m.total)::float8               AS revenue
      FROM mine m
      LEFT JOIN first_touch f ON f.order_id = m.order_id
     GROUP BY 1
     ORDER BY SUM(m.total) DESC
  `, [storeId, from, to])
  return rows.map(r => ({ source: r.source, orders: num(r.orders), revenue: num(r.revenue) }))
}

// ─── Shared ad accounts ───────────────────────────────────────────────────────

/**
 * Pairs of stores where one store's journeys touch ads run in another store's
 * ad account, in the window. Today: CAMP HALLOW selling on EPOCH's ads. Only
 * stores inside `storeIds` are matched, so nothing outside the viewer's own
 * stores is ever named.
 */
export async function getSharedAdAccounts(
  storeIds: string[], range: DateRange, names?: Map<string, string>,
): Promise<SharedAdAccount[]> {
  if (storeIds.length < 2) return []
  const rows = await query<{
    ad_store: string; sales_store: string; ad_name: string | null; sales_name: string | null
    orders: number; revenue: number
  }>(`
    WITH acct AS (
      SELECT id, COALESCE(timezone, 'UTC') AS tz FROM tenants WHERE id = ANY($1::text[])
    ),
    period_orders AS (
      SELECT o.tenant_id, o.order_id, o.total_price::numeric AS total
        FROM shopify_orders o
        JOIN acct a ON a.id = o.tenant_id
       WHERE o.created_at >= ($2::date - 2)::timestamptz
         AND o.created_at <  ($3::date + 3)::timestamptz
         AND (o.created_at AT TIME ZONE a.tz)::date BETWEEN $2::date AND $3::date
         AND ${KEPT_ORDER_SQL}
    ),
    touched AS (
      SELECT DISTINCT o.tenant_id, o.order_id, o.total, p.ad_id
        FROM period_orders o
        JOIN order_touchpoints p ON p.tenant_id = o.tenant_id AND p.order_id = o.order_id
       WHERE p.ad_id IS NOT NULL
    ),
    owner AS (
      SELECT DISTINCT ON (m.ad_id) m.ad_id, m.tenant_id
        FROM fb_ad_daily_metrics m
       WHERE m.ad_id IN (SELECT ad_id FROM touched) AND m.tenant_id = ANY($1::text[])
       ORDER BY m.ad_id, m.date DESC
    ),
    pairs AS (
      SELECT DISTINCT ow.tenant_id AS ad_store, t.tenant_id AS sales_store, t.order_id, t.total
        FROM touched t
        JOIN owner ow ON ow.ad_id = t.ad_id
       WHERE ow.tenant_id <> t.tenant_id
    )
    SELECT p.ad_store, p.sales_store,
           COALESCE(ta.shop_name, ta.shopify_domain) AS ad_name,
           COALESCE(ts.shop_name, ts.shopify_domain) AS sales_name,
           count(*)::int AS orders, SUM(p.total)::float8 AS revenue
      FROM pairs p
      JOIN tenants ta ON ta.id = p.ad_store
      JOIN tenants ts ON ts.id = p.sales_store
     GROUP BY 1, 2, 3, 4
     ORDER BY revenue DESC
  `, [storeIds, range.from, range.to])
  return rows.map(r => ({
    adStoreId: r.ad_store,
    adStoreName: names?.get(r.ad_store) ?? r.ad_name ?? r.ad_store,
    salesStoreId: r.sales_store,
    salesStoreName: names?.get(r.sales_store) ?? r.sales_name ?? r.sales_store,
    orders: num(r.orders),
    revenue: num(r.revenue),
  }))
}

/** Ids of the stores sharing a login with `storeId` (itself included). */
async function accountStoreIds(storeId: string): Promise<string[]> {
  const rows = await query<{ id: string }>(`WITH ${ACCOUNT_CTE} SELECT id FROM acct`, [storeId])
  return rows.map(r => r.id)
}

/** The shared-ad-account pairs one store is part of, among the stores of its
 *  own login, in the window. */
export async function getSharedAdAccountsForStore(
  storeId: string, range: DateRange, names?: Map<string, string>,
): Promise<SharedAdAccount[]> {
  const shared = await getSharedAdAccounts(await accountStoreIds(storeId), range, names)
  return shared.filter(s => s.adStoreId === storeId || s.salesStoreId === storeId)
}

// ─── The whole screen ─────────────────────────────────────────────────────────

/**
 * Everything the attribution screen shows, for one store and window.
 * `limit` cuts the creative table only; totals cover every ad.
 */
export async function getAttributionReport(
  storeId: string, range: DateRange, model: Model,
  opts: { limit?: number; names?: Map<string, string> } = {},
): Promise<AttributionReport> {
  const limit = Math.min(Math.max(opts.limit ?? 100, 1), 1000)
  const [coverage, rows, sources, shared] = await Promise.all([
    getCoverage(storeId, range.from, range.to),
    creativeRows(storeId, range.from, range.to, model),
    getSourceBreakdown(storeId, range.from, range.to),
    getSharedAdAccountsForStore(storeId, range, opts.names),
  ])

  const creatives = rows.map(toCreative).sort(byWeight)
  const phantom: PhantomDisclosure = { rows: 0, value: 0 }
  for (const r of rows) {
    if (r.ad_store_id !== storeId) continue
    phantom.rows += num(r.phantom_rows)
    phantom.value += num(r.phantom_value)
  }

  return {
    storeId,
    range,
    model,
    coverage,
    totals: attributionTotals(storeId, creatives),
    creatives: creatives.slice(0, limit),
    others: othersRow(creatives.slice(limit)),
    sources,
    sharedAccounts: shared,
    phantom,
  }
}

// ─── Journey list ─────────────────────────────────────────────────────────────

/** SQL condition for each filter, kept beside the type so they cannot drift. */
function filterClause(filter: JourneyFilter): string {
  switch (filter) {
    case 'paid':         return 'AND j.first_ad_id IS NOT NULL'
    case 'unattributed': return 'AND j.first_ad_id IS NULL'
    case 'multi':        return 'AND COALESCE(j.moments_count, 0) > 1'
    default:             return ''
  }
}

const CURSOR_RE = /^(\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}\.\d{6}Z)\|(\d{1,30})$/

export function encodeJourneyCursor(createdAtUtc: string, orderId: string): string {
  return Buffer.from(`${createdAtUtc}|${orderId}`, 'utf8').toString('base64url')
}

/** Null for anything that is not a cursor this module wrote. */
export function decodeJourneyCursor(cursor: string | null | undefined): { createdAt: string; orderId: string } | null {
  if (!cursor || cursor.length > 200) return null
  let raw: string
  try { raw = Buffer.from(cursor, 'base64url').toString('utf8') } catch { return null }
  const m = CURSOR_RE.exec(raw)
  return m ? { createdAt: m[1], orderId: m[2] } : null
}

/**
 * A page of orders with their paths, newest first.
 *
 * Keyset-paged on (created_at, order_id): orders keep arriving while someone
 * reads, and an OFFSET page would then repeat the rows that slid down from the
 * page before. `offset` is still accepted for the current client, which sends
 * it; new callers pass `cursor` (the previous page's nextCursor).
 */
export async function getJourneyPage(
  storeId: string, from: string, to: string,
  opts: { limit?: number; cursor?: string | null; offset?: number; search?: string; filter?: JourneyFilter } = {},
): Promise<JourneyPage> {
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 30) || 30, 1), 100)
  const filter = opts.filter ?? 'all'
  // Digits only: the search is for an order number, and letting anything else
  // through would just scan the whole table for nothing.
  const search = (opts.search ?? '').replace(/\D/g, '').slice(0, 20)
  const after = decodeJourneyCursor(opts.cursor)
  const offset = after ? 0 : Math.max(Math.trunc(opts.offset ?? 0) || 0, 0)

  const params: unknown[] = [storeId, from, to]
  const base = `
      FROM shopify_orders o
      JOIN tenants t ON t.id = o.tenant_id
      LEFT JOIN order_journeys j ON j.tenant_id = o.tenant_id AND j.order_id = o.order_id
     WHERE o.tenant_id = $1
       AND o.created_at >= ($2::date - 2)::timestamptz
       AND o.created_at <  ($3::date + 3)::timestamptz
       AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
       AND ${KEPT_ORDER_SQL}
       ${filterClause(filter)}
       ${search ? `AND o.order_number::text LIKE $${params.push(`%${search}%`)}` : ''}`
  const countParams = [...params]

  let keyset = ''
  if (after) {
    const a = params.push(after.createdAt)
    const b = params.push(after.orderId)
    keyset = `AND (o.created_at, o.order_id) < ($${a}::timestamptz, $${b}::text)`
  }
  const lim = params.push(limit + 1)
  const off = params.push(offset)

  const [countRows, orders] = await Promise.all([
    query<{ n: number }>(`SELECT count(*)::int AS n ${base}`, countParams),
    query<{
      order_id: string; order_number: number | null; total: number
      created_local: string; created_utc: string; tz: string
      moments_count: number | null; days_to_conversion: number | null
    }>(`
      SELECT o.order_id, o.order_number, o.total_price::float8 AS total,
             to_char(o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'), 'YYYY-MM-DD"T"HH24:MI:SS') AS created_local,
             to_char(o.created_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.US"Z"')              AS created_utc,
             COALESCE(t.timezone, 'UTC') AS tz,
             j.moments_count, j.days_to_conversion
      ${base}
      ${keyset}
      ORDER BY o.created_at DESC, o.order_id DESC
      LIMIT $${lim} OFFSET $${off}
    `, params),
  ])

  const page = orders.slice(0, limit)
  const total = num(countRows[0]?.n)
  const hasMore = orders.length > limit
  const last = page[page.length - 1]
  return {
    orders: await attachTouches(storeId, page),
    total,
    hasMore,
    nextCursor: hasMore && last ? encodeJourneyCursor(last.created_utc, last.order_id) : null,
  }
}

/**
 * A touch as this module builds it: `adInAccount` (optional on the shared
 * JourneyTouch, for pages from before it existed) is always set here. MOKOO
 * #5399 read "anúncio de conta não conectada" for an ad of its own account
 * that the ad table listed as "Anúncio sem nome".
 */
export type JourneyTouchOwned = JourneyTouch & { adInAccount: boolean }

async function attachTouches(
  storeId: string,
  orders: {
    order_id: string; order_number: number | null; total: number
    created_local: string; created_utc: string; tz: string
    moments_count: number | null; days_to_conversion: number | null
  }[],
): Promise<JourneyOrder[]> {
  if (orders.length === 0) return []

  const touches = await query<{
    order_id: string; seq: number; occurred_at: string | null; occurred_local: string | null
    source: string | null; utm_medium: string | null
    ad_id: string | null; ad_name: string | null; ad_in_account: boolean | null; landing_page: string | null
  }>(`
    WITH ${ACCOUNT_CTE}
    SELECT p.order_id, p.seq,
           to_char(p.occurred_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS"Z"')               AS occurred_at,
           to_char(p.occurred_at AT TIME ZONE COALESCE(t.timezone, 'UTC'), 'YYYY-MM-DD HH24:MI') AS occurred_local,
           p.source, p.utm_medium, p.ad_id, a.name AS ad_name,
           -- The ad runs in one of this login's accounts: a catalog row, or
           -- spend on record (the ad table's owner rule, creativeRows). An ad
           -- with spend and no catalog row is one the sync has not described
           -- yet, not an account Opero cannot read.
           (p.ad_id IS NOT NULL AND (a.ad_id IS NOT NULL OR EXISTS (
              SELECT 1 FROM fb_ad_daily_metrics m
               WHERE m.ad_id = p.ad_id AND m.tenant_id IN (SELECT id FROM acct)))) AS ad_in_account,
           p.landing_page
      FROM order_touchpoints p
      JOIN tenants t ON t.id = p.tenant_id
      -- Ad names only from this login's own accounts (fb_ads is shared by all).
      LEFT JOIN fb_ads a ON a.ad_id = p.ad_id AND a.tenant_id IN (SELECT id FROM acct)
     WHERE p.tenant_id = $1 AND p.order_id = ANY($2::text[])
     ORDER BY p.order_id, p.seq
  `, [storeId, orders.map(o => o.order_id)])

  const byOrder = new Map<string, JourneyTouchOwned[]>()
  for (const t of touches) {
    const list = byOrder.get(t.order_id) ?? []
    list.push({
      seq: t.seq,
      occurredAt: t.occurred_at,
      occurredAtLocal: t.occurred_local,
      source: t.source,
      utmMedium: t.utm_medium,
      adId: t.ad_id,
      adName: t.ad_name,
      adInAccount: !!t.ad_in_account,
      landingPage: t.landing_page,
    })
    byOrder.set(t.order_id, list)
  }

  return orders.map(o => ({
    orderId: o.order_id,
    orderNumber: o.order_number,
    total: num(o.total),
    createdAt: o.created_local,
    createdAtUtc: o.created_utc,
    momentsCount: o.moments_count,
    daysToConversion: o.days_to_conversion,
    touches: byOrder.get(o.order_id) ?? [],
  }))
}
