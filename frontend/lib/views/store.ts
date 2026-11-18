/**
 * The store summary ("Resumo", the desktop home): one store, one window, every
 * number from the profit engine.
 *
 * What the page needs, and where each piece comes from:
 *
 *   loadStoreSummary   ONE computePnL for the window (daily, hourly, products,
 *                      countries) + the comparison window priced the way the
 *                      portfolio prices it (same-time cut for a running day),
 *                      assembled with lib/views/portfolio assemblePortfolio so
 *                      the verdict here is the verdict the phone and the
 *                      overview show for this store. Verdict, ledger, KPIs,
 *                      top products and top countries all read this one result.
 *   loadProfitTrail    the 30 days before the window (and today, when the
 *                      window ends yesterday) for the daily chart's context.
 *                      Streams: it is context, not the period's numbers.
 *   loadChargebacks    90-day dispute health (not a property of the period).
 *   loadCampaignSummary the campaign report of lib/data/campaigns for the same
 *                      store and window, with the unified action.
 *
 * The old home ran 16 loaders twice and priced the period four times; each
 * block drifted (a daily chart without Shopify ads, countries at a flat cost,
 * campaign tables on their own 7/30-day windows and the previous store).
 * Everything here is the window the page context resolved (lib/views/page),
 * passed in, never re-derived.
 *
 * Pure helpers (comparisonPlan, trailRanges, chartSeries, storeKpis,
 * topProducts, topCountries, campaignHighlights, chargebackLevel) are tested in
 * __tests__/store.test.ts.
 */

import { query } from '../db'
import { centsOfDollar } from '../format'
import {
  computePnL, computeSameTimeComparison, sumPnL,
  type CountryPnL, type DayPnL, type HourPoint, type PnL, type ProductPnL, type StorePnL,
} from '../engine/pnl'
import { daysBetween, minutesIntoDay, safeTz, shiftDate, todayInTz, type Comparison, type DateRange, type Period } from '../engine/dates'
import { getChargebackHealth, type ChargebackHealth } from '../adjustments'
import { getCampaignReport, type CampaignReport, type CampaignRow } from '../data/campaigns'
import type { CampaignAction } from '../campaignSignal'
import {
  assemblePortfolio,
  type PortfolioStoreInput, type PortfolioStoreRow, type PortfolioView, type StoreComparison,
} from './portfolio'

// ─── Comparison (one store) ──────────────────────────────────────────────────

/**
 * How the comparison window must be priced for ONE store, mirroring
 * lib/views/portfolio loadComparison (which is not exported):
 *  - whole       a closed window: the earlier window, whole days;
 *  - same_time   the window is today: yesterday cut at this minute of the
 *                store's clock (engine computeSameTimeComparison);
 *  - cut_last    several days ending today ("Este mês", a custom range): the
 *                earlier days whole plus the last one cut at this minute.
 * With one store the anchor clock is the store's own, so its window has always
 * started and the comparison is always included.
 */
export type ComparisonPlan =
  | { kind: 'whole'; range: DateRange }
  | { kind: 'same_time'; day: string }
  | { kind: 'cut_last'; lastDay: string; runUp: DateRange | null; cutMinutes: number | null }

export function comparisonPlan(range: DateRange, cmp: Comparison, storeToday: string, minutesNow: number): ComparisonPlan {
  const cutLast = cmp.sameTimeOfDay || range.to >= storeToday
  if (!cutLast) return { kind: 'whole', range: { from: cmp.from, to: cmp.to } }
  if (range.from === range.to && cmp.from === cmp.to && cmp.to === shiftDate(range.to, -1)) {
    return { kind: 'same_time', day: range.to }
  }
  return {
    kind: 'cut_last',
    lastDay: cmp.to,
    runUp: cmp.from < cmp.to ? { from: cmp.from, to: shiftDate(cmp.to, -1) } : null,
    cutMinutes: range.to === storeToday ? minutesNow : null,
  }
}

async function loadStoreComparison(
  store: PortfolioStoreInput, range: DateRange, cmp: Comparison, now: Date,
): Promise<StoreComparison> {
  const tz = safeTz(store.timezone)
  const plan = comparisonPlan(range, cmp, todayInTz(tz, now), minutesIntoDay(tz, now))
  const whole: DateRange = { from: cmp.from, to: cmp.to }
  const id = store.id
  if (plan.kind === 'whole') {
    const p = (await computePnL([id], plan.range, {}, now)).get(id)
    return { included: true, range: whole, cutoffMinutes: null, totals: p?.totals ?? sumPnL([]) }
  }
  if (plan.kind === 'same_time') {
    const p = (await computeSameTimeComparison([id], plan.day, now)).get(id)
    return { included: true, range: whole, cutoffMinutes: p?.cutoffMinutes ?? null, totals: p?.totals ?? sumPnL([]) }
  }
  // The engine only cuts single-day windows: the run-up and the cut last day
  // are priced apart and added.
  const [last, runUp] = await Promise.all([
    computePnL([id], { from: plan.lastDay, to: plan.lastDay }, { cutoffMinutes: { [id]: plan.cutMinutes } }, now),
    plan.runUp ? computePnL([id], plan.runUp, {}, now) : Promise.resolve(new Map<string, StorePnL>()),
  ])
  const parts = [runUp.get(id)?.totals, last.get(id)?.totals].filter((x): x is PnL => !!x)
  return { included: true, range: whole, cutoffMinutes: plan.cutMinutes, totals: sumPnL(parts) }
}

// ─── The summary (verdict, ledger, KPIs, products, countries) ────────────────

export interface StoreWindow {
  period: Period
  /** The window as the page context resolved it (store's own timezone). */
  range: DateRange
  comparison: Comparison
}

export interface StoreSummary {
  store: PortfolioStoreInput
  /** One-store portfolio: feed it to verdictInputFromPortfolio. */
  view: PortfolioView
  /** view.stores[0]. */
  row: PortfolioStoreRow
  /** The window as the engine priced it: totals, daily, hourly (one-day
   *  windows), products, countries. */
  pnl: StorePnL
  /** The comparison window's totals, or null when it has nothing in it (no
   *  orders and no spend), so deltas say "sem comparação" instead of "era $0". */
  previous: PnL | null
  kpis: StoreKpis
  products: TopList<ProductLine>
  countries: TopList<CountryLine>
  /** Currency the shop sells in when it is not USD (the engine reads orders
   *  already converted to dollars; the page says so). */
  sellsIn: string | null
}

/**
 * Everything above the fold of the Resumo, from one engine pass over the
 * window plus the comparison. `win` must be the page context's window.
 */
export async function loadStoreSummary(store: PortfolioStoreInput, win: StoreWindow, now: Date): Promise<StoreSummary> {
  const [current, compared, sellsIn] = await Promise.all([
    computePnL([store.id], win.range, { products: true, countries: true }, now),
    loadStoreComparison(store, win.range, win.comparison, now),
    loadSaleCurrency(store.id).catch(() => null),
  ])
  const pnl = current.get(store.id)
  if (!pnl) throw new Error(`Loja ${store.id} não encontrada no motor`)
  const view = assemblePortfolio({
    stores: [store], period: win.period, range: win.range, comparison: win.comparison,
    anchorTimezone: safeTz(store.timezone), now,
    current, compared: new Map([[store.id, compared]]),
    chargebackHealth: null, liveFeed: [], liveCovered: new Set([store.id]), syncRows: null,
  })
  const row = view.stores[0]
  const prev = compared.totals
  const previous = prev.orders > 0 || prev.adSpend > 0 ? prev : null
  return {
    store, view, row, pnl, previous,
    kpis: storeKpis(pnl.totals, previous, pnl.configured, win.range, pnl.daily),
    products: topProducts(pnl.products ?? [], pnl.totals.revenue),
    countries: topCountries(pnl.countries ?? [], pnl.totals.revenue),
    sellsIn,
  }
}

/** The shop's selling currency when it is not the dollar (Hibikura: JPY). */
async function loadSaleCurrency(storeId: string): Promise<string | null> {
  const rows = await query<{ currency: string }>(
    `SELECT currency FROM shopify_orders
      WHERE tenant_id = $1 AND currency IS NOT NULL
      ORDER BY created_at DESC LIMIT 1`, [storeId])
  const c = rows[0]?.currency?.toUpperCase() ?? null
  return c && c !== 'USD' ? c : null
}

// ─── KPIs ────────────────────────────────────────────────────────────────────

export interface StoreKpis {
  days: number
  revenue: number
  orders: number
  /** Revenue ÷ orders. */
  aov: number | null
  ordersPerDay: number
  /** Store revenue ÷ Meta spend (engine roas). */
  metaRoas: number | null
  /** Which ad spend the ROAS card judges: the only channel that spent, or
   *  both together. With both, revenue ÷ Meta spend would credit Meta with
   *  every sale the Shopify ads brought (Dumpling 8jcp3a: 109× on $56 of Meta
   *  next to $1.796 of Shopify ads), so the card uses all ad spend and says so
   *  — it is never called the Meta ROAS. */
  roasChannel: AdChannel | null
  /** Store revenue ÷ the spend of roasChannel. */
  channelRoas: number | null
  /** Engine break-even (revenue ÷ contribution); null without cost settings,
   *  where the engine's 1.00 would be a fake number. */
  breakEven: number | null
  metaSpend: number
  /** Meta spend per dollar sold, in cents (0..100+). */
  metaCents: number | null
  metaPerDay: number
  shopSpend: number
  shopCents: number | null
  /** Days of the window with Shopify ad spend. */
  shopDays: number
  /** (Meta + Shopify ads) ÷ orders. */
  adCostPerOrder: number | null
  /** (contribution − fixed costs) ÷ orders: what an order leaves to pay for
   *  ads. Null without cost settings (it would just be the ticket). */
  leftBeforeAdsPerOrder: number | null
  /** operatingProfit ÷ orders (NOT halved: halve at render with ctx.part). */
  profitPerOrder: number | null
  margin: number | null
  previous: {
    revenue: number; orders: number; aov: number | null; metaRoas: number | null
    metaSpend: number; shopSpend: number; adCostPerOrder: number | null
    margin: number | null; profitPerOrder: number | null; channelRoas: number | null
  } | null
}

const per = (a: number, b: number): number | null => (b > 0 ? a / b : null)

export type AdChannel = 'meta' | 'shop' | 'both'

/** Below this share of the ad spend, a second channel is a side cost (MOKOO's
 *  $226 of Shopify ads next to $5.624 of Meta) and the ROAS stays the Meta
 *  ROAS the owner reads everywhere; above it, the sales are no longer Meta's
 *  alone and the ROAS is measured on both channels together. */
export const MINOR_CHANNEL_SHARE = 0.1

/** The ad spend a ROAS should be measured on (see StoreKpis.roasChannel). */
export function adChannelOf(t: Pick<PnL, 'metaSpend' | 'shopSpend'>): AdChannel | null {
  const total = t.metaSpend + t.shopSpend
  if (!(total > 0)) return null
  if (t.shopSpend <= 0 || t.shopSpend < total * MINOR_CHANNEL_SHARE) return t.metaSpend > 0 ? 'meta' : 'shop'
  if (t.metaSpend <= 0 || t.metaSpend < total * MINOR_CHANNEL_SHARE) return 'shop'
  return 'both'
}

export function channelRoas(t: Pick<PnL, 'revenue' | 'metaSpend' | 'shopSpend'>): number | null {
  const ch = adChannelOf(t)
  // A minor second channel is left out of the ratio, as the owner reads the
  // Meta ROAS; it is still in the profit.
  const spend = ch === 'both' ? t.metaSpend + t.shopSpend : ch === 'meta' ? t.metaSpend : ch === 'shop' ? t.shopSpend : 0
  return spend > 0 ? t.revenue / spend : null
}

export const CHANNEL_LABEL: Record<AdChannel, string> = { meta: 'Meta', shop: 'Anúncios Shopify', both: 'Meta + Shopify' }

/**
 * Why a CONFIGURED store has no break-even in a window. The engine returns
 * breakEvenRoas = null both without cost settings and when revenue ÷
 * contribution has no answer; components/ui RoasGauge reads every null as
 * "custos não configurados", which sent the owner to a cost page that was
 * already filled in (EPOCH at 03h: $137 of Meta, no order yet, "empate
 * desconhecido → custos não configurados").
 *   no_sales   no revenue in the window: every ad dollar was a loss
 *   no_margin  the sales did not cover product, shipping and fees
 *              (contribution ≤ 0): no ROAS breaks even
 * Null when the break-even is known or the store really has no cost settings.
 */
export type EmpateGap = 'no_sales' | 'no_margin'

export function empateGap(
  configured: boolean, breakEven: number | null, t: Pick<PnL, 'revenue' | 'contribution'>,
): EmpateGap | null {
  if (!configured || (breakEven !== null && breakEven > 0)) return null
  if (!(t.revenue > 0)) return 'no_sales'
  if (t.contribution <= 0) return 'no_margin'
  return null
}

/**
 * Meta and Shopify ads in whole cents of each dollar sold, allocated the way
 * the "Para onde foi cada dólar" ledger next to the KPIs allocates them
 * (components/ui/Breakdown BreakdownLedger: largest remainder over its cost
 * lines plus the profit). Plain rounding put "39¢" in the KPI next to the
 * ledger's "40¢" (Hibikura, 18 nov). Keep the line list in step with the
 * ledger's costParts. Null without revenue.
 */
export function ledgerAdCents(t: PnL, configured: boolean): { meta: number | null; shop: number | null } {
  if (!(t.revenue > 0)) return { meta: null, shop: null }
  const known = (v: number) => (configured ? v : 0)
  const lines: { key: string; v: number }[] = [
    { key: 'cogs', v: known(t.productCost) },
    { key: 'shipping', v: known(t.shipping) },
    { key: 'fees', v: known(t.fees) },
    ...(t.perOrderExtras > 0 ? [{ key: 'extras', v: known(t.perOrderExtras) }] : []),
    { key: 'meta', v: t.metaSpend },
    { key: 'shop', v: t.shopSpend },
    { key: 'fixed', v: known(t.fixedCosts) },
  ]
  const profitBase = configured ? t.operatingProfit : t.revenue - t.adSpend
  const cents = centsOfDollar([...lines.map(l => l.v), Math.max(0, profitBase)], t.revenue)
  const at = (k: string) => cents[lines.findIndex(l => l.key === k)]
  return { meta: at('meta'), shop: at('shop') }
}

export function storeKpis(t: PnL, prev: PnL | null, configured: boolean, range: DateRange, daily: DayPnL[] = []): StoreKpis {
  const days = daysBetween(range.from, range.to)
  return {
    days,
    revenue: t.revenue,
    orders: t.orders,
    aov: per(t.revenue, t.orders),
    ordersPerDay: t.orders / Math.max(1, days),
    metaRoas: t.metaSpend > 0 ? t.roas : null,
    roasChannel: adChannelOf(t),
    channelRoas: channelRoas(t),
    breakEven: configured ? t.breakEvenRoas : null,
    metaSpend: t.metaSpend,
    metaCents: t.revenue > 0 ? (t.metaSpend / t.revenue) * 100 : null,
    metaPerDay: t.metaSpend / Math.max(1, days),
    shopSpend: t.shopSpend,
    shopCents: t.revenue > 0 ? (t.shopSpend / t.revenue) * 100 : null,
    shopDays: daily.filter(d => d.shopSpend > 0).length,
    adCostPerOrder: per(t.adSpend, t.orders),
    leftBeforeAdsPerOrder: configured ? per(t.contribution - t.fixedCosts, t.orders) : null,
    profitPerOrder: configured ? t.profitPerOrder : null,
    margin: configured ? t.margin : null,
    previous: prev ? {
      revenue: prev.revenue, orders: prev.orders, aov: per(prev.revenue, prev.orders),
      metaRoas: prev.metaSpend > 0 ? prev.roas : null,
      channelRoas: adChannelOf(prev) === adChannelOf(t) ? channelRoas(prev) : null,
      metaSpend: prev.metaSpend, shopSpend: prev.shopSpend, adCostPerOrder: per(prev.adSpend, prev.orders),
      margin: configured ? prev.margin : null, profitPerOrder: configured ? prev.profitPerOrder : null,
    } : null,
  }
}

// ─── Top products and countries ──────────────────────────────────────────────

export interface TopList<T> {
  rows: T[]
  /** Everything after the top rows, summed. */
  rest: { count: number; revenue: number; orders: number }
  /** Number of rows with sales. */
  total: number
  /** Share of revenue the top rows cover, %. */
  topShare: number | null
}

export interface ProductLine {
  key: string
  productId: string | null
  title: string
  units: number
  orders: number
  revenue: number
  /** % of the store's revenue. */
  share: number | null
  /** Revenue − the item's product, shipping and fee costs. */
  contribution: number
  contributionMargin: number | null
}

export const TOP_N = 5

export function topProducts(products: ProductPnL[], revenue: number, n = TOP_N): TopList<ProductLine> {
  const sold = products.filter(p => p.units > 0 || p.revenue > 0).sort((a, b) => b.revenue - a.revenue)
  const rows = sold.slice(0, n).map(p => ({
    key: p.key, productId: p.productId, title: p.title || 'Produto sem nome',
    units: p.units, orders: p.orders, revenue: p.revenue,
    share: revenue > 0 ? (p.revenue / revenue) * 100 : null,
    contribution: p.contribution,
    contributionMargin: p.revenue > 0 ? (p.contribution / p.revenue) * 100 : null,
  }))
  const restRows = sold.slice(n)
  const top = rows.reduce((s, r) => s + r.revenue, 0)
  return {
    rows,
    // A product row counts the orders it appears in, so orders of different
    // products overlap; the rest is reported by revenue and count only.
    rest: { count: restRows.length, revenue: restRows.reduce((s, r) => s + r.revenue, 0), orders: 0 },
    total: sold.length,
    topShare: revenue > 0 ? (top / revenue) * 100 : null,
  }
}

export interface CountryLine {
  country: string
  orders: number
  revenue: number
  aov: number | null
  share: number | null
  contribution: number
}

export function topCountries(countries: CountryPnL[], revenue: number, n = TOP_N): TopList<CountryLine> {
  // Shopify orders only: a country Meta reports spend in without a single
  // order is Meta's attribution, not a market.
  const sold = countries.filter(c => c.orders > 0).sort((a, b) => b.revenue - a.revenue || b.orders - a.orders)
  const rows = sold.slice(0, n).map(c => ({
    country: c.country, orders: c.orders, revenue: c.revenue,
    aov: per(c.revenue, c.orders),
    share: revenue > 0 ? (c.revenue / revenue) * 100 : null,
    contribution: c.contribution,
  }))
  const restRows = sold.slice(n)
  const top = rows.reduce((s, r) => s + r.revenue, 0)
  return {
    rows,
    rest: {
      count: restRows.length,
      revenue: restRows.reduce((s, r) => s + r.revenue, 0),
      orders: restRows.reduce((s, r) => s + r.orders, 0),
    },
    total: sold.length,
    topShare: revenue > 0 ? (top / revenue) * 100 : null,
  }
}

// ─── Daily chart: the window with 30 days of context ─────────────────────────

/** Days of context drawn before the window. */
export const TRAIL_DAYS = 30

/**
 * The context around the window: the 30 days before it and, when the window
 * ends yesterday ("7 dias", "Ontem"), today so far — so the chart reaches the
 * present without counting today in the period.
 */
export function trailRanges(range: DateRange, today: string): { before: DateRange; after: DateRange | null } {
  return {
    before: { from: shiftDate(range.from, -TRAIL_DAYS), to: shiftDate(range.from, -1) },
    after: range.to < today && shiftDate(range.to, 1) === today ? { from: today, to: today } : null,
  }
}

export interface ChartDay {
  date: string
  profit: number
  revenue: number
  metaSpend: number
  shopSpend: number
  orders: number
  inWindow: boolean
}

const chartDay = (d: DayPnL, inWindow: boolean): ChartDay => ({
  date: d.date, profit: d.operatingProfit, revenue: d.revenue, metaSpend: d.metaSpend,
  shopSpend: d.shopSpend, orders: d.orders, inWindow,
})

const idle = (d: ChartDay) => d.orders === 0 && d.revenue === 0 && d.metaSpend === 0 && d.shopSpend === 0

/**
 * Before + window + after, oldest first, each date once. Context days before
 * the store had any activity (Hibikura opened on 07/11) are dropped: a row of
 * empty days reads as "sold nothing", which is not what happened. Days inside
 * the window are always kept, empty or not.
 */
export function chartSeries(before: DayPnL[], window: DayPnL[], after: DayPnL[]): ChartDay[] {
  const seen = new Set<string>()
  const out: ChartDay[] = []
  for (const [list, inWindow] of [[before, false], [window, true], [after, false]] as const) {
    for (const d of list) {
      if (seen.has(d.date)) continue
      seen.add(d.date)
      out.push(chartDay(d, inWindow))
    }
  }
  out.sort((a, b) => a.date.localeCompare(b.date))
  const firstActive = out.findIndex(d => d.inWindow || !idle(d))
  return firstActive > 0 ? out.slice(firstActive) : out
}

export interface ProfitTrail {
  before: DayPnL[]
  after: DayPnL[]
  /** Yesterday's whole-day hourly curve, as the reference line of a
   *  one-day window's intraday chart. */
  reference: HourPoint[] | null
}

/**
 * The days around the window, priced by the engine on the store's calendar.
 * Profit per day does not depend on the window it is priced in (refund pricing
 * does, and is not drawn), so these bars line up with the window's own.
 */
export async function loadProfitTrail(storeId: string, range: DateRange, today: string, now: Date): Promise<ProfitTrail> {
  const t = trailRanges(range, today)
  const single = range.from === range.to
  const refDay = shiftDate(range.from, -1)
  const [before, after, ref] = await Promise.all([
    computePnL([storeId], t.before, {}, now),
    t.after ? computePnL([storeId], t.after, {}, now) : Promise.resolve(null),
    single ? computePnL([storeId], { from: refDay, to: refDay }, {}, now) : Promise.resolve(null),
  ])
  return {
    before: before.get(storeId)?.daily ?? [],
    after: after?.get(storeId)?.daily ?? [],
    reference: ref?.get(storeId)?.hourly ?? null,
  }
}

// ─── Refunds and chargebacks ─────────────────────────────────────────────────

/** Shopify Payments' line, as the old screens and the phone already show it:
 *  amber from 1%, coral at 1,5% of orders over 90 days. */
export const CHARGEBACK_WATCH_PCT = 1
export const CHARGEBACK_LIMIT_PCT = 1.5

export type ChargebackLevel = 'none' | 'ok' | 'watch' | 'over'

export function chargebackLevel(h: Pick<ChargebackHealth, 'count' | 'rate'>): ChargebackLevel {
  if (h.count === 0) return 'none'
  if (h.rate >= CHARGEBACK_LIMIT_PCT) return 'over'
  if (h.rate >= CHARGEBACK_WATCH_PCT) return 'watch'
  return 'ok'
}

/**
 * A dispute's evidence deadline on the store's own clock. Postgres hands the
 * timestamptz back as "2026-12-25 23:00:00+00"; slicing the first 10
 * characters gave the UTC date, a day late for a Brazilian store whenever the
 * deadline falls between 00h and 03h UTC (21h–24h in Brasília the day
 * before), which is exactly the deadline a "até" line must not overstate.
 * Null when the value does not parse.
 */
export function dueInTz(dueBy: string, tz: string): { date: string; minutes: number } | null {
  const iso = dueBy.trim().replace(' ', 'T').replace(/([+-]\d{2})$/, '$1:00')
  const at = new Date(iso)
  if (Number.isNaN(at.getTime())) return null
  return { date: todayInTz(tz, at), minutes: minutesIntoDay(tz, at) }
}

export interface ChargebackBlock {
  health: ChargebackHealth
  level: ChargebackLevel
  /** No dispute was ever read for this store: a zero is not proof there were
   *  none (the app may not have permission to read disputes). */
  neverSeen: boolean
}

export async function loadChargebacks(storeId: string): Promise<ChargebackBlock> {
  const [health, seen] = await Promise.all([
    getChargebackHealth(storeId),
    query<{ seen: boolean }>(
      `SELECT EXISTS (SELECT 1 FROM order_adjustments WHERE tenant_id = $1 AND kind = 'chargeback') AS seen`,
      [storeId]).then(r => !!r[0]?.seen),
  ])
  return { health, level: chargebackLevel(health), neverSeen: !seen }
}

// ─── Campaigns ───────────────────────────────────────────────────────────────

export interface CampaignHighlights {
  top: CampaignRow[]
  rest: { count: number; spend: number }
  /** Campaigns with spend in the window. */
  withSpend: number
  actions: Record<CampaignAction, number>
  /** Meta purchase value of the store's own campaigns ÷ store revenue, %. */
  attributedShare: number | null
}

export function campaignHighlights(report: Pick<CampaignReport, 'campaigns' | 'storeRevenue'>, n = TOP_N): CampaignHighlights {
  const spent = report.campaigns.filter(c => c.spend > 0).sort((a, b) => b.spend - a.spend)
  const top = spent.slice(0, n)
  const rest = spent.slice(n)
  const actions: Record<CampaignAction, number> = { escalar: 0, manter: 0, cortar: 0, observar: 0 }
  for (const c of report.campaigns) if (c.decision.action) actions[c.decision.action] += 1
  const own = report.campaigns.filter(c => !c.shared).reduce((s, c) => s + c.purchaseValue, 0)
  return {
    top,
    rest: { count: rest.length, spend: rest.reduce((s, c) => s + c.spend, 0) },
    withSpend: spent.length,
    actions,
    attributedShare: report.storeRevenue > 0 ? (own / report.storeRevenue) * 100 : null,
  }
}

export interface CampaignSummary {
  report: CampaignReport
  highlights: CampaignHighlights
}

/**
 * The campaign report for the page's store and window, with the same action
 * thresholds as /campaigns and the push alerts (the owner's scale threshold),
 * so a badge here never disagrees with the campaigns page.
 */
export async function loadCampaignSummary(
  store: { id: string; timezone: string }, range: DateRange,
  storeNames: ReadonlyMap<string, string>, now: Date,
): Promise<CampaignSummary> {
  // Loaded lazily: lib/alerts pulls the push stack, which this module's pure
  // helpers (and their tests) do not need.
  const { getAlertConfig } = await import('../alerts')
  const cfg = await getAlertConfig()
  const report = await getCampaignReport(
    { id: store.id, timezone: safeTz(store.timezone) }, range,
    { thresholds: { minMargin: cfg.scaleAlerts.threshold }, storeNames, now },
  )
  return { report, highlights: campaignHighlights(report) }
}
