/**
 * R11: stores before their first sale, and every store-fact date printed
 * beside a window. One test for the verdict, the Todas rows (desktop and
 * phone), the chips, the total-row notes, the trails and every page verdict.
 *
 * The window is never clamped to the first sale; only the reading changes.
 * A null first date counts as "after every window" ('9999-12-31'), so a store
 * that never sold reads "ainda não vendeu", not "sem vendas" (C2-M9).
 */

import { daysBetween, type DateRange } from '../engine/dates'
import { clockText, minutesInto } from './clock'
import { startOf } from './compare'
import type { IsoDate, MemberResolution, StoreFacts } from './types'

/** What a member did in its window, as far as "activity" goes (R11). */
export interface ActivityTotals {
  orders: number
  /** Meta + Shopify ad spend. */
  adSpend: number
  /** Refunds and chargebacks (any sign). */
  adjustments?: number
  refundCount?: number
  chargebackCount?: number
}

const zero = (v: number | undefined) => !(Math.abs(v ?? 0) >= 0.005)

/** Idle: no orders, no ad spend, no refunds or chargebacks. Configured fixed
 *  costs are NOT activity (they run whether the store sells or not). */
export function isIdleWindow(t: ActivityTotals): boolean {
  return t.orders === 0 && zero(t.adSpend) && zero(t.adjustments) && !(t.refundCount ?? 0) && !(t.chargebackCount ?? 0)
}

/**
 * "ainda não vendia": the first order is after the window's last read day AND
 * the store was idle in it. A store that spent before its first sale shows
 * $0 · 0 and its loss (L569, L605). Takes precedence over "custos não
 * configurados" (L156).
 */
export function beforeFirstSale(
  readTo: IsoDate | null, totals: ActivityTotals, store: Pick<StoreFacts, 'firstOrderDate'>,
): boolean {
  if (!readTo) return false
  return firstSaleAfter(readTo, store.firstOrderDate) && isIdleWindow(totals)
}

/**
 * The dates half of beforeFirstSale: the first order comes after `readTo`.
 * A null first order is "after every window" (never sold, R11, C2-M9); an
 * unknown one arrives as MIN_DATE from the facts loader and is before every
 * window (§9.7). The one reading of a first-order date for every caller that
 * needs only the dates (a total row's groups, a trail's empty state).
 */
export function firstSaleAfter(readTo: IsoDate, firstOrderDate: IsoDate | null): boolean {
  return startOf(firstOrderDate) > readTo
}

/** beforeFirstSale for a member of a resolution. */
export function memberBeforeFirstSale(m: MemberResolution, totals: ActivityTotals, store: Pick<StoreFacts, 'firstOrderDate'>): boolean {
  return beforeFirstSale(m.read?.to ?? null, totals, store)
}

/**
 * The store's first activity falls inside the window (after its first day):
 * the window has `daysBefore` days before it. Trails, sparklines and "dias no
 * lucro N de M" start at `day` (L41, L77). Null otherwise.
 */
export function startsInside(window: DateRange, store: Pick<StoreFacts, 'firstActivityDate'>): { day: IsoDate; daysBefore: number } | null {
  const start = store.firstActivityDate
  if (!start || start <= window.from || start > window.to) return null
  return { day: start, daysBefore: daysBetween(window.from, start) - 1 }
}

export interface DateContext {
  window: DateRange
  comparison?: DateRange | null
  clockToday: IsoDate
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** True when the window or its comparison lies (partly) in another year than
 *  the clock's today: every date beside it then says its year. */
function contextNeedsYear(c: DateContext): boolean {
  const y = c.clockToday.slice(0, 4)
  const ds = [c.window.from, c.window.to, c.comparison?.from, c.comparison?.to].filter((d): d is string => !!d)
  return ds.some(d => d.slice(0, 4) !== y)
}

/**
 * A store-fact date (first sale, first activity, archive day) printed beside
 * a window: with its year whenever the date, the window or its comparison is
 * in another year than today (L186, L268, L415). "11 abr 2026" beside
 * "15 dez 2025 – 15 jan 2026", "7 nov" beside "1–24 nov".
 */
export function dateBeside(date: IsoDate, c: DateContext): string {
  const [y, m, d] = date.split('-').map(Number)
  const year = contextNeedsYear(c) || String(y) !== c.clockToday.slice(0, 4)
  return `${d} ${MONTHS[m - 1]}${year ? ` ${y}` : ''}`
}

/**
 * The archive instant as said beside a window (R10 wording): its day through
 * dateBeside and its time on the store's own clock — "Situação em 10 nov às
 * 09h02, quando a loja foi arquivada". Null for a store that is not archived.
 */
export function archiveMoment(store: Pick<StoreFacts, 'archivedAt' | 'archivedOn' | 'tz'>, c: DateContext): { day: string; time: string } | null {
  if (!store.archivedAt || !store.archivedOn) return null
  return { day: dateBeside(store.archivedOn, c), time: clockText(minutesInto(store.tz, new Date(store.archivedAt))) }
}

/** A range beside a window, by the same rule ("11–30 abr 2026"). */
export function rangeBeside(r: DateRange, c: DateContext): string {
  if (r.from === r.to) return dateBeside(r.from, c)
  const [y1, m1, d1] = r.from.split('-').map(Number)
  const [y2, m2, d2] = r.to.split('-').map(Number)
  const year = contextNeedsYear(c) || String(y1) !== c.clockToday.slice(0, 4) || String(y2) !== c.clockToday.slice(0, 4)
  if (y1 !== y2) return `${d1} ${MONTHS[m1 - 1]} ${y1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`
  const yr = year ? ` ${y2}` : ''
  if (m1 === m2) return `${d1}–${d2} ${MONTHS[m2 - 1]}${yr}`
  return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]}${yr}`
}
