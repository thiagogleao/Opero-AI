import { comparisonRange, computeStorePnL, formatRange, todayInTz, type DateRange } from '@/lib/engine'
import type { PnL } from '@/lib/engine/pnl'
import { totalsView } from '../views'
import { insightsWindow, type InsightsWindow } from '../window'
import { nothingToRead } from './facts'

/**
 * Whether the AI reading of a window would be refused for having nothing in
 * it (facts nothingToRead: neither the window nor the one before it has an
 * order, a sale, ad spend, a refund or a chargeback) — asked up front, so the
 * Resumo can say so instead of offering a "Gerar leitura" that can only come
 * back as no_data (Glooty, 20–23 nov: its last spend was on 15 nov; Squishy
 * World after its archive day). generateInsights keeps its own check for any
 * other caller.
 *
 * The same windows the server reads: insightsWindow (closed days only, at
 * most INSIGHTS_MAX_DAYS) and comparisonRange('custom') before it, as
 * buildInsightsFacts builds them, and the same activity test.
 */

const CENT = 0.005

/** One day (or any totals) as facts hasActivity reads it. */
type Activity = Pick<PnL, 'orders' | 'revenue' | 'metaSpend' | 'shopSpend' | 'refundCount' | 'chargebackCount'>

export function dayActive(d: Activity): boolean {
  return d.orders > 0 || d.revenue > CENT || d.metaSpend > CENT || d.shopSpend > CENT
    || d.refundCount > 0 || d.chargebackCount > 0
}

/** A day of `days` inside `range` has activity: the reading is not empty, and
 *  no engine pass is needed to know it (the page already priced those days). */
export function activeDayIn(days: readonly (Activity & { date: string })[], range: DateRange): boolean {
  return days.some(d => d.date >= range.from && d.date <= range.to && dayActive(d))
}

export interface QuietWindow {
  window: InsightsWindow
  /** The window before it, with its dates as the page prints them ("16–19 nov"). */
  previous: DateRange & { label: string }
}

/**
 * The AI window and the one before it when both are empty, else null — also
 * null when the window has no closed day (the card says that itself) or the
 * store is unknown. `daily`: the page's own days for the window it shows
 * (StoreSummary pnl.daily); a single active day among them settles it with
 * no query. Only a quiet window pays for the two engine passes.
 */
export async function quietInsightsWindow(
  store: { id: string; timezone: string },
  range: DateRange,
  daily: readonly (Activity & { date: string })[],
  now: Date = new Date(),
): Promise<QuietWindow | null> {
  const w = insightsWindow(store.timezone, 'custom', range.from, range.to, now)
  if (!w.ok) return null
  if (activeDayIn(daily, w.window)) return null
  const prevRange = comparisonRange('custom', w.window, store.timezone, now)
  const [cur, prev] = await Promise.all([
    computeStorePnL(store.id, w.window, {}, now),
    computeStorePnL(store.id, prevRange, {}, now),
  ])
  if (!cur) return null
  const empty = nothingToRead({
    totals: totalsView(cur.totals, cur.configured),
    previousTotals: prev ? totalsView(prev.totals, prev.configured) : null,
  })
  const previous = { from: prevRange.from, to: prevRange.to }
  return empty ? { window: w.window, previous: { ...previous, label: formatRange(previous, todayInTz(store.timezone, now)) } } : null
}
