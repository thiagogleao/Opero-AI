/**
 * Fold a full country list into the rows a table shows: the `limit` biggest
 * countries by revenue (Meta spend breaks ties) and one "outros" row with the
 * rest, so the table still adds up to the store. Same rule and same label as
 * lib/data/countries rollUpCountries, applied to finished rows so the page can
 * also count, from the full list, how many countries actually had orders (the
 * full list includes countries where only Meta spent). Rows with nothing in
 * them never get here: rollUpCountries drops them. The Shopify table folds
 * shopifyCountryRows(all) instead, the Meta table the full list. Pure.
 */

import type { CountryRow } from '@/lib/data/countries'
import { outrosLabel, SMALL_SAMPLE } from '@/lib/data/countries'

const pct = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null)

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
    captureOrders: a.captureOrders + (r.meta.captureOrders ?? r.orders),
    capturePurchases: a.capturePurchases + (r.meta.capturePurchases ?? r.meta.purchases),
  }), { orders: 0, revenue: 0, variableCosts: 0, contribution: 0, spend: 0, purchases: 0, value: 0, captureOrders: 0, capturePurchases: 0 })
  // An "outros" row already in the list carries its own counts.
  const merged = tail.reduce((n, r) => n + (r.mergedCountries ?? 1), 0)
  const withOrders = tail.reduce((n, r) => n + (r.country === 'outros' ? r.mergedWithOrders ?? (r.orders > 0 ? 1 : 0) : r.orders > 0 ? 1 : 0), 0)
  return [...head, {
    country: 'outros',
    name: outrosLabel(withOrders, merged - withOrders),
    orders: sum.orders,
    revenue: sum.revenue,
    revenueShare: pct(sum.revenue, storeRevenue),
    variableCosts: sum.variableCosts,
    contribution: sum.contribution,
    contributionMargin: pct(sum.contribution, sum.revenue),
    contributionPerOrder: sum.orders > 0 ? sum.contribution / sum.orders : null,
    smallSample: sum.orders < SMALL_SAMPLE,
    // The capture of the folded rows over their comparable days only, as
    // each row's own (lib/data/countries captureDays).
    meta: {
      spend: sum.spend, purchases: sum.purchases, purchaseValue: sum.value,
      capturePct: pct(sum.capturePurchases, sum.captureOrders),
      captureOrders: sum.captureOrders, capturePurchases: sum.capturePurchases,
    },
    mergedCountries: merged,
    mergedWithOrders: withOrders,
  }]
}

const CENT = 0.005

/**
 * The rows of the Shopify table ("Vendas por país" / "Contribuição por país"):
 * only countries with an order or money from orders. The full list also holds
 * countries where only Meta spent (rollUpCountries keeps them for the Meta
 * table), and they read as "0 · $0 · — das vendas" rows under a verdict that
 * said "Nenhum pedido na Glooty". Those stay in the Meta table only. An
 * "outros" row already in the list keeps only its countries with orders in
 * its name. Dropped rows carry no orders or money, so the table still adds
 * up to the store. Fold the result with foldCountryRows. Pure.
 */
export function shopifyCountryRows(all: CountryRow[]): CountryRow[] {
  const sold = (r: CountryRow) => r.orders > 0 || Math.abs(r.revenue) >= CENT
    || Math.abs(r.variableCosts) >= CENT || Math.abs(r.contribution) >= CENT
  return all.filter(sold).map(r => {
    if (r.country !== 'outros') return r
    const withOrders = r.mergedWithOrders ?? (r.orders > 0 ? 1 : 0)
    return { ...r, name: outrosLabel(withOrders, 0), mergedCountries: withOrders, mergedWithOrders: withOrders }
  })
}

/** Countries with at least one order, and how many of them are under the
 *  sample size — counted on the full list. */
export function countryCounts(all: CountryRow[]): { withOrders: number; small: number } {
  const withOrders = all.filter(r => r.country !== 'outros' && r.orders > 0)
  return { withOrders: withOrders.length, small: withOrders.filter(r => r.orders < SMALL_SAMPLE).length }
}
