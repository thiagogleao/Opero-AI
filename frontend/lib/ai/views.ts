import { sumPnL, type CountryPnL, type DayPnL, type PnL, type ProductPnL } from '@/lib/engine'
import { PARTNER_SHARE } from './config'
import { r1, r2, safeDiv } from './format'

/**
 * Compact, rounded views of the engine's numbers for the model (tool results
 * and the insights fact sheet). Nothing here computes profit: every money
 * figure is an engine field, only rounded, and every list says what it left
 * out so a partial list can never be read as a total.
 */

export interface TotalsView {
  revenue: number | null
  orders: number
  units: number
  aov: number | null
  productCost: number | null
  shipping: number | null
  fees: number | null
  perOrderExtras: number | null
  variableCosts: number | null
  contribution: number | null
  contributionMargin: number | null
  metaSpend: number | null
  shopSpend: number | null
  fixedCosts: number | null
  operatingProfit: number | null
  margin: number | null
  profitPerOrder: number | null
  refundGross: number | null
  refundCount: number
  refunds: number | null
  chargebacks: number | null
  chargebackFees: number | null
  chargebackCount: number
  cashResult: number | null
  breakEvenRoas: number | null
  roas: number | null
  metaRoas: number | null
  metaPurchaseValue: number | null
  metaPurchases: number
  /** Meta spend per Shopify order (the real acquisition cost, not Meta's CPA). */
  cac: number | null
}

/**
 * `configured: false` (no cost settings) blanks every cost-derived line: the
 * engine reports them as 0, and a model reading "contribution = revenue,
 * break-even 1.00x" would take them as facts about the store.
 */
export function totalsView(t: PnL, configured = true): TotalsView {
  const cost = (n: number | null) => (configured ? r2(n) : null)
  return {
    revenue: r2(t.revenue), orders: t.orders, units: t.units, aov: r2(safeDiv(t.revenue, t.orders)),
    productCost: cost(t.productCost), shipping: cost(t.shipping), fees: cost(t.fees),
    perOrderExtras: cost(t.perOrderExtras), variableCosts: cost(t.variableCosts),
    contribution: cost(t.contribution), contributionMargin: configured ? r1(t.contributionMargin) : null,
    metaSpend: r2(t.metaSpend), shopSpend: r2(t.shopSpend), fixedCosts: cost(t.fixedCosts),
    operatingProfit: r2(t.operatingProfit), margin: r1(t.margin), profitPerOrder: r2(t.profitPerOrder),
    refundGross: r2(t.refundGross), refundCount: t.refundCount, refunds: r2(t.refunds),
    chargebacks: r2(t.chargebacks), chargebackFees: r2(t.chargebackFees), chargebackCount: t.chargebackCount,
    cashResult: r2(t.cashResult), breakEvenRoas: cost(t.breakEvenRoas), roas: r2(t.roas),
    metaRoas: r2(t.metaRoas), metaPurchaseValue: r2(t.metaPurchaseValue),
    metaPurchases: Math.round(t.metaPurchases), cac: t.metaSpend > 0 ? r2(safeDiv(t.metaSpend, t.orders)) : null,
  }
}

/** The partner's half of the money lines. Margins, ROAS and break-even are
 *  ratios and are never halved. */
export interface PartnerShareView {
  share: number
  operatingProfit: number | null
  profitPerOrder: number | null
  cashResult: number | null
  refunds: number | null
}

export function partnerShareView(t: PnL): PartnerShareView {
  return {
    share: PARTNER_SHARE,
    operatingProfit: r2(t.operatingProfit * PARTNER_SHARE),
    profitPerOrder: t.profitPerOrder === null ? null : r2(t.profitPerOrder * PARTNER_SHARE),
    cashResult: r2(t.cashResult * PARTNER_SHARE),
    refunds: r2(t.refunds * PARTNER_SHARE),
  }
}

export interface SeriesPoint {
  /** A date, or "from..to" for a weekly bucket. */
  period: string
  revenue: number | null
  orders: number
  metaSpend: number | null
  shopSpend: number | null
  operatingProfit: number | null
  roas: number | null
}

/**
 * The day-by-day series, or weekly buckets when the window is long. Buckets
 * are sums of the engine's own days (sumPnL), so they add up to the totals.
 */
export function seriesView(daily: DayPnL[], maxDailyPoints = 35): { granularity: 'day' | 'week'; points: SeriesPoint[] } {
  const point = (period: string, p: PnL): SeriesPoint => ({
    period, revenue: r2(p.revenue), orders: p.orders, metaSpend: r2(p.metaSpend), shopSpend: r2(p.shopSpend),
    operatingProfit: r2(p.operatingProfit), roas: r2(p.roas),
  })
  if (daily.length <= maxDailyPoints) {
    return { granularity: 'day', points: daily.map(d => point(d.date, d)) }
  }
  const points: SeriesPoint[] = []
  for (let i = 0; i < daily.length; i += 7) {
    const chunk = daily.slice(i, i + 7)
    points.push(point(`${chunk[0].date}..${chunk[chunk.length - 1].date}`, sumPnL(chunk)))
  }
  return { granularity: 'week', points }
}

export interface ProductRow {
  productId: string | null
  title: string
  units: number
  orders: number
  revenue: number | null
  contribution: number | null
  contributionMargin: number | null
}

export interface ProductsView {
  totalProducts: number
  sortedBy?: ProductSort
  top: ProductRow[]
  /** Everything not listed, summed, so top + others = the store's revenue. */
  others: { products: number; units: number; revenue: number | null; contribution: number | null }
}

export type ProductSort = 'revenue' | 'units' | 'contribution'

export function productsView(products: ProductPnL[], limit: number, sort: ProductSort = 'revenue'): ProductsView {
  const key = (p: ProductPnL) => (sort === 'units' ? p.units : sort === 'contribution' ? p.contribution : p.revenue)
  const sorted = [...products].sort((a, b) => key(b) - key(a) || b.revenue - a.revenue)
  const top = sorted.slice(0, limit)
  const rest = sorted.slice(limit)
  return {
    totalProducts: products.length,
    sortedBy: sort,
    top: top.map(p => ({
      productId: p.productId, title: p.title, units: p.units, orders: p.orders,
      revenue: r2(p.revenue), contribution: r2(p.contribution),
      contributionMargin: r1(p.revenue > 0 ? (p.contribution / p.revenue) * 100 : null),
    })),
    others: {
      products: rest.length,
      units: rest.reduce((s, p) => s + p.units, 0),
      revenue: r2(rest.reduce((s, p) => s + p.revenue, 0)),
      contribution: r2(rest.reduce((s, p) => s + p.contribution, 0)),
    },
  }
}

export interface CountryRow {
  country: string
  /** Shopify orders: the sample size for anything said about this country. */
  orders: number
  revenue: number | null
  contribution: number | null
  /** Spend Meta delivered in this country (a fact Meta knows). */
  metaSpend: number | null
  /** Shopify contribution minus Meta spend in the country. Organic orders are
   *  in the contribution too, so this flatters countries with organic demand. */
  contributionAfterMeta: number | null
  /** What Meta claims it sold there: capture varies 17%–140% by country. */
  metaPurchaseValue: number | null
  /** Rough reliability of the country's own numbers, from its order count. */
  sample: 'insuficiente' | 'pequena' | 'razoável' | 'boa'
}

export interface CountriesView {
  totalCountries: number
  rows: CountryRow[]
  others: { countries: number; orders: number; revenue: number | null; contribution: number | null; metaSpend: number | null }
}

export function sampleLabel(orders: number): CountryRow['sample'] {
  if (orders < 10) return 'insuficiente'
  if (orders < 30) return 'pequena'
  if (orders < 100) return 'razoável'
  return 'boa'
}

/** Countries by Shopify revenue, plus any country where Meta spent real money
 *  (≥ 2% of spend) even with few orders: that is where a decision may be due. */
export function countriesView(countries: CountryPnL[], limit: number): CountriesView {
  const totalSpend = countries.reduce((s, c) => s + c.metaSpend, 0)
  const byRevenue = [...countries].sort((a, b) => b.revenue - a.revenue || b.metaSpend - a.metaSpend)
  const picked = new Set(byRevenue.slice(0, limit).map(c => c.country))
  for (const c of countries) {
    if (totalSpend > 0 && c.metaSpend >= totalSpend * 0.02) picked.add(c.country)
  }
  const rows = byRevenue.filter(c => picked.has(c.country))
  const rest = byRevenue.filter(c => !picked.has(c.country))
  return {
    totalCountries: countries.length,
    rows: rows.map(c => ({
      country: c.country, orders: c.orders, revenue: r2(c.revenue), contribution: r2(c.contribution),
      metaSpend: r2(c.metaSpend), contributionAfterMeta: r2(c.contribution - c.metaSpend),
      metaPurchaseValue: r2(c.metaPurchaseValue), sample: sampleLabel(c.orders),
    })),
    others: {
      countries: rest.length,
      orders: rest.reduce((s, c) => s + c.orders, 0),
      revenue: r2(rest.reduce((s, c) => s + c.revenue, 0)),
      contribution: r2(rest.reduce((s, c) => s + c.contribution, 0)),
      metaSpend: r2(rest.reduce((s, c) => s + c.metaSpend, 0)),
    },
  }
}
