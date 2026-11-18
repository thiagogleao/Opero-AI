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
 *  - A young day or a handful of orders is "cedo demais para julgar".
 *  - Every comparison says exactly what it compares ("vs ontem até esta hora").
 *  - The partner split halves money results only, never margins or ROAS.
 *
 * Entry points:
 *   buildVerdict(input)                    any number of stores, any period
 *   verdictInputFromPortfolio(view, opts)  adapter from buildPortfolio()
 *   storeStatus(store, opts)               one chip for a store row in a list
 *   roasSummary(roas, breakEven)           "ROAS 1,95× · empate 1,58× → no lucro"
 */

import type { PnL } from '../engine/pnl'
import type { DateRange, Period } from '../engine/dates'
import { daysBetween, minutesIntoDay } from '../engine/dates'
import type { PortfolioView, DayState } from './portfolio'
import {
  dayOfLabel, formatClock, formatDate, formatDuration, formatMoney, formatPct, formatRangeLabel,
  formatRoas, pctChange, plural, tzCity,
} from '../format'

// ─── Thresholds ──────────────────────────────────────────────────────────────

/** Below 15 cents of profit per dollar sold the margin is "fina". */
export const THIN_MARGIN_PCT = 15
/** Fewer orders than this is too few to judge a window. */
export const MIN_ORDERS = 5
/** Before 04h00 of the store's day, a day is too young to judge. */
export const EARLY_DAY_MINUTES = 240
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
  breakEven: number | null
  /** pos: at or above break-even; neg: below; unknown: no cost settings. */
  state: 'pos' | 'neg' | 'unknown'
  /** "ROAS 1,95× · empate 1,58× → no lucro". */
  text: string
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
  /** One store with Meta spend: ROAS against its own break-even. */
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

const cap = (s: string) => s.charAt(0).toUpperCase() + s.slice(1)
const line = (...parts: (string | { text: string; strong?: boolean; tone?: 'pos' | 'neg' | 'warn' })[]): VerdictLine => {
  const ps = parts.map(p => (typeof p === 'string' ? { text: p } : p))
  return { parts: ps, text: ps.map(p => p.text).join('') }
}
const strong = (text: string, tone?: 'pos' | 'neg' | 'warn') => ({ text, strong: true, tone })

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

/** "ROAS 1,95× · empate 1,58× → no lucro". */
export function roasSummary(roas: number, breakEven: number | null): RoasSummary {
  if (breakEven === null || !(breakEven > 0)) {
    return { roas, breakEven: null, state: 'unknown', text: `ROAS ${formatRoas(roas)} · empate desconhecido → custos não configurados` }
  }
  const state = roas >= breakEven ? 'pos' : 'neg'
  return {
    roas, breakEven, state,
    text: `ROAS ${formatRoas(roas)} · empate ${formatRoas(breakEven)} → ${state === 'pos' ? 'no lucro' : 'no prejuízo'}`,
  }
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

  // What is judged: a lone store as it is; in a sum, only stores with costs
  // (an unconfigured store's revenue − ads is not profit and would inflate
  // or deflate the total; it is named in a line instead).
  const configured = stores.filter(s => s.configured)
  const sumOnlyConfigured = !single && configured.length > 0 && configured.length < stores.length
  const judged = sumOnlyConfigured ? configured : stores
  const excludedStores = sumOnlyConfigured ? stores.filter(s => !s.configured) : []
  const withCosts = judged.length > 0 && judged.every(s => s.configured)

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
  // judged. Any other window with few orders is still what happened (money
  // lost is lost): it keeps its verdict and gets a "poucos pedidos" chip.
  const early = runningDay && !noSales && (earlyDay || orders < MIN_ORDERS)
  const fewOrders = !runningDay && !noSales && orders < MIN_ORDERS
  const margin = totals.margin
  const thin = basis === 'profit' && rawAmount > 0 && margin !== null && margin < THIN_MARGIN_PCT

  // ── Chips
  const chips: VerdictChip[] = []
  if (noSales) {
    if (spent && !earlyDay) chips.push(chip('prejuizo'))
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
  if (noSales) {
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
  const nStores = judged.length
  if (amount === null) {
    amountCaption = partial ? 'nenhum pedido até agora' : 'nenhum pedido no período'
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
  if (early) {
    cand.push({ p: 95, l: line(`Com ${plural(orders, 'pedido', 'pedidos')}, o resultado de hoje ainda não diz nada. Para decidir, olhe ontem e os últimos 7 dias.`) })
  }
  if (basis === 'revenue_minus_ads' && !noSales) {
    cand.push({ p: 92, l: line('Vendas ', strong(money(totals.revenue)), ' − anúncios ', strong(money(totals.adSpend)), '. Configure o custo dos produtos, o frete e as taxas para ver o lucro real.') })
  }
  if (basis === 'profit' && !noSales && !early && totals.revenue > 0 && margin !== null) {
    const c = Math.round(Math.abs(margin))
    cand.push({
      p: 90,
      l: rawAmount >= 0
        ? line('Sobraram ', strong(`${c} ${c === 1 ? 'centavo' : 'centavos'} de cada dólar vendido`), '.')
        : line('Faltaram ', strong(`${c} ${c === 1 ? 'centavo' : 'centavos'} em cada dólar vendido`, 'neg'), ' para empatar.'),
    })
  }
  if (fewOrders) {
    cand.push({ p: 85, l: line(`Só ${plural(orders, 'pedido', 'pedidos')} no período: pouca amostra para cravar uma tendência.`) })
  }
  if (cmp && comparisonTotals && comparable && !noSales && !early) {
    const prev = resultOf(comparisonTotals)
    const where = cmp.label === 'ontem até esta hora' ? 'ontem até esta hora' : `em ${formatRangeLabel({ from: cmp.from, to: cmp.to }, input.today)}`
    // A percentage only between two positive results: "376% a menos" from a
    // profit to a loss says nothing a reader can use.
    const ch = rawAmount >= 0 ? pctChange(rawAmount, prev) : null
    const tail = ch === null ? '.' : `: ${formatPct(Math.abs(ch), { digits: 0 })} ${ch >= 0 ? 'a mais' : 'a menos'}${partial ? ' até agora' : ''}.`
    cand.push({
      p: 80,
      l: basis === 'profit' && prev < 0
        ? line('O prejuízo foi de ', strong(money(-prev * k), 'neg'), ` ${where}${tail}`)
        : line(`${basis === 'profit' ? 'O lucro' : 'Vendas − anúncios'} ${prev >= 0 ? 'era' : 'foi'} `, strong(money(prev * k), prev < 0 ? 'neg' : undefined), ` ${where}${tail}`),
    })
  } else if (cmp && !noSales && !early && !comparable && input.period !== 'today') {
    cand.push({ p: 45, l: line(`Sem vendas para comparar em ${formatRangeLabel({ from: cmp.from, to: cmp.to }, input.today)}.`) })
  }
  if (cmp && comparisonTotals && !noSales && !early && comparisonTotals.revenue > 0) {
    const rv = pctChange(totals.revenue, comparisonTotals.revenue)
    const ad = pctChange(totals.adSpend, comparisonTotals.adSpend)
    if (rv !== null && Math.abs(rv) >= 1) {
      const rvText = `As vendas ${rv >= 0 ? 'subiram' : 'caíram'} ${formatPct(Math.abs(rv), { digits: 0 })}`
      const adText = ad !== null && Math.abs(ad) >= 1 ? ` e o gasto em anúncios ${ad >= 0 ? 'subiu' : 'caiu'} ${formatPct(Math.abs(ad), { digits: 0 })}` : ''
      cand.push({ p: 40, l: line(`${rvText}${adText}.`) })
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
  } else if (city && input.range.from === input.range.to) {
    notes.push(line(`Dia de ${city}: a loja fecha o dia no fuso dela, que pode não bater com o de Brasília.`))
  }

  // ── When
  const isToday = input.range.from === input.range.to && input.range.from === input.today
  const rangeText = isToday ? 'hoje' : formatRangeLabel(input.range, input.today)
  const lead = single ? rangeText : `${plural(nStores, 'loja', 'lojas')} na soma · ${rangeText}`
  const when = cmp ? `${lead} · ${comparisonText(cmp, input.today)}` : lead

  const roas = single && totals.metaSpend > 0 && totals.roas !== null
    ? roasSummary(totals.roas, basis === 'profit' ? totals.breakEvenRoas : null)
    : null

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
 * margem fina / no lucro. Lowercase labels, as the lists use them.
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
  if (runningDay && (s.minutesCovered < EARLY_DAY_MINUTES || t.orders < MIN_ORDERS)) return chip('comecando')
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
    stores: view.stores.map(r => ({
      id: r.id, name: r.name, timezone: r.timezone, configured: r.configured, totals: r.totals,
      comparison: { included: r.comparison.included, totals: r.comparison.totals },
      partial: r.partial, minutesCovered: r.minutesCovered, dayState: r.dayState,
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
