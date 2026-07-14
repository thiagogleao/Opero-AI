import { query } from './db'

export async function getOverviewMetrics(tenantId: string, dateFrom: string, dateTo: string) {
  const [shopify] = await query<{
    revenue: number; orders: number; aov: number
    new_customers: number; returning_customers: number
    abandoned_value: number; abandoned_count: number
  }>(`
    WITH tz AS (
      SELECT COALESCE(timezone, 'UTC') AS name FROM tenants WHERE id = $1
    ),
    period_orders AS (
      SELECT order_id, total_price, customer_id
      FROM shopify_orders, tz
      WHERE tenant_id = $1
        AND (created_at AT TIME ZONE tz.name)::date BETWEEN $2::date AND $3::date
        AND financial_status NOT IN ('refunded', 'voided')
    ),
    first_order_dates AS (
      SELECT customer_id, MIN((created_at AT TIME ZONE (SELECT name FROM tz))::date) AS first_date
      FROM shopify_orders
      WHERE tenant_id = $1
        AND financial_status NOT IN ('refunded', 'voided')
        AND customer_id IS NOT NULL
      GROUP BY customer_id
    ),
    customer_type AS (
      SELECT
        po.order_id,
        po.total_price,
        CASE
          WHEN fo.first_date >= $2::date THEN 'new'
          ELSE 'returning'
        END AS ctype
      FROM period_orders po
      LEFT JOIN first_order_dates fo ON po.customer_id = fo.customer_id
    )
    SELECT
      COALESCE(SUM(total_price::numeric), 0)                                  AS revenue,
      COUNT(*)                                                                  AS orders,
      CASE WHEN COUNT(*) > 0 THEN SUM(total_price::numeric) / COUNT(*) ELSE 0 END AS aov,
      COUNT(*) FILTER (WHERE ctype = 'new')                                    AS new_customers,
      COUNT(*) FILTER (WHERE ctype = 'returning')                              AS returning_customers,
      0 AS abandoned_value,
      0 AS abandoned_count
    FROM customer_type
  `, [tenantId, dateFrom, dateTo])

  const [fb] = await query<{
    spend: number; fb_revenue: number; roas: number
    purchases: number; avg_ctr: number; avg_frequency: number
  }>(`
    SELECT
      COALESCE(SUM(spend), 0)          AS spend,
      COALESCE(SUM(purchase_value), 0) AS fb_revenue,
      CASE WHEN SUM(spend) > 0 THEN SUM(purchase_value) / SUM(spend) ELSE 0 END AS roas,
      COALESCE(SUM(purchases), 0)      AS purchases,
      COALESCE(AVG(ctr), 0)            AS avg_ctr,
      COALESCE(AVG(NULLIF(frequency,0)), 0) AS avg_frequency
    FROM fb_ad_daily_metrics
    WHERE tenant_id = $1
      AND date BETWEEN $2::date AND $3::date
  `, [tenantId, dateFrom, dateTo])

  const [abandoned] = await query<{ abandoned_value: number; abandoned_count: number }>(`
    SELECT
      COALESCE(SUM(total_price), 0) AS abandoned_value,
      COUNT(*)                      AS abandoned_count
    FROM shopify_abandoned_checkouts
    WHERE tenant_id = $1
      AND created_at::date BETWEEN $2::date AND $3::date
      AND total_price <= (
        SELECT GREATEST(COALESCE(AVG(total_price::numeric), 100) * 30, 500)
        FROM shopify_orders
        WHERE tenant_id = $1
          AND financial_status NOT IN ('refunded', 'voided')
      )
  `, [tenantId, dateFrom, dateTo])

  const blended_roas = Number(fb.spend) > 0 ? Number(shopify.revenue) / Number(fb.spend) : 0

  return { ...shopify, ...fb, ...abandoned, blended_roas }
}

export async function getDailyRevenue(tenantId: string, dateFrom: string, dateTo: string) {
  const rows = await query<{ date: string; revenue: string; spend: string }>(`
    SELECT
      dates.d::text                               AS date,
      ROUND(COALESCE(s.total_revenue, 0)::numeric, 2) AS revenue,
      ROUND(COALESCE(f.spend, 0)::numeric, 2)     AS spend
    FROM generate_series($2::date, $3::date, '1 day') AS dates(d)
    LEFT JOIN (
      SELECT
        (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date AS date,
        SUM(o.total_price::numeric) AS total_revenue
      FROM shopify_orders o
      JOIN tenants t ON t.id = o.tenant_id
      WHERE o.tenant_id = $1
        AND o.financial_status NOT IN ('refunded', 'voided')
      GROUP BY 1
    ) s ON s.date = dates.d
    LEFT JOIN (
      SELECT date, SUM(spend) AS spend
      FROM fb_ad_daily_metrics
      WHERE tenant_id = $1
      GROUP BY date
    ) f ON f.date = dates.d
    ORDER BY dates.d
  `, [tenantId, dateFrom, dateTo])
  return rows.map(r => ({ date: r.date, revenue: Number(r.revenue), spend: Number(r.spend) }))
}

export async function getDailyRoas(tenantId: string, dateFrom: string, dateTo: string) {
  const rows = await query<{ date: string; blended_roas: string }>(`
    SELECT
      dates.d::text AS date,
      ROUND(COALESCE(
        CASE WHEN f.spend > 0 THEN s.total_revenue / f.spend ELSE 0 END,
      0)::numeric, 2) AS blended_roas
    FROM generate_series($2::date, $3::date, '1 day') AS dates(d)
    LEFT JOIN (
      SELECT
        (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date AS date,
        SUM(o.total_price::numeric) AS total_revenue
      FROM shopify_orders o
      JOIN tenants t ON t.id = o.tenant_id
      WHERE o.tenant_id = $1
        AND o.financial_status NOT IN ('refunded', 'voided')
      GROUP BY 1
    ) s ON s.date = dates.d
    LEFT JOIN (
      SELECT date, SUM(spend) AS spend, SUM(purchase_value) AS purchase_value
      FROM fb_ad_daily_metrics
      WHERE tenant_id = $1
      GROUP BY date
    ) f ON f.date = dates.d
    ORDER BY dates.d
  `, [tenantId, dateFrom, dateTo])
  return rows.map(r => ({ date: r.date, blended_roas: Number(r.blended_roas) }))
}

export async function getTopCreatives(tenantId: string, dateFrom: string, dateTo: string) {
  return query<{
    ad_id: string; name: string; spend: number
    revenue: number; roas: number; ctr: number; frequency: number
    purchases: number; score: number
    hook_rate: number | null
    hold_rate_25: number | null; hold_rate_50: number | null
    hold_rate_75: number | null; hold_rate_100: number | null
    video_plays: number | null
    thumbnail_url: string | null; creative_url: string | null
  }>(`
    SELECT
      a.ad_id,
      COALESCE(a.name, a.ad_id)              AS name,
      a.thumbnail_url,
      a.creative_url,
      ROUND(SUM(m.spend)::numeric, 2)        AS spend,
      ROUND(SUM(m.purchase_value)::numeric, 2) AS revenue,
      ROUND(CASE WHEN SUM(m.spend) > 0
        THEN SUM(m.purchase_value) / SUM(m.spend) ELSE 0 END::numeric, 2) AS roas,
      ROUND(CASE WHEN SUM(m.impressions) > 0
        THEN SUM(m.link_clicks)::numeric / SUM(m.impressions) * 100
        ELSE 0 END::numeric, 2)             AS ctr,
      ROUND(CASE WHEN SUM(NULLIF(m.reach,0)) > 0
        THEN SUM(m.impressions)::numeric / SUM(m.reach)
        ELSE 0 END::numeric, 2)             AS frequency,
      SUM(m.purchases)                       AS purchases,
      ROUND(
        ((SUM(m.purchase_value) - SUM(m.spend)) *
        (1 - EXP(-SUM(m.spend) / 50.0)))::numeric
      , 2) AS score,
      -- Video metrics: computed from aggregated raw counters for accuracy
      ROUND(CASE WHEN SUM(m.impressions) > 0 AND SUM(m.video_plays) > 0
        THEN SUM(m.video_plays)::numeric / SUM(m.impressions) * 100
        ELSE NULL END::numeric, 2)          AS hook_rate,
      ROUND(CASE WHEN SUM(m.video_plays) > 0 AND SUM(m.video_p25) > 0
        THEN SUM(m.video_p25)::numeric / SUM(m.video_plays) * 100
        ELSE NULL END::numeric, 2)          AS hold_rate_25,
      ROUND(CASE WHEN SUM(m.video_plays) > 0 AND SUM(m.video_p50) > 0
        THEN SUM(m.video_p50)::numeric / SUM(m.video_plays) * 100
        ELSE NULL END::numeric, 2)          AS hold_rate_50,
      ROUND(CASE WHEN SUM(m.video_plays) > 0 AND SUM(m.video_p75) > 0
        THEN SUM(m.video_p75)::numeric / SUM(m.video_plays) * 100
        ELSE NULL END::numeric, 2)          AS hold_rate_75,
      ROUND(CASE WHEN SUM(m.video_plays) > 0 AND SUM(m.video_p100) > 0
        THEN SUM(m.video_p100)::numeric / SUM(m.video_plays) * 100
        ELSE NULL END::numeric, 2)          AS hold_rate_100,
      SUM(m.video_plays)                    AS video_plays
    FROM fb_ad_daily_metrics m
    JOIN fb_ads a ON m.ad_id = a.ad_id
    WHERE m.tenant_id = $1
      AND m.date BETWEEN $2::date AND $3::date
    GROUP BY a.ad_id, a.name, a.thumbnail_url, a.creative_url
    HAVING SUM(m.spend) > 0
    ORDER BY score DESC
  `, [tenantId, dateFrom, dateTo])
}

export async function getCountryMetrics(tenantId: string, dateFrom: string, dateTo: string) {
  return query<{
    country_code: string; revenue: number; orders: number; aov: number
  }>(`
    SELECT
      country_code,
      ROUND(SUM(revenue)::numeric, 2)        AS revenue,
      SUM(orders_count)                      AS orders,
      ROUND(AVG(avg_order_value)::numeric, 2) AS aov
    FROM shopify_country_metrics
    WHERE tenant_id = $1
      AND date BETWEEN $2::date AND $3::date
      AND country_code != 'XX'
    GROUP BY country_code
    ORDER BY revenue DESC
    LIMIT 10
  `, [tenantId, dateFrom, dateTo])
}

export async function getCustomerSplit(tenantId: string, dateFrom: string, dateTo: string) {
  return query<{
    date: string; new_customers: number; returning_customers: number
    new_revenue: number; returning_revenue: number
  }>(`
    WITH tz AS (SELECT COALESCE(timezone,'UTC') AS name FROM tenants WHERE id = $1),
    first_order_dates AS (
      SELECT customer_id, MIN((created_at AT TIME ZONE (SELECT name FROM tz))::date) AS first_date
      FROM shopify_orders
      WHERE tenant_id = $1
        AND financial_status NOT IN ('refunded', 'voided')
        AND customer_id IS NOT NULL
      GROUP BY customer_id
    )
    SELECT
      (o.created_at AT TIME ZONE (SELECT name FROM tz))::date::text                         AS date,
      COUNT(*) FILTER (WHERE fo.first_date >= $2::date)                                     AS new_customers,
      COUNT(*) FILTER (WHERE fo.first_date < $2::date OR fo.first_date IS NULL)             AS returning_customers,
      COALESCE(SUM(o.total_price::numeric) FILTER (WHERE fo.first_date >= $2::date), 0)     AS new_revenue,
      COALESCE(SUM(o.total_price::numeric) FILTER (WHERE fo.first_date < $2::date OR fo.first_date IS NULL), 0) AS returning_revenue
    FROM shopify_orders o
    LEFT JOIN first_order_dates fo ON o.customer_id = fo.customer_id
    WHERE o.tenant_id = $1
      AND (o.created_at AT TIME ZONE (SELECT name FROM tz))::date BETWEEN $2::date AND $3::date
      AND o.financial_status NOT IN ('refunded', 'voided')
    GROUP BY 1
    ORDER BY 1
  `, [tenantId, dateFrom, dateTo])
}

export async function getCountrySpend(tenantId: string, dateFrom: string, dateTo: string) {
  return query<{
    country: string; spend: number; purchases: number
    revenue: number; clicks: number; cpc: number; roas: number
  }>(`
    SELECT
      breakdown_value                                    AS country,
      ROUND(SUM(spend)::numeric, 2)                     AS spend,
      SUM(purchases)                                    AS purchases,
      ROUND(SUM(purchase_value)::numeric, 2)            AS revenue,
      SUM(clicks)                                       AS clicks,
      ROUND(CASE WHEN SUM(clicks) > 0 THEN SUM(spend) / SUM(clicks) ELSE 0 END::numeric, 3) AS cpc,
      ROUND(CASE WHEN SUM(spend) > 0 THEN SUM(purchase_value) / SUM(spend) ELSE 0 END::numeric, 2) AS roas
    FROM fb_ad_breakdowns
    WHERE tenant_id = $1
      AND breakdown_type = 'country'
      AND date BETWEEN $2::date AND $3::date
    GROUP BY breakdown_value
    HAVING SUM(spend) > 5
    ORDER BY spend DESC
    LIMIT 10
  `, [tenantId, dateFrom, dateTo])
}

export type BreakdownRow = {
  label: string; spend: number; purchases: number
  revenue: number; clicks: number; roas: number; impressions: number; ctr: number
}

export async function getBreakdownByType(
  tenantId: string, dateFrom: string, dateTo: string,
  breakdownType: 'device' | 'placement' | 'age_gender'
): Promise<BreakdownRow[]> {
  return query<BreakdownRow>(`
    SELECT
      breakdown_value                                       AS label,
      ROUND(SUM(spend)::numeric, 2)                        AS spend,
      SUM(purchases)                                       AS purchases,
      ROUND(SUM(purchase_value)::numeric, 2)               AS revenue,
      SUM(clicks)                                          AS clicks,
      SUM(impressions)                                     AS impressions,
      ROUND(CASE WHEN SUM(impressions) > 0
        THEN SUM(clicks)::numeric / SUM(impressions) * 100 ELSE 0 END::numeric, 2) AS ctr,
      ROUND(CASE WHEN SUM(spend) > 0
        THEN SUM(purchase_value) / SUM(spend) ELSE 0 END::numeric, 2)              AS roas
    FROM fb_ad_breakdowns
    WHERE tenant_id = $1
      AND breakdown_type = $4
      AND date BETWEEN $2::date AND $3::date
    GROUP BY breakdown_value
    HAVING SUM(spend) > 1
    ORDER BY spend DESC
    LIMIT 15
  `, [tenantId, dateFrom, dateTo, breakdownType])
}

export async function getCustomerLtv(tenantId: string) {
  return query<{
    segment: string; customers: number; avg_orders: number
    avg_ltv: number; avg_aov: number; pct: number
  }>(`
    WITH buckets AS (
      SELECT
        customer_id,
        orders_count,
        total_spent,
        CASE
          WHEN orders_count = 1 THEN '1 pedido'
          WHEN orders_count BETWEEN 2 AND 3 THEN '2-3 pedidos'
          WHEN orders_count BETWEEN 4 AND 6 THEN '4-6 pedidos'
          ELSE '7+ pedidos'
        END AS segment,
        CASE
          WHEN orders_count = 1 THEN 1
          WHEN orders_count BETWEEN 2 AND 3 THEN 2
          WHEN orders_count BETWEEN 4 AND 6 THEN 3
          ELSE 4
        END AS sort_order
      FROM shopify_customers
      WHERE tenant_id = $1
        AND orders_count > 0
    ),
    totals AS (SELECT COUNT(*) AS total FROM buckets)
    SELECT
      b.segment,
      COUNT(*)                                               AS customers,
      ROUND(AVG(b.orders_count)::numeric, 1)                AS avg_orders,
      ROUND(AVG(b.total_spent)::numeric, 2)                 AS avg_ltv,
      ROUND(CASE WHEN AVG(b.orders_count) > 0
        THEN AVG(b.total_spent) / AVG(b.orders_count) ELSE 0 END::numeric, 2) AS avg_aov,
      ROUND(COUNT(*) * 100.0 / NULLIF((SELECT total FROM totals), 0), 1)      AS pct
    FROM buckets b
    GROUP BY b.segment, b.sort_order
    ORDER BY b.sort_order
  `, [tenantId])
}

export async function getCampaignMetrics(tenantId: string, dateFrom: string, dateTo: string) {
  return query<{
    campaign_id: string; campaign_name: string; objective: string | null
    spend: number; revenue: number; roas: number; purchases: number
    impressions: number; clicks: number; ctr: number; cpm: number
    adset_count: number; ad_count: number
  }>(`
    SELECT
      c.campaign_id,
      COALESCE(c.name, c.campaign_id)         AS campaign_name,
      c.objective,
      ROUND(SUM(m.spend)::numeric, 2)         AS spend,
      ROUND(SUM(m.purchase_value)::numeric, 2) AS revenue,
      ROUND(CASE WHEN SUM(m.spend) > 0
        THEN SUM(m.purchase_value) / SUM(m.spend) ELSE 0 END::numeric, 2) AS roas,
      SUM(m.purchases)                        AS purchases,
      SUM(m.impressions)                      AS impressions,
      SUM(m.link_clicks)                      AS clicks,
      ROUND(CASE WHEN SUM(m.impressions) > 0
        THEN SUM(m.link_clicks)::numeric / SUM(m.impressions) * 100
        ELSE 0 END::numeric, 2)              AS ctr,
      ROUND(CASE WHEN SUM(m.impressions) > 0
        THEN SUM(m.spend) / SUM(m.impressions) * 1000
        ELSE 0 END::numeric, 2)              AS cpm,
      COUNT(DISTINCT a.adset_id)              AS adset_count,
      COUNT(DISTINCT m.ad_id)                 AS ad_count
    FROM fb_campaigns c
    JOIN fb_ad_daily_metrics m ON m.campaign_id = c.campaign_id
    LEFT JOIN fb_adsets a ON a.campaign_id = c.campaign_id
    WHERE m.tenant_id = $1
      AND m.date BETWEEN $2::date AND $3::date
    GROUP BY c.campaign_id, c.name, c.objective
    HAVING SUM(m.spend) > 0
    ORDER BY spend DESC
  `, [tenantId, dateFrom, dateTo])
}

export async function getAdsetMetrics(tenantId: string, campaignId: string, dateFrom: string, dateTo: string) {
  return query<{
    adset_id: string; adset_name: string
    spend: number; revenue: number; roas: number; purchases: number
    impressions: number; clicks: number; ctr: number; ad_count: number
  }>(`
    SELECT
      s.adset_id,
      COALESCE(s.name, s.adset_id)            AS adset_name,
      ROUND(SUM(m.spend)::numeric, 2)         AS spend,
      ROUND(SUM(m.purchase_value)::numeric, 2) AS revenue,
      ROUND(CASE WHEN SUM(m.spend) > 0
        THEN SUM(m.purchase_value) / SUM(m.spend) ELSE 0 END::numeric, 2) AS roas,
      SUM(m.purchases)                        AS purchases,
      SUM(m.impressions)                      AS impressions,
      SUM(m.link_clicks)                      AS clicks,
      ROUND(CASE WHEN SUM(m.impressions) > 0
        THEN SUM(m.link_clicks)::numeric / SUM(m.impressions) * 100
        ELSE 0 END::numeric, 2)              AS ctr,
      COUNT(DISTINCT m.ad_id)                 AS ad_count
    FROM fb_adsets s
    JOIN fb_ad_daily_metrics m ON m.adset_id = s.adset_id AND m.tenant_id = s.tenant_id
    WHERE s.tenant_id = $1
      AND s.campaign_id = $2
      AND m.date BETWEEN $3::date AND $4::date
    GROUP BY s.adset_id, s.name
    HAVING SUM(m.spend) > 0
    ORDER BY spend DESC
  `, [tenantId, campaignId, dateFrom, dateTo])
}

export async function getCreativeDetail(tenantId: string, adId: string, dateFrom: string, dateTo: string) {
  const [summary] = await query<{
    ad_id: string; name: string; status: string
    thumbnail_url: string | null; creative_url: string | null; landing_url: string | null
    spend: number; revenue: number; roas: number; purchases: number
    impressions: number; clicks: number; ctr: number; frequency: number
    video_plays: number | null; hook_rate: number | null
    hold_rate_25: number | null; hold_rate_50: number | null
    hold_rate_75: number | null; hold_rate_100: number | null
  }>(`
    SELECT
      a.ad_id, COALESCE(a.name, a.ad_id) AS name, a.status,
      a.thumbnail_url, a.creative_url, a.landing_url,
      ROUND(SUM(m.spend)::numeric, 2)          AS spend,
      ROUND(SUM(m.purchase_value)::numeric, 2)  AS revenue,
      ROUND(CASE WHEN SUM(m.spend) > 0
        THEN SUM(m.purchase_value) / SUM(m.spend) ELSE 0 END::numeric, 2) AS roas,
      SUM(m.purchases)                          AS purchases,
      SUM(m.impressions)                        AS impressions,
      SUM(m.link_clicks)                        AS clicks,
      ROUND(CASE WHEN SUM(m.impressions) > 0
        THEN SUM(m.link_clicks)::numeric / SUM(m.impressions) * 100 ELSE 0 END::numeric, 2) AS ctr,
      ROUND(CASE WHEN SUM(NULLIF(m.reach,0)) > 0
        THEN SUM(m.impressions)::numeric / SUM(m.reach) ELSE 0 END::numeric, 2)             AS frequency,
      SUM(m.video_plays)                        AS video_plays,
      ROUND(CASE WHEN SUM(m.impressions) > 0 AND SUM(m.video_plays) > 0
        THEN SUM(m.video_plays)::numeric / SUM(m.impressions) * 100 ELSE NULL END::numeric, 2) AS hook_rate,
      ROUND(CASE WHEN SUM(m.video_plays) > 0 AND SUM(m.video_p25) > 0
        THEN SUM(m.video_p25)::numeric / SUM(m.video_plays) * 100 ELSE NULL END::numeric, 2)  AS hold_rate_25,
      ROUND(CASE WHEN SUM(m.video_plays) > 0 AND SUM(m.video_p50) > 0
        THEN SUM(m.video_p50)::numeric / SUM(m.video_plays) * 100 ELSE NULL END::numeric, 2)  AS hold_rate_50,
      ROUND(CASE WHEN SUM(m.video_plays) > 0 AND SUM(m.video_p75) > 0
        THEN SUM(m.video_p75)::numeric / SUM(m.video_plays) * 100 ELSE NULL END::numeric, 2)  AS hold_rate_75,
      ROUND(CASE WHEN SUM(m.video_plays) > 0 AND SUM(m.video_p100) > 0
        THEN SUM(m.video_p100)::numeric / SUM(m.video_plays) * 100 ELSE NULL END::numeric, 2) AS hold_rate_100
    FROM fb_ads a
    JOIN fb_ad_daily_metrics m ON a.ad_id = m.ad_id
    WHERE m.tenant_id = $1 AND a.ad_id = $2
      AND m.date BETWEEN $3::date AND $4::date
    GROUP BY a.ad_id, a.name, a.status, a.thumbnail_url, a.creative_url, a.landing_url
  `, [tenantId, adId, dateFrom, dateTo])

  const daily = await query<{
    date: string; spend: number; revenue: number; roas: number
    impressions: number; clicks: number; purchases: number
  }>(`
    SELECT
      date::text,
      ROUND(spend::numeric, 2)          AS spend,
      ROUND(purchase_value::numeric, 2) AS revenue,
      ROUND(CASE WHEN spend > 0 THEN purchase_value / spend ELSE 0 END::numeric, 2) AS roas,
      impressions, link_clicks AS clicks, purchases
    FROM fb_ad_daily_metrics
    WHERE tenant_id = $1 AND ad_id = $2
      AND date BETWEEN $3::date AND $4::date
    ORDER BY date
  `, [tenantId, adId, dateFrom, dateTo])

  return { summary, daily }
}

export async function getFunnelMetrics(tenantId: string, dateFrom: string, dateTo: string) {
  const [fb] = await query<{
    impressions: number; link_clicks: number; landing_page_views: number
    add_to_cart: number; initiate_checkout: number; purchases: number
    spend: number; cpm: number; cpc: number
    cost_per_atc: number; cost_per_checkout: number; cost_per_purchase: number
  }>(`
    SELECT
      COALESCE(SUM(impressions), 0)         AS impressions,
      COALESCE(SUM(link_clicks), 0)         AS link_clicks,
      COALESCE(SUM(landing_page_views), 0)  AS landing_page_views,
      COALESCE(SUM(add_to_cart), 0)         AS add_to_cart,
      COALESCE(SUM(initiate_checkout), 0)   AS initiate_checkout,
      COALESCE(SUM(purchases), 0)           AS purchases,
      COALESCE(SUM(spend), 0)               AS spend,
      ROUND(CASE WHEN SUM(impressions) > 0 THEN SUM(spend) / SUM(impressions) * 1000 ELSE 0 END::numeric, 2) AS cpm,
      ROUND(CASE WHEN SUM(link_clicks) > 0 THEN SUM(spend) / SUM(link_clicks) ELSE 0 END::numeric, 3)        AS cpc,
      ROUND(CASE WHEN SUM(add_to_cart) > 0 THEN SUM(spend) / SUM(add_to_cart) ELSE 0 END::numeric, 2)        AS cost_per_atc,
      ROUND(CASE WHEN SUM(initiate_checkout) > 0 THEN SUM(spend) / SUM(initiate_checkout) ELSE 0 END::numeric, 2) AS cost_per_checkout,
      ROUND(CASE WHEN SUM(purchases) > 0 THEN SUM(spend) / SUM(purchases) ELSE 0 END::numeric, 2)            AS cost_per_purchase
    FROM fb_ad_daily_metrics
    WHERE tenant_id = $1
      AND date BETWEEN $2::date AND $3::date
  `, [tenantId, dateFrom, dateTo])

  const [shopify] = await query<{ orders: number; abandoned: number }>(`
    SELECT
      COUNT(*) FILTER (WHERE o.financial_status NOT IN ('refunded','voided')) AS orders,
      (SELECT COUNT(*) FROM shopify_abandoned_checkouts
       WHERE tenant_id = $1
         AND created_at::date BETWEEN $2::date AND $3::date
         AND total_price <= (
           SELECT GREATEST(COALESCE(AVG(total_price::numeric),100)*30,500)
           FROM shopify_orders WHERE tenant_id = $1 AND financial_status NOT IN ('refunded','voided')
         )
      ) AS abandoned
    FROM shopify_orders o
    JOIN tenants t ON t.id = o.tenant_id
    WHERE o.tenant_id = $1
      AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
  `, [tenantId, dateFrom, dateTo])

  return { ...fb, shopify_orders: Number(shopify.orders), shopify_abandoned: Number(shopify.abandoned) }
}

export async function getProductMetrics(tenantId: string, dateFrom: string, dateTo: string) {
  return query<{
    product_id: string; title: string; image_url: string | null
    units: number; orders: number; revenue: number; aov: number
  }>(`
    SELECT
      p.product_id,
      COALESCE(p.title, oi.product_title, oi.title)  AS title,
      p.image_url,
      COALESCE(SUM(oi.quantity), 0)                  AS units,
      COUNT(DISTINCT o.order_id)                     AS orders,
      ROUND(SUM(oi.quantity * oi.price)::numeric, 2) AS revenue,
      ROUND(CASE WHEN COUNT(DISTINCT o.order_id) > 0
        THEN SUM(oi.quantity * oi.price) / COUNT(DISTINCT o.order_id) ELSE 0
        END::numeric, 2)                             AS aov
    FROM shopify_order_items oi
    JOIN shopify_orders o ON oi.order_id = o.order_id AND oi.tenant_id = o.tenant_id
    JOIN tenants t ON t.id = o.tenant_id
    LEFT JOIN shopify_products p ON oi.product_id = p.product_id AND p.tenant_id = o.tenant_id
    WHERE o.tenant_id = $1
      AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
      AND o.financial_status NOT IN ('refunded', 'voided')
    GROUP BY p.product_id, p.title, oi.product_title, p.image_url
    ORDER BY revenue DESC
  `, [tenantId, dateFrom, dateTo])
}

export async function getAllProducts(tenantId: string) {
  return query<{
    product_id: string; title: string; image_url: string | null
    price_min: number; price_max: number; status: string
  }>(`
    SELECT product_id, title, image_url, price_min, price_max, status
    FROM shopify_products
    WHERE tenant_id = $1
    ORDER BY title
  `, [tenantId])
}

export async function getLastSyncTime(tenantId: string) {
  const rows = await query<{ finished_at: string; source: string }>(`
    SELECT source, finished_at::text
    FROM sync_runs
    WHERE tenant_id = $1
      AND status = 'success'
    ORDER BY finished_at DESC
    LIMIT 2
  `, [tenantId])
  return rows
}

export type SourceSyncRun = {
  source: string
  status: string
  records_collected: number
  error_message: string | null
  finished_at: string | null
  started_at: string | null
}

/** Duration (seconds) of the most recent successful sync per source. Used as ETA baseline. */
export async function getLastSyncDurations(tenantId: string): Promise<{ source: string; duration_seconds: number }[]> {
  return query<{ source: string; duration_seconds: number }>(`
    SELECT DISTINCT ON (source)
      source,
      GREATEST(EXTRACT(EPOCH FROM (finished_at - started_at))::int, 1) AS duration_seconds
    FROM sync_runs
    WHERE tenant_id = $1
      AND status = 'success'
      AND finished_at IS NOT NULL
      AND started_at  IS NOT NULL
    ORDER BY source, finished_at DESC
  `, [tenantId])
}

/** Returns the most recent sync_run per source (shopify / facebook) for a tenant.
 *  Timestamps are formatted as ISO 8601 UTC so the browser can parse them unambiguously. */
export async function getCurrentSyncStatus(tenantId: string): Promise<SourceSyncRun[]> {
  return query<SourceSyncRun>(`
    SELECT DISTINCT ON (source)
      source, status, records_collected, error_message,
      to_char(finished_at, 'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS finished_at,
      to_char(started_at,  'YYYY-MM-DD"T"HH24:MI:SS"Z"') AS started_at
    FROM sync_runs
    WHERE tenant_id = $1
    ORDER BY source, started_at DESC
  `, [tenantId])
}

export async function getTenantTimezone(tenantId: string): Promise<string> {
  const rows = await query<{ timezone: string }>(
    `SELECT COALESCE(timezone, 'UTC') AS timezone FROM tenants WHERE id = $1`,
    [tenantId]
  )
  return rows[0]?.timezone ?? 'UTC'
}
