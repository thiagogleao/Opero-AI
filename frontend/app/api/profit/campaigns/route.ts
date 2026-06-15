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

  // Run the full profit calc to get the real non-FB cost rate
  const summary = await getProfitSummary(tenantId, dateFrom, dateTo)
  const nonFbCostRate = summary.totalRevenue > 0
    ? (summary.totalCosts - summary.fbSpend) / summary.totalRevenue
    : 0

  // Campaign-level FB metrics
  const campaigns = await query<{
    campaign_id: string; campaign_name: string; objective: string | null
    spend: string; fb_revenue: string; purchases: string; roas: string
  }>(`
    SELECT
      c.campaign_id,
      COALESCE(c.name, c.campaign_id) AS campaign_name,
      c.objective,
      ROUND(SUM(m.spend)::numeric, 2)::text          AS spend,
      ROUND(SUM(m.purchase_value)::numeric, 2)::text AS fb_revenue,
      SUM(m.purchases)::text                          AS purchases,
      ROUND(CASE WHEN SUM(m.spend) > 0
        THEN SUM(m.purchase_value) / SUM(m.spend) ELSE 0
        END::numeric, 2)::text                        AS roas
    FROM fb_campaigns c
    JOIN fb_ad_daily_metrics m ON m.campaign_id = c.campaign_id
    WHERE m.tenant_id = $1
      AND m.date BETWEEN $2::date AND $3::date
    GROUP BY c.campaign_id, c.name, c.objective
    HAVING SUM(m.spend) > 0
    ORDER BY SUM(m.spend) DESC
  `, [tenantId, dateFrom, dateTo])

  const result = campaigns.map(c => {
    const spend     = Number(c.spend)
    const fbRevenue = Number(c.fb_revenue)
    // Estimated profit: FB-attributed revenue minus FB spend minus proportional non-FB costs
    const nonFbCost = fbRevenue * nonFbCostRate
    const profit    = fbRevenue - spend - nonFbCost
    const margin    = fbRevenue > 0 ? (profit / fbRevenue) * 100 : 0
    return {
      campaign_id:      c.campaign_id,
      campaign_name:    c.campaign_name,
      objective:        c.objective,
      spend,
      fb_revenue:       fbRevenue,
      purchases:        Number(c.purchases),
      roas:             Number(c.roas),
      estimated_profit: Math.round(profit * 100) / 100,
      margin:           Math.round(margin * 10) / 10,
      configured:       summary.configured,
    }
  }).sort((a, b) => b.estimated_profit - a.estimated_profit)

  return Response.json({
    campaigns: result,
    nonFbCostRate: Math.round(nonFbCostRate * 1000) / 10,
    configured: summary.configured,
  })
}
