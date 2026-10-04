import { query } from './db'
import { getProfitSummary } from './profitCalc'
import { REFERENCE_TZ, todayInTz, shiftDate } from './mobileRange'

/**
 * Which campaigns have room for more budget.
 *
 * Campaign level, not creative level: in this account's structure a creative
 * cannot be funded on its own, so a verdict about an ad would be advice nobody
 * can act on.
 *
 * Revenue comes from what Meta attributes to the campaign, and costs come from
 * the store's own cost engine. That pairing is deliberate and was arrived at by
 * measuring: crediting revenue through our own journey data covers only 57-65%
 * of a store's sales while the campaign still carries 100% of its spend, so
 * every campaign read between -9% and -74% and no campaign could ever clear a
 * 20% bar. Meta's own attribution covers 85-88%, which puts revenue and spend
 * on the same footing. The journey figures travel alongside as the honest
 * cross-check, because Meta over-credits individual ads badly — that comparison
 * is what the attribution screen is for.
 *
 * Three further rules, each one a wrong number in the prototype first:
 *
 *   - The current day never counts. Both spend and attributed revenue for a day
 *     still running are incomplete, and reading them is a collapse in margin
 *     that is only the clock.
 *   - A day with no recorded spend is not a day of infinite margin, it is a day
 *     with no data. Campaigns on the disabled ad accounts showed a steady 79%
 *     that way — exactly the ones nobody should be told to scale.
 *   - Too few orders is noise. A single sale on a quiet day swings margin by
 *     tens of points, and a verdict from that is a coin toss with a number
 *     attached.
 */

export type Verdict = 'scale' | 'watch' | 'hold' | 'cut' | 'insufficient'

export interface ScaleConfig {
  /** Sustained margin over the window that earns more budget. */
  minMargin: number
  /** Days in the sustained-margin window. */
  windowDays: number
  /** A shorter run at a higher margin also earns it — the campaign that just took off. */
  streakDays: number
  streakMargin: number
  /** Below these, the window is not worth a verdict. */
  minOrders: number
  minSpend: number
  /** Sustained margin below this is burning money. */
  cutMargin: number
}

export const DEFAULT_SCALE_CONFIG: ScaleConfig = {
  minMargin: 20,
  windowDays: 7,
  streakDays: 3,
  streakMargin: 35,
  minOrders: 10,
  minSpend: 150,
  cutMargin: -10,
}

export interface CampaignDay {
  date: string
  spend: number
  orders: number
  revenue: number
  profit: number
  /** Null when the campaign did not spend that day — not zero, unknown. */
  margin: number | null
  cpa: number | null
  roas: number | null
  /** The same day measured through our own journey data, for comparison. */
  journeyOrders: number
  journeyRevenue: number
}

export interface CampaignSignal {
  campaignId: string
  name: string
  status: string | null
  days: CampaignDay[]
  /** Totals over the window, counting only days with recorded spend. */
  spend: number
  orders: number
  revenue: number
  profit: number
  margin: number
  cpa: number | null
  roas: number | null
  /** Consecutive most-recent days at or above the streak margin. */
  /** Totals from our own journey data over the same window. */
  journeyOrders: number
  journeyRevenue: number
  streak: number
  /** Last 3 days against the 4 before them. Negative means improving for CPA. */
  cpaTrend: number | null
  roasTrend: number | null
  verdict: Verdict
  reasons: string[]
}

/** Days with spend are the only ones that can carry a verdict. */
const judgeable = (d: CampaignDay) => d.spend > 0

function mean(values: number[]): number | null {
  const real = values.filter(v => Number.isFinite(v))
  return real.length ? real.reduce((a, b) => a + b, 0) / real.length : null
}

/** Percentage change from `before` to `after`; null when there is no baseline. */
function trend(after: number | null, before: number | null): number | null {
  if (after === null || before === null || before === 0) return null
  return ((after - before) / Math.abs(before)) * 100
}

export async function getCampaignSignals(
  tenantId: string,
  config: ScaleConfig = DEFAULT_SCALE_CONFIG,
  tz: string = REFERENCE_TZ,
): Promise<CampaignSignal[]> {
  // Today is excluded. Revenue is credited to the day of the click, and the
  // clicks of a day still running have not finished converting — judging them
  // reads as a collapse in margin that is only the clock.
  const to = shiftDate(todayInTz(tz), -1)
  // Two windows of history: enough to see a trend behind the judging window.
  const from = shiftDate(to, -(config.windowDays * 2))

  const summary = await getProfitSummary(tenantId, from, to)
  if (!summary.configured || summary.totalRevenue <= 0) return []
  // Everything except ad spend, as a share of revenue. The same shape the
  // daily profit chart uses, so a campaign's margin and the store's agree.
  const nonAdRatio = (summary.totalCosts - summary.fbSpend) / summary.totalRevenue

  const rows = await query<{
    campaign_id: string; name: string | null; status: string | null; date: string
    spend: string; orders: string; revenue: string
    journey_orders: string; journey_revenue: string
  }>(`
    WITH spend AS (
      SELECT a.campaign_id, m.date::text AS date,
             SUM(m.spend)          AS spend,
             SUM(m.purchases)      AS orders,
             SUM(m.purchase_value) AS revenue
      FROM fb_ad_daily_metrics m
      JOIN fb_ads a ON a.ad_id = m.ad_id
      WHERE m.tenant_id = $1 AND m.date BETWEEN $2::date AND $3::date
        AND a.campaign_id IS NOT NULL
      GROUP BY 1, 2
    ),
    credited AS (
      SELECT p.campaign_id,
             (p.occurred_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date::text AS date,
             count(DISTINCT o.order_id) AS orders,
             SUM(o.total_price::numeric)  AS revenue
      FROM order_touchpoints p
      JOIN shopify_orders o ON o.order_id = p.order_id AND o.tenant_id = p.tenant_id
      JOIN tenants t ON t.id = o.tenant_id
      WHERE p.tenant_id = $1
        AND p.campaign_id IS NOT NULL
        AND p.seq = 1
        AND (p.occurred_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
        AND o.financial_status NOT IN ('refunded', 'voided')
      GROUP BY 1, 2
    )
    SELECT COALESCE(s.campaign_id, c.campaign_id)  AS campaign_id,
           fc.name, fc.status,
           COALESCE(s.date, c.date)                AS date,
           ROUND(COALESCE(s.spend, 0)::numeric, 2)::text   AS spend,
           COALESCE(s.orders, 0)::text                     AS orders,
           ROUND(COALESCE(s.revenue, 0)::numeric, 2)::text AS revenue,
           COALESCE(c.orders, 0)::text                     AS journey_orders,
           ROUND(COALESCE(c.revenue, 0)::numeric, 2)::text AS journey_revenue
    FROM spend s
    FULL OUTER JOIN credited c ON c.campaign_id = s.campaign_id AND c.date = s.date
    LEFT JOIN fb_campaigns fc ON fc.campaign_id = COALESCE(s.campaign_id, c.campaign_id)
    ORDER BY 1, 4
  `, [tenantId, from, to])

  const byCampaign = new Map<string, { name: string; status: string | null; days: CampaignDay[] }>()
  for (const r of rows) {
    const spend = Number(r.spend)
    const orders = Number(r.orders)
    const revenue = Number(r.revenue)
    const profit = revenue * (1 - nonAdRatio) - spend

    const day: CampaignDay = {
      date: r.date,
      spend, orders, revenue, profit,
      journeyOrders: Number(r.journey_orders),
      journeyRevenue: Number(r.journey_revenue),
      margin: spend > 0 && revenue > 0 ? (profit / revenue) * 100 : spend > 0 ? -100 : null,
      cpa:    spend > 0 && orders > 0 ? spend / orders : null,
      roas:   spend > 0 ? revenue / spend : null,
    }

    const entry = byCampaign.get(r.campaign_id)
      ?? { name: r.name ?? r.campaign_id, status: r.status, days: [] }
    entry.days.push(day)
    byCampaign.set(r.campaign_id, entry)
  }

  const signals: CampaignSignal[] = []

  for (const [campaignId, c] of byCampaign) {
    const days = c.days.sort((a, b) => a.date.localeCompare(b.date))

    // Calendar days, not rows. Taking the last N entries instead meant a
    // campaign that stopped running two weeks ago had its old days read as the
    // current week — which is how campaigns on a restricted account were being
    // recommended for more budget.
    const windowStart = shiftDate(to, -(config.windowDays - 1))
    const priorStart  = shiftDate(to, -(config.windowDays * 2 - 1))
    const priorEnd    = shiftDate(windowStart, -1)

    const window   = days.filter(d => d.date >= windowStart && judgeable(d))
    const previous = days.filter(d => d.date >= priorStart && d.date <= priorEnd && judgeable(d))

    const spend   = window.reduce((a, d) => a + d.spend, 0)
    const orders  = window.reduce((a, d) => a + d.orders, 0)
    const revenue = window.reduce((a, d) => a + d.revenue, 0)
    const profit  = revenue * (1 - nonAdRatio) - spend
    const margin  = revenue > 0 ? (profit / revenue) * 100 : spend > 0 ? -100 : 0

    // Consecutive calendar days back from the last complete one. A missing day
    // ends the run: a campaign that did not spend yesterday is not on a streak.
    const byDate = new Map(days.map(d => [d.date, d]))
    let streak = 0
    for (let i = 0; i < config.windowDays * 2; i++) {
      const d = byDate.get(shiftDate(to, -i))
      if (!d || !judgeable(d) || d.margin === null || d.margin < config.streakMargin) break
      streak++
    }

    const recent3 = window.slice(-3)
    const prior4  = window.slice(-7, -3)
    const cpaTrend  = trend(mean(recent3.map(d => d.cpa ?? NaN)),  mean(prior4.map(d => d.cpa ?? NaN)))
    const roasTrend = trend(mean(recent3.map(d => d.roas ?? NaN)), mean(prior4.map(d => d.roas ?? NaN)))

    const reasons: string[] = []
    let verdict: Verdict

    if (orders < config.minOrders || spend < config.minSpend) {
      verdict = 'insufficient'
      reasons.push(
        `Volume baixo demais para julgar: ${orders} pedido${orders === 1 ? '' : 's'} e ` +
        `$${spend.toFixed(0)} em ${config.windowDays} dias (mínimo ${config.minOrders} e $${config.minSpend})`
      )
    } else if (margin >= config.minMargin) {
      verdict = 'scale'
      reasons.push(`Margem de ${margin.toFixed(0)}% sustentada em ${config.windowDays} dias, acima dos ${config.minMargin}% que você pede`)
    } else if (streak >= config.streakDays) {
      verdict = 'scale'
      reasons.push(`${streak} dias seguidos acima de ${config.streakMargin}% de margem — despontou agora`)
    } else if (margin <= config.cutMargin) {
      verdict = 'cut'
      reasons.push(`Margem de ${margin.toFixed(0)}% em ${config.windowDays} dias — está queimando dinheiro`)
    } else if (margin > 0) {
      verdict = 'watch'
      reasons.push(`Margem de ${margin.toFixed(0)}%, abaixo dos ${config.minMargin}% para escalar`)
    } else {
      verdict = 'hold'
      reasons.push(`Margem de ${margin.toFixed(0)}% — no limite, sem folga para mais orçamento`)
    }

    // Supporting evidence, stated only when it is real.
    if (verdict !== 'insufficient') {
      if (cpaTrend !== null && cpaTrend <= -10) reasons.push(`CPA caindo ${Math.abs(cpaTrend).toFixed(0)}% nos últimos 3 dias`)
      if (cpaTrend !== null && cpaTrend >= 15)  reasons.push(`CPA subindo ${cpaTrend.toFixed(0)}% nos últimos 3 dias`)
      if (roasTrend !== null && roasTrend >= 10) reasons.push(`ROAS subindo ${roasTrend.toFixed(0)}% nos últimos 3 dias`)
      if (roasTrend !== null && roasTrend <= -15) reasons.push(`ROAS caindo ${Math.abs(roasTrend).toFixed(0)}% nos últimos 3 dias`)
      if (streak >= config.streakDays && verdict === 'scale' && margin >= config.minMargin) {
        reasons.push(`e ${streak} dias seguidos acima de ${config.streakMargin}%`)
      }
      if (previous.length > 0) {
        const prevRevenue = previous.reduce((a, d) => a + d.revenue, 0)
        const prevSpend   = previous.reduce((a, d) => a + d.spend, 0)
        const prevMargin  = prevRevenue > 0 ? ((prevRevenue * (1 - nonAdRatio) - prevSpend) / prevRevenue) * 100 : null
        if (prevMargin !== null && margin - prevMargin >= 10) {
          reasons.push(`Margem melhorou ${(margin - prevMargin).toFixed(0)} pontos contra os ${config.windowDays} dias anteriores`)
        }
      }
    }

    signals.push({
      campaignId, name: c.name, status: c.status, days,
      spend, orders, revenue, profit, margin,
      journeyOrders: window.reduce((a, d) => a + d.journeyOrders, 0),
      journeyRevenue: window.reduce((a, d) => a + d.journeyRevenue, 0),
      cpa: orders > 0 ? spend / orders : null,
      roas: spend > 0 ? revenue / spend : null,
      streak, cpaTrend, roasTrend, verdict, reasons,
    })
  }

  const rank: Record<Verdict, number> = { scale: 0, cut: 1, watch: 2, hold: 3, insufficient: 4 }
  return signals.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.spend - a.spend)
}
