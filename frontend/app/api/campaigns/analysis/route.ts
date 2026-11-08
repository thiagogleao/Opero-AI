import { NextRequest } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { getActiveTenantId } from '@/lib/activeStore'
import { getCampaignMetrics, getCampaignDaily } from '@/lib/queries'
import { getProfitSummary } from '@/lib/profitCalc'
import {
  campaignSignal, campaignTrend, marginRateFromSummary,
  CAMPAIGN_RANK, TREND_RANK,
} from '@/lib/campaignSignal'

export const dynamic = 'force-dynamic'

/**
 * Per-campaign result for a window: is it making money, how much, and how the
 * days inside the window moved.
 *
 * The revenue here is what Meta attributes to the campaign, because that is the
 * only per-campaign revenue that exists — Shopify orders carry no campaign id in
 * our tables. The response says so in `revenueSource`, and `fbRevenueGap`
 * reports how far Meta's total sits from the store's real revenue so the reader
 * can judge how much to trust the split. When the gap is large, every campaign
 * row is optimistic by roughly the same factor.
 */
export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = await getActiveTenantId(userId)

  const { searchParams } = new URL(req.url)
  const dateFrom = searchParams.get('dateFrom') ?? ''
  const dateTo   = searchParams.get('dateTo')   ?? ''
  if (!dateFrom || !dateTo) {
    return Response.json({ error: 'dateFrom and dateTo required' }, { status: 400 })
  }

  const [summary, totals, daily] = await Promise.all([
    getProfitSummary(tenantId, dateFrom, dateTo),
    getCampaignMetrics(tenantId, dateFrom, dateTo),
    getCampaignDaily(tenantId, dateFrom, dateTo),
  ])

  const marginRate = marginRateFromSummary(summary)

  // Group the daily rows once, then hand each campaign its own slice.
  const byCampaign = new Map<string, typeof daily>()
  for (const r of daily) {
    const list = byCampaign.get(r.campaign_id)
    if (list) list.push(r)
    else byCampaign.set(r.campaign_id, [r])
  }

  const campaigns = totals.map(c => {
    const spend     = Number(c.spend)
    const revenue   = Number(c.revenue)
    const purchases = Number(c.purchases)
    const result    = campaignSignal({ spend, revenue, purchases, marginRate })

    const series = (byCampaign.get(c.campaign_id) ?? []).map(d => {
      const dSpend   = Number(d.spend)
      const dRevenue = Number(d.revenue)
      const r = campaignSignal({
        spend: dSpend, revenue: dRevenue, purchases: Number(d.purchases), marginRate,
      })
      return {
        date:      d.date,
        spend:     Math.round(dSpend * 100) / 100,
        revenue:   Math.round(dRevenue * 100) / 100,
        purchases: Number(d.purchases),
        roas:      Math.round(r.roas * 100) / 100,
        // Only a configured store gets a profit number; otherwise null, so the
        // chart draws nothing instead of a flat line that looks like zero.
        profit:    marginRate > 0 ? Math.round(r.profit * 100) / 100 : null,
      }
    })

    const daysProfitable = series.filter(d => d.profit !== null && d.profit > 0).length

    // Which way it is moving, judged on the same rows the strip draws.
    const trend = campaignTrend(
      series.map(d => ({ date: d.date, spend: d.spend, revenue: d.revenue })),
      dateTo, marginRate
    )

    return {
      trend:        trend.trend,
      recentDays:   trend.recentDays,
      recentSpend:  trend.recentSpend,
      recentRoas:   trend.recentRoas,
      recentProfit: trend.recentProfit,
      baseRoas:     trend.baseRoas,
      lift:         trend.lift,
      accelerating: trend.accelerating,

      campaign_id:   c.campaign_id,
      campaign_name: c.campaign_name,
      objective:     c.objective,
      status:        c.status,
      adset_count:   Number(c.adset_count),
      ad_count:      Number(c.ad_count),

      spend,
      revenue,
      purchases,
      impressions: Number(c.impressions),
      clicks:      Number(c.clicks),
      ctr:         Number(c.ctr),
      cpm:         Number(c.cpm),
      cpc:         Number(c.clicks) > 0 ? Math.round((spend / Number(c.clicks)) * 100) / 100 : null,
      aov:         purchases > 0 ? Math.round((revenue / purchases) * 100) / 100 : null,

      roas:                 Math.round(result.roas * 100) / 100,
      breakEven:            Math.round(result.breakEven * 100) / 100,
      contribution:         Math.round(result.contribution * 100) / 100,
      profit:               Math.round(result.profit * 100) / 100,
      profitPct:            Math.round(result.profitPct * 10) / 10,
      cpa:                  result.cpa !== null ? Math.round(result.cpa * 100) / 100 : null,
      contributionPerOrder: result.contributionPerOrder !== null
        ? Math.round(result.contributionPerOrder * 100) / 100 : null,
      verdict:              result.verdict,

      days:           series.length,
      daysProfitable,
      series,
    }
  })

  // Losing money first; inside each verdict the ones that are moving come
  // first. That puts the case this panel exists for — a campaign still behind
  // on the period total but paying for itself again this week — on the very
  // top row, and a profitable campaign that started cooling above the rest of
  // the winners.
  campaigns.sort((a, b) =>
    CAMPAIGN_RANK[a.verdict] - CAMPAIGN_RANK[b.verdict]
    || TREND_RANK[a.trend] - TREND_RANK[b.trend]
    || b.spend - a.spend
  )

  const totalSpend   = campaigns.reduce((s, c) => s + c.spend, 0)
  const totalRevenue = campaigns.reduce((s, c) => s + c.revenue, 0)
  const totalProfit  = campaigns.reduce((s, c) => s + c.profit, 0)

  return Response.json({
    dateFrom, dateTo,
    configured: marginRate > 0,
    marginRate: Math.round(marginRate * 1000) / 10,
    breakEvenRoas: marginRate > 0 ? Math.round((1 / marginRate) * 100) / 100 : null,
    revenueSource: 'meta',
    campaigns,
    totals: {
      spend:     Math.round(totalSpend * 100) / 100,
      revenue:   Math.round(totalRevenue * 100) / 100,
      profit:    Math.round(totalProfit * 100) / 100,
      profitPct: totalRevenue > 0 ? Math.round((totalProfit / totalRevenue) * 1000) / 10 : 0,
      roas:      totalSpend > 0 ? Math.round((totalRevenue / totalSpend) * 100) / 100 : 0,
      count:     campaigns.length,
      losing:    campaigns.filter(c => c.verdict === 'prejuizo').length,
      scaling:   campaigns.filter(c => c.trend === 'escalar').length,
      cooling:   campaigns.filter(c => c.trend === 'esfriando').length,
    },
    // How far Meta's claim sits from the money the store actually took in.
    // Positive means Meta claims more than the store booked.
    fbRevenueGap: summary.totalRevenue > 0
      ? Math.round(((totalRevenue - summary.totalRevenue) / summary.totalRevenue) * 1000) / 10
      : null,
    storeRevenue: Math.round(summary.totalRevenue * 100) / 100,
  })
}
