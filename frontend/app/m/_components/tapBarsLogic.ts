/**
 * The pure rules of the phone's tap-to-pin charts (TapBars / TapHours):
 * which layout a series gets, which column a touch x falls in, how long
 * windows fold into weeks, which column is pinned by default, and the one
 * numbers line under the bars. No React, so the rules are unit-tested
 * (app/m/_components/__tests__/tapBarsLogic.test.ts).
 *
 * Numbers are never recomputed here: a day's value, margin and money come
 * from the engine's day rows (PortfolioDay); a week adds those rows (they sum
 * to the totals by contract) and takes its margin from lib/views/verdict
 * sumTotals, the engine's own definition.
 */

import type { PnL } from '@/lib/engine/pnl'
import { sumTotals } from '@/lib/views/verdict'
import { formatDate, formatMoney, formatPct, formatRangeLabel, formatWeekdayDate, monthShort, plural } from '@/lib/format'

export interface TapDay {
  key: string            // 'YYYY-MM-DD' (day) or 'YYYY-MM-DD/YYYY-MM-DD' (week)
  label: string          // "qui, 19 nov" | "16–22 nov"
  axis: string           // "19" | "16" (x label), "" to skip
  monthStart?: string    // "nov" when a month begins at this column
  value: number          // profit (operatingProfit) or revenue − adSpend (net mode)
  margin: number | null  // PortfolioDay.margin; null in net mode / no revenue
  revenue: number
  adSpend: number
  metaSpend: number
  shopSpend: number
  orders: number
  partial: boolean       // the running day (hatched)
  /** C18: a day before the store's first sale (one store) with nothing in it. */
  notYet?: boolean
  /** A day before the first sale that still had money in it (ad spend that
   *  ran ahead of the first order): its numbers show, tagged. */
  beforeFirst?: boolean
}

/** Fit when every column gets at least this many px (C15b; r2: the 24-px
 *  minimum tap target, so fit never makes a column narrower than a target). */
export const FIT_MIN_COL = 24
/** Strip columns are this wide; their bars 16 px. */
export const STRIP_COL = 28
export const STRIP_BAR = 16
/** Past this many days the series folds into Monday–Sunday weeks. */
export const WEEK_AFTER = 62
/** Below this column width the x labels skip every other column. */
export const LABEL_EVERY_COL = 24
/** A tap moves less than this (px), whatever its length (r3: a press held to
 *  read a value, the old drag-to-read habit, pins too). */
export const TAP_SLOP = 8
/** A still press pins on its own after this long, without waiting for the
 *  finger to lift (and the release then does nothing more). */
export const LONG_PRESS_MS = 450

export interface Layout {
  mode: 'fit' | 'strip'
  /** Column width in px. */
  col: number
  /** Bar width in px. */
  bar: number
}

/** Fit (columns fill the width) or strip (fixed 28-px columns that scroll). */
export function layoutFor(n: number, width: number): Layout {
  const w = Math.max(1, width)
  const count = Math.max(1, n)
  const col = w / count
  if (col >= FIT_MIN_COL) return { mode: 'fit', col, bar: Math.min(28, Math.max(8, col * 0.6)) }
  return { mode: 'strip', col: STRIP_COL, bar: STRIP_BAR }
}

/** The column under x (px from the left edge of the track, scroll included),
 *  clamped to the series: a touch on the last pixel still lands on a column. */
export function indexFromX(x: number, col: number, n: number): number {
  if (n <= 0) return -1
  if (!(col > 0) || !Number.isFinite(x)) return 0
  return Math.min(n - 1, Math.max(0, Math.floor(x / col)))
}

/** A gesture counts as a tap: same column, little movement, not cancelled
 *  (a pan or a scroll never pins). Its length does not matter: `ms` is kept
 *  for the callers' records. */
export function isTap(g: { downIndex: number; upIndex: number; dx: number; dy: number; ms: number; cancelled: boolean }): boolean {
  return !g.cancelled && g.downIndex >= 0 && g.downIndex === g.upIndex && Math.hypot(g.dx, g.dy) < TAP_SLOP
}

/** The default pin: the latest complete column — the one before a running
 *  last column when there are at least two, else the last one. */
export function defaultPin(cols: readonly { partial: boolean }[]): number {
  const n = cols.length
  if (n === 0) return -1
  if (n >= 2 && cols[n - 1].partial) return n - 2
  return n - 1
}

/** Days a week column covers (its key is 'from/to'). */
function weekDays(key: string): number {
  const [from, to] = key.split('/')
  if (!to) return 1
  return Math.round((Date.parse(to + 'T00:00:00Z') - Date.parse(from + 'T00:00:00Z')) / 86_400_000) + 1
}

/** Week mode: the latest complete week — not a running one, and not the
 *  short tail the window ends on (23–24 nov) when a whole week precedes it. */
export function defaultWeekPin(cols: readonly { key: string; partial: boolean }[]): number {
  const n = cols.length
  if (n === 0) return -1
  const last = cols[n - 1]
  if (n >= 2 && (last.partial || weekDays(last.key) < 7)) return n - 2
  return n - 1
}

/** The pinned column for a stored key (C17: the pin survives a refresh while
 *  its key exists), else the default pin. */
export function resolvePin(cols: readonly { key: string; partial: boolean }[], key: string | null): number {
  if (key !== null) {
    const i = cols.findIndex(c => c.key === key)
    if (i >= 0) return i
  }
  return defaultPin(cols)
}

/** What a tap on column `i` pins: the column, or the default when it is the
 *  pinned one already (tap again → back to the default). Returns the new key
 *  (null = the default). */
export function tapResult(cols: readonly { key: string; partial: boolean }[], pinned: number, i: number): string | null {
  if (i < 0 || i >= cols.length) return cols[pinned]?.key ?? null
  if (i === pinned) return null
  return cols[i].key
}

/** Monday of the ISO week of a 'YYYY-MM-DD' date (UTC arithmetic: a date, not an instant). */
export function mondayOf(iso: string): string {
  const [y, m, d] = iso.split('-').map(Number)
  const t = new Date(Date.UTC(y, m - 1, d))
  const dow = (t.getUTCDay() + 6) % 7 // 0 = Monday
  t.setUTCDate(t.getUTCDate() - dow)
  return t.toISOString().slice(0, 10)
}

/**
 * Days → Monday–Sunday weeks (partial first/last weeks labelled by their real
 * dates). Money and orders are added; the week margin is sumTotals' (Σprofit
 * ÷ Σrevenue × 100, the engine's definition) in profit mode, null in net mode.
 */
export function aggregateWeeks(days: readonly TapDay[], mode: 'profit' | 'net', today?: string): TapDay[] {
  const groups = new Map<string, TapDay[]>()
  for (const d of days) {
    const date = d.key.slice(0, 10)
    const k = mondayOf(date)
    const g = groups.get(k)
    if (g) g.push(d)
    else groups.set(k, [d])
  }
  const out: TapDay[] = []
  let lastMonth = ''
  for (const g of groups.values()) {
    const from = g[0].key.slice(0, 10)
    const to = g[g.length - 1].key.slice(0, 10)
    const add = (f: (d: TapDay) => number) => g.reduce((s, d) => s + f(d), 0)
    const value = add(d => d.value)
    const revenue = add(d => d.revenue)
    const margin = mode === 'profit'
      ? sumTotals(g.map(d => ({ revenue: d.revenue, operatingProfit: d.value }) as unknown as PnL)).margin
      : null
    const month = monthShort(from)
    out.push({
      key: `${from}/${to}`,
      label: formatRangeLabel({ from, to }, today),
      axis: String(Number(from.slice(8, 10))),
      monthStart: month !== lastMonth ? month : undefined,
      value, margin, revenue,
      adSpend: add(d => d.adSpend),
      metaSpend: add(d => d.metaSpend),
      shopSpend: add(d => d.shopSpend),
      orders: add(d => d.orders),
      partial: g.some(d => d.partial),
      notYet: g.every(d => d.notYet) || undefined,
      beforeFirst: !g.every(d => d.notYet) && g.every(d => d.notYet || d.beforeFirst) ? true : undefined,
    })
    lastMonth = month
  }
  return out
}

/** Engine day rows → chart columns (day mode). */
export function daysToColumns(
  rows: readonly { date: string; operatingProfit: number; margin: number | null; revenue: number; adSpend: number; metaSpend: number; shopSpend: number; orders: number }[],
  opts: { mode: 'profit' | 'net'; partialDate?: string; today?: string; firstOrderDate?: string | null },
): TapDay[] {
  let lastMonth = ''
  return rows.map((d, i) => {
    const month = monthShort(d.date)
    // Only a truly empty day "had not started": Glooty spent $74 and $156 on
    // ads on 4–5 nov before its first order on 6 nov — those are in the totals.
    const before = !!opts.firstOrderDate && d.date < opts.firstOrderDate
    const active = d.orders > 0 || Math.abs(d.revenue) >= 0.005 || Math.abs(d.adSpend) >= 0.005 || Math.abs(d.operatingProfit) >= 0.005
    const col: TapDay = {
      key: d.date,
      label: formatWeekdayDate(d.date, opts.today),
      axis: String(Number(d.date.slice(8, 10))),
      monthStart: i === 0 || month !== lastMonth ? month : undefined,
      value: opts.mode === 'net' ? d.revenue - d.adSpend : d.operatingProfit,
      margin: opts.mode === 'net' ? null : d.margin,
      revenue: d.revenue,
      adSpend: d.adSpend,
      metaSpend: d.metaSpend,
      shopSpend: d.shopSpend,
      orders: d.orders,
      partial: !!opts.partialDate && d.date === opts.partialDate,
      notYet: before && !active ? true : undefined,
      beforeFirst: before && active ? true : undefined,
    }
    lastMonth = month
    return col
  })
}

/** Day columns, folded into weeks past WEEK_AFTER days. */
export function chartColumns(days: TapDay[], mode: 'profit' | 'net', today?: string): { cols: TapDay[]; unit: 'day' | 'week' } {
  return days.length > WEEK_AFTER ? { cols: aggregateWeeks(days, mode, today), unit: 'week' } : { cols: days, unit: 'day' }
}

/** Where zero sits and how tall a value is, for a 0..1 plot (0 = top). Mixed
 *  signs: zero placed proportionally; all negative: zero at the top; nothing
 *  but zeros: zero at the bottom. */
export function scaleOf(values: readonly number[]): { hi: number; lo: number; zero: number; h: (v: number) => number } {
  const hi = Math.max(0, ...values)
  const lo = Math.min(0, ...values)
  const span = hi - lo
  if (span <= 0) return { hi, lo, zero: 1, h: () => 0 }
  return { hi, lo, zero: hi / span, h: (v: number) => Math.abs(v) / span }
}

/** "13 de 24 dias no lucro · melhor qui, 5 nov $1.126 · pior dom, 8 nov −$678"
 *  over the complete columns (net mode: "acima de zero"); null when there is
 *  no complete column. */
export function summaryLine(cols: readonly TapDay[], mode: 'profit' | 'net', unit: 'day' | 'week' = 'day'): string | null {
  const done = cols.filter(c => !c.partial && !c.notYet)
  if (!done.length) return null
  const up = done.filter(c => c.value > 0).length
  const best = done.reduce((a, c) => (c.value > a.value ? c : a))
  const worst = done.reduce((a, c) => (c.value < a.value ? c : a))
  const what = unit === 'week' ? plural(done.length, 'semana', 'semanas') : plural(done.length, 'dia', 'dias')
  const head = `${up} de ${what} ${mode === 'net' ? 'acima de zero' : 'no lucro'}`
  if (done.length < 2) return head
  return `${head} · melhor ${best.label} ${formatMoney(best.value)} · pior ${worst.label} ${formatMoney(worst.value)}`
}

/** The readout sentence of a day column (aria-label and live announcement). */
export function daySentence(c: TapDay, mode: 'profit' | 'net'): string {
  if (c.notYet) return `${c.label}: a loja ainda não vendia`
  const parts = mode === 'net'
    ? [`vendas − anúncios ${formatMoney(c.value)}`, `receita ${formatMoney(c.revenue)}`, `anúncios ${formatMoney(c.adSpend)}`]
    : [`lucro ${formatMoney(c.value)}`, `margem ${c.margin === null ? 'sem vendas' : formatPct(c.margin)}`, `receita ${formatMoney(c.revenue)}`, `anúncios ${formatMoney(c.adSpend)}`]
  return `${c.label}${c.beforeFirst ? ' (antes da 1ª venda)' : ''}: ${parts.join(', ')}, ${plural(c.orders, 'pedido', 'pedidos')}${c.partial ? ' (parcial)' : ''}`
}

/** "13h" for hour h. */
export const hourLabel = (h: number) => `${String(h).padStart(2, '0')}h`

/** One hour column of TapHours. */
export interface TapHour {
  key: string            // String(hour)
  hour: number
  axis: string
  value: number          // cumProfit
  cumRevenue: number
  revenue: number
  orders: number
  partial: boolean       // the running hour
}

/** Intraday points → hour columns 0…last point (C18: none when empty). */
export function hoursToColumns(points: readonly { hour: number; cumProfit: number; cumRevenue: number; revenue: number; orders: number }[], running: boolean): TapHour[] {
  if (!points.length) return []
  const last = points[points.length - 1].hour
  const byHour = new Map(points.map(p => [p.hour, p]))
  const out: TapHour[] = []
  let prev = { cumProfit: 0, cumRevenue: 0 }
  for (let h = 0; h <= last; h++) {
    const p = byHour.get(h)
    const cum = p ?? { cumProfit: prev.cumProfit, cumRevenue: prev.cumRevenue }
    out.push({
      key: String(h), hour: h, axis: String(h),
      value: cum.cumProfit, cumRevenue: cum.cumRevenue,
      revenue: p?.revenue ?? 0, orders: p?.orders ?? 0,
      partial: running && h === last,
    })
    prev = { cumProfit: cum.cumProfit, cumRevenue: cum.cumRevenue }
  }
  return out
}

/** The default pin of the hours chart: the latest hour. */
export const defaultHourPin = (cols: readonly unknown[]) => cols.length - 1

/** The longest readout value, in characters (at least 4): the cells size their
 *  font from it and their real width (TapBars.module.css `--chars`), so a
 *  7-character "$11.171" never runs into its neighbour at 360 px. */
export const readoutChars = (texts: readonly string[]) => Math.max(4, ...texts.map(t => t.length))

/** Re-export so the component formats dates through one module. */
export { formatDate }
