/**
 * Fold a full country list into the rows a table shows: the `limit` biggest
 * countries by revenue (Meta spend breaks ties) and one "outros" row with the
 * rest, so the table still adds up to the store. Same rule as
 * lib/data/countries rollUpCountries, applied to finished rows so the page can
 * also count, from the full list, how many countries actually had orders (the
 * full list includes countries where only Meta spent). Pure.
 */

import type { CountryRow } from '@/lib/data/countries'
import { SMALL_SAMPLE } from '@/lib/data/countries'

const pct = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null)

/** Meta's country breakdown also returns countries (and an "unknown" bucket)
 *  with no spend and no purchases at all. */
const isUnknown = (code: string) => code === '??' || /^(unknown|xx)$/i.test(code)

/**
 * The rows worth a line: an order, revenue or something from Meta. Empty
 * countries would otherwise be counted as "só com gasto do Meta" and show as
 * "unknown · 0 · $0" rows. Meta's "unknown" bucket gets a Portuguese name.
 */
export function meaningfulCountries(all: CountryRow[]): CountryRow[] {
  return all
    .filter(r => r.country === 'outros' || r.orders > 0 || Math.abs(r.revenue) >= 0.005
      || r.meta.spend >= 0.005 || r.meta.purchases > 0 || r.meta.purchaseValue >= 0.005)
    .map(r => (isUnknown(r.country) ? { ...r, name: 'País não informado' } : r))
}

export function foldCountryRows(all: CountryRow[], limit: number, storeRevenue: number): CountryRow[] {
  const sorted = [...all].filter(r => r.country !== 'outros').sort((a, b) => b.revenue - a.revenue || b.meta.spend - a.meta.spend)
  const already = all.find(r => r.country === 'outros')
  const head = sorted.slice(0, Math.max(0, limit))
  const tail = [...sorted.slice(Math.max(0, limit)), ...(already ? [already] : [])]
  if (!tail.length) return head
  const sum = tail.reduce((a, r) => ({
    orders: a.orders + r.orders, revenue: a.revenue + r.revenue, variableCosts: a.variableCosts + r.variableCosts,
    contribution: a.contribution + r.contribution, spend: a.spend + r.meta.spend, purchases: a.purchases + r.meta.purchases,
    value: a.value + r.meta.purchaseValue,
  }), { orders: 0, revenue: 0, variableCosts: 0, contribution: 0, spend: 0, purchases: 0, value: 0 })
  const merged = tail.reduce((n, r) => n + (r.mergedCountries ?? 1), 0)
  const withOrders = tail.filter(r => r.country !== 'outros' && r.orders > 0).length + (already && already.orders > 0 ? 1 : 0)
  const metaOnly = merged - withOrders
  return [...head, {
    country: 'outros',
    name: metaOnly > 0
      ? `Outros ${withOrders} ${withOrders === 1 ? 'país' : 'países'} · +${metaOnly} só com gasto do Meta`
      : `Outros ${merged} ${merged === 1 ? 'país' : 'países'}`,
    orders: sum.orders,
    revenue: sum.revenue,
    revenueShare: pct(sum.revenue, storeRevenue),
    variableCosts: sum.variableCosts,
    contribution: sum.contribution,
    contributionMargin: pct(sum.contribution, sum.revenue),
    contributionPerOrder: sum.orders > 0 ? sum.contribution / sum.orders : null,
    smallSample: sum.orders < SMALL_SAMPLE,
    meta: { spend: sum.spend, purchases: sum.purchases, purchaseValue: sum.value, capturePct: sum.orders > 0 ? (sum.purchases / sum.orders) * 100 : null },
    mergedCountries: merged,
  }]
}

/** Countries with at least one order, and how many of them are under the
 *  sample size — counted on the full list. */
export function countryCounts(all: CountryRow[]): { withOrders: number; small: number } {
  const withOrders = all.filter(r => r.country !== 'outros' && r.orders > 0)
  return { withOrders: withOrders.length, small: withOrders.filter(r => r.orders < SMALL_SAMPLE).length }
}
