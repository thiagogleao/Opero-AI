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
 *
 * Meta's side leaves out the store's shared-account campaigns (in its books,
 * sales mostly in another shop), by the Campanhas rule (lib/data/campaigns
 * partitionOwnShared): EPOCH's October showed US "Captura 283%" because 5
 * campaigns whose sales landed in CAMP HALLOW were counted against EPOCH's
 * own orders. What is left out is named in `sharedLeftOut`.
 */

import { query } from '../db'
import { computeStorePnL, purchaseValueSql, purchasesSql, type CountryPnL, type PnL } from '../engine/pnl'
import { isIsoDate, type DateRange } from '../engine/dates'
import { getSharedAdAccountsForStore } from '../attribution'
import { SHARED_ACCOUNT_NOTE, type SharedAdAccount } from '../attributionModels'
import { getOwnSharedFacts, type OwnSharedFacts } from './campaigns'

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
  /** Portuguese name ("Estados Unidos"), UNKNOWN_COUNTRY, or outrosLabel()
   *  ("Outros 9 países · +214 só com gasto do Meta"). */
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
  /** Only on the "outros" row: how many of those had at least one order (the
   *  rest only had Meta spend). */
  mergedWithOrders?: number
}

/** Shared-account campaigns left out of Meta's country columns. */
export interface CountrySharedLeftOut {
  campaigns: number
  /** Over the whole window, from the daily ad rows (the numbers Campanhas
   *  shows for them). */
  spend: number
  purchases: number
  purchaseValue: number
  /** Stores most of their tracked orders landed in (ids). */
  salesStoreIds: string[]
}

export interface CountryReport {
  storeId: string
  range: DateRange
  configured: boolean
  /** Biggest revenue first, then an "outros" row when there are more than
   *  `limit` countries; countries with nothing in them are left out
   *  (hasCountryActivity). orders, revenue, variableCosts and contribution sum
   *  to `totals`. */
  rows: CountryRow[]
  /** The store's P&L for the window. Ads (Meta and Shopify) and fixed costs
   *  are store lines: totals.contribution − ads − fixed = operatingProfit. */
  totals: PnL
  /** Stores of the same login whose sales ride on this store's ads, or whose
   *  ads carry this store's sales (CAMP HALLOW / EPOCH). Meta's country
   *  purchases then include the other store's sales. */
  sharedAdAccounts: SharedAdAccount[]
  /** Shared-account campaigns whose spend, purchases and value were taken out
   *  of every country's Meta columns (and of the coverage); null when none.
   *  Always set by getCountryReport (optional for reports built by hand). */
  sharedLeftOut?: CountrySharedLeftOut | null
  meta: {
    label: string
    caveat: string
    /** Spend Meta's country breakdown covers, against the store's Meta spend
     *  (both without shared-account campaigns). The breakdown is a separate
     *  pull with missing days. */
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

/** The name of every country nobody can name: Shopify's "??" (no country on
 *  the order), Meta's "unknown" bucket, XX/ZZ and any code Intl rejects. */
export const UNKNOWN_COUNTRY = 'País desconhecido'

let regionNames: Intl.DisplayNames | null = null

/**
 * "Estados Unidos" for "US". Intl.DisplayNames throws on anything that is not
 * a region subtag ("unknown", "??"), and the raw code used to come back as the
 * country's name ("unknown · 0 · $0"); with fallback 'none' it also returns
 * nothing for a well-formed code it does not know, instead of echoing it.
 */
export function countryName(code: string): string {
  const c = (code ?? '').trim().toUpperCase()
  // Region subtags only: two letters (ISO 3166) or three digits (UN M.49).
  if (!/^(?:[A-Z]{2}|\d{3})$/.test(c) || c === 'XX' || c === 'ZZ') return UNKNOWN_COUNTRY
  try {
    regionNames ??= new Intl.DisplayNames(['pt-BR'], { type: 'region', fallback: 'none' })
    return regionNames.of(c) ?? UNKNOWN_COUNTRY
  } catch {
    return UNKNOWN_COUNTRY
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

const CENT = 0.005

/**
 * A country worth a line: an order, money, or anything from Meta. Meta's
 * country breakdown also returns countries — and its "unknown" bucket — with
 * no spend and no purchases at all; kept, they showed as a "País desconhecido
 * · 0 pedidos · $0" row (Hibikura) and were counted in "Outros N países".
 * Every money field is checked, so dropping a row never breaks the sum.
 */
export function hasCountryActivity(c: Pick<CountryPnL, 'orders' | 'revenue' | 'variableCosts' | 'contribution' | 'metaSpend' | 'metaPurchaseValue'> & { purchases: number }): boolean {
  return c.orders > 0 || c.purchases > 0 || Math.abs(c.revenue) >= CENT || Math.abs(c.variableCosts) >= CENT
    || Math.abs(c.contribution) >= CENT || Math.abs(c.metaSpend) >= CENT || Math.abs(c.metaPurchaseValue) >= CENT
}

const paises = (n: number) => `${n} ${n === 1 ? 'país' : 'países'}`

/**
 * The name of the "outros" row. Only countries with an order count as the
 * countries the orders came from: "Outros 223 países · 14 pedidos" summed 9
 * countries that sold and 214 where Meta only spent (MOKOO, 7 dias).
 */
export function outrosLabel(withOrders: number, metaOnly: number): string {
  if (metaOnly <= 0) return `Outros ${paises(withOrders)}`
  if (withOrders <= 0) return `${paises(metaOnly)} só com gasto do Meta`
  return `Outros ${paises(withOrders)} · +${metaOnly} só com gasto do Meta`
}

/**
 * Keep the `limit` countries with most revenue (Meta spend breaks ties, so a
 * country Meta spends on without sales still ranks) and sum the rest into one
 * "outros" row, so the table always adds up to the store. Countries with
 * nothing in them are dropped first (hasCountryActivity).
 */
export function rollUpCountries(
  countries: (CountryPnL & { purchases: number })[], storeRevenue: number, limit: number,
): CountryRow[] {
  const sorted = countries.filter(hasCountryActivity).sort((a, b) => b.revenue - a.revenue || b.metaSpend - a.metaSpend)
  const head = sorted.slice(0, Math.max(0, limit)).map(c => toRow(c, storeRevenue))
  const tail = sorted.slice(Math.max(0, limit))
  if (!tail.length) return head
  const sum = tail.reduce((a, c) => ({
    country: 'outros', orders: a.orders + c.orders, revenue: a.revenue + c.revenue,
    variableCosts: a.variableCosts + c.variableCosts, contribution: a.contribution + c.contribution,
    metaSpend: a.metaSpend + c.metaSpend, metaPurchaseValue: a.metaPurchaseValue + c.metaPurchaseValue,
    purchases: a.purchases + c.purchases,
  }), { country: 'outros', orders: 0, revenue: 0, variableCosts: 0, contribution: 0, metaSpend: 0, metaPurchaseValue: 0, purchases: 0 })
  const withOrders = tail.filter(c => c.orders > 0).length
  return [...head, {
    ...toRow(sum, storeRevenue),
    name: outrosLabel(withOrders, tail.length - withOrders),
    mergedCountries: tail.length,
    mergedWithOrders: withOrders,
  }]
}

interface CountryMeta { country: string; spend: number; pv: number; pc: number }

/**
 * Take the shared-account campaigns' share of Meta's country split out of
 * each country's Meta columns. Shopify's side is untouched, so the rows still
 * add up to the store. Never below zero (rounding).
 */
export function withoutShared<T extends CountryPnL & { purchases: number }>(countries: T[], shared: readonly CountryMeta[]): T[] {
  if (!shared.length) return countries
  const by = new Map(shared.map(r => [r.country, r]))
  const cut = (a: number, b: number) => Math.max(0, Math.round((a - b) * 100) / 100)
  return countries.map(c => {
    const o = by.get(c.country)
    return o ? { ...c, metaSpend: cut(c.metaSpend, o.spend), metaPurchaseValue: cut(c.metaPurchaseValue, o.pv), purchases: Math.max(0, c.purchases - o.pc) } : c
  })
}

/** Meta's country split of some ads of a store (the shared-account ones). */
async function loadCountryMetaOfAds(storeId: string, range: DateRange, adIds: string[]): Promise<CountryMeta[]> {
  if (!adIds.length) return []
  const rows = await query<{ country: string | null; spend: number; pv: number; pc: number }>(
    `SELECT breakdown_value AS country,
            COALESCE(SUM(spend), 0)::float8 AS spend,
            COALESCE(SUM(${purchaseValueSql()}), 0)::float8 AS pv,
            COALESCE(SUM(${purchasesSql()}), 0)::float8 AS pc
       FROM fb_ad_breakdowns
      WHERE tenant_id = $1 AND breakdown_type = 'country' AND date BETWEEN $2::date AND $3::date
        AND ad_id = ANY($4::text[])
      GROUP BY 1`,
    [storeId, range.from, range.to, adIds],
  )
  return rows.map(r => ({ country: r.country || '??', spend: Number(r.spend) || 0, pv: Number(r.pv) || 0, pc: Number(r.pc) || 0 }))
}

/** What the shared-account campaigns were, from the split facts. */
function sharedLeftOutOf(split: OwnSharedFacts | null): CountrySharedLeftOut | null {
  if (!split || !split.sharedGroups.length) return null
  let spend = 0, purchases = 0, purchaseValue = 0
  for (const f of split.shared) { spend += f.spend; purchases += f.purchases; purchaseValue += f.purchaseValue }
  return {
    campaigns: split.sharedGroups.filter(g => g.campaignId).length,
    spend: Math.round(spend * 100) / 100, purchases, purchaseValue: Math.round(purchaseValue * 100) / 100,
    salesStoreIds: [...new Set(split.sharedGroups.map(g => g.salesStoreId).filter((x): x is string => !!x))],
  }
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
  const [pnl, purchases, breakdownDays, shared, split] = await Promise.all([
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
    // A failed split keeps every campaign in Meta's columns (as before)
    // rather than failing the page.
    getOwnSharedFacts(store.id, range).catch(err => { console.error('[countries] own/shared split', err); return null }),
  ])
  if (!pnl) return null

  const sharedLeftOut = sharedLeftOutOf(split)
  const sharedAds = split && sharedLeftOut ? [...new Set(split.shared.map(f => f.adId))] : []
  const sharedByCountry = await loadCountryMetaOfAds(store.id, range, sharedAds)
  const pcBy = new Map(purchases.map(r => [r.country || '??', Number(r.pc) || 0]))
  const countries = withoutShared((pnl.countries ?? []).map(c => ({ ...c, purchases: pcBy.get(c.country) ?? 0 })), sharedByCountry)
  const covered = new Set(breakdownDays.map(r => r.d))
  const coveredSpend = countries.reduce((s, c) => s + c.metaSpend, 0)
  const totalSpend = Math.max(0, pnl.totals.metaSpend - (sharedLeftOut?.spend ?? 0))

  const notes: string[] = []
  if (countries.some(c => c.country === 'US' && c.orders > 0)) notes.push(TERRITORIES_NOTE)
  if (!pnl.configured) notes.push('Custos não configurados: a contribuição de cada país é a própria receita.')
  // The left-out campaigns get their own sentence on screen (with names).
  if (shared.length && !sharedLeftOut) notes.push(SHARED_ACCOUNT_NOTE)

  return {
    storeId: store.id,
    range,
    configured: pnl.configured,
    rows: rollUpCountries(countries, pnl.totals.revenue, limit),
    totals: pnl.totals,
    sharedAdAccounts: shared,
    sharedLeftOut,
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
