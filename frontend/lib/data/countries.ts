/**
 * Countries, from the profit engine.
 *
 * Shopify's side (orders, revenue, variable costs, contribution) comes from
 * computePnL's per-order pass, grouped by the order's country: every order is
 * priced with the store's real rules (country supplier prices, the EU fee,
 * rate cards) and every country is kept, so the rows plus "outros" add up to
 * the store exactly. The old view priced countries at a flat default, split ad
 * spend by revenue share (which gives every country the same ROAS) and kept
 * only the top 12 countries, which then carried 100% of the spend.
 *
 * Meta's side is shown apart and named "atribuído pelo Meta": spend, purchases
 * and value from Meta's own country breakdown, and the capture (Meta purchases
 * ÷ real orders). Ads are not charged to countries: per-country attribution is
 * not reliable enough to decide on (CLAUDE.md measured 17%–140% capture at
 * EPOCH), so the store's ad spend stays one line below the table.
 */

import { query } from '../db'
import { computeStorePnL, purchasesSql, type CountryPnL, type PnL } from '../engine/pnl'
import { isIsoDate, type DateRange } from '../engine/dates'
import { getSharedAdAccountsForStore } from '../attribution'
import { SHARED_ACCOUNT_NOTE, type SharedAdAccount } from '../attributionModels'

// ─── Types ────────────────────────────────────────────────────────────────────

/** What Meta's country breakdown attributes to a country. */
export interface MetaCountryAttribution {
  spend: number
  purchases: number
  /** Phantom ad-days removed. */
  purchaseValue: number
  /** Meta purchases ÷ Shopify orders of the country, in %. Above or below 100
   *  is Meta's attribution error, not a conversion rate. Null without orders. */
  capturePct: number | null
}

export interface CountryRow {
  /** ISO 3166 alpha-2; "??" when Shopify had no country; "outros" for the row
   *  that sums every country below the cut. */
  country: string
  /** Portuguese name ("Estados Unidos"), "Desconhecido", or "Outros N países". */
  name: string
  orders: number
  revenue: number
  revenueShare: number | null
  variableCosts: number
  contribution: number
  contributionMargin: number | null
  contributionPerOrder: number | null
  /** Fewer than SMALL_SAMPLE orders: too few to judge the country on. */
  smallSample: boolean
  meta: MetaCountryAttribution
  /** Only on the "outros" row: how many countries it sums. */
  mergedCountries?: number
}

export interface CountryReport {
  storeId: string
  range: DateRange
  configured: boolean
  /** Biggest revenue first, then an "outros" row when there are more than
   *  `limit` countries. orders, revenue, variableCosts and contribution sum to
   *  `totals`. */
  rows: CountryRow[]
  /** The store's P&L for the window. Ads (Meta and Shopify) and fixed costs
   *  are store lines: totals.contribution − ads − fixed = operatingProfit. */
  totals: PnL
  /** Stores of the same login whose sales ride on this store's ads, or whose
   *  ads carry this store's sales (CAMP HALLOW / EPOCH). Meta's country
   *  purchases then include the other store's sales. */
  sharedAdAccounts: SharedAdAccount[]
  meta: {
    label: string
    caveat: string
    /** Spend Meta's country breakdown covers, against the store's Meta spend.
     *  The breakdown is a separate pull with missing days. */
    coveredSpend: number
    totalSpend: number
    coveragePct: number | null
    /** Days with Meta spend that have no country breakdown. */
    missingDays: string[]
  }
  notes: string[]
}

export const SMALL_SAMPLE = 30

export const META_COUNTRY_LABEL = 'Atribuído pelo Meta'

export const META_COUNTRY_CAVEAT =
  'Divisão por país feita pelo próprio Meta. Medida na EPOCH, ela captou de 17% a 140% dos pedidos reais, ' +
  'conforme o país: não decida geografia por ela. Compare com os pedidos da Shopify ao lado.'

export const TERRITORIES_NOTE =
  'Porto Rico, Ilhas Virgens, Guam, Samoa e Marianas chegam da Shopify como "US": as vendas desses territórios estão dentro dos Estados Unidos.'

// ─── Pure helpers (exported for the tests) ────────────────────────────────────

let regionNames: Intl.DisplayNames | null = null

export function countryName(code: string): string {
  if (!code || code === '??' || code === 'XX') return 'Desconhecido'
  try {
    regionNames ??= new Intl.DisplayNames(['pt-BR'], { type: 'region' })
    return regionNames.of(code.toUpperCase()) ?? code
  } catch {
    return code
  }
}

const pct = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null)

function toRow(c: CountryPnL & { purchases: number }, storeRevenue: number): CountryRow {
  return {
    country: c.country,
    name: countryName(c.country),
    orders: c.orders,
    revenue: c.revenue,
    revenueShare: pct(c.revenue, storeRevenue),
    variableCosts: c.variableCosts,
    contribution: c.contribution,
    contributionMargin: pct(c.contribution, c.revenue),
    contributionPerOrder: c.orders > 0 ? c.contribution / c.orders : null,
    smallSample: c.orders < SMALL_SAMPLE,
    meta: {
      spend: c.metaSpend,
      purchases: c.purchases,
      purchaseValue: c.metaPurchaseValue,
      capturePct: c.orders > 0 ? (c.purchases / c.orders) * 100 : null,
    },
  }
}

/**
 * Keep the `limit` countries with most revenue (Meta spend breaks ties, so a
 * country Meta spends on without sales still ranks) and sum the rest into one
 * "outros" row, so the table always adds up to the store.
 */
export function rollUpCountries(
  countries: (CountryPnL & { purchases: number })[], storeRevenue: number, limit: number,
): CountryRow[] {
  const sorted = [...countries].sort((a, b) => b.revenue - a.revenue || b.metaSpend - a.metaSpend)
  const head = sorted.slice(0, Math.max(0, limit)).map(c => toRow(c, storeRevenue))
  const tail = sorted.slice(Math.max(0, limit))
  if (!tail.length) return head
  const sum = tail.reduce((a, c) => ({
    country: 'outros', orders: a.orders + c.orders, revenue: a.revenue + c.revenue,
    variableCosts: a.variableCosts + c.variableCosts, contribution: a.contribution + c.contribution,
    metaSpend: a.metaSpend + c.metaSpend, metaPurchaseValue: a.metaPurchaseValue + c.metaPurchaseValue,
    purchases: a.purchases + c.purchases,
  }), { country: 'outros', orders: 0, revenue: 0, variableCosts: 0, contribution: 0, metaSpend: 0, metaPurchaseValue: 0, purchases: 0 })
  return [...head, { ...toRow(sum, storeRevenue), name: `Outros ${tail.length} países`, mergedCountries: tail.length }]
}

// ─── Loading ──────────────────────────────────────────────────────────────────

/**
 * Every country the store sold to or Meta spent on in the window.
 * `limit` (default 12, max 250) is the number of named rows before "outros".
 */
export async function getCountryReport(
  store: { id: string }, range: DateRange, opts: { limit?: number } = {},
): Promise<CountryReport | null> {
  if (!isIsoDate(range.from) || !isIsoDate(range.to) || range.from > range.to) {
    throw new RangeError(`invalid range ${range.from}..${range.to}`)
  }
  const limit = Math.min(Math.max(Math.trunc(opts.limit ?? 12) || 12, 1), 250)
  const [pnl, purchases, breakdownDays, shared] = await Promise.all([
    computeStorePnL(store.id, range, { countries: true }),
    query<{ country: string | null; pc: number }>(
      `SELECT breakdown_value AS country, COALESCE(SUM(${purchasesSql()}), 0)::float8 AS pc
         FROM fb_ad_breakdowns
        WHERE tenant_id = $1 AND breakdown_type = 'country' AND date BETWEEN $2::date AND $3::date
        GROUP BY 1`,
      [store.id, range.from, range.to],
    ),
    query<{ d: string }>(
      `SELECT DISTINCT date::text AS d FROM fb_ad_breakdowns
        WHERE tenant_id = $1 AND breakdown_type = 'country' AND date BETWEEN $2::date AND $3::date`,
      [store.id, range.from, range.to],
    ),
    getSharedAdAccountsForStore(store.id, range).catch(() => [] as SharedAdAccount[]),
  ])
  if (!pnl) return null

  const pcBy = new Map(purchases.map(r => [r.country || '??', Number(r.pc) || 0]))
  const countries = (pnl.countries ?? []).map(c => ({ ...c, purchases: pcBy.get(c.country) ?? 0 }))
  const covered = new Set(breakdownDays.map(r => r.d))
  const coveredSpend = countries.reduce((s, c) => s + c.metaSpend, 0)
  const totalSpend = pnl.totals.metaSpend

  const notes: string[] = []
  if (countries.some(c => c.country === 'US' && c.orders > 0)) notes.push(TERRITORIES_NOTE)
  if (!pnl.configured) notes.push('Custos não configurados: a contribuição de cada país é a própria receita.')
  if (shared.length) notes.push(SHARED_ACCOUNT_NOTE)

  return {
    storeId: store.id,
    range,
    configured: pnl.configured,
    rows: rollUpCountries(countries, pnl.totals.revenue, limit),
    totals: pnl.totals,
    sharedAdAccounts: shared,
    meta: {
      label: META_COUNTRY_LABEL,
      caveat: META_COUNTRY_CAVEAT,
      coveredSpend,
      totalSpend,
      coveragePct: pct(coveredSpend, totalSpend),
      missingDays: pnl.daily.filter(d => d.metaSpend > 0 && !covered.has(d.date)).map(d => d.date),
    },
    notes,
  }
}
