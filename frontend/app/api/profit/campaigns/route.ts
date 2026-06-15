import { NextRequest } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { query } from '@/lib/db'
import { getActiveTenantId } from '@/lib/activeStore'
import { getProfitSummary } from '@/lib/profitCalc'

// Words stripped before matching campaign name → product title
const NOISE_WORDS = new Set([
  'cbo','cpa','asc','adv','advantage','advantage+','usa','eua','br','uk','de','au','ca',
  'mundo','world','global','international','teste','test','inicial','initial','copia','copy',
  'ultimo','tiro','final','novo','new','v2','v3','retargeting','ret','lookalike','lal',
  'cold','warm','hot','broad','interest','remarketing','prospecting','dynamic','catalog',
  'the','de','da','do','e','ou','em','para','com',
])

function extractKeywords(name: string): string[] {
  return name.toLowerCase()
    .replace(/[^a-z0-9\s]/g, ' ')
    .split(/\s+/)
    .filter(w => w.length >= 2 && !NOISE_WORDS.has(w))
}

function matchProductId(
  campaignName: string,
  products: Array<{ product_id: string; title: string }>
): string | null {
  const ckw = extractKeywords(campaignName)
  if (ckw.length === 0) return null

  let bestId: string | null = null
  let bestScore = 0

  for (const p of products) {
    const pkw = extractKeywords(p.title)
    const score = ckw.filter(w => pkw.some(pw => pw.includes(w) || w.includes(pw))).length
    if (score > bestScore) {
      bestScore = score
      bestId = p.product_id
    }
  }

  return bestScore >= 1 ? bestId : null
}

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = await getActiveTenantId(userId)

  const { searchParams } = new URL(req.url)
  const dateFrom = searchParams.get('dateFrom') ?? ''
  const dateTo   = searchParams.get('dateTo')   ?? ''
  if (!dateFrom || !dateTo) return Response.json({ error: 'dateFrom and dateTo required' }, { status: 400 })

  // Full profit summary for non-FB cost rate + net profit cap
  const summary = await getProfitSummary(tenantId, dateFrom, dateTo)
  const nonFbCostRate = summary.totalRevenue > 0
    ? (summary.totalCosts - summary.fbSpend) / summary.totalRevenue
    : 0

  // --- All queries in parallel ---
  const [campaignRows, breakdownRows, productRevenueRows] = await Promise.all([
    // Campaign-level FB metrics
    query<{ campaign_id: string; campaign_name: string; spend: string; fb_revenue: string; purchases: string; roas: string }>(`
      SELECT
        a.campaign_id,
        COALESCE(MAX(c.name), MAX(a.campaign_name), a.campaign_id) AS campaign_name,
        ROUND(SUM(m.spend)::numeric, 2)::text          AS spend,
        ROUND(SUM(m.purchase_value)::numeric, 2)::text AS fb_revenue,
        SUM(m.purchases)::text                          AS purchases,
        ROUND(CASE WHEN SUM(m.spend) > 0
          THEN SUM(m.purchase_value) / SUM(m.spend) ELSE 0
          END::numeric, 2)::text AS roas
      FROM fb_ad_daily_metrics m
      JOIN fb_ads a ON m.ad_id = a.ad_id
      LEFT JOIN fb_campaigns c ON a.campaign_id = c.campaign_id
      WHERE m.tenant_id = $1
        AND m.date BETWEEN $2::date AND $3::date
        AND a.campaign_id IS NOT NULL
      GROUP BY a.campaign_id
      HAVING SUM(m.spend) > 0
      ORDER BY SUM(m.spend) DESC
    `, [tenantId, dateFrom, dateTo]),

    // Campaign spend by country from breakdowns
    query<{ campaign_id: string; country_code: string; spend: string }>(`
      SELECT
        a.campaign_id,
        b.breakdown_value AS country_code,
        SUM(b.spend)::text AS spend
      FROM fb_ad_breakdowns b
      JOIN fb_ads a ON b.ad_id = a.ad_id
      WHERE b.tenant_id = $1
        AND b.date BETWEEN $2::date AND $3::date
        AND b.breakdown_type = 'country'
        AND a.campaign_id IS NOT NULL
      GROUP BY a.campaign_id, b.breakdown_value
    `, [tenantId, dateFrom, dateTo]),

    // Shopify revenue by product × country (actual sales)
    query<{ product_id: string; title: string; country_code: string; revenue: string }>(`
      SELECT
        COALESCE(oi.product_id, 'unknown')                            AS product_id,
        COALESCE(p.title, oi.product_title, oi.title, 'Desconhecido') AS title,
        COALESCE(o.country_code, 'XX')                                AS country_code,
        ROUND(SUM(oi.quantity * oi.price)::numeric, 2)::text          AS revenue
      FROM shopify_order_items oi
      JOIN shopify_orders o ON oi.order_id = o.order_id
      JOIN tenants t ON t.id = o.tenant_id
      LEFT JOIN shopify_products p ON oi.product_id = p.product_id
      WHERE o.tenant_id = $1
        AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
        AND o.financial_status NOT IN ('refunded', 'voided')
      GROUP BY oi.product_id, p.title, oi.product_title, oi.title, o.country_code
    `, [tenantId, dateFrom, dateTo]),
  ])

  const hasBreakdownData = breakdownRows.length > 0

  // Build product list (deduplicated by product_id, keeping all titles)
  const productMap = new Map<string, string>() // product_id → title
  for (const r of productRevenueRows) {
    if (!productMap.has(r.product_id)) productMap.set(r.product_id, r.title)
  }
  const productList = Array.from(productMap.entries()).map(([product_id, title]) => ({ product_id, title }))

  // Shopify revenue: product_id → country_code → revenue
  const shopifyRevByProductCountry = new Map<string, Map<string, number>>()
  for (const r of productRevenueRows) {
    if (!shopifyRevByProductCountry.has(r.product_id))
      shopifyRevByProductCountry.set(r.product_id, new Map())
    shopifyRevByProductCountry.get(r.product_id)!.set(r.country_code, Number(r.revenue))
  }

  // Campaign country spend: campaign_id → country_code → spend
  const campaignCountrySpend = new Map<string, Map<string, number>>()
  const totalSpendByCountry = new Map<string, number>()
  for (const r of breakdownRows) {
    if (!campaignCountrySpend.has(r.campaign_id))
      campaignCountrySpend.set(r.campaign_id, new Map())
    campaignCountrySpend.get(r.campaign_id)!.set(r.country_code, Number(r.spend))
    totalSpendByCountry.set(r.country_code, (totalSpendByCountry.get(r.country_code) ?? 0) + Number(r.spend))
  }

  const totalFbSpend = summary.fbSpend

  // 1. Match each campaign to a product
  const campaignToProduct = new Map<string, string | null>()
  for (const c of campaignRows) {
    campaignToProduct.set(c.campaign_id, matchProductId(c.campaign_name, productList))
  }

  // 2. For each (product_id, country_code): total spend from campaigns matching that product in that country
  //    Used to split revenue when multiple campaigns target the same product+country
  const productCountryTotalSpend = new Map<string, number>() // key: `${product_id}::${country_code}`
  for (const c of campaignRows) {
    const pid = campaignToProduct.get(c.campaign_id)
    if (!pid) continue
    const countries = campaignCountrySpend.get(c.campaign_id)
    if (!countries) continue
    for (const [country, spend] of countries) {
      const key = `${pid}::${country}`
      productCountryTotalSpend.set(key, (productCountryTotalSpend.get(key) ?? 0) + spend)
    }
  }

  // 3. Attribute revenue to each campaign
  const results = campaignRows.map(c => {
    const spend     = Number(c.spend)
    const fbRevenue = Number(c.fb_revenue)
    const fbProfit  = fbRevenue - spend - fbRevenue * nonFbCostRate
    const fbMargin  = fbRevenue > 0 ? (fbProfit / fbRevenue) * 100 : 0

    const pid = campaignToProduct.get(c.campaign_id)
    const countrySpend = campaignCountrySpend.get(c.campaign_id)

    let attributedRevenue = 0
    let matchedProduct = pid ? (productMap.get(pid) ?? null) : null

    if (pid && hasBreakdownData && countrySpend && countrySpend.size > 0) {
      // Best case: we know which product AND which countries
      const productCountryRevMap = shopifyRevByProductCountry.get(pid)
      if (productCountryRevMap) {
        for (const [country, cSpend] of countrySpend) {
          const shopifyRev = productCountryRevMap.get(country) ?? 0
          const totalSpendForKey = productCountryTotalSpend.get(`${pid}::${country}`) ?? cSpend
          const share = totalSpendForKey > 0 ? cSpend / totalSpendForKey : 1
          attributedRevenue += share * shopifyRev
        }
      }
    } else if (pid && !hasBreakdownData) {
      // Know product but not countries: split total product revenue by spend share
      const productCountryRevMap = shopifyRevByProductCountry.get(pid)
      const totalProductRev = productCountryRevMap
        ? Array.from(productCountryRevMap.values()).reduce((s, v) => s + v, 0)
        : 0
      // Total spend for campaigns matching this product
      const totalSpendForProduct = campaignRows
        .filter(r => campaignToProduct.get(r.campaign_id) === pid)
        .reduce((s, r) => s + Number(r.spend), 0)
      attributedRevenue = totalSpendForProduct > 0
        ? totalProductRev * (spend / totalSpendForProduct)
        : 0
    } else {
      // No product match → excluded from real profit calculation entirely
      matchedProduct = null
      attributedRevenue = 0
    }

    const realProfit = attributedRevenue - spend - attributedRevenue * nonFbCostRate
    const realMargin = attributedRevenue > 0 ? (realProfit / attributedRevenue) * 100 : 0

    // Reliability check: if attributed revenue is much lower than what FB/spend suggests,
    // the product+country match likely missed most sales → exclude from real profit
    const reference = Math.max(spend, fbRevenue)
    const MIN_RATIO = 0.15  // attributed must be >= 15% of reference to be trustworthy
    const attribution_reliable = matchedProduct !== null && (
      reference === 0 || attributedRevenue >= reference * MIN_RATIO
    )

    return {
      campaign_id:          c.campaign_id,
      campaign_name:        c.campaign_name,
      matched_product:      attribution_reliable ? matchedProduct : null,
      spend,
      fb_revenue:           fbRevenue,
      purchases:            Number(c.purchases),
      roas:                 Number(c.roas),
      fb_profit:            Math.round(fbProfit * 100) / 100,
      fb_margin:            Math.round(fbMargin * 10) / 10,
      attributed_revenue:   attribution_reliable ? Math.round(attributedRevenue * 100) / 100 : 0,
      real_profit:          attribution_reliable ? Math.round(realProfit * 100) / 100 : 0,
      real_margin:          attribution_reliable ? Math.round(realMargin * 10) / 10 : 0,
      configured:           summary.configured,
      attribution_reliable,
    }
  })

  // Normalize: sum of reliable real profits must not exceed actual total net profit
  if (summary.configured && summary.netProfit !== 0) {
    const totalRealProfit = results.reduce((s, r) => s + r.real_profit, 0)
    if (totalRealProfit > summary.netProfit && totalRealProfit > 0) {
      const scale = summary.netProfit / totalRealProfit
      for (const r of results) {
        if (!r.attribution_reliable) continue
        r.real_profit = Math.round(r.real_profit * scale * 100) / 100
        r.real_margin = r.attributed_revenue > 0
          ? Math.round((r.real_profit / r.attributed_revenue) * 1000) / 10
          : 0
      }
    }
  }

  results.sort((a, b) => b.real_profit - a.real_profit)

  return Response.json({
    campaigns: results,
    nonFbCostRate: Math.round(nonFbCostRate * 1000) / 10,
    configured: summary.configured,
    hasBreakdownData,
    totalNetProfit: summary.netProfit,
  })
}
