/**
 * The portfolio view: one store or many, one period, every number from the
 * profit engine.
 *
 * This is the payload behind the phone's home screen (GET /api/mobile) and is
 * meant to be reused by the owner's desktop view and the daily summary push.
 * It takes stores the caller has already resolved through lib/access (so it
 * never decides who may see what) and builds everything from ONE computePnL
 * call for the window and ONE for its comparison: the totals are the sum of the
 * store rows, the daily series is the same orders bucketed by date, and the
 * hourly curve is the same orders bucketed by hour. Earlier versions recomputed
 * each block separately and each block drifted from the others (a curve that
 * ended $550 below the headline it sat under, a store that counted $0 because
 * it had no cost settings, a sync stamp from a store nobody was looking at).
 *
 * Calendar rule, decided by the owner: with several stores, every store is
 * measured on the same calendar date in its OWN timezone. Hibikura (Tokyo)
 * therefore shows a whole, already closed day in "Hoje" from noon in Brazil on.
 * Such a store is still in the totals, but it is not plotted on the intraday
 * curve (which is about a day still running) and it is flagged `dayClosed`.
 */

import { query } from '../db'
import {
  computePnL, computeSameTimeComparison, sumPnL, KEPT_ORDER_SQL,
  type HourPoint, type PnL, type StorePnL,
} from '../engine/pnl'
import {
  anchorTz, comparisonRange, eachDay, formatRange, minutesIntoDay, safeTz, shiftDate,
  todayInTz, isIsoDate,
  type Comparison, type DateRange, type Period,
} from '../engine/dates'
import { getChargebackHealth, type ChargebackHealth } from '../adjustments'
import type { StoreRef } from '../access'
import { STALE_AFTER_MIN, staleness } from '../sync/plan'
import { LIVE_FEED_SIZE, resolvePortfolioWindow } from './portfolioLimits'
// verdict imports only types from this module, so this is no import cycle.
import { judgedStores } from './verdict'

// ─── Types (the API contract) ─────────────────────────────────────────────────

/** A store as lib/access returns it; `name` is already disambiguated. */
export type PortfolioStoreInput = Pick<StoreRef, 'id' | 'name' | 'timezone'> & {
  /** Archived stores can be read on request (the "arquivadas" view) but get no
   *  live feed: they are not selling. */
  archived?: boolean
}

/**
 * Where the store's own calendar stands relative to the window.
 *  - running      the window includes the store's current day
 *  - closed       the window ends on the reference clock's today, but that date
 *                 is already over in the store's timezone (Tokyo seen from Brazil
 *                 in the afternoon)
 *  - not_started  the window's dates have not begun yet in the store's timezone
 *  - complete     an ordinary past window
 */
export type DayState = 'running' | 'closed' | 'not_started' | 'complete'

export type BadgeCode =
  | 'sem_custos' | 'dia_encerrado' | 'dia_nao_comecou' | 'sync_atrasado' | 'sync_falhando' | 'sem_webhook'

export interface StoreBadge {
  code: BadgeCode
  /** Short Portuguese label for a chip. */
  label: string
  /** One sentence for a tooltip or a footnote. */
  detail: string
  tone: 'info' | 'warn'
}

export type SyncSource = 'shopify' | 'facebook'

export interface SourceFreshness {
  source: SyncSource
  /** Newest successful run of this store and source (ISO), null when none in 7 days. */
  lastSuccessAt: string | null
  lastAttemptAt: string | null
  /** 'success' | 'error' | 'running' as the collector wrote it. */
  lastStatus: string | null
  /** Minutes from lastSuccessAt to generatedAt. */
  ageMinutes: number | null
  /** Older than the source's cadence allows (STALE_AFTER_MINUTES). */
  stale: boolean
  /** Past the red threshold (lib/sync/plan) and the latest run ended in error
   *  or partial — the top bar's "falhando". */
  failing: boolean
}

export interface StoreFreshness {
  orders: SourceFreshness
  /** Null when the store has no ad sync at all (no facebook runs in 7 days). */
  ads: SourceFreshness | null
  /** Orders arrive by webhook (a live order in the last 30 days). Without it the
   *  live feed falls back to synced orders, up to ~10 minutes late. */
  liveFeed: boolean
  stale: boolean
  failing: boolean
}

export interface StoreComparison {
  /** False when the store has nothing fair to compare with (its window has
   *  not started); its totals are then zero and it is left out of the sum. */
  included: boolean
  range: DateRange
  /** Minutes into the comparison's last day where it was cut to match a day
   *  still running, or null when whole days are compared (Hibikura's closed
   *  day is compared whole against whole). */
  cutoffMinutes: number | null
  totals: PnL
}

export interface PortfolioStoreRow {
  id: string
  name: string
  timezone: string
  archived: boolean
  /** False: no cost settings, so costs are zero and "lucro" is revenue − ads. */
  configured: boolean
  /** The window includes the store's current day. */
  partial: boolean
  dayState: DayState
  /** The store's day is already over while the window is still "today". */
  dayClosed: boolean
  /** The store's own today. */
  storeToday: string
  /** Minutes into the store's day when partial, else 1440. */
  minutesCovered: number
  /** Engine totals (see lib/engine/pnl.ts for every definition). */
  totals: PnL
  comparison: StoreComparison
  badges: StoreBadge[]
  freshness: StoreFreshness
  /** The store's first kept order on its own calendar (YYYY-MM-DD), null when
   *  unknown (no order yet, or not loaded). A window before it is "the store
   *  did not sell yet", not a dead month (lib/views/verdict reads it). */
  firstOrderDate: string | null
}

export interface PortfolioComparison extends DateRange {
  label: string
  /** True when at least one store's comparison was cut at its own current time. */
  sameTimeOfDay: boolean
  /** Sum of the included stores' comparison totals. */
  totals: PnL
}

/** One date of the window, summed over the stores. Sums to `totals`. */
export interface PortfolioDay {
  date: string
  revenue: number
  orders: number
  contribution: number
  metaSpend: number
  shopSpend: number
  adSpend: number
  fixedCosts: number
  operatingProfit: number
  adjustments: number
  cashResult: number
  margin: number | null
  roas: number | null
}

export interface IntradayStoreSeries {
  storeId: string
  name: string
  timezone: string
  /** Hours of the store's own day drawn (24 for a finished day). */
  hoursCovered: number
  points: HourPoint[]
}

/** One hour of the combined curve. Hour h is hour h of each store's own day. */
export interface IntradayPoint {
  hour: number
  revenue: number
  orders: number
  /** Running totals; a store whose clock is behind contributes its last value. */
  cumRevenue: number
  cumProfit: number
  /** Stores whose day has reached this hour. */
  storesReporting: number
}

/** A store beside the curve. Its numbers are for the window's date
 *  (PortfolioIntraday.day), NOT for `storeToday`: Hibikura in "Hoje" at 16h in
 *  Brazil shows its whole, closed Tokyo day 17/11 while its own today is 18/11. */
export interface IntradayAside {
  storeId: string
  name: string
  timezone: string
  /** The store's own current date, to say why it is aside ("já é 18/11 em Tóquio"). */
  storeToday: string
  revenue: number
  orders: number
  /** Meta + Shopify ads (for a store without costs, operatingProfit is
   *  revenue minus this). */
  adSpend: number
  operatingProfit: number
}

export interface PortfolioIntraday {
  day: string
  points: IntradayPoint[]
  stores: IntradayStoreSeries[]
  /** In the totals but not on the curve: their day is already over. */
  closedStores: IntradayAside[]
  /** Left out of a summed curve, as out of the verdict and dailyJudged
   *  (lib/views/verdict judgedStores): no cost settings, so their revenue − ads
   *  is not profit. Shown beside the curve, never folded into it. */
  unconfiguredStores: IntradayAside[]
  /** Not on the curve: their day has not begun. */
  notStartedStores: IntradayAside[]
  peak: { hour: number; profit: number } | null
  /** Equals the sum of the plotted stores' operatingProfit (the judged
   *  stores whose day is running or complete). */
  closing: number
  /** Hour from which the curve stayed at or above zero through the close;
   *  null when it closes below zero. */
  greenSince: number | null
  /** Every plotted store has cost settings. */
  configured: boolean
}

export interface LiveOrderItem {
  storeId: string
  /** Disambiguated store name. */
  store: string
  orderId: string
  orderNumber: string | null
  /** In `currency`: the shop's currency for webhook rows, USD for synced rows. */
  total: number
  currency: string
  country: string | null
  items: { title: string | null; quantity: number | null; price: string | null }[]
  /** When the buyer ordered. */
  placedAt: string | null
  /** When Opero learned of it (equals placedAt for synced rows). */
  receivedAt: string
  /** webhook = seconds after the sale; sync = from the 10-minute order sync, for
   *  stores whose webhook delivered nothing in 30 days. */
  source: 'webhook' | 'sync'
}

export interface StoreAdjustments {
  storeId: string
  name: string
  refunds: number
  refundGross: number
  refundCount: number
  chargebacks: number
  chargebackFees: number
  chargebackCount: number
  adjustments: number
}

export type AwaitingDispute = ChargebackHealth['dueSoon'][number]

/** One store's disputes waiting for evidence (loadAwaiting). */
export interface StoreAwaiting {
  /** Deadline not passed yet (or unknown), soonest first: every one of them. */
  list: AwaitingDispute[]
  /** Still "needs_response" but the deadline already passed. */
  overdue: number
}

/** Ninety-day dispute health. The rate that matters to Shopify Payments is
 *  per store (each store is its own merchant account), hence `byStore`. */
export interface PortfolioChargebackHealth extends ChargebackHealth {
  byStore: { storeId: string; name: string; count: number; orders: number; rate: number; open: number; amount: number }[]
  /** Every dispute that can still be answered, soonest deadline first: the
   *  whole list, not the first rows (getChargebackHealth reads 5 per store,
   *  and the phone showed 4 of 12 under a heading that read as the to-do list). */
  dueSoon: (AwaitingDispute & { storeId: string; store: string })[]
  /** dueSoon counted per store, most first; its sum is dueSoon.length. */
  awaitingByStore: { storeId: string; name: string; count: number }[]
  /** Disputes still waiting for evidence whose deadline already passed. */
  overdue: number
}

export interface PortfolioFreshness {
  generatedAt: string
  /** Oldest "last success" among the shown stores' expected sources. */
  oldestSuccessAt: string | null
  newestSuccessAt: string | null
  staleStores: { storeId: string; name: string; sources: SyncSource[]; failing: boolean }[]
  storesWithoutLiveFeed: { storeId: string; name: string }[]
}

export interface PortfolioView {
  generatedAt: string
  period: Period
  /** The window, as dates on the anchor clock; each store reads the same dates
   *  in its own timezone. */
  range: DateRange
  rangeLabel: string
  /** Set when a custom range was cut to fit (portfolioLimits: longer than
   *  MAX_WINDOW_DAYS, or starting before MIN_WINDOW_DATE): one sentence saying
   *  what is shown. Null otherwise. */
  rangeNote: string | null
  /** The store's own timezone for one store, America/Sao_Paulo for several. */
  anchorTimezone: string
  anchorToday: string
  storeIds: string[]
  /** Sum of the store rows (engine definitions, see lib/engine/pnl.ts). */
  totals: PnL
  /** Every store has cost settings. */
  configured: boolean
  unconfiguredStoreIds: string[]
  comparison: PortfolioComparison
  /** Every store, summed by date (revenue − ads for a store without costs). */
  daily: PortfolioDay[]
  /** The same days for the stores the verdict sums (lib/views/verdict
   *  judgedStores): when some stores of several have no cost settings, only
   *  the configured ones, so bars drawn under the verdict add up to its
   *  amount instead of mixing in revenue − ads. Otherwise equal to `daily`. */
  dailyJudged: PortfolioDay[]
  /** Only for single-day windows. */
  intraday: PortfolioIntraday | null
  stores: PortfolioStoreRow[]
  /** Stores where refunds or chargebacks arrived in the window, biggest first. */
  adjustmentsByStore: StoreAdjustments[]
  /** Last 90 days of disputes (not a property of the period). Null when not
   *  requested or on failure. */
  chargebackHealth: PortfolioChargebackHealth | null
  liveFeed: LiveOrderItem[]
  freshness: PortfolioFreshness
}

/** Which of the non-P&L blocks to load (all by default). */
export interface PortfolioIncludes {
  liveFeed?: boolean
  chargebackHealth?: boolean
  freshness?: boolean
}

export class PortfolioInputError extends Error {}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

/** When a source is late: the thresholds of lib/sync/plan STALE_AFTER_MIN,
 *  the same the desktop top bar judges with (lib/sync/status), so a store is
 *  never "atrasada" on the phone and current on the desktop, or the reverse.
 *  Amber there = stale here; red with a failed last run = failing. */
export const STALE_AFTER_MINUTES: Record<SyncSource, number> = {
  shopify: STALE_AFTER_MIN.shopify[0], facebook: STALE_AFTER_MIN.facebook[0],
}
export { LIVE_FEED_SIZE }

const CITY: Record<string, string> = {
  'Asia/Tokyo': 'Tóquio', 'America/Sao_Paulo': 'São Paulo', 'America/Belem': 'Belém',
  'America/Los_Angeles': 'Los Angeles', 'America/New_York': 'Nova York', 'Europe/London': 'Londres',
  'Europe/Lisbon': 'Lisboa', UTC: 'UTC',
}

export function cityOfTz(tz: string): string {
  return Object.hasOwn(CITY, tz) ? CITY[tz] : (tz.split('/').pop() ?? tz).replace(/_/g, ' ')
}

const ddmm = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}`

export function dayStateOf(range: DateRange, storeToday: string, anchorToday: string): DayState {
  if (range.from > storeToday) return 'not_started'
  if (range.to >= storeToday) return 'running'
  return range.to === anchorToday ? 'closed' : 'complete'
}

export interface SyncRow {
  tenant_id: string
  source: string
  last_success: Date | string | null
  last_started: Date | string | null
  last_status: string | null
}

const iso = (v: Date | string | null | undefined): string | null => {
  if (!v) return null
  const d = v instanceof Date ? v : new Date(v)
  return Number.isNaN(d.getTime()) ? null : d.toISOString()
}

export function sourceFreshness(source: SyncSource, row: SyncRow | undefined, now: Date): SourceFreshness {
  const lastSuccessAt = iso(row?.last_success)
  const ageMinutes = lastSuccessAt ? Math.max(0, Math.round((now.getTime() - Date.parse(lastSuccessAt)) / 60000)) : null
  // Judged on the exact age, like the top bar (the rounded minutes are for
  // display). No success in the 7 days read is late, not unknown: the store
  // is synced and nothing arrived.
  const level = lastSuccessAt ? staleness(source, new Date(lastSuccessAt), now) : 'red'
  const stale = level === 'amber' || level === 'red'
  const lastStatus = row?.last_status ?? null
  return {
    source, lastSuccessAt, lastAttemptAt: iso(row?.last_started), lastStatus, ageMinutes,
    stale, failing: level === 'red' && (lastStatus === 'error' || lastStatus === 'partial'),
  }
}

/** One store's freshness from its own runs only: another store's fresh sync
 *  must never make this one look current. */
export function storeFreshness(storeId: string, rows: SyncRow[], liveFeed: boolean, now: Date): StoreFreshness {
  const mine = rows.filter(r => r.tenant_id === storeId)
  const orders = sourceFreshness('shopify', mine.find(r => r.source === 'shopify'), now)
  const fb = mine.find(r => r.source === 'facebook')
  // A store with no ad runs at all has nothing to be stale about.
  const ads = fb ? sourceFreshness('facebook', fb, now) : null
  return {
    orders, ads, liveFeed,
    stale: orders.stale || (ads?.stale ?? false),
    failing: orders.failing || (ads?.failing ?? false),
  }
}

function unknownFreshness(liveFeed: boolean): StoreFreshness {
  const unknown = (source: SyncSource): SourceFreshness => ({
    source, lastSuccessAt: null, lastAttemptAt: null, lastStatus: null, ageMinutes: null, stale: false, failing: false,
  })
  return { orders: unknown('shopify'), ads: null, liveFeed, stale: false, failing: false }
}

function ageText(minutes: number | null): string {
  if (minutes === null) return 'sem sincronização nos últimos 7 dias'
  if (minutes < 120) return `há ${minutes} min`
  if (minutes < 48 * 60) return `há ${Math.round(minutes / 60)} h`
  return `há ${Math.round(minutes / 1440)} dias`
}

export function badgesFor(
  row: Pick<PortfolioStoreRow, 'configured' | 'dayState' | 'timezone' | 'freshness'> & { archived?: boolean }, range: DateRange,
): StoreBadge[] {
  const out: StoreBadge[] = []
  if (!row.configured) {
    out.push({
      code: 'sem_custos', label: 'Custos não configurados', tone: 'warn',
      detail: 'Sem custos de produto, frete e taxas: o lucro desta loja é só receita menos anúncios.',
    })
  }
  const city = cityOfTz(row.timezone)
  if (row.dayState === 'closed') {
    out.push({
      code: 'dia_encerrado', label: 'Dia encerrado', tone: 'info',
      detail: `O dia ${ddmm(range.to)} já terminou em ${city}: estes são os números do dia inteiro.`,
    })
  } else if (row.dayState === 'not_started') {
    out.push({
      code: 'dia_nao_comecou', label: 'Dia não começou', tone: 'info',
      detail: `Em ${city} ainda não é ${ddmm(range.from)}.`,
    })
  }
  // An archived store is not synced any more: its age is expected, not news.
  if (row.archived) return out
  const f = row.freshness
  const lagging = [f.orders, f.ads].filter((s): s is SourceFreshness => !!s && s.stale)
  if (lagging.length) {
    const what = lagging.map(s => `${s.source === 'shopify' ? 'pedidos' : 'anúncios'} ${ageText(s.ageMinutes)}`).join(', ')
    out.push(f.failing
      ? { code: 'sync_falhando', label: 'Sincronização falhando', tone: 'warn', detail: `Última atualização: ${what}. A última tentativa deu erro.` }
      : { code: 'sync_atrasado', label: 'Dados atrasados', tone: 'warn', detail: `Última atualização: ${what}.` })
  }
  if (!f.liveFeed) {
    out.push({
      code: 'sem_webhook', label: 'Sem vendas ao vivo', tone: 'info',
      detail: 'Esta loja não avisa vendas na hora: os pedidos aparecem com a sincronização, até 10 minutos depois.',
    })
  }
  return out
}

function dayPoint(date: string, p: PnL): PortfolioDay {
  return {
    date, revenue: p.revenue, orders: p.orders, contribution: p.contribution,
    metaSpend: p.metaSpend, shopSpend: p.shopSpend, adSpend: p.adSpend, fixedCosts: p.fixedCosts,
    operatingProfit: p.operatingProfit, adjustments: p.adjustments, cashResult: p.cashResult,
    margin: p.margin, roas: p.roas,
  }
}

/** Hour from which a cumulative curve stayed at or above zero through its end
 *  (the last crossing, not the first non-negative hour). */
export function greenSinceOf(points: { hour: number; cumProfit: number }[]): number | null {
  if (!points.length || points[points.length - 1].cumProfit < 0) return null
  let lastNegative = -1
  points.forEach((p, i) => { if (p.cumProfit < 0) lastNegative = i })
  return points[lastNegative + 1].hour
}

/**
 * Sum several stores' hourly curves by hour of each store's own day. A store
 * whose clock is behind (fewer hours covered) holds its last value, so the
 * last point is exactly the sum of the plotted stores' profit.
 */
export function combineIntraday(series: IntradayStoreSeries[]): IntradayPoint[] {
  const hours = series.reduce((m, s) => Math.max(m, s.points.length), 0)
  const out: IntradayPoint[] = []
  for (let h = 0; h < hours; h++) {
    const pt: IntradayPoint = { hour: h, revenue: 0, orders: 0, cumRevenue: 0, cumProfit: 0, storesReporting: 0 }
    for (const s of series) {
      if (!s.points.length) continue
      if (h < s.points.length) {
        pt.revenue += s.points[h].revenue
        pt.orders += s.points[h].orders
        pt.storesReporting += 1
      }
      const k = Math.min(h, s.points.length - 1)
      pt.cumRevenue += s.points[k].cumRevenue
      pt.cumProfit += s.points[k].cumProfit
    }
    out.push(pt)
  }
  return out
}

/** Several stores' 90-day dispute health, summed. The rate is recomputed from
 *  the summed counts: averaging rates would let a store with four orders weigh
 *  as much as one with four thousand. */
export function combineHealth(
  each: { store: PortfolioStoreInput; health: ChargebackHealth; awaiting?: StoreAwaiting }[],
): PortfolioChargebackHealth {
  const sum = { count: 0, orders: 0, amount: 0, fees: 0, open: 0, lost: 0, won: 0, overdue: 0 }
  for (const { health: h, awaiting } of each) {
    sum.count += h.count; sum.orders += h.orders; sum.amount += h.amount; sum.fees += h.fees
    sum.open += h.open; sum.lost += h.lost; sum.won += h.won
    sum.overdue += awaiting?.overdue ?? 0
  }
  // The complete list when it was loaded; health.dueSoon (5 rows per store)
  // only as a fallback for callers that did not load it.
  const listOf = (e: (typeof each)[number]) => e.awaiting?.list ?? e.health.dueSoon
  return {
    ...sum,
    rate: sum.orders > 0 ? (sum.count / sum.orders) * 100 : 0,
    dueSoon: each
      .flatMap(e => listOf(e).map(d => ({ ...d, storeId: e.store.id, store: e.store.name })))
      .sort((a, b) => (a.dueBy ?? '9999').localeCompare(b.dueBy ?? '9999')),
    awaitingByStore: each
      .map(e => ({ storeId: e.store.id, name: e.store.name, count: listOf(e).length }))
      .filter(a => a.count > 0)
      .sort((a, b) => b.count - a.count),
    hasData: each.some(e => e.health.hasData),
    byStore: each
      .filter(e => e.health.count > 0)
      .map(({ store, health: h }) => ({
        storeId: store.id, name: store.name, count: h.count, orders: h.orders, rate: h.rate, open: h.open, amount: h.amount,
      }))
      .sort((a, b) => b.rate - a.rate),
  }
}

// ─── Assembly (pure) ──────────────────────────────────────────────────────────

export interface PortfolioInputs {
  stores: readonly PortfolioStoreInput[]
  period: Period
  range: DateRange
  comparison: Comparison
  anchorTimezone: string
  now: Date
  current: Map<string, StorePnL>
  compared: Map<string, StoreComparison>
  chargebackHealth: PortfolioChargebackHealth | null
  liveFeed: LiveOrderItem[]
  /** Stores whose webhook delivered in the last 30 days. */
  liveCovered: Set<string>
  /** Null when freshness was not loaded (or failed): every store then reads
   *  as unknown rather than as stale. */
  syncRows: SyncRow[] | null
  /** Each store's first kept order on its own calendar (loadFirstOrderDates).
   *  Optional: without it every row's firstOrderDate is null and the verdict
   *  reads a window before the store opened as "sem vendas". */
  firstOrderDates?: ReadonlyMap<string, string>
  /** rangeCutNote of the window, when buildPortfolio had to cut it. */
  rangeNote?: string | null
}

const presentOnly = <T>(x: T | undefined): x is T => x !== undefined

/** Everything after the queries. Pure: same inputs, same view. */
export function assemblePortfolio(i: PortfolioInputs): PortfolioView {
  const anchorToday = todayInTz(i.anchorTimezone, i.now)
  const rows: PortfolioStoreRow[] = []
  const pnlOf = new Map<string, StorePnL>()

  for (const s of i.stores) {
    const p = i.current.get(s.id)
    if (!p) continue // a store that no longer exists has nothing to show
    pnlOf.set(s.id, p)
    const tz = safeTz(p.store.timezone || s.timezone)
    const storeToday = todayInTz(tz, i.now)
    const dayState = dayStateOf(i.range, storeToday, anchorToday)
    const freshness = i.syncRows
      ? storeFreshness(s.id, i.syncRows, i.liveCovered.has(s.id), i.now)
      : unknownFreshness(i.liveCovered.has(s.id))
    const comparison = i.compared.get(s.id) ?? {
      included: false, range: { from: i.comparison.from, to: i.comparison.to }, cutoffMinutes: null, totals: sumPnL([]),
    }
    const row: PortfolioStoreRow = {
      id: s.id, name: s.name, timezone: tz, archived: s.archived ?? p.store.archived,
      configured: p.configured, partial: p.partial,
      dayState, dayClosed: dayState === 'closed', storeToday, minutesCovered: p.minutesCovered,
      totals: p.totals, comparison, badges: [], freshness,
      firstOrderDate: i.firstOrderDates?.get(s.id) ?? null,
    }
    row.badges = badgesFor(row, i.range)
    rows.push(row)
  }

  const totals = sumPnL(rows.map(r => r.totals))
  const included = rows.filter(r => r.comparison.included)
  const comparisonTotals = sumPnL(included.map(r => r.comparison.totals))

  // Daily: the same per-store days, summed by date. Every date is present, so
  // a day with spend and no sales still pulls the line down.
  const dailyOf = (list: PortfolioStoreRow[]) => eachDay(i.range.from, i.range.to).map(date => {
    const lines = list.map(r => pnlOf.get(r.id)!.daily.find(d => d.date === date)).filter(presentOnly)
    return dayPoint(date, sumPnL(lines))
  })
  const daily = dailyOf(rows)
  const { judged } = judgedStores(rows)
  const dailyJudged = judged.length === rows.length ? daily : dailyOf(judged)

  let intraday: PortfolioIntraday | null = null
  if (i.range.from === i.range.to) {
    const aside = (r: PortfolioStoreRow): IntradayAside => ({
      storeId: r.id, name: r.name, timezone: r.timezone, storeToday: r.storeToday,
      revenue: r.totals.revenue, orders: r.totals.orders, adSpend: r.totals.adSpend, operatingProfit: r.totals.operatingProfit,
    })
    // The owner chose "each store on its own day": a store whose day already
    // closed is reported beside the curve, never folded into hours it did not
    // live through. And the curve sums the stores the verdict sums: a store
    // without costs entered it as revenue − ads, so on 14 nov it ended at
    // $1.298 (peak $1.312) under a verdict and ledger of $1.362.
    const judgedIds = new Set(judged.map(r => r.id))
    const plotted = rows.filter(r => judgedIds.has(r.id) && (r.dayState === 'running' || r.dayState === 'complete'))
    const series: IntradayStoreSeries[] = plotted.map(r => {
      const points = pnlOf.get(r.id)!.hourly ?? []
      return { storeId: r.id, name: r.name, timezone: r.timezone, hoursCovered: points.length, points }
    })
    const points = combineIntraday(series)
    const peak = points.reduce<{ hour: number; profit: number } | null>(
      (best, p) => (best === null || p.cumProfit > best.profit ? { hour: p.hour, profit: p.cumProfit } : best), null)
    intraday = {
      day: i.range.from,
      points,
      stores: series,
      closedStores: rows.filter(r => judgedIds.has(r.id) && r.dayState === 'closed').map(aside),
      notStartedStores: rows.filter(r => judgedIds.has(r.id) && r.dayState === 'not_started').map(aside),
      unconfiguredStores: rows.filter(r => !judgedIds.has(r.id)).map(aside),
      peak,
      closing: points.length ? points[points.length - 1].cumProfit : 0,
      greenSince: greenSinceOf(points),
      configured: plotted.every(r => r.configured),
    }
  }

  const adjustmentsByStore: StoreAdjustments[] = rows
    .filter(r => r.totals.adjustments > 0)
    .map(r => ({
      storeId: r.id, name: r.name,
      refunds: r.totals.refunds, refundGross: r.totals.refundGross, refundCount: r.totals.refundCount,
      chargebacks: r.totals.chargebacks, chargebackFees: r.totals.chargebackFees,
      chargebackCount: r.totals.chargebackCount, adjustments: r.totals.adjustments,
    }))
    .sort((a, b) => b.adjustments - a.adjustments)

  const live = rows.filter(r => !r.archived)
  const successes = live.flatMap(r => [r.freshness.orders.lastSuccessAt, r.freshness.ads?.lastSuccessAt ?? null])
    .filter((x): x is string => !!x)
    .sort()
  const generatedAt = i.now.toISOString()

  return {
    generatedAt,
    period: i.period,
    range: i.range,
    rangeLabel: formatRange(i.range, anchorToday),
    rangeNote: i.rangeNote ?? null,
    anchorTimezone: i.anchorTimezone,
    anchorToday,
    storeIds: rows.map(r => r.id),
    totals,
    configured: rows.every(r => r.configured),
    unconfiguredStoreIds: rows.filter(r => !r.configured).map(r => r.id),
    comparison: {
      from: i.comparison.from, to: i.comparison.to, label: i.comparison.label,
      sameTimeOfDay: included.some(r => r.comparison.cutoffMinutes !== null),
      totals: comparisonTotals,
    },
    daily,
    dailyJudged,
    intraday,
    stores: rows,
    adjustmentsByStore,
    chargebackHealth: i.chargebackHealth,
    liveFeed: i.liveFeed,
    freshness: {
      generatedAt,
      oldestSuccessAt: successes[0] ?? null,
      newestSuccessAt: successes[successes.length - 1] ?? null,
      staleStores: live.filter(r => r.freshness.stale).map(r => ({
        storeId: r.id, name: r.name, failing: r.freshness.failing,
        sources: [r.freshness.orders, r.freshness.ads]
          .filter((s): s is SourceFreshness => !!s && s.stale).map(s => s.source),
      })),
      storesWithoutLiveFeed: live.filter(r => !r.freshness.liveFeed).map(r => ({ storeId: r.id, name: r.name })),
    },
  }
}

// ─── Loading ──────────────────────────────────────────────────────────────────

/**
 * The comparison window, priced per store on its own clock.
 *  - One day that is today: yesterday cut at each store's current minute
 *    (computeSameTimeComparison). A store whose day already closed is
 *    compared whole day against whole day.
 *  - Several days ending today ("Este mês", a custom range): the earlier
 *    window with its last day cut the same way.
 *  - Anything else: whole days.
 */
async function loadComparison(
  stores: readonly PortfolioStoreInput[], range: DateRange, cmp: Comparison, anchorToday: string, now: Date,
): Promise<Map<string, StoreComparison>> {
  const ids = stores.map(s => s.id)
  const out = new Map<string, StoreComparison>()
  const tzOf = new Map(stores.map(s => [s.id, safeTz(s.timezone)]))
  // A store whose window has not begun has no "same time" to compare with.
  const notStarted = (id: string) => range.from > todayInTz(tzOf.get(id) ?? 'UTC', now)
  const whole: DateRange = { from: cmp.from, to: cmp.to }
  const put = (id: string, included: boolean, cutoffMinutes: number | null, totals: PnL) =>
    out.set(id, { included, range: whole, cutoffMinutes: included ? cutoffMinutes : null, totals: included ? totals : sumPnL([]) })

  const cutLast = cmp.sameTimeOfDay || range.to >= anchorToday
  if (!cutLast) {
    for (const [id, p] of await computePnL(ids, whole, {}, now)) put(id, true, null, p.totals)
    return out
  }

  if (range.from === range.to && cmp.from === cmp.to && cmp.to === shiftDate(range.to, -1)) {
    for (const [id, p] of await computeSameTimeComparison(ids, range.to, now)) {
      put(id, !notStarted(id), p.cutoffMinutes, p.totals)
    }
    return out
  }

  // Several days, the last one cut: the engine only cuts single-day windows, so
  // the run-up and the last day are priced apart and added.
  const cut: Record<string, number | null> = {}
  for (const [id, tz] of tzOf) cut[id] = todayInTz(tz, now) === range.to ? minutesIntoDay(tz, now) : null
  const [lastDay, runUp] = await Promise.all([
    computePnL(ids, { from: cmp.to, to: cmp.to }, { cutoffMinutes: cut }, now),
    cmp.from < cmp.to
      ? computePnL(ids, { from: cmp.from, to: shiftDate(cmp.to, -1) }, {}, now)
      : Promise.resolve(new Map<string, StorePnL>()),
  ])
  for (const id of ids) {
    if (!runUp.has(id) && !lastDay.has(id)) continue
    const parts = [runUp.get(id)?.totals, lastDay.get(id)?.totals].filter(presentOnly)
    put(id, !notStarted(id), cut[id] ?? null, sumPnL(parts))
  }
  return out
}

interface LiveRow {
  tenant_id: string; order_id: string; order_number: string | null; total: number; currency: string | null
  country_code: string | null; line_items: unknown; created_at: Date | null; received_at: Date
}
interface SyncedRow {
  tenant_id: string; order_id: string; order_number: string | null; total: number
  country_code: string | null; items: unknown; created_at: Date
}

function lineItems(raw: unknown): LiveOrderItem['items'] {
  if (!Array.isArray(raw)) return []
  return raw.map(r => {
    const x = (r ?? {}) as Record<string, unknown>
    return {
      title: x.title == null ? null : String(x.title),
      quantity: x.quantity == null ? null : Number(x.quantity),
      price: x.price == null ? null : String(x.price),
    }
  })
}

/**
 * The newest sales of these stores. Webhook rows (live_orders) arrive seconds
 * after the sale; a store whose webhook delivered nothing in 30 days (Hibikura,
 * Glooty and CAMP HALLOW today) would otherwise never appear, so its newest
 * synced orders stand in, marked as such.
 */
async function loadLiveFeed(
  ids: string[], nameOf: Map<string, string>,
): Promise<{ items: LiveOrderItem[]; covered: Set<string> }> {
  if (!ids.length) return { items: [], covered: new Set() }
  const [live, coveredRows] = await Promise.all([
    query<LiveRow>(
      `SELECT tenant_id, order_id, order_number, total_price::float8 AS total, currency, country_code,
              line_items, created_at, received_at
         FROM live_orders
        WHERE tenant_id = ANY($1::text[])
        ORDER BY received_at DESC
        LIMIT ${LIVE_FEED_SIZE}`, [ids]),
    query<{ tenant_id: string }>(
      `SELECT DISTINCT tenant_id FROM live_orders
        WHERE tenant_id = ANY($1::text[]) AND received_at > now() - interval '30 days'`, [ids]),
  ])
  const covered = new Set(coveredRows.map(r => r.tenant_id))
  const uncovered = ids.filter(id => !covered.has(id))
  const synced = uncovered.length
    ? await query<SyncedRow>(
        // Items are matched by Shopify's order id, which is global.
        `SELECT o.tenant_id, o.order_id, o.order_number::text AS order_number, o.total_price::float8 AS total,
                o.country_code, o.created_at,
                COALESCE((SELECT json_agg(json_build_object('title', oi.product_title, 'quantity', oi.quantity) ORDER BY oi.id)
                            FROM shopify_order_items oi WHERE oi.order_id = o.order_id), '[]'::json) AS items
           FROM shopify_orders o
          WHERE o.tenant_id = ANY($1::text[])
            AND o.created_at > now() - interval '7 days'
            AND ${KEPT_ORDER_SQL}
          ORDER BY o.created_at DESC
          LIMIT ${LIVE_FEED_SIZE}`, [uncovered])
    : []

  const items: LiveOrderItem[] = [
    ...live.map(r => ({
      storeId: r.tenant_id, store: nameOf.get(r.tenant_id) ?? r.tenant_id,
      orderId: r.order_id, orderNumber: r.order_number, total: Number(r.total) || 0,
      currency: r.currency || 'USD', country: r.country_code, items: lineItems(r.line_items),
      placedAt: iso(r.created_at), receivedAt: iso(r.received_at) ?? new Date(0).toISOString(),
      source: 'webhook' as const,
    })),
    ...synced.map(r => {
      const at = iso(r.created_at) ?? new Date(0).toISOString()
      return {
        storeId: r.tenant_id, store: nameOf.get(r.tenant_id) ?? r.tenant_id,
        orderId: r.order_id, orderNumber: r.order_number ? `#${r.order_number}` : null,
        // shopify_orders.total_price is already in dollars (its currency
        // column keeps the shop's own, e.g. JPY).
        total: Number(r.total) || 0, currency: 'USD', country: r.country_code,
        items: lineItems(r.items), placedAt: at, receivedAt: at, source: 'sync' as const,
      }
    }),
  ]
  items.sort((a, b) => (b.placedAt ?? b.receivedAt).localeCompare(a.placedAt ?? a.receivedAt))
  return { items: items.slice(0, LIVE_FEED_SIZE), covered }
}

/** Newest run per store and source over the last week. */
async function loadSyncRows(ids: string[]): Promise<SyncRow[]> {
  if (!ids.length) return []
  return query<SyncRow>(
    `SELECT tenant_id, source,
            MAX(finished_at) FILTER (WHERE status = 'success') AS last_success,
            MAX(started_at) AS last_started,
            (ARRAY_AGG(status ORDER BY started_at DESC))[1] AS last_status
       FROM sync_runs
      WHERE tenant_id = ANY($1::text[])
        AND source IN ('shopify', 'facebook')
        AND started_at > now() - interval '7 days'
      GROUP BY 1, 2`, [ids])
}

/**
 * Each store's first kept order, as a date on the store's own calendar — the
 * same timezone and the same "kept" rule the engine dates orders with
 * (lib/engine/pnl loadOrders), so "começou a vender em 7 nov" is the first day
 * the engine has a sale on. Stores with no order are absent. Exported for
 * one-store callers that assemble the view themselves (lib/views/store).
 */
export async function loadFirstOrderDates(ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  // MIN(created_at) first, then the conversion: the date is monotonic in the
  // instant, and the plain MIN can walk the (tenant_id, created_at) index.
  const rows = await query<{ tenant_id: string; d: string | null }>(
    `SELECT o.tenant_id,
            (MIN(o.created_at) AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date::text AS d
       FROM shopify_orders o
       JOIN tenants t ON t.id = o.tenant_id
      WHERE o.tenant_id = ANY($1::text[])
        AND ${KEPT_ORDER_SQL}
      GROUP BY o.tenant_id, t.timezone`, [[...ids]])
  return new Map(rows.filter(r => isIsoDate(r.d)).map(r => [r.tenant_id, r.d as string]))
}

/**
 * Every chargeback of these stores still waiting for evidence ("needs_response"),
 * split into the ones that can still be answered (deadline ahead or unknown,
 * soonest first) and a count of those whose deadline passed. One query for all
 * stores; getChargebackHealth's dueSoon stops at 5 rows per store, which hid
 * EPOCH's fifth dispute and, after the cross-store cut, MOKOO's.
 */
async function loadAwaiting(ids: readonly string[]): Promise<Map<string, StoreAwaiting>> {
  const out = new Map<string, StoreAwaiting>(ids.map(id => [id, { list: [], overdue: 0 }]))
  if (!ids.length) return out
  const rows = await query<{
    tenant_id: string; external_id: string; amount: number; currency: string | null; reason: string | null
    due: string | null; overdue: boolean
  }>(
    `SELECT tenant_id, external_id, amount::float8 AS amount, currency, reason,
            evidence_due_by::text AS due,
            (evidence_due_by IS NOT NULL AND evidence_due_by <= now()) AS overdue
       FROM order_adjustments
      WHERE tenant_id = ANY($1::text[]) AND kind = 'chargeback' AND status = 'needs_response'
      ORDER BY evidence_due_by NULLS LAST, external_id`, [[...ids]])
  for (const r of rows) {
    const a = out.get(r.tenant_id)
    if (!a) continue
    if (r.overdue) { a.overdue += 1; continue }
    a.list.push({
      externalId: r.external_id, amount: Number(r.amount) || 0, currency: r.currency || 'USD',
      reason: r.reason ?? 'general', dueBy: r.due,
    })
  }
  return out
}

async function loadHealth(stores: readonly PortfolioStoreInput[]): Promise<PortfolioChargebackHealth> {
  const [each, awaiting] = await Promise.all([
    Promise.all(stores.map(async store => ({ store, health: await getChargebackHealth(store.id) }))),
    loadAwaiting(stores.map(s => s.id)),
  ])
  return combineHealth(each.map(e => ({ ...e, awaiting: awaiting.get(e.store.id) })))
}

/**
 * Build the portfolio view for `stores` (already access-checked by the caller:
 * pass every active store for "Todas"; archived ones only in their own view).
 * Viewer-independent — the names are whatever lib/access labelled them.
 *
 * @throws PortfolioInputError for a custom period without two valid dates.
 */
export async function buildPortfolio(
  stores: readonly PortfolioStoreInput[],
  period: Period,
  from?: string | null,
  to?: string | null,
  now: Date = new Date(),
  include: PortfolioIncludes = {},
): Promise<PortfolioView> {
  if (period === 'custom' && !(isIsoDate(from) && isIsoDate(to))) {
    throw new PortfolioInputError('Escolha a data inicial e a final')
  }
  const want = { liveFeed: true, chargebackHealth: true, freshness: true, ...include }
  const unique = [...new Map(stores.map(s => [s.id, s])).values()]
  const ids = unique.map(s => s.id)
  const anchor = anchorTz(unique.map(s => s.timezone))
  const anchorToday = todayInTz(anchor, now)
  // A custom range is cut the way the desktop pages cut it (portfolioLimits):
  // ?from=1990-01-01 priced 13.470 days per store, plus a 1953–1989 comparison.
  const { range, note: rangeNote } = resolvePortfolioWindow(period, anchor, from, to, now)
  const cmp = comparisonRange(period, range, anchor, now)
  const nameOf = new Map(unique.map(s => [s.id, s.name]))
  // Archived stores are not selling: no feed, and no "missing webhook" noise.
  const feedIds = unique.filter(s => !s.archived).map(s => s.id)

  const noFeed = { items: [] as LiveOrderItem[], covered: new Set<string>(ids) }
  const [current, compared, chargebackHealth, feed, syncRows, firstOrderDates] = await Promise.all([
    computePnL(ids, range, {}, now),
    ids.length ? loadComparison(unique, range, cmp, anchorToday, now) : Promise.resolve(new Map<string, StoreComparison>()),
    // These blocks are context, not the P&L: a failure must not blank the screen.
    want.chargebackHealth && ids.length
      ? loadHealth(unique).catch(err => { console.error('[portfolio] chargeback health', err); return null })
      : Promise.resolve(null),
    want.liveFeed
      ? loadLiveFeed(feedIds, nameOf)
          .then(f => ({ items: f.items, covered: new Set([...f.covered, ...ids.filter(id => !feedIds.includes(id))]) }))
          .catch(err => { console.error('[portfolio] live feed', err); return noFeed })
      : Promise.resolve(noFeed),
    want.freshness
      ? loadSyncRows(ids).catch(err => { console.error('[portfolio] sync runs', err); return null })
      : Promise.resolve(null),
    // Wording only ("começou a vender em 7 nov"): without it the verdict
    // falls back to "sem vendas", never to wrong numbers.
    loadFirstOrderDates(ids).catch(err => { console.error('[portfolio] first orders', err); return new Map<string, string>() }),
  ])

  return assemblePortfolio({
    stores: unique, period, range, comparison: cmp, anchorTimezone: anchor, now,
    current, compared, chargebackHealth,
    liveFeed: feed.items, liveCovered: feed.covered, syncRows, firstOrderDates, rangeNote,
  })
}
