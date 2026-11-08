/**
 * The verdict on a whole campaign.
 *
 * The sibling of creativeSignal.ts, and it exists for the same reason: the web
 * dashboard and the phone must not disagree about whether a campaign is making
 * money. The thresholds live here and nowhere else.
 *
 * The difference from an ad verdict is what the number means. An ad is judged
 * on ROAS against break-even because ads compete with each other for the same
 * budget. A campaign is judged on money: what it brought in, minus what the
 * store pays to deliver it, minus what it cost to buy the traffic. That answer
 * is a dollar amount and a percentage, not a ranking.
 */

export type CampaignVerdict = 'lucro' | 'empate' | 'prejuizo' | 'pouco_dado'

export interface CampaignInput {
  spend: number
  /** Revenue Meta attributes to this campaign in the window. */
  revenue: number
  purchases: number
  /**
   * Share of revenue left after every cost except ad spend — COGS, shipping,
   * fees, packaging and prorated extras. Between 0 and 1. Zero means the store
   * has not configured its costs, and then no profit claim is made at all.
   */
  marginRate: number
}

export interface CampaignResult {
  roas: number
  /** ROAS the campaign has to clear just to pay for itself. */
  breakEven: number
  /** Revenue minus everything except ad spend. */
  contribution: number
  /** What is left after ad spend — the number that decides it. */
  profit: number
  /** Profit as a share of the campaign's revenue. */
  profitPct: number
  /** Ad cost per purchase. */
  cpa: number | null
  /** Contribution per purchase, to compare against the CPA. */
  contributionPerOrder: number | null
  verdict: CampaignVerdict
}

/**
 * Below this, a day or two of noise swings the verdict, so it stays silent
 * rather than calling a campaign dead on $8 of spend.
 */
const MIN_SPEND = 15
/**
 * Inside this band around zero the campaign is neither winning nor losing in
 * any way worth acting on — 5% of spend is smaller than the swing a single
 * refund or a late-attributed order causes.
 */
const FLAT_BAND = 0.05

export function campaignSignal(c: CampaignInput): CampaignResult {
  const spend    = Math.max(0, Number(c.spend) || 0)
  const revenue  = Math.max(0, Number(c.revenue) || 0)
  const orders   = Math.max(0, Number(c.purchases) || 0)
  const rate     = Number(c.marginRate) || 0
  const rateOk   = rate > 0 && rate <= 1

  const roas         = spend > 0 ? revenue / spend : 0
  const breakEven    = rateOk ? 1 / rate : 0
  const contribution = rateOk ? revenue * rate : 0
  const profit       = rateOk ? contribution - spend : 0
  const profitPct    = rateOk && revenue > 0 ? (profit / revenue) * 100 : 0

  let verdict: CampaignVerdict
  if (!rateOk || spend < MIN_SPEND || (orders === 0 && spend < MIN_SPEND * 2)) {
    verdict = 'pouco_dado'
  } else {
    const band = spend * FLAT_BAND
    verdict = profit > band ? 'lucro' : profit < -band ? 'prejuizo' : 'empate'
  }

  return {
    roas,
    breakEven,
    contribution,
    profit,
    profitPct,
    cpa: orders > 0 ? spend / orders : null,
    contributionPerOrder: rateOk && orders > 0 ? contribution / orders : null,
    verdict,
  }
}

/**
 * Lead with what is losing money, then with what is turning around: both are
 * rows that cost something while nobody looks at them — one in spend, the
 * other in the budget it is not getting.
 */
export const CAMPAIGN_RANK: Record<CampaignVerdict, number> = {
  prejuizo: 0, empate: 1, lucro: 2, pouco_dado: 3,
}

// ─── Trend ────────────────────────────────────────────────────────────────────

/**
 * Which way a campaign is moving inside the window.
 *
 * A 30-day average buries a turn. A campaign that burned money for three weeks
 * and has been above break-even for the last five days reads "prejuízo" on the
 * period total, and that is the right answer about the past and the wrong one
 * about tomorrow's budget. The tag answers the second question.
 */
export type CampaignTrend = 'escalar' | 'esfriando' | 'estavel' | 'curto'

export interface TrendDay {
  date: string
  spend: number
  revenue: number
}

export interface TrendResult {
  trend: CampaignTrend
  /** Days with spend in the recent window. */
  recentDays: number
  recentSpend: number
  recentRoas: number
  recentProfit: number
  /** Everything before the recent window, the yardstick it is measured against. */
  baseRoas: number
  baseProfit: number
  /** How much better the recent ROAS is than the baseline, in percent. */
  lift: number | null
  /** Recent ROAS above break-even, and the shorter window above the longer one. */
  accelerating: boolean
}

/** Short window: what the campaign is doing now. */
const RECENT_DAYS = 7
/** Shorter still, to tell "recovering" from "already recovered and flattening". */
const EDGE_DAYS = 2
/** Below this in the recent window the trend is one good day, not a turn. */
const TREND_MIN_SPEND = 30
/** A recent ROAS this much above the baseline counts as a real improvement. */
const LIFT_THRESHOLD = 15

function dayOffset(dateTo: string, days: number): string {
  const d = new Date(`${dateTo}T00:00:00Z`)
  d.setUTCDate(d.getUTCDate() - days)
  return d.toISOString().slice(0, 10)
}

function windowTotals(days: TrendDay[], marginRate: number) {
  const spend   = days.reduce((s, d) => s + d.spend, 0)
  const revenue = days.reduce((s, d) => s + d.revenue, 0)
  return {
    spend, revenue,
    roas:   spend > 0 ? revenue / spend : 0,
    profit: marginRate > 0 ? revenue * marginRate - spend : 0,
  }
}

/**
 * Slices by date, not by position in the array: a campaign that spent on day 1
 * and then again on day 30 must not have those two rows read as "the last two
 * days", which is what taking the last two entries would do.
 */
export function campaignTrend(
  series: TrendDay[], dateTo: string, marginRate: number
): TrendResult {
  const breakEven = marginRate > 0 ? 1 / marginRate : 0
  const recentCut = dayOffset(dateTo, RECENT_DAYS - 1)
  const edgeCut   = dayOffset(dateTo, EDGE_DAYS - 1)

  const recent = series.filter(d => d.date >= recentCut)
  const base   = series.filter(d => d.date <  recentCut)
  const edge   = series.filter(d => d.date >= edgeCut)

  const r = windowTotals(recent, marginRate)
  const b = windowTotals(base, marginRate)
  const e = windowTotals(edge, marginRate)

  const lift = b.roas > 0 ? ((r.roas - b.roas) / b.roas) * 100 : null
  // The ladder the user actually watches: the last couple of days ahead of the
  // last week, and the last week ahead of everything before it.
  const accelerating = marginRate > 0
    && r.roas >= breakEven
    && e.roas >= r.roas
    && (b.spend === 0 || r.roas > b.roas)

  let trend: CampaignTrend = 'estavel'
  if (marginRate <= 0 || r.spend < TREND_MIN_SPEND || recent.length < 2) {
    trend = 'curto'
  } else if (
    // Pulling its weight now, and better than it was — the case worth a tag
    // even when the period total still says the campaign is behind.
    r.profit > 0 && (accelerating || (lift !== null && lift >= LIFT_THRESHOLD) || b.spend === 0)
  ) {
    trend = 'escalar'
  } else if (
    // It used to pay for itself and no longer does: the mirror image, and the
    // one that quietly keeps spending because the period average still looks
    // fine.
    r.profit < 0 && b.spend > 0 && b.profit > 0
  ) {
    trend = 'esfriando'
  }

  return {
    trend,
    recentDays:   recent.length,
    recentSpend:  Math.round(r.spend * 100) / 100,
    recentRoas:   Math.round(r.roas * 100) / 100,
    recentProfit: Math.round(r.profit * 100) / 100,
    baseRoas:     Math.round(b.roas * 100) / 100,
    baseProfit:   Math.round(b.profit * 100) / 100,
    lift:         lift !== null ? Math.round(lift * 10) / 10 : null,
    accelerating,
  }
}

export const TREND_LABEL: Record<CampaignTrend, string> = {
  escalar:   'Escalar',
  esfriando: 'Esfriando',
  estavel:   'Estável',
  curto:     '',
}

export const TREND_COLOR: Record<CampaignTrend, string> = {
  escalar:   '#10B981',
  esfriando: '#F59E0B',
  estavel:   '#64748B',
  curto:     '#64748B',
}

/**
 * A campaign turning around deserves attention next to one that is bleeding:
 * both are decisions. Ties inside a verdict break toward the one that is
 * moving.
 */
export const TREND_RANK: Record<CampaignTrend, number> = {
  escalar: 0, esfriando: 1, estavel: 2, curto: 3,
}

export const VERDICT_LABEL: Record<CampaignVerdict, string> = {
  lucro:      'Lucro',
  empate:     'No fio',
  prejuizo:   'Prejuízo',
  pouco_dado: 'Pouco dado',
}

export const VERDICT_COLOR: Record<CampaignVerdict, string> = {
  lucro:      '#10B981',
  empate:     '#F59E0B',
  prejuizo:   '#F43F5E',
  pouco_dado: '#64748B',
}

/**
 * The store's contribution margin rate, from a profit summary.
 *
 * `totalCosts` already includes ad spend, so ad spend comes back out: a
 * campaign is charged its own spend, never the whole account's. Returns 0 when
 * costs are not configured, which makes every verdict read "pouco_dado"
 * instead of inventing a margin.
 */
export function marginRateFromSummary(s: {
  configured: boolean; totalRevenue: number; totalCosts: number; fbSpend: number
}): number {
  if (!s.configured || s.totalRevenue <= 0) return 0
  const nonAdCosts = s.totalCosts - s.fbSpend
  const rate = (s.totalRevenue - nonAdCosts) / s.totalRevenue
  return rate > 0 && rate <= 1 ? rate : 0
}
