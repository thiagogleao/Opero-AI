import { query } from './db'

/**
 * Reading the collected journeys.
 *
 * Every number here comes from Shopify's own record of the visits that preceded
 * an order, joined to the ad that the visit's utm identifies. It is deliberately
 * kept separate from what Meta reports about itself: the whole point is to be
 * able to put the two side by side.
 */

export type Model = 'first' | 'last' | 'linear'

export const MODELS: { key: Model; label: string; hint: string }[] = [
  { key: 'first',  label: 'Primeiro clique', hint: 'Crédito para o anúncio que trouxe a pessoa pela primeira vez' },
  { key: 'last',   label: 'Último clique',   hint: 'Crédito para o último anúncio antes da compra' },
  { key: 'linear', label: 'Dividido',        hint: 'Crédito repartido entre todos os anúncios da jornada' },
]

export interface CreativeAttribution {
  adId: string
  name: string | null
  campaignName: string | null
  thumbnail: string | null
  /** Orders the journey credits to this ad. Fractional under the linear model. */
  orders: number
  revenue: number
  spend: number
  /** What Meta reports for itself over the same window. */
  metaPurchases: number
  metaRevenue: number
  roasJourney: number | null
  roasMeta: number | null
}

export interface Coverage {
  orders: number
  withJourney: number
  withAd: number
  pct: number
  attributablePct: number
}

/**
 * How much of the period is actually measured.
 *
 * Shown next to every table on purpose: a ranking built from a tenth of the
 * orders looks authoritative and is not, and the only defence is to say so.
 */
export async function getCoverage(
  tenantId: string, dateFrom: string, dateTo: string
): Promise<Coverage> {
  const [row] = await query<{ orders: string; with_journey: string; with_ad: string }>(
    `SELECT
       count(*)::text                                            AS orders,
       count(j.order_id)::text                                   AS with_journey,
       count(j.order_id) FILTER (WHERE j.first_ad_id IS NOT NULL)::text AS with_ad
     FROM shopify_orders o
     JOIN tenants t ON t.id = o.tenant_id
     LEFT JOIN order_journeys j ON j.tenant_id = o.tenant_id AND j.order_id = o.order_id
     WHERE o.tenant_id = $1
       AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
       AND o.financial_status NOT IN ('refunded', 'voided')`,
    [tenantId, dateFrom, dateTo]
  )

  const orders = Number(row?.orders ?? 0)
  const withJourney = Number(row?.with_journey ?? 0)
  const withAd = Number(row?.with_ad ?? 0)
  return {
    orders,
    withJourney,
    withAd,
    pct: orders > 0 ? Math.round((withJourney / orders) * 100) : 0,
    attributablePct: orders > 0 ? Math.round((withAd / orders) * 100) : 0,
  }
}

/** The SQL that turns one order into credited ads, per model. */
function creditCte(model: Model): string {
  if (model === 'linear') {
    // Split evenly between the distinct ads touched, so an order that met three
    // ads gives a third to each rather than counting three whole sales.
    return `
      order_ads AS (
        SELECT p.order_id, p.ad_id, count(*) OVER (PARTITION BY p.order_id) AS ads_in_order
        FROM (SELECT DISTINCT order_id, ad_id FROM order_touchpoints
              WHERE tenant_id = $1 AND ad_id IS NOT NULL) p
      ),
      credits AS (
        SELECT o.order_id, a.ad_id,
               1.0 / a.ads_in_order                      AS weight,
               o.total_price::numeric / a.ads_in_order   AS revenue
        FROM period_orders o
        JOIN order_ads a ON a.order_id = o.order_id
      )`
  }
  const column = model === 'first' ? 'first_ad_id' : 'last_ad_id'
  return `
      credits AS (
        SELECT o.order_id, j.${column} AS ad_id, 1.0 AS weight, o.total_price::numeric AS revenue
        FROM period_orders o
        JOIN order_journeys j ON j.tenant_id = $1 AND j.order_id = o.order_id
        WHERE j.${column} IS NOT NULL
      )`
}

/**
 * Sales credited to each ad by the journey, beside the ad's spend and beside
 * what Meta claims for itself.
 */
export async function getCreativeAttribution(
  tenantId: string, dateFrom: string, dateTo: string, model: Model
): Promise<CreativeAttribution[]> {
  const rows = await query<{
    ad_id: string; name: string | null; campaign_name: string | null; thumbnail_url: string | null
    orders: string; revenue: string; spend: string
    meta_purchases: string; meta_revenue: string
  }>(`
    WITH period_orders AS (
      SELECT o.order_id, o.total_price
      FROM shopify_orders o
      JOIN tenants t ON t.id = o.tenant_id
      WHERE o.tenant_id = $1
        AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
        AND o.financial_status NOT IN ('refunded', 'voided')
    ),
    ${creditCte(model)},
    by_ad AS (
      SELECT ad_id, SUM(weight) AS orders, SUM(revenue) AS revenue
      FROM credits GROUP BY ad_id
    ),
    spend AS (
      SELECT ad_id,
             SUM(spend)          AS spend,
             SUM(purchases)      AS meta_purchases,
             SUM(purchase_value) AS meta_revenue
      FROM fb_ad_daily_metrics
      WHERE tenant_id = $1 AND date BETWEEN $2::date AND $3::date
      GROUP BY ad_id
    )
    SELECT
      COALESCE(b.ad_id, s.ad_id)                   AS ad_id,
      a.name, a.campaign_name, a.thumbnail_url,
      ROUND(COALESCE(b.orders, 0)::numeric, 2)::text  AS orders,
      ROUND(COALESCE(b.revenue, 0)::numeric, 2)::text AS revenue,
      ROUND(COALESCE(s.spend, 0)::numeric, 2)::text   AS spend,
      COALESCE(s.meta_purchases, 0)::text             AS meta_purchases,
      ROUND(COALESCE(s.meta_revenue, 0)::numeric, 2)::text AS meta_revenue
    FROM by_ad b
    -- Ads that spent but the journey never credits are the interesting ones, so
    -- a full join keeps them instead of hiding them.
    FULL OUTER JOIN spend s ON s.ad_id = b.ad_id
    LEFT JOIN fb_ads a ON a.ad_id = COALESCE(b.ad_id, s.ad_id)
    WHERE COALESCE(s.spend, 0) > 0 OR COALESCE(b.orders, 0) > 0
    ORDER BY COALESCE(s.spend, 0) DESC
    LIMIT 100
  `, [tenantId, dateFrom, dateTo])

  return rows.map(r => {
    const revenue = Number(r.revenue)
    const spend = Number(r.spend)
    const metaRevenue = Number(r.meta_revenue)
    return {
      adId: r.ad_id,
      name: r.name,
      campaignName: r.campaign_name,
      thumbnail: r.thumbnail_url,
      orders: Number(r.orders),
      revenue,
      spend,
      metaPurchases: Number(r.meta_purchases),
      metaRevenue,
      roasJourney: spend > 0 ? revenue / spend : null,
      roasMeta: spend > 0 ? metaRevenue / spend : null,
    }
  })
}

export interface SourceRow {
  source: string
  orders: number
  revenue: number
}

/** Where sales come from when there is no ad to name — direct, search, social. */
export async function getSourceBreakdown(
  tenantId: string, dateFrom: string, dateTo: string
): Promise<SourceRow[]> {
  return (await query<{ source: string; orders: string; revenue: string }>(`
    WITH period_orders AS (
      SELECT o.order_id, o.total_price
      FROM shopify_orders o
      JOIN tenants t ON t.id = o.tenant_id
      WHERE o.tenant_id = $1
        AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
        AND o.financial_status NOT IN ('refunded', 'voided')
    ),
    first_touch AS (
      SELECT DISTINCT ON (p.order_id)
        p.order_id,
        CASE
          WHEN p.ad_id IS NOT NULL             THEN 'Anúncio pago'
          WHEN p.utm_medium = 'paid'           THEN 'Pago sem identificação'
          WHEN p.source ILIKE '%google%'       THEN 'Google'
          WHEN p.source ILIKE '%instagram%'    THEN 'Instagram orgânico'
          WHEN p.source ILIKE '%facebook%'     THEN 'Facebook orgânico'
          WHEN p.source = 'direct'             THEN 'Direto'
          ELSE COALESCE(p.source, 'Desconhecido')
        END AS source
      FROM order_touchpoints p
      WHERE p.tenant_id = $1
      ORDER BY p.order_id, p.seq
    )
    SELECT
      COALESCE(f.source, 'Sem rastreio')            AS source,
      count(*)::text                                 AS orders,
      ROUND(SUM(o.total_price::numeric), 2)::text    AS revenue
    FROM period_orders o
    LEFT JOIN first_touch f ON f.order_id = o.order_id
    GROUP BY 1
    ORDER BY SUM(o.total_price::numeric) DESC
  `, [tenantId, dateFrom, dateTo])).map(r => ({
    source: r.source,
    orders: Number(r.orders),
    revenue: Number(r.revenue),
  }))
}

export interface JourneyOrder {
  orderId: string
  orderNumber: number | null
  total: number
  createdAt: string
  momentsCount: number | null
  daysToConversion: number | null
  touches: {
    seq: number
    occurredAt: string | null
    source: string | null
    utmMedium: string | null
    adId: string | null
    adName: string | null
    landingPage: string | null
  }[]
}

/** Recent orders with their full path, newest first. */
export async function getRecentJourneys(
  tenantId: string, dateFrom: string, dateTo: string, limit = 40
): Promise<JourneyOrder[]> {
  const orders = await query<{
    order_id: string; order_number: number | null; total_price: string
    created_at: string; moments_count: number | null; days_to_conversion: number | null
  }>(`
    SELECT o.order_id, o.order_number, o.total_price::text, o.created_at::text,
           j.moments_count, j.days_to_conversion
    FROM shopify_orders o
    JOIN tenants t ON t.id = o.tenant_id
    LEFT JOIN order_journeys j ON j.tenant_id = o.tenant_id AND j.order_id = o.order_id
    WHERE o.tenant_id = $1
      AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
      AND o.financial_status NOT IN ('refunded', 'voided')
    ORDER BY o.created_at DESC
    LIMIT $4
  `, [tenantId, dateFrom, dateTo, limit])

  if (orders.length === 0) return []

  const touches = await query<{
    order_id: string; seq: number; occurred_at: string | null
    source: string | null; utm_medium: string | null
    ad_id: string | null; ad_name: string | null; landing_page: string | null
  }>(`
    SELECT p.order_id, p.seq, p.occurred_at::text, p.source, p.utm_medium,
           p.ad_id, a.name AS ad_name, p.landing_page
    FROM order_touchpoints p
    LEFT JOIN fb_ads a ON a.ad_id = p.ad_id
    WHERE p.tenant_id = $1 AND p.order_id = ANY($2::text[])
    ORDER BY p.order_id, p.seq
  `, [tenantId, orders.map(o => o.order_id)])

  const byOrder = new Map<string, JourneyOrder['touches']>()
  for (const t of touches) {
    const list = byOrder.get(t.order_id) ?? []
    list.push({
      seq: t.seq,
      occurredAt: t.occurred_at,
      source: t.source,
      utmMedium: t.utm_medium,
      adId: t.ad_id,
      adName: t.ad_name,
      landingPage: t.landing_page,
    })
    byOrder.set(t.order_id, list)
  }

  return orders.map(o => ({
    orderId: o.order_id,
    orderNumber: o.order_number,
    total: Number(o.total_price),
    createdAt: o.created_at,
    momentsCount: o.moments_count,
    daysToConversion: o.days_to_conversion,
    touches: byOrder.get(o.order_id) ?? [],
  }))
}
