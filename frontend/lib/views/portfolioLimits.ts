/**
 * Limits of the portfolio view (GET /api/mobile, /api/mobile/detail and every
 * caller of buildPortfolio), in a module with no server import so the phone's
 * client code applies the very same rules before it asks (app/m/_lib/selection):
 * the period button must never name dates the numbers do not use.
 */

import {
  daysBetween, formatRange, isIsoDate, resolveRange, shiftDate, todayInTz, type DateRange, type Period,
} from '../engine/dates'

/**
 * Longest custom window priced, and the earliest date: the desktop pages' rule
 * (lib/views/page.ts MAX_WINDOW_DAYS and MIN_PAGE_DATE), repeated here because
 * page.ts is server-only. Without it the phone asked for 1990–2026: 5,3 MB in
 * 8 s with 13.470 daily bars, and isIsoDate accepts years from 0100, where
 * Date.UTC reads two-digit years as 19xx and the comparison window breaks.
 */
export const MAX_WINDOW_DAYS = 366
export const MIN_WINDOW_DATE = '2000-01-01'
/** MIN_WINDOW_DATE in words, always with its year (it is never this year). */
export const MIN_WINDOW_LABEL = '1 jan 2000'

/** Newest sales the live feed carries (loadLiveFeed's LIMIT): the list on the
 *  phone is "the N most recent", never "all". */
export const LIVE_FEED_SIZE = 40

/** Why a custom range was cut: longer than MAX_WINDOW_DAYS, or starting before
 *  MIN_WINDOW_DATE; null when it is used as asked (apart from an end past today,
 *  which every caller already reads as today). */
export type RangeCut = 'long' | 'floor' | null

export interface FittedRange extends DateRange {
  cut: RangeCut
}

/**
 * A custom range exactly as it will be priced. The same steps, in the same
 * order, as the desktop's resolvePeriodWindow over lib/engine/dates
 * resolveRange: each date floored at MIN_WINDOW_DATE, ordered, never past
 * `today` (the selection's own today), then only the last MAX_WINDOW_DAYS days.
 * Pure; `from` and `to` must be YYYY-MM-DD.
 */
export function fitCustomRange(from: string, to: string, today: string): FittedRange {
  const floor = (d: string) => (d < MIN_WINDOW_DATE ? MIN_WINDOW_DATE : d)
  const floored = from < MIN_WINDOW_DATE || to < MIN_WINDOW_DATE
  const [a, b] = floor(from) <= floor(to) ? [floor(from), floor(to)] : [floor(to), floor(from)]
  const range = { from: a > today ? today : a, to: b > today ? today : b }
  if (daysBetween(range.from, range.to) > MAX_WINDOW_DAYS) {
    return { from: shiftDate(range.to, -(MAX_WINDOW_DAYS - 1)), to: range.to, cut: 'long' }
  }
  return { ...range, cut: floored ? 'floor' : null }
}

/** One sentence for a range that was cut ("…aqui estão os últimos 366,
 *  18 nov 2025 – 18 nov"), null when it was not. */
export function rangeCutNote(r: FittedRange, today: string): string | null {
  if (r.cut === 'long') {
    return `O período pedido passa de ${MAX_WINDOW_DAYS} dias, o máximo: aqui estão os últimos ${MAX_WINDOW_DAYS}, ${formatRange(r, today)}.`
  }
  if (r.cut === 'floor') {
    return `Datas antes de ${MIN_WINDOW_LABEL} não entram: o período começa em ${formatRange({ from: r.from, to: r.from }, today)}.`
  }
  return null
}

/**
 * The window a portfolio request prices, on `tz`'s calendar (lib/engine/dates
 * anchorTz): presets as resolveRange reads them, a custom range through
 * fitCustomRange. GET /api/mobile (buildPortfolio) and /api/mobile/detail
 * (buildMobileDetail) both call it, so a tab never prices other dates than
 * the headline above it. `note` is rangeCutNote when the range was cut.
 */
export function resolvePortfolioWindow(
  period: Period, tz: string, from: string | null | undefined, to: string | null | undefined, now: Date = new Date(),
): { range: DateRange; note: string | null } {
  if (period === 'custom' && isIsoDate(from) && isIsoDate(to)) {
    const today = todayInTz(tz, now)
    const fitted = fitCustomRange(from, to, today)
    return { range: { from: fitted.from, to: fitted.to }, note: rangeCutNote(fitted, today) }
  }
  return { range: resolveRange(period, tz, from, to, now), note: null }
}

/**
 * The 400 for a custom range wholly before MIN_WINDOW_DATE (nothing to cut it
 * down to: the desktop reads such a link as no dates at all), else null.
 * GET /api/mobile and parseDetailQuery answer the same.
 */
export function tooEarlyRangeError(from: string | null | undefined, to: string | null | undefined): string | null {
  if (!isIsoDate(from) || !isIsoDate(to)) return null
  return from < MIN_WINDOW_DATE && to < MIN_WINDOW_DATE
    ? `Escolha datas a partir de ${MIN_WINDOW_LABEL}`
    : null
}
