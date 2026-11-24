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
 * ÷ real orders, both counted only on the days the breakdown covers whole:
 * it is a separate pull with missing and partial days, and dividing part of
 * the purchases by every order made Meta look blind to half the sales). Ads
 * are not charged to countries: per-country attribution is not reliable
 * enough to decide on (CLAUDE.md measured 17%–140% capture at EPOCH), so the
 * store's ad spend stays one line below the table.
 *
 * Meta's side leaves out the store's shared-account campaigns (in its books,
 * sales mostly in another shop), by the Campanhas rule (lib/data/campaigns
 * partitionOwnShared): EPOCH's October showed US "Captura 283%" because 5
 * campaigns whose sales landed in CAMP HALLOW were counted against EPOCH's
 * own orders. What is left out is named in `sharedLeftOut`.
 */

import { query } from '../db'
import { computeStorePnL, KEPT_ORDER_SQL, purchaseValueSql, purchasesSql, type CountryPnL, type PnL } from '../engine/pnl'
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
  /** capturePurchases ÷ captureOrders, in %. Above or below 100 is Meta's
   *  attribution error, not a conversion rate. Null without such orders. */
  capturePct: number | null
  /** The country's Shopify orders the capture divides by: only those of the
   *  days Meta's country split can be compared on (captureDays). Below
   *  `orders` when some days with Meta spend have no split, or only part of
   *  one: MOKOO's October read US "179 compras · 373 pedidos · Captura 48%"
   *  with the split covering 52% of the spend, while the Funil on the same
   *  page said Meta saw 86% of the orders. Optional for rows built by hand
   *  (then the row's orders). */
  captureOrders?: number
  /** Meta's purchases of the country on those same days (shared-account
   *  campaigns left out, as `purchases`). Optional for rows built by hand
   *  (then `purchases`). */
  capturePurchases?: number
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

/** One country of Meta's split of the left-out shared-account campaigns. */
export interface CountrySharedMeta {
  /** ISO code, "??" when Meta gave none (as the rows). */
  country: string
  spend: number
  /** Phantom ad-days removed. */
  purchaseValue: number
  purchases: number
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
  /** Meta's country split of those left-out campaigns, per country (what
   *  was taken out of each row's Meta columns). A sum over stores that also
   *  holds every store in `sharedLeftOut.salesStoreIds` adds it back, as the
   *  desktop "Todas" does: those campaigns' sales are then orders of the sum.
   *  Empty when nothing was left out; optional for reports built by hand. */
  sharedMeta?: CountrySharedMeta[]
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
    /** Days with Meta spend whose country breakdown holds only part of the
     *  day's spend (below FULL_DAY_SHARE). They and `missingDays` are left
     *  out of the capture, on both sides. Optional for reports built by hand. */
    partialDays?: string[]
    /** Days with Meta spend the capture is counted on. 0 with spend in the
     *  window: no day can be compared, and every capturePct is null.
     *  Optional for reports built by hand. */
    captureSpendDays?: number
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

/** A country of the engine with Meta's purchases, and what the capture
 *  divides when it is not the whole window (absent: orders and purchases). */
export type CountryInput = CountryPnL & { purchases: number; captureOrders?: number; capturePurchases?: number }

function toRow(c: CountryInput, storeRevenue: number): CountryRow {
  const captureOrders = c.captureOrders ?? c.orders
  const capturePurchases = c.capturePurchases ?? c.purchases
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
      capturePct: captureOrders > 0 ? (capturePurchases / captureOrders) * 100 : null,
      captureOrders,
      capturePurchases,
    },
  }
}

/** A day counts for the capture when Meta's country split holds at least
 *  this share of the day's Meta spend. MOKOO's October had days at 2%, 75%
 *  and 82%: their orders went in whole and their purchases only in part. */
export const FULL_DAY_SHARE = 0.95

/**
 * Split the window's days by how Meta's country breakdown covers them:
 * `missing` (Meta spend, no split at all), `partial` (a split holding less
 * than FULL_DAY_SHARE of the day's spend) and `comparable` (every other day,
 * days without Meta spend included, as the Funil's capture counts them).
 * `splitSpend` has one entry per day the breakdown has rows for.
 */
export function captureDays(
  daily: readonly { date: string; metaSpend: number }[], splitSpend: ReadonlyMap<string, number>,
): { comparable: string[]; partial: string[]; missing: string[]; comparableSpendDays: number } {
  const comparable: string[] = [], partial: string[] = [], missing: string[] = []
  let comparableSpendDays = 0
  for (const d of daily) {
    if (!(d.metaSpend > 0)) { comparable.push(d.date); continue }
    const split = splitSpend.get(d.date)
    if (split === undefined) missing.push(d.date)
    else if (split < d.metaSpend * FULL_DAY_SHARE) partial.push(d.date)
    else { comparable.push(d.date); comparableSpendDays++ }
  }
  return { comparable, partial, missing, comparableSpendDays }
}

/** How Meta's country split covers one store's Meta spend in a window. */
export interface MetaSplitCoverage {
  /** Spend the split holds over the window (what the country rows add up to). */
  coveredSpend: number
  /** The store's Meta spend in the window (the engine's). */
  totalSpend: number
  coveragePct: number | null
  /** Days with Meta spend and no split at all. */
  missingDays: string[]
  /** Days with Meta spend whose split holds less than FULL_DAY_SHARE of it. */
  partialDays: string[]
}

/**
 * The coverage of one store from its daily Meta spend (the engine's daily
 * rows) and the split's spend per day. The "Todas" Países block sums every
 * store's country rows; MOKOO's split was empty for the whole week and its
 * $6.618 disappeared from the sum without a word (13,7 mil shown of 20,7 mil).
 * Pure.
 */
export function metaSplitCoverage(
  daily: readonly { date: string; metaSpend: number }[], splitByDay: ReadonlyMap<string, number>, totalSpend: number,
): MetaSplitCoverage {
  const days = captureDays(daily, splitByDay)
  const inWindow = new Set(daily.map(d => d.date))
  let covered = 0
  for (const [d, spend] of splitByDay) if (inWindow.has(d)) covered += spend
  covered = Math.round(covered * 100) / 100
  return { coveredSpend: covered, totalSpend, coveragePct: pct(covered, totalSpend), missingDays: days.missing, partialDays: days.partial }
}

/**
 * metaSplitCoverage for several stores, in one read of the split's daily
 * spend. Stores with no row in the split get an empty map (every day with
 * spend is missing).
 */
export async function getMetaSplitCoverage(
  stores: readonly { storeId: string; daily: readonly { date: string; metaSpend: number }[]; totalSpend: number }[],
  range: DateRange,
): Promise<Map<string, MetaSplitCoverage>> {
  const out = new Map<string, MetaSplitCoverage>()
  if (!stores.length) return out
  const rows = await query<{ tenant_id: string; d: string; spend: number }>(
    `SELECT tenant_id, date::text AS d, COALESCE(SUM(spend), 0)::float8 AS spend
       FROM fb_ad_breakdowns
      WHERE tenant_id = ANY($1::text[]) AND breakdown_type = 'country' AND date BETWEEN $2::date AND $3::date
      GROUP BY 1, 2`,
    [stores.map(s => s.storeId), range.from, range.to],
  )
  for (const s of stores) {
    const split = new Map(rows.filter(r => r.tenant_id === s.storeId).map(r => [r.d, Number(r.spend) || 0]))
    out.set(s.storeId, metaSplitCoverage(s.daily, split, s.totalSpend))
  }
  return out
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
  countries: CountryInput[], storeRevenue: number, limit: number,
): CountryRow[] {
  const sorted = countries.filter(hasCountryActivity).sort((a, b) => b.revenue - a.revenue || b.metaSpend - a.metaSpend)
  const head = sorted.slice(0, Math.max(0, limit)).map(c => toRow(c, storeRevenue))
  const tail = sorted.slice(Math.max(0, limit))
  if (!tail.length) return head
  const sum = tail.reduce<Required<CountryInput>>((a, c) => ({
    country: 'outros', orders: a.orders + c.orders, revenue: a.revenue + c.revenue,
    variableCosts: a.variableCosts + c.variableCosts, contribution: a.contribution + c.contribution,
    metaSpend: a.metaSpend + c.metaSpend, metaPurchaseValue: a.metaPurchaseValue + c.metaPurchaseValue,
    purchases: a.purchases + c.purchases,
    captureOrders: a.captureOrders + (c.captureOrders ?? c.orders),
    capturePurchases: a.capturePurchases + (c.capturePurchases ?? c.purchases),
  }), { country: 'outros', orders: 0, revenue: 0, variableCosts: 0, contribution: 0, metaSpend: 0, metaPurchaseValue: 0, purchases: 0, captureOrders: 0, capturePurchases: 0 })
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
export function withoutShared<T extends CountryInput>(countries: T[], shared: readonly CountryMeta[]): T[] {
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

/** Counts keyed by country as the engine keys them: no code (null or "")
 *  is "??", so both land in one entry. */
function sumByCountry(rows: readonly { country: string | null; n: number }[]): Map<string, number> {
  const out = new Map<string, number>()
  for (const r of rows) {
    const key = r.country || '??'
    out.set(key, (out.get(key) ?? 0) + (Number(r.n) || 0))
  }
  return out
}

/**
 * Orders and Meta purchases per country on the comparable days only, for the
 * capture. Null when every day is comparable (the window's own counts are the
 * right ones). With no comparable day that had Meta spend, both maps are empty
 * and every capture is null: purchases from days without spend against their
 * orders would read as 0%. Orders follow the engine's rules (kept orders, the
 * store's own calendar, no country = "??"); purchases leave out the
 * shared-account ads, as the Meta columns do.
 */
async function loadCaptureCounts(
  storeId: string, range: DateRange, days: ReturnType<typeof captureDays>, sharedAds: string[],
): Promise<{ orders: Map<string, number>; purchases: Map<string, number> } | null> {
  if (!days.missing.length && !days.partial.length) return null
  if (days.comparableSpendDays === 0) return { orders: new Map(), purchases: new Map() }
  const [orders, purchases] = await Promise.all([
    query<{ country: string | null; n: number }>(
      `SELECT o.country_code AS country, COUNT(*)::int AS n
         FROM shopify_orders o
         JOIN tenants t ON t.id = o.tenant_id
        WHERE o.tenant_id = $1
          AND o.created_at >= ($2::date - 2)::timestamptz
          AND o.created_at <  ($3::date + 3)::timestamptz
          AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date = ANY($4::date[])
          AND ${KEPT_ORDER_SQL}
        GROUP BY 1`,
      [storeId, range.from, range.to, days.comparable],
    ),
    query<{ country: string | null; n: number }>(
      `SELECT breakdown_value AS country, COALESCE(SUM(${purchasesSql()}), 0)::float8 AS n
         FROM fb_ad_breakdowns
        WHERE tenant_id = $1 AND breakdown_type = 'country' AND date = ANY($2::date[])
          AND COALESCE(ad_id, '') <> ALL($3::text[])
        GROUP BY 1`,
      [storeId, days.comparable, sharedAds],
    ),
  ])
  return { orders: sumByCountry(orders), purchases: sumByCountry(purchases) }
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
    query<{ d: string; spend: number }>(
      `SELECT date::text AS d, COALESCE(SUM(spend), 0)::float8 AS spend FROM fb_ad_breakdowns
        WHERE tenant_id = $1 AND breakdown_type = 'country' AND date BETWEEN $2::date AND $3::date
        GROUP BY 1`,
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
  const pcBy = sumByCountry(purchases.map(r => ({ country: r.country, n: r.pc })))
  const days = captureDays(pnl.daily, new Map(breakdownDays.map(r => [r.d, Number(r.spend) || 0])))
  const capture = await loadCaptureCounts(store.id, range, days, sharedAds)
  const countries = withoutShared((pnl.countries ?? []).map(c => ({
    ...c, purchases: pcBy.get(c.country) ?? 0,
    ...(capture ? { captureOrders: capture.orders.get(c.country) ?? 0, capturePurchases: capture.purchases.get(c.country) ?? 0 } : {}),
  })), sharedByCountry)
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
    sharedMeta: sharedByCountry.map(r => ({ country: r.country, spend: r.spend, purchaseValue: r.pv, purchases: r.pc })),
    meta: {
      label: META_COUNTRY_LABEL,
      caveat: META_COUNTRY_CAVEAT,
      coveredSpend,
      totalSpend,
      coveragePct: pct(coveredSpend, totalSpend),
      missingDays: days.missing,
      partialDays: days.partial,
      captureSpendDays: days.comparableSpendDays,
    },
    notes,
  }
}
