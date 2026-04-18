import { query } from './db'

export async function getOverviewMetrics(tenantId: string, dateFrom: string, dateTo: string) {
  const [shopify] = await query<{
    revenue: number; orders: number; aov: number
    new_customers: number; returning_customers: number
    abandoned_value: number; abandoned_count: number
  }>(`
    WITH period_orders AS (
      SELECT id AS order_id, total_price, customer_id
      FROM shopify_orders
      WHERE tenant_id = $1
        AND created_at::date BETWEEN $2::date AND $3::date
        AND financial_status NOT IN ('refunded', 'voided')
    ),
    first_order_dates AS (
      SELECT customer_id, MIN(created_at::date) AS first_date
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
      s.date::text                        AS date,
      ROUND(s.total_revenue::numeric, 2)  AS revenue,
      ROUND(COALESCE(f.spend, 0)::numeric, 2) AS spend
    FROM shopify_daily_metrics s
    LEFT JOIN (
      SELECT date, SUM(spend) AS spend
      FROM fb_ad_daily_metrics
      WHERE tenant_id = $1
      GROUP BY date
    ) f ON s.date = f.date
    WHERE s.tenant_id = $1
      AND s.date BETWEEN $2::date AND $3::date
    ORDER BY s.date
  `, [tenantId, dateFrom, dateTo])
  return rows.map(r => ({ date: r.date, revenue: Number(r.revenue), spend: Number(r.spend) }))
}

export async function getDailyRoas(tenantId: string, dateFrom: string, dateTo: string) {
  const rows = await query<{ date: string; fb_roas: string; blended_roas: string }>(`
    SELECT
      s.date::text AS date,
      ROUND(COALESCE(
        CASE WHEN f.spend > 0 THEN f.purchase_value / f.spend ELSE 0 END,
      0)::numeric, 2) AS fb_roas,
      ROUND(COALESCE(
        CASE WHEN f.spend > 0 THEN s.total_revenue / f.spend ELSE 0 END,
      0)::numeric, 2) AS blended_roas
    FROM shopify_daily_metrics s
    LEFT JOIN (
      SELECT date, SUM(spend) AS spend, SUM(purchase_value) AS purchase_value
      FROM fb_ad_daily_metrics
      WHERE tenant_id = $1
      GROUP BY date
    ) f ON s.date = f.date
    WHERE s.tenant_id = $1
      AND s.date BETWEEN $2::date AND $3::date
    ORDER BY s.date
  `, [tenantId, dateFrom, dateTo])
  return rows.map(r => ({ date: r.date, fb_roas: Number(r.fb_roas), blended_roas: Number(r.blended_roas) }))
}

export async function getTopCreatives(tenantId: string, dateFrom: string, dateTo: string) {
  return query<{
    ad_id: string; name: string; spend: number
    revenue: number; roas: number; ctr: number; frequency: number
    purchases: number; score: number
  }>(`
    SELECT
      a.ad_id,
      COALESCE(a.name, a.ad_id)              AS name,
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
      , 2) AS score
    FROM fb_ad_daily_metrics m
    JOIN fb_ads a ON m.ad_id = a.ad_id
    WHERE m.tenant_id = $1
      AND m.date BETWEEN $2::date AND $3::date
    GROUP BY a.ad_id, a.name
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
  return query<{ date: string; new_customers: number; returning_customers: number }>(`
    WITH first_order_dates AS (
      SELECT customer_id, MIN(created_at::date) AS first_date
      FROM shopify_orders
      WHERE tenant_id = $1
        AND financial_status NOT IN ('refunded', 'voided')
        AND customer_id IS NOT NULL
      GROUP BY customer_id
    )
    SELECT
      o.created_at::date::text                                                  AS date,
      COUNT(*) FILTER (WHERE fo.first_date >= $2::date)                        AS new_customers,
      COUNT(*) FILTER (WHERE fo.first_date < $2::date OR fo.first_date IS NULL) AS returning_customers
    FROM shopify_orders o
    LEFT JOIN first_order_dates fo ON o.customer_id = fo.customer_id
    WHERE o.tenant_id = $1
      AND o.created_at::date BETWEEN $2::date AND $3::date
      AND o.financial_status NOT IN ('refunded', 'voided')
    GROUP BY o.created_at::date
    ORDER BY o.created_at::date
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
      COUNT(*) FILTER (WHERE financial_status NOT IN ('refunded','voided')) AS orders,
      (SELECT COUNT(*) FROM shopify_abandoned_checkouts
       WHERE tenant_id = $1
         AND created_at::date BETWEEN $2::date AND $3::date
         AND total_price <= (
           SELECT GREATEST(COALESCE(AVG(total_price::numeric),100)*30,500)
           FROM shopify_orders WHERE tenant_id = $1 AND financial_status NOT IN ('refunded','voided')
         )
      ) AS abandoned
    FROM shopify_orders
    WHERE tenant_id = $1
      AND created_at::date BETWEEN $2::date AND $3::date
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
      COALESCE(p.title, oi.product_title)            AS title,
      p.image_url,
      COALESCE(SUM(oi.quantity), 0)                  AS units,
      COUNT(DISTINCT o.id)                           AS orders,
      ROUND(SUM(oi.quantity * oi.price)::numeric, 2) AS revenue,
      ROUND(CASE WHEN COUNT(DISTINCT o.id) > 0
        THEN SUM(oi.quantity * oi.price) / COUNT(DISTINCT o.id) ELSE 0
        END::numeric, 2)                             AS aov
    FROM shopify_order_items oi
    JOIN shopify_orders o ON oi.order_id = o.id
    LEFT JOIN shopify_products p ON oi.product_id = p.product_id
    WHERE o.tenant_id = $1
      AND o.created_at::date BETWEEN $2::date AND $3::date
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
