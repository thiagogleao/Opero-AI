/**
 * Which campaigns have room for more budget — the shape the push alerts
 * (lib/alerts.runScaleChecks) and the current ScalePanel read.
 *
 * There is no rule here any more. The verdict is campaignSignal.decideCampaign
 * over the last 7 closed days in the STORE's timezone (it used to be São
 * Paulo's for every store), fed by lib/data/campaigns: phantom purchases
 * dropped, spend of ads missing from fb_ads kept, the margin without Shop
 * Campaigns or fixed costs. This file only maps that decision onto the old
 * verdict names so the callers keep working until they move to
 * getCampaignReport:
 *
 *   escalar → scale    manter → watch    cortar → cut
 *   observar → hold (margin between the cut line and 0) or insufficient
 *   no action (paused, shared account, no costs…) → insufficient
 *
 * Campaigns with no spend in the window are left out (they used to be listed
 * as "$0 em 7 dias" under raw ids).
 */

import { loadStores } from './engine/pnl'
import { safeTz } from './engine/dates'
import { DEFAULT_THRESHOLDS, type CampaignDecision } from './campaignSignal'
import { decisionWindows, getCampaignReport } from './data/campaigns'

export type Verdict = 'scale' | 'watch' | 'hold' | 'cut' | 'insufficient'

export interface ScaleConfig {
  /** Margin (%) over the window that earns more budget: the owner's threshold. */
  minMargin: number
  /** Days in the judged window. */
  windowDays: number
  /** Below these, the window is not worth a verdict. */
  minOrders: number
  minSpend: number
  /** Margin at or below this is burning money. */
  cutMargin: number
}

export const DEFAULT_SCALE_CONFIG: ScaleConfig = {
  minMargin: DEFAULT_THRESHOLDS.minMargin,
  windowDays: DEFAULT_THRESHOLDS.windowDays,
  minOrders: DEFAULT_THRESHOLDS.minOrders,
  minSpend: DEFAULT_THRESHOLDS.minSpend,
  cutMargin: DEFAULT_THRESHOLDS.cutMargin,
}

export interface CampaignDay {
  date: string
  spend: number
  orders: number
  revenue: number
  /** Null when not priced (no spend that day, no margin, shared account). */
  profit: number | null
  /** Null when the campaign did not spend that day — not zero, unknown. */
  margin: number | null
  cpa: number | null
  roas: number | null
}

export interface CampaignSignal {
  campaignId: string
  name: string
  status: string | null
  /** Every date of the 7-day window, in order, empty days included. */
  days: CampaignDay[]
  spend: number
  orders: number
  revenue: number
  /** Null when the campaign is not priced with this store's margin. */
  profit: number | null
  /** Estimated profit ÷ Meta purchase value, % (0 when not priced). */
  margin: number
  cpa: number | null
  roas: number | null
  /** Orders whose first tracked touch was this campaign, same window. */
  journeyOrders: number
  verdict: Verdict
  reasons: string[]
  /** The unified decision this verdict was mapped from. */
  decision: CampaignDecision
}

export function toVerdict(d: CampaignDecision): Verdict {
  switch (d.action) {
    case 'escalar': return 'scale'
    case 'manter': return 'watch'
    case 'cortar': return 'cut'
    case 'observar': return d.basis === 'margem' ? 'hold' : 'insufficient'
    default: return 'insufficient'
  }
}

/**
 * The verdicts for one store over its last `windowDays` closed days, on the
 * store's own calendar. `storeTz` is the store's timezone when the caller
 * already has it (it is read from the store otherwise); it is no longer a
 * reference clock shared by every store.
 */
export async function getCampaignSignals(
  tenantId: string,
  config: ScaleConfig = DEFAULT_SCALE_CONFIG,
  storeTz?: string,
): Promise<CampaignSignal[]> {
  let tz = storeTz ? safeTz(storeTz) : null
  if (!tz) {
    const [store] = await loadStores([tenantId])
    if (!store) return []
    tz = safeTz(store.timezone)
  }
  const { window } = decisionWindows(tz, new Date(), config.windowDays)
  const report = await getCampaignReport({ id: tenantId, timezone: tz }, window, { thresholds: config })

  const out: CampaignSignal[] = []
  for (const c of report.campaigns) {
    if (c.campaignId === null || c.decision.spend <= 0) continue
    const d = c.decision
    out.push({
      campaignId: c.campaignId,
      name: c.name,
      status: c.status,
      days: d.days.map(x => ({
        date: x.date, spend: x.spend, orders: x.purchases, revenue: x.revenue,
        profit: x.estimatedProfit, margin: x.margin,
        cpa: x.spend > 0 && x.purchases > 0 ? x.spend / x.purchases : null,
        roas: x.spend > 0 ? x.revenue / x.spend : null,
      })),
      spend: d.spend, orders: d.purchases, revenue: d.revenue,
      profit: d.estimatedProfit, margin: d.margin ?? 0,
      cpa: d.cpa, roas: d.roas,
      journeyOrders: c.journeyOrders,
      verdict: toVerdict(d),
      reasons: [d.reason, ...d.notes],
      decision: d,
    })
  }
  const rank: Record<Verdict, number> = { cut: 0, scale: 1, watch: 2, hold: 3, insufficient: 4 }
  return out.sort((a, b) => rank[a.verdict] - rank[b.verdict] || b.spend - a.spend)
}
