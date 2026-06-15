import { NextRequest } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { query } from '@/lib/db'
import { getActiveTenantId } from '@/lib/activeStore'
import { getProfitSummary } from '@/lib/profitCalc'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = await getActiveTenantId(userId)

  const { searchParams } = new URL(req.url)
  const dateFrom = searchParams.get('dateFrom') ?? ''
  const dateTo   = searchParams.get('dateTo')   ?? ''
  if (!dateFrom || !dateTo) return Response.json({ error: 'dateFrom and dateTo required' }, { status: 400 })

  // Full profit summary → non-FB cost rate + actual net profit for normalization
  const summary = await getProfitSummary(tenantId, dateFrom, dateTo)
  const nonFbCostRate = summary.totalRevenue > 0
    ? (summary.totalCosts - summary.fbSpend) / summary.totalRevenue
    : 0

  // Campaign-level FB metrics
  const campaignRows = await query<{
    campaign_id: string; campaign_name: string
    spend: string; fb_revenue: string; purchases: string; roas: string
  }>(`
    SELECT
      a.campaign_id,
      COALESCE(MAX(c.name), MAX(a.campaign_name), a.campaign_id) AS campaign_name,
      ROUND(SUM(m.spend)::numeric, 2)::text          AS spend,
      ROUND(SUM(m.purchase_value)::numeric, 2)::text AS fb_revenue,
      SUM(m.purchases)::text                          AS purchases,
      ROUND(CASE WHEN SUM(m.spend) > 0
        THEN SUM(m.purchase_value) / SUM(m.spend) ELSE 0
        END::numeric, 2)::text                        AS roas
    FROM fb_ad_daily_metrics m
    JOIN fb_ads a ON m.ad_id = a.ad_id
    LEFT JOIN fb_campaigns c ON a.campaign_id = c.campaign_id
    WHERE m.tenant_id = $1
      AND m.date BETWEEN $2::date AND $3::date
      AND a.campaign_id IS NOT NULL
    GROUP BY a.campaign_id
    HAVING SUM(m.spend) > 0
    ORDER BY SUM(m.spend) DESC
  `, [tenantId, dateFrom, dateTo])

  // --- Country-based Shopify attribution ---

  // Campaign spend breakdown by country (from fb_ad_breakdowns)
  const breakdownRows = await query<{
    campaign_id: string; country_code: string; spend: string
  }>(`
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
  `, [tenantId, dateFrom, dateTo])

  // Shopify revenue by country
  const shopifyCountryRows = await query<{
    country_code: string; revenue: string
  }>(`
    SELECT
      COALESCE(o.country_code, 'XX') AS country_code,
      ROUND(SUM(o.total_price::numeric), 2)::text AS revenue
    FROM shopify_orders o
    JOIN tenants t ON t.id = o.tenant_id
    WHERE o.tenant_id = $1
      AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
      AND o.financial_status NOT IN ('refunded', 'voided')
    GROUP BY o.country_code
  `, [tenantId, dateFrom, dateTo])

  const totalFbSpend = summary.fbSpend
  const totalShopifyRevenue = shopifyCountryRows.reduce((s, r) => s + Number(r.revenue), 0)

  // Build lookup maps
  const shopifyByCountry = new Map<string, number>()
  for (const r of shopifyCountryRows) shopifyByCountry.set(r.country_code, Number(r.revenue))

  // Total FB spend per country (across all campaigns)
  const totalSpendByCountry = new Map<string, number>()
  for (const r of breakdownRows) {
    totalSpendByCountry.set(r.country_code, (totalSpendByCountry.get(r.country_code) ?? 0) + Number(r.spend))
  }

  // Per-campaign spend by country
  const campaignCountrySpend = new Map<string, Map<string, number>>()
  for (const r of breakdownRows) {
    if (!campaignCountrySpend.has(r.campaign_id)) campaignCountrySpend.set(r.campaign_id, new Map())
    campaignCountrySpend.get(r.campaign_id)!.set(r.country_code, Number(r.spend))
  }

  const hasBreakdownData = breakdownRows.length > 0

  // Build result with both FB-attributed and Shopify-attributed profit
  const results = campaignRows.map(c => {
    const spend     = Number(c.spend)
    const fbRevenue = Number(c.fb_revenue)

    // FB-attributed profit (existing metric)
    const fbProfit = fbRevenue - spend - fbRevenue * nonFbCostRate
    const fbMargin = fbRevenue > 0 ? (fbProfit / fbRevenue) * 100 : 0

    // Shopify-attributed revenue: distribute Shopify sales by country proportionally
    let attributedRevenue = 0
    const countrySpend = campaignCountrySpend.get(c.campaign_id)

    if (hasBreakdownData && countrySpend && countrySpend.size > 0) {
      for (const [country, cSpend] of countrySpend) {
        const totalInCountry = totalSpendByCountry.get(country) ?? 0
        const shopifyRevenue = shopifyByCountry.get(country) ?? 0
        if (totalInCountry > 0) {
          attributedRevenue += (cSpend / totalInCountry) * shopifyRevenue
        }
      }
    } else {
      // No country breakdown: attribute proportionally by total FB spend share
      attributedRevenue = totalFbSpend > 0
        ? totalShopifyRevenue * (spend / totalFbSpend)
        : 0
    }

    const realProfit = attributedRevenue - spend - attributedRevenue * nonFbCostRate
    const realMargin = attributedRevenue > 0 ? (realProfit / attributedRevenue) * 100 : 0

    return {
      campaign_id:        c.campaign_id,
      campaign_name:      c.campaign_name,
      spend,
      fb_revenue:         fbRevenue,
      purchases:          Number(c.purchases),
      roas:               Number(c.roas),
      fb_profit:          Math.round(fbProfit * 100) / 100,
      fb_margin:          Math.round(fbMargin * 10) / 10,
      attributed_revenue: Math.round(attributedRevenue * 100) / 100,
      real_profit:        Math.round(realProfit * 100) / 100,
      real_margin:        Math.round(realMargin * 10) / 10,
      configured:         summary.configured,
    }
  })

  // Normalize: total real profits must not exceed actual net profit
  if (summary.configured && summary.netProfit !== 0) {
    const totalRealProfit = results.reduce((s, r) => s + r.real_profit, 0)
    if (totalRealProfit > summary.netProfit && totalRealProfit > 0) {
      const scale = summary.netProfit / totalRealProfit
      for (const r of results) {
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
