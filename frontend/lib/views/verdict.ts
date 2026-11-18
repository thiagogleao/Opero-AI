/**
 * The verdict: the sentence every page opens with ("A MOKOO lucrou nos últimos
 * 7 dias — mas menos do que nos 7 dias anteriores."), its chips, the big
 * number and two or three plain lines that say why.
 *
 * Shared by the desktop site (server components) and the phone (a client
 * component reading /api/mobile), so this module is PURE and client-safe: it
 * imports only types from the engine and the portfolio view, plus the pure
 * calendar helpers of lib/engine/dates.
 *
 * Honesty rules it enforces (from the owner's brief):
 *  - A store without cost settings is judged on revenue − ads and says so;
 *    in a sum of several stores it is left OUT of the amount and named.
 *  - No sales is "sem vendas", never a fake $0.
 *  - A young day or a handful of orders is "cedo demais para julgar" — but
 *    past 04h a day whose ads already cost more than its sales is a loss,
 *    whatever the order count (adsAboveSales).
 *  - Every comparison says exactly what it compares ("vs ontem até esta hora").
 *  - The partner split halves money results only, never margins or ROAS.
 *
 * Entry points:
 *   buildVerdict(input)                    any number of stores, any period
 *   verdictInputFromPortfolio(view, opts)  adapter from buildPortfolio()
 *   storeStatus(store, opts)               one chip for a store row in a list
 *   roasSummary(roas, breakEven, facts)    "ROAS 1,95× · empate 1,58× → no lucro"
 *   storeRoas(totals, configured)          the same on the store's ad channel
 *   judgedStores(stores) / isIdle(totals)  which stores a sum is made of
 */

import type { PnL } from '../engine/pnl'
import type { DateRange, Period } from '../engine/dates'
import { daysBetween, minutesIntoDay } from '../engine/dates'
import type { PortfolioStoreRow, PortfolioView, DayState } from './portfolio'
import {
  dayOfLabel, formatClock, formatDate, formatDuration, formatMoney, formatPct, formatRangeLabel,
  formatRoas, monthLong, plural, readablePctChange, tzCity,
} from '../format'
import { adChannelOf, channelRoas, channelSpend, CHANNEL_LABEL, ROAS_LABEL, type AdChannel } from './adChannel'
// Pure (no React): the RoasGauge and this module word a missing break-even
// the same way.
import { breakEvenReason, reasonText, REASON_WORDS, type BreakEvenReason } from '../../components/ui/roasReason'

// ─── Thresholds ──────────────────────────────────────────────────────────────

/** Below 15 cents of profit per dollar sold the margin is "fina". */
export const THIN_MARGIN_PCT = 15
/** Fewer orders than this is too few to judge a window. */
export const MIN_ORDERS = 5
/** Before 04h00 of the store's day, a day is too young to judge. */
export const EARLY_DAY_MINUTES = 240

/**
 * The ads alone already cost more than everything sold (ROAS under 1×): a
 * loss whatever the products cost, since every break-even is above 1×. A
 * running day past its early hours in this state is "no prejuízo" even with a
 * handful of orders — like the same day with no order at all. "Cedo demais"
 * hid EPOCH's −$511 at 14h15 (2 orders, $227 sold, $698 of ads) while a
 * smaller loss with no sale was flagged. Few orders only soften a verdict
 * whose money is still in play.
 */
export function adsAboveSales(t: Pick<PnL, 'revenue' | 'adSpend'>): boolean {
  return t.adSpend > 0 && t.revenue < t.adSpend
}
/** A change within ±5% is "quase o mesmo". */
const SAME_BAND_PCT = 5
/** What the partner split keeps of a money result. */
export const SPLIT_SHARE = 0.5

// ─── Types ───────────────────────────────────────────────────────────────────

export type VerdictTone = 'pos' | 'neg' | 'warn' | 'neu'
export type ChipTone = 'pos' | 'neg' | 'warn' | 'neu' | 'info' | 'cfg'
export type ChipIcon = 'up' | 'down' | 'diamond' | 'ring' | 'clock' | 'sliders' | 'alert' | 'check'
export type ChipCode =
  | 'lucro' | 'prejuizo' | 'margem_fina' | 'cedo' | 'poucos_pedidos' | 'sem_custos'
  | 'sem_vendas' | 'parcial' | 'dia_fuso' | 'comecando'

export interface VerdictChip {
  code: ChipCode
  label: string
  tone: ChipTone
  icon: ChipIcon
}

/** A line of plain text with emphasised runs (rendered by <RichLine>). */
export interface VerdictLine {
  parts: { text: string; strong?: boolean; tone?: 'pos' | 'neg' | 'warn' }[]
  /** The same line as plain text (for push notifications, the AI, tests). */
  text: string
}

/** One store as the verdict needs it. PortfolioStoreRow satisfies it. */
export interface VerdictStore {
  id: string
  name: string
  timezone: string
  configured: boolean
  totals: PnL
  /** The same store in the comparison window; `included: false` when it has
   *  nothing fair to compare with (its window had not started). */
  comparison: { included: boolean; totals: PnL } | null
  /** The window includes the store's current day. */
  partial: boolean
  /** Minutes into the store's day when partial, else 1440. */
  minutesCovered: number
  dayState: DayState
  /** The store's first order, on its own calendar (YYYY-MM-DD); null or
   *  absent when unknown. A window that ends before it is "the store did not
   *  sell yet", not a dead month. */
  firstOrderDate?: string | null
}

export interface VerdictInput {
  /** One store = a store verdict; several = a portfolio verdict. */
  stores: VerdictStore[]
  period: Period
  /** The window, on the anchor clock. */
  range: DateRange
  /** Today on the anchor clock (YYYY-MM-DD). */
  today: string
  /** The store's timezone for one store, America/Sao_Paulo for several. */
  anchorTimezone: string
  /** Minutes into the anchor's day, for "parcial · até 13h38" with several
   *  stores. Defaults to the latest running store's clock. */
  anchorMinutes?: number
  /** The comparison window and its exact label from comparisonRange(). */
  comparison: { from: string; to: string; label: string; sameTimeOfDay: boolean } | null
  /** Subject of a several-store sentence ("As lojas", "Suas lojas"). */
  subject?: string
  /** Partner view: money results are halved (never margins or ROAS). */
  split?: boolean
}

export interface RoasSummary {
  roas: number
  /** The break-even it was judged against; null when there is none to use. */
  breakEven: number | null
  /** pos: at or above break-even; neg: below it, or a loss whatever the ROAS
   *  (no sales, no margin); unknown: no cost settings or no known cause. */
  state: 'pos' | 'neg' | 'unknown'
  /** Why there is no break-even (components/ui/roasReason): no_costs is only
   *  one of the causes. Null when there is one (breakEven set) or when the
   *  cause is not known (breakEven null, text "empate desconhecido"). */
  reason: BreakEvenReason | null
  /** "ROAS 1,95× · empate 1,58× → no lucro",
   *  "ROAS 0,00× · sem empate → nenhuma venda no período: todo o gasto foi prejuízo". */
  text: string
  // ── Filled by buildVerdict for its one-store ROAS box (not by roasSummary):
  /** The ad spend the ROAS divides by (lib/views/adChannel adChannelOf): the
   *  same spend the break-even sentence talks about. */
  channel?: AdChannel
  /** "ROAS do Meta", "ROAS dos Anúncios Shopify", "ROAS dos anúncios (Meta + Shopify)". */
  label?: string
  /** The spend of `channel`. */
  spend?: number
  /** One plain sentence for under the gauge, in the channel's words. */
  explain?: string
}

/** What the ROAS box needs to know about the store to say why a break-even
 *  is missing (components/ui/roasReason BreakEvenFacts). */
export interface RoasFacts {
  configured?: boolean
  revenue?: number | null
  contribution?: number | null
  reason?: BreakEvenReason | null
}

export interface ExcludedStore {
  id: string
  name: string
  revenue: number
  adSpend: number
  /** Revenue − ads (halved when split). */
  revenueMinusAds: number
}

export interface Verdict {
  tone: VerdictTone
  chips: VerdictChip[]
  /** "10–16 nov · vs 7 dias anteriores (3–9 nov)". */
  when: string
  /** The serif sentence. */
  headline: string
  /** The big number (already halved when split); null when there is nothing
   *  to show (no sales, no spend). */
  amount: number | null
  amountTone: 'pos' | 'neg' | 'neu'
  /** "de lucro real, depois de todos os custos". */
  amountCaption: string
  /** Two or three plain lines: the money story and what is left out. */
  details: VerdictLine[]
  /** Fine print about the clock and timezones ("Faltam 10h18 para o dia
   *  fechar.", "A Hibikura entra com o dia de Tóquio, que já fechou."). */
  notes: VerdictLine[]
  /** What the amount is: real profit, revenue − ads, or nothing. */
  basis: 'profit' | 'revenue_minus_ads' | 'none'
  /** The P&L the verdict judged (configured stores of a sum; NOT halved).
   *  Feed it to <BreakdownLedger> so the ledger and the amount agree. */
  totals: PnL
  /** The same stores in the comparison window, or null. */
  comparisonTotals: PnL | null
  /** Stores without cost settings left out of a several-store amount. */
  excluded: ExcludedStore[]
  /** One store with ad spend: the ROAS of its ad channel (storeRoas) against
   *  its own break-even, with the channel, its label and the plain sentence. */
  roas: RoasSummary | null
  /** A running day too young (or with too few orders) to judge: the tone is
   *  neutral on purpose. */
  early: boolean
  /** A closed window with fewer than MIN_ORDERS orders (keeps its verdict,
   *  adds the "Poucos pedidos para julgar" chip). */
  fewOrders: boolean
  partial: boolean
  split: boolean
  storeCount: number
}

// ─── Small helpers ───────────────────────────────────────────────────────────

const RATIO_KEYS = new Set(['margin', 'contributionMargin', 'breakEvenRoas', 'roas', 'metaRoas', 'profitPerOrder'])

/**
 * Sum several stores' P&L. Every additive figure is added; the ratios are
 * recomputed with the engine's definitions (lib/engine/pnl.ts derive). This
 * copy exists only because pnl.ts loads the database and this module must
 * run in the browser.
 */
export function sumTotals(list: PnL[]): PnL {
  const out: Record<string, number | null> = {}
  const keys = list.length ? Object.keys(list[0]) : []
  for (const k of keys) {
    if (RATIO_KEYS.has(k)) continue
    out[k] = list.reduce((s, p) => s + (Number((p as unknown as Record<string, unknown>)[k]) || 0), 0)
  }
  const n = (k: string) => (out[k] as number) ?? 0
  const revenue = n('revenue')
  const contribution = n('contribution')
  out.margin = revenue > 0 ? (n('operatingProfit') / revenue) * 100 : null
  out.contributionMargin = revenue > 0 ? (contribution / revenue) * 100 : null
  out.breakEvenRoas = contribution > 0 ? revenue / contribution : null
  out.roas = n('metaSpend') > 0 ? revenue / n('metaSpend') : null
  out.metaRoas = n('metaSpend') > 0 ? n('metaPurchaseValue') / n('metaSpend') : null
  out.profitPerOrder = n('orders') > 0 ? n('operatingProfit') / n('orders') : null
  return out as unknown as PnL
}

/**
 * Which stores a verdict sums. A lone store is judged as it is; in a sum,
 * only the stores with cost settings when some have them (an unconfigured
 * store's revenue − ads is not profit and would inflate or deflate the total:
 * it is named in a line instead). Exported so the series drawn under the
 * verdict (lib/views/portfolio dailyJudged) follow the same rule.
 */
export function judgedStores<T extends { configured: boolean }>(stores: readonly T[]): { judged: T[]; excluded: T[] } {
  const configured = stores.filter(s => s.configured)
  const sumOnlyConfigured = stores.length > 1 && configured.length > 0 && configured.length < stores.length
  return sumOnlyConfigured
    ? { judged: configured, excluded: stores.filter(s => !s.configured) }
    : { judged: [...stores], excluded: [] }
}

/** Nothing happened in the window: no order, no sale, no ad spend, no refund
 *  or chargeback and no fixed cost. Such a store adds nothing to a sum. */
export function isIdle(t: Pick<PnL, 'orders' | 'revenue' | 'adSpend' | 'adjustments' | 'fixedCosts'>): boolean {
  const zero = (v: number) => !(Math.abs(v) >= 0.005)
  return t.orders === 0 && zero(t.revenue) && zero(t.adSpend) && zero(t.adjustments) && zero(t.fixedCosts)
}

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const line = (...parts: (string | { text: string; strong?: boolean; tone?: 'pos' | 'neg' | 'warn' })[]): VerdictLine => {
  const ps = parts.map(p => (typeof p === 'string' ? { text: p } : p))
  return { parts: ps, text: ps.map(p => p.text).join('') }
}
const strong = (text: string, tone?: 'pos' | 'neg' | 'warn') => ({ text, strong: true, tone })

/**
 * "subiram 12%" / "caíram $480": how a revenue or spend figure (never halved)
 * moved. In percent when the percentage means something (format
 * readablePctChange), in dollars over a tiny base or a huge jump. Null when
 * there is no base or it barely moved.
 */
function moved(cur: number, prev: number, up: string, down: string): string | null {
  if (!(prev > 0)) return null
  const pct = readablePctChange(cur, prev)
  if (pct !== null) return Math.abs(pct) >= 1 ? `${pct >= 0 ? up : down} ${formatPct(Math.abs(pct), { digits: 0 })}` : null
  const d = cur - prev
  return Math.abs(d) >= 0.5 ? `${d >= 0 ? up : down} ${formatMoney(Math.abs(d))}` : null
}

/**
 * What each dollar sold left (margin ≥ 0) or lacked to break even, in words
 * that agree: "Sobraram 12 centavos", "Sobrou 1 centavo", "Sobrou menos de 1
 * centavo" (a 0,32% margin read "Sobraram 0 centavos" beside "lucrou"),
 * "Faltaram $2,25" past a dollar (not "225 centavos").
 */
export function perDollarLine(marginPct: number, inProfit: boolean): VerdictLine {
  const c = Math.round(Math.abs(marginPct))
  const cents = (n: number) => `${n} ${n === 1 ? 'centavo' : 'centavos'}`
  if (inProfit) {
    if (c < 1) return line('Sobrou ', strong('menos de 1 centavo de cada dólar vendido'), '.')
    return line(c === 1 ? 'Sobrou ' : 'Sobraram ', strong(`${cents(c)} de cada dólar vendido`), '.')
  }
  if (c < 1) return line('Faltou ', strong('menos de 1 centavo em cada dólar vendido', 'neg'), ' para empatar.')
  if (c < 100) return line(c === 1 ? 'Faltou ' : 'Faltaram ', strong(`${cents(c)} em cada dólar vendido`, 'neg'), ' para empatar.')
  // pt-BR keeps the singular below 2 ("Faltou $1,40").
  return line(c < 200 ? 'Faltou ' : 'Faltaram ', strong(`${formatMoney(c / 100, { cents: 'always' })} em cada dólar vendido`, 'neg'), ' para empatar.')
}

/** "MOKOO e Glooty", "MOKOO, EPOCH e Glooty". */
function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}

/** "nos últimos 7 dias", "hoje", "neste mês", "em 10–16 nov". */
export function periodPhrase(period: Period, range: DateRange, today: string): string {
  switch (period) {
    case 'today': return 'hoje'
    case 'yesterday': return 'ontem'
    case '7d': return 'nos últimos 7 dias'
    case '14d': return 'nos últimos 14 dias'
    case '30d': return 'nos últimos 30 dias'
    case '90d': return 'nos últimos 90 dias'
    case 'mtd': return 'neste mês'
    case 'lastmonth': return 'no mês passado'
    default:
      if (range.from === range.to) return range.from === today ? 'hoje' : `em ${formatDate(range.from, today)}`
      return `em ${formatRangeLabel(range, today)}`
  }
}

/** The comparison as a phrase after "do que": "nos 7 dias anteriores",
 *  "ontem até esta hora", "no mês anterior". Built from the engine's exact
 *  label so the sentence never claims a different base than the chip. */
export function comparisonPhrase(label: string): string {
  if (label === 'ontem até esta hora') return 'ontem até esta hora'
  if (label === 'dia anterior') return 'no dia anterior'
  if (label === 'mês anterior') return 'no mês anterior'
  if (/^mesmos dias/.test(label)) return `nos ${label}`
  if (/dias anteriores$/.test(label)) return `nos ${label}`
  return `em ${label}`
}

/** "vs 7 dias anteriores (3–9 nov)", "vs ontem até esta hora". */
export function comparisonText(c: { from: string; to: string; label: string; sameTimeOfDay: boolean }, today: string): string {
  if (c.label === 'ontem até esta hora') return 'vs ontem até esta hora'
  return `vs ${c.label} (${formatRangeLabel({ from: c.from, to: c.to }, today)})`
}

/**
 * "ROAS 1,95× · empate 1,58× → no lucro". A missing break-even is said for
 * what it is, with the RoasGauge's words (components/ui/roasReason): no cost
 * settings, no sales (every ad dollar a loss), sales that did not cover
 * product, shipping and fees, or — with no facts given — just "empate
 * desconhecido". It used to read "custos não configurados" for every null,
 * sending the owner to a cost page that was already filled in.
 */
export function roasSummary(roas: number, breakEven: number | null, facts: RoasFacts = {}): RoasSummary {
  const reason = breakEvenReason({ breakEven, ...facts })
  if (reason !== null || breakEven === null) {
    const why = reason ?? 'unknown'
    return {
      // An unknown cause is not a reason: a caller without facts must not
      // override a gauge that has them (VerdictCard forwards `reason`).
      roas, breakEven: null, reason: why === 'unknown' ? null : why, state: REASON_WORDS[why].tone === 'neg' ? 'neg' : 'unknown',
      text: `ROAS ${formatRoas(roas)} · ${reasonText(why)}`,
    }
  }
  const state = roas >= breakEven ? 'pos' : 'neg'
  return {
    roas, breakEven, state, reason: null,
    text: `ROAS ${formatRoas(roas)} · empate ${formatRoas(breakEven)} → ${state === 'pos' ? 'no lucro' : 'no prejuízo'}`,
  }
}

/**
 * The one-store ROAS box: measured on the ad spend lib/views/adChannel picks
 * (Meta, Anúncios Shopify, or both together), so the ROAS and the break-even
 * sentence talk about the same money. It was revenue ÷ Meta spend only, next
 * to a profit that also paid for Shopify ads (Dumpling 8jcp3a: 109× on $56 of
 * Meta beside $1.796 of Shopify ads) — and a store with only Shopify ads got
 * no box at all. Null without ad spend.
 */
export function storeRoas(t: PnL, configured: boolean): RoasSummary | null {
  const channel = adChannelOf(t)
  const value = channelRoas(t)
  if (!channel || value === null) return null
  const s = roasSummary(value, configured ? t.breakEvenRoas : null, { configured, revenue: t.revenue, contribution: t.contribution })
  const spend = channelSpend(t, channel)
  return { ...s, channel, label: ROAS_LABEL[channel], spend, explain: roasExplain(s, channel, t) }
}

function roasExplain(s: RoasSummary, channel: AdChannel, t: PnL): string {
  if (s.reason !== null || s.breakEven === null) return REASON_WORDS[s.reason ?? 'unknown'].explain
  const per = formatMoney(s.roas, { cents: 'always' })
  const lead = channel === 'meta'
    ? `Cada $1 no Meta trouxe ${per} em vendas da loja (todas as vendas, não só as que o Meta atribui a si).`
    : channel === 'shop'
      ? `Cada $1 em Anúncios Shopify trouxe ${per} em vendas da loja (todas as vendas, não só as que a Shopify atribui aos anúncios).`
      : `Cada $1 em anúncios (Meta e Shopify somados) trouxe ${per} em vendas da loja.`
  const below = ` Abaixo de ${formatMoney(s.breakEven, { cents: 'always' })} a loja passa a perder dinheiro com os anúncios.`
  // A minor second channel (under 10% of the ad spend) is outside the ratio
  // but inside the profit: say so, or the gauge reads as all the ad money.
  const minor = channel === 'meta' && t.shopSpend > 0 ? { what: CHANNEL_LABEL.shop, spend: t.shopSpend }
    : channel === 'shop' && t.metaSpend > 0 ? { what: CHANNEL_LABEL.meta, spend: t.metaSpend }
      : null
  const aside = minor ? ` Os ${formatMoney(minor.spend)} de ${minor.what} ficam fora deste ROAS (menos de 10% do gasto em anúncios), mas entram no lucro.` : ''
  return lead + below + aside
}

const CHIP: Record<ChipCode, Omit<VerdictChip, 'code' | 'label'> & { label: string }> = {
  lucro: { label: 'No lucro', tone: 'pos', icon: 'up' },
  prejuizo: { label: 'No prejuízo', tone: 'neg', icon: 'down' },
  margem_fina: { label: 'Margem fina', tone: 'warn', icon: 'diamond' },
  cedo: { label: 'Cedo demais para julgar', tone: 'neu', icon: 'clock' },
  poucos_pedidos: { label: 'Poucos pedidos para julgar', tone: 'neu', icon: 'ring' },
  sem_custos: { label: 'Custos não configurados', tone: 'cfg', icon: 'sliders' },
  sem_vendas: { label: 'Sem vendas no período', tone: 'neu', icon: 'ring' },
  parcial: { label: 'parcial', tone: 'info', icon: 'clock' },
  dia_fuso: { label: 'dia de', tone: 'info', icon: 'clock' },
  comecando: { label: 'começando', tone: 'info', icon: 'clock' },
}
const chip = (code: ChipCode, label?: string): VerdictChip => ({ code, ...CHIP[code], label: label ?? CHIP[code].label })

// ─── The verdict ─────────────────────────────────────────────────────────────

export function buildVerdict(input: VerdictInput): Verdict {
  const stores = input.stores
  const single = stores.length === 1
  const split = !!input.split
  const k = split ? SPLIT_SHARE : 1
  const money = (v: number) => formatMoney(v)

  const { judged, excluded: excludedStores } = judgedStores(stores)
  const withCosts = judged.length > 0 && judged.every(s => s.configured)
  // A store with nothing in the window adds nothing to the sum: "6 lojas na
  // soma" with CAMP HALLOW idle overstated what the amount is made of.
  const idleStores = single ? [] : judged.filter(s => isIdle(s.totals))
  const nStores = judged.length - idleStores.length

  const totals = sumTotals(judged.map(s => s.totals))
  const cmpJudged = judged.filter(s => s.comparison?.included)
  const comparisonTotals = input.comparison && cmpJudged.length ? sumTotals(cmpJudged.map(s => s.comparison!.totals)) : null
  const comparable = !!comparisonTotals && (comparisonTotals.orders > 0 || comparisonTotals.adSpend > 0)

  // Without cost settings the engine's costs are zero, so its "profit" is
  // already revenue − ads − 0; saying so explicitly keeps the intent clear.
  const resultOf = (p: PnL) => (withCosts ? p.operatingProfit : p.revenue - p.adSpend)
  const noSales = totals.orders === 0 && totals.revenue <= 0
  const spent = totals.adSpend > 0
  const basis: Verdict['basis'] = noSales && !spent && withCosts ? 'none' : withCosts ? 'profit' : 'revenue_minus_ads'
  // A window that ends before the store's first order is not a dead month:
  // Hibikura's October read "não teve vendas no mês passado" for a store that
  // only started selling on 7 nov.
  const firstOrder = single ? stores[0].firstOrderDate ?? null : null
  const beforeStart = !!firstOrder && noSales && !spent && input.range.to < firstOrder

  const rawAmount = resultOf(totals)
  const amount = noSales && !spent ? null : rawAmount * k

  // Clock: the store's own for one store, the anchor's for several.
  const running = judged.filter(s => s.partial)
  const partial = running.length > 0
  const minutes = single
    ? stores[0].minutesCovered
    : input.anchorMinutes ?? (running.length ? Math.max(...running.map(s => s.minutesCovered)) : 1440)
  const orders = totals.orders
  // Only a window that IS the running day can be "too young": in "Este mês"
  // at 02h00 the young clock is one sliver of a month already sold.
  const singleDay = input.range.from === input.range.to
  const runningDay = partial && singleDay
  const earlyDay = runningDay && minutes < EARLY_DAY_MINUTES
  // A day still running with a young clock or a handful of orders cannot be
  // judged — unless its ads already cost more than it sold (adsAboveSales):
  // that loss is real however few the orders. Any other window with few
  // orders is still what happened (money lost is lost): it keeps its verdict
  // and gets a "poucos pedidos" chip.
  const lossAlready = runningDay && !earlyDay && !noSales && orders < MIN_ORDERS && adsAboveSales(totals)
  const early = runningDay && !noSales && (earlyDay || (orders < MIN_ORDERS && !lossAlready))
  const fewOrders = !runningDay && !noSales && orders < MIN_ORDERS
  const margin = totals.margin
  const thin = basis === 'profit' && rawAmount > 0 && margin !== null && margin < THIN_MARGIN_PCT

  // ── Chips
  const chips: VerdictChip[] = []
  if (noSales) {
    if (beforeStart) chips.push(chip('comecando', `Vende desde ${formatDate(firstOrder!, input.today)}`))
    else if (spent && !earlyDay) chips.push(chip('prejuizo'))
    else if (spent) chips.push(chip('cedo'))
    else chips.push(chip('sem_vendas', partial ? 'Sem vendas ainda' : 'Sem vendas no período'))
  } else if (early) {
    chips.push(chip('cedo'))
  } else if (basis === 'revenue_minus_ads') {
    // Revenue below ad spend is a loss whatever the product costs are.
    if (rawAmount < 0) chips.push(chip('prejuizo'))
  } else {
    chips.push(rawAmount >= 0 ? chip('lucro') : chip('prejuizo'))
    if (thin) chips.push(chip('margem_fina'))
  }
  if (basis === 'revenue_minus_ads') chips.push(chip('sem_custos'))
  if (excludedStores.length) {
    chips.push(chip('sem_custos', excludedStores.length === 1 ? '1 loja sem custos' : `${excludedStores.length} lojas sem custos`))
  }
  if (fewOrders) chips.push(chip('poucos_pedidos'))
  if (partial) chips.push(chip('parcial', `parcial · até ${formatClock(minutes)}`))
  const fuso = single ? dayOfLabel(stores[0].timezone) : null
  if (fuso) chips.push(chip('dia_fuso', fuso))

  // ── Tone
  let tone: VerdictTone
  if (noSales) tone = spent && !earlyDay ? 'neg' : 'neu'
  else if (early) tone = 'neu'
  else if (rawAmount < 0) tone = 'neg'
  else if (basis === 'revenue_minus_ads' || thin) tone = 'warn'
  else tone = 'pos'

  // ── Headline
  const P = periodPhrase(input.period, input.range, input.today)
  const subject = single ? `A ${stores[0].name}` : (input.subject ?? 'As lojas')
  const pl = !single
  const city = single && fuso ? tzCity(stores[0].timezone) : null
  const cmp = input.comparison
  const cp = cmp ? comparisonPhrase(cmp.label) : ''

  let headline: string
  if (beforeStart) {
    const span = input.period === 'lastmonth' ? monthLong(input.range.from)
      : input.range.from === input.range.to ? formatDate(input.range.from, input.today)
        : formatRangeLabel(input.range, input.today)
    headline = `${subject} começou a vender em ${formatDate(firstOrder!, input.today)} — não há dados de ${span}.`
  } else if (noSales) {
    if (spent) {
      headline = partial
        ? `${subject} ainda não ${pl ? 'venderam' : 'vendeu'} ${P}, e já ${pl ? 'gastaram' : 'gastou'} ${money(totals.adSpend)} em anúncios.`
        : `${subject} ${pl ? 'gastaram' : 'gastou'} ${money(totals.adSpend)} em anúncios e não ${pl ? 'venderam' : 'vendeu'} nada ${P}.`
    } else {
      headline = partial
        ? `${subject} ainda não ${pl ? 'venderam' : 'vendeu'} ${P}.`
        : `${subject} não ${pl ? 'tiveram' : 'teve'} vendas ${P}.`
    }
  } else if (early) {
    const what = `${plural(orders, 'pedido', 'pedidos')} e ${money(Math.abs(rawAmount * k))} de ${rawAmount >= 0 ? (basis === 'profit' ? 'lucro' : 'sobra') : (basis === 'profit' ? 'prejuízo' : 'falta')}`
    headline = earlyDay
      ? `${city ? `Em ${city} o dia` : 'O dia'} acabou de começar. Por enquanto, ${what}.`
      : `Ainda é pouco para julgar ${P}: por enquanto, ${what}.`
  } else if (basis === 'revenue_minus_ads') {
    headline = rawAmount < 0
      ? partial
        ? `${subject} ${pl ? 'estão gastando' : 'está gastando'} mais em anúncios do que ${pl ? 'vendem' : 'vende'} ${P}.`
        : `${subject} ${pl ? 'gastaram' : 'gastou'} mais em anúncios do que ${pl ? 'venderam' : 'vendeu'} ${P}.`
      : `${subject} ${pl ? 'venderam' : 'vendeu'} ${money(totals.revenue)} ${P}, mas sem o custo dos produtos não dá para dizer se ${pl ? 'lucraram' : 'lucrou'}.`
  } else {
    const inProfit = rawAmount >= 0
    const verb = partial
      ? `${pl ? 'estão' : 'está'} ${inProfit ? 'no lucro' : 'no prejuízo'}`
      : inProfit ? (pl ? 'lucraram juntas' : 'lucrou') : (pl ? 'tiveram prejuízo juntas' : 'teve prejuízo')
    let clause = ''
    if (cmp && comparisonTotals && comparable) {
      const prev = resultOf(comparisonTotals)
      const cur = rawAmount
      if (cur > 0 && prev > 0) {
        const ch = ((cur - prev) / prev) * 100
        clause = ch > SAME_BAND_PCT ? ` — e mais do que ${cp}` : ch < -SAME_BAND_PCT ? ` — mas menos do que ${cp}` : ` — quase o mesmo que ${cp}`
      } else if (cur >= 0 && prev < 0) {
        clause = ` — depois de prejuízo ${cp}`
      } else if (cur < 0 && prev > 0) {
        clause = ` — depois de lucrar ${cp}`
      } else if (cur < 0 && prev < 0) {
        clause = cur < prev ? ` — e pior do que ${cp}` : ` — mas menos do que ${cp}`
      }
    }
    headline = `${subject} ${verb} ${P}${clause}.`
  }
  headline = cap(headline)

  // ── Amount caption
  let amountCaption: string
  if (amount === null) {
    amountCaption = beforeStart ? 'a loja ainda não vendia nesse período' : partial ? 'nenhum pedido até agora' : 'nenhum pedido no período'
  } else if (basis === 'revenue_minus_ads') {
    amountCaption = 'de receita menos anúncios, sem o custo dos produtos'
  } else if (noSales) {
    amountCaption = 'de prejuízo: anúncios sem nenhuma venda'
  } else {
    const word = rawAmount >= 0 ? 'lucro' : 'prejuízo'
    amountCaption = partial
      ? `de ${word} real até agora, depois de todos os custos`
      : single
        ? `de ${word} real, depois de todos os custos`
        : `de ${word} real somando ${plural(nStores, 'loja', 'lojas')}`
  }
  if (split && amount !== null) amountCaption += ' · sua parte (50%)'

  // ── Details: the money story, by priority; the top three, in this order.
  const cand: { p: number; l: VerdictLine }[] = []
  if (excludedStores.length) {
    const ex = excludedStores
    const rma = ex.reduce((s, x) => s + (x.totals.revenue - x.totals.adSpend), 0) * k
    const idle = ex.every(x => x.totals.revenue <= 0 && x.totals.adSpend <= 0)
    const verb = ` ${ex.length === 1 ? 'fica' : 'ficam'} fora da soma: sem custos configurados`
    cand.push({
      p: 100,
      l: idle
        ? line(strong(joinNames(ex.map(s => s.name))), `${verb} (sem vendas nem anúncios no período).`)
        : line(strong(joinNames(ex.map(s => s.name))), `${verb} (receita − anúncios: `, strong(money(rma), rma < 0 ? 'neg' : undefined), ').'),
    })
  }
  if (beforeStart) {
    cand.push({ p: 99, l: line('Escolha um período a partir de ', strong(formatDate(firstOrder!, input.today)), ' para ver o resultado.') })
  }
  // Money can leave with no sale in the window: refunds and chargebacks of
  // older orders. "Sem vendas" alone hid CAMP HALLOW's −$343 of chargebacks
  // while the ledger beside it ended in "Resultado de caixa −$343".
  if (noSales && totals.adjustments >= 0.005) {
    const lead = spent ? 'E' : 'Mas'
    const out = strong(`${money(-totals.adjustments * k)} no caixa`, 'neg')
    const what = [
      totals.refundCount > 0 ? plural(totals.refundCount, 'reembolso', 'reembolsos') : null,
      totals.chargebackCount > 0 ? plural(totals.chargebackCount, 'chargeback', 'chargebacks') : null,
    ].filter((x): x is string => x !== null)
    const n = totals.refundCount + totals.chargebackCount
    cand.push({
      p: 97,
      l: what.length
        ? line(`${lead} ${n === 1 ? 'chegou' : 'chegaram'} ${joinNames(what)}: `, out, '.')
        : line(`${lead} reembolsos e chargebacks tiraram `, out, '.'),
    })
  }
  if (early) {
    cand.push({ p: 95, l: line(`Com ${plural(orders, 'pedido', 'pedidos')}, o resultado de hoje ainda não diz nada. Para decidir, olhe ontem e os últimos 7 dias.`) })
  }
  if (lossAlready) {
    // Spend and sales are never halved: only the profit is the partner's.
    cand.push({
      p: 95,
      l: line('Os anúncios já custaram ', strong(money(totals.adSpend)), ' e as vendas somam ', strong(money(totals.revenue)),
        ` até agora: mesmo com só ${plural(orders, 'pedido', 'pedidos')}, o gasto já passou das vendas.`),
    })
  }
  if (basis === 'revenue_minus_ads' && !noSales) {
    cand.push({ p: 92, l: line('Vendas ', strong(money(totals.revenue)), ' − anúncios ', strong(money(totals.adSpend)), '. Configure o custo dos produtos, o frete e as taxas para ver o lucro real.') })
  }
  if (basis === 'profit' && !noSales && !early && totals.revenue > 0 && margin !== null) {
    cand.push({ p: 90, l: perDollarLine(margin, rawAmount >= 0) })
  }
  if (fewOrders) {
    cand.push({ p: 85, l: line(`Só ${plural(orders, 'pedido', 'pedidos')} no período: pouca amostra para cravar uma tendência.`) })
  }
  if (cmp && comparisonTotals && comparable && !noSales && !early) {
    const prev = resultOf(comparisonTotals)
    const where = cmp.label === 'ontem até esta hora' ? 'ontem até esta hora' : `em ${formatRangeLabel({ from: cmp.from, to: cmp.to }, input.today)}`
    // A percentage only between two positive results: "376% a menos" from a
    // profit to a loss says nothing a reader can use. And only over a base
    // big enough to mean something: $250 after $1,89 read "13.123% a mais";
    // that case says the difference in dollars ("$248 a mais").
    const ch = rawAmount >= 0 ? readablePctChange(rawAmount, prev) : null
    const diff = rawAmount - prev
    const soFar = partial ? ' até agora' : ''
    const tail = ch !== null
      ? `: ${formatPct(Math.abs(ch), { digits: 0 })} ${ch >= 0 ? 'a mais' : 'a menos'}${soFar}.`
      : rawAmount >= 0 && prev > 0 && Math.abs(diff) >= 0.005
        ? `: ${money(Math.abs(diff) * k)} ${diff >= 0 ? 'a mais' : 'a menos'}${soFar}.`
        : '.'
    cand.push({
      p: 80,
      l: basis === 'profit' && prev < 0
        ? line('O prejuízo foi de ', strong(money(-prev * k), 'neg'), ` ${where}${tail}`)
        : line(`${basis === 'profit' ? 'O lucro' : 'Vendas − anúncios'} ${prev >= 0 ? 'era' : 'foi'} `, strong(money(prev * k), prev < 0 ? 'neg' : undefined), ` ${where}${tail}`),
    })
  } else if (cmp && !noSales && !early && !comparable && input.period !== 'today') {
    const started = firstOrder && cmp.to < firstOrder ? `: a loja começou a vender em ${formatDate(firstOrder, input.today)}` : ''
    cand.push({ p: 45, l: line(`Sem vendas para comparar em ${formatRangeLabel({ from: cmp.from, to: cmp.to }, input.today)}${started}.`) })
  }
  if (cmp && comparisonTotals && !noSales && !early && comparisonTotals.revenue > 0) {
    const rvText = moved(totals.revenue, comparisonTotals.revenue, 'subiram', 'caíram')
    if (rvText) {
      const adText = moved(totals.adSpend, comparisonTotals.adSpend, 'subiu', 'caiu')
      cand.push({ p: 40, l: line(`As vendas ${rvText}${adText ? ` e o gasto em anúncios ${adText}` : ''}.`) })
    }
  }
  const details = cand
    .map((c, i) => ({ ...c, i }))
    .sort((a, b) => b.p - a.p)
    .slice(0, 3)
    .sort((a, b) => a.i - b.i)
    .map(c => c.l)

  // ── Notes: the fine print about the clock and the timezones.
  const notes: VerdictLine[] = []
  if (partial && input.period !== 'mtd' && input.range.from === input.range.to) {
    const left = 1440 - minutes
    if (left > 0) notes.push(line('Faltam ', strong(formatDuration(left)), ` para o dia fechar${city ? ` em ${city}` : ''}.`))
  }
  if (!single) {
    const closed = stores.filter(s => s.dayState === 'closed')
    if (closed.length === 1) {
      notes.push(line('A ', strong(closed[0].name), ` entra com o dia de ${tzCity(closed[0].timezone)}, que já fechou.`))
    } else if (closed.length > 1) {
      notes.push(line(strong(joinNames(closed.map(s => s.name))), ' entram com o dia inteiro do fuso delas, que já fechou.'))
    }
    const notStarted = stores.filter(s => s.dayState === 'not_started')
    if (notStarted.length) {
      notes.push(line(strong(joinNames(notStarted.map(s => s.name))), ` ainda não ${notStarted.length === 1 ? 'começou' : 'começaram'} este dia no próprio fuso.`))
    }
    // Idle stores are out of the count in `when`; say who they are (a store
    // whose day has not started is already explained above). One that had not
    // made its first sale yet is not "parada": say that instead.
    const notYet = idleStores.filter(s => s.dayState !== 'not_started' && !!s.firstOrderDate && input.range.to < s.firstOrderDate)
    if (notYet.length && nStores > 0) {
      notes.push(line(strong(joinNames(notYet.map(s => s.name))), ` ainda não ${notYet.length === 1 ? 'vendia' : 'vendiam'} ${P}: ${notYet.length === 1 ? 'fica' : 'ficam'} fora da contagem de lojas.`))
    }
    const quiet = idleStores.filter(s => s.dayState !== 'not_started' && !notYet.includes(s))
    if (quiet.length && nStores > 0) {
      const nothing = `${partial ? 'ainda não ' : 'não '}${quiet.length === 1 ? 'teve' : 'tiveram'} vendas, anúncios nem reembolsos ${P}`
      notes.push(quiet.length === 1
        ? line(strong(quiet[0].name), ` ${nothing}: fica fora da contagem de lojas.`)
        : line(strong(`${quiet.length} lojas paradas`), `, fora da contagem: ${joinNames(quiet.map(s => s.name))} ${nothing}.`))
    }
  } else if (city && input.range.from === input.range.to) {
    notes.push(line(`Dia de ${city}: a loja fecha o dia no fuso dela, que pode não bater com o de Brasília.`))
  }
  // A window that starts before the first order: its early days are empty
  // because the store was not selling yet, not because sales stopped.
  if (firstOrder && !beforeStart && input.range.from < firstOrder && firstOrder <= input.range.to) {
    notes.push(line(`${subject} só começou a vender em `, strong(formatDate(firstOrder, input.today)), ': o período tem dias antes disso.'))
  }

  // ── When
  const isToday = input.range.from === input.range.to && input.range.from === input.today
  const rangeText = isToday ? 'hoje' : formatRangeLabel(input.range, input.today)
  const lead = single ? rangeText
    : nStores > 0 ? `${plural(nStores, 'loja', 'lojas')} na soma · ${rangeText}` : `nenhuma loja com movimento · ${rangeText}`
  const when = cmp ? `${lead} · ${comparisonText(cmp, input.today)}` : lead

  const roas = single ? storeRoas(totals, stores[0].configured) : null

  return {
    tone, chips, when, headline,
    amount,
    amountTone: amount === null || early ? 'neu' : amount < 0 ? 'neg' : basis === 'profit' ? 'pos' : 'neu',
    amountCaption, details, notes, basis,
    totals, comparisonTotals,
    excluded: excludedStores.map(s => ({
      id: s.id, name: s.name, revenue: s.totals.revenue, adSpend: s.totals.adSpend,
      revenueMinusAds: (s.totals.revenue - s.totals.adSpend) * k,
    })),
    roas, early, fewOrders, partial, split, storeCount: stores.length,
  }
}

// ─── One chip for a store row ────────────────────────────────────────────────

/**
 * The single status chip for a store in a list (phone store list, overview
 * table): sem vendas / custos não configurados / começando / no prejuízo /
 * margem fina / no lucro. Lowercase labels, as the lists use them. Agrees
 * with buildVerdict: a running day is "começando" before 04h, or with fewer
 * than MIN_ORDERS orders while its ads have not yet passed its sales.
 *
 * `singleDay` (default true): the window is one day. Pass
 * `{ singleDay: range.from === range.to }` for longer windows, where a young
 * clock on the last day does not make the store "começando".
 */
export function storeStatus(
  s: Pick<VerdictStore, 'configured' | 'totals' | 'partial' | 'minutesCovered'>,
  opts: { singleDay?: boolean } = {},
): VerdictChip {
  const t = s.totals
  const low = (c: VerdictChip): VerdictChip => ({ ...c, label: c.label.charAt(0).toLowerCase() + c.label.slice(1) })
  const runningDay = s.partial && (opts.singleDay ?? true)
  if (t.orders === 0 && t.revenue <= 0) {
    if (t.adSpend > 0 && !(runningDay && s.minutesCovered < EARLY_DAY_MINUTES)) return low(chip('prejuizo'))
    return low(chip('sem_vendas', 'Sem vendas'))
  }
  if (!s.configured) return low(chip('sem_custos'))
  if (runningDay && s.minutesCovered < EARLY_DAY_MINUTES) return chip('comecando')
  // Past 04h a handful of orders is still "começando" — unless the ads already
  // cost more than the sales, as the zero-order rule above (adsAboveSales).
  if (runningDay && t.orders < MIN_ORDERS && !adsAboveSales(t)) return chip('comecando')
  if (t.operatingProfit < 0) return low(chip('prejuizo'))
  if (t.margin !== null && t.margin < THIN_MARGIN_PCT) return low(chip('margem_fina'))
  return low(chip('lucro'))
}

// ─── Adapter ─────────────────────────────────────────────────────────────────

/** The verdict input for a buildPortfolio() result (one store or many). */
export function verdictInputFromPortfolio(
  view: PortfolioView, opts: { subject?: string; split?: boolean } = {},
): VerdictInput {
  return {
    stores: view.stores.map((r: PortfolioStoreRow & { firstOrderDate?: string | null }) => ({
      id: r.id, name: r.name, timezone: r.timezone, configured: r.configured, totals: r.totals,
      comparison: { included: r.comparison.included, totals: r.comparison.totals },
      partial: r.partial, minutesCovered: r.minutesCovered, dayState: r.dayState,
      // Read when the portfolio row carries it (the first order on the
      // store's own calendar); without it the verdict reads as before.
      firstOrderDate: r.firstOrderDate ?? null,
    })),
    period: view.period,
    range: view.range,
    today: view.anchorToday,
    anchorTimezone: view.anchorTimezone,
    anchorMinutes: minutesIntoDay(view.anchorTimezone, new Date(view.generatedAt)),
    comparison: {
      from: view.comparison.from, to: view.comparison.to,
      label: view.comparison.label, sameTimeOfDay: view.comparison.sameTimeOfDay,
    },
    subject: opts.subject,
    split: opts.split,
  }
}

/** Days in the window (for "média por dia" lines). */
export function windowDays(range: DateRange): number {
  return daysBetween(range.from, range.to)
}
