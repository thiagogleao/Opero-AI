import {
  daysBetween, isIsoDate, isPeriod, shiftDate, todayInTz,
  type DateRange, type Period,
} from '@/lib/engine'
import { INSIGHTS_MAX_DAYS } from './config'
import { windowFor } from '../period'
import { rangeBeside } from '../period'

/**
 * Which days an AI answer is about. Always resolved on the server, in the
 * store's own timezone, with the engine's period presets — so "7 dias" means
 * the same seven complete days on the dashboard, the Copilot and the insights.
 */

export interface InsightsWindow extends DateRange {
  /** The preset the window came from ('custom' for dates): its comparison
   *  follows the period's own rule (R6), as the page's does. */
  period?: Period
  days: number
  label: string
  /** True when the requested window ran into today and was cut at yesterday. */
  cutAtYesterday: boolean
  /** True when the window was longer than INSIGHTS_MAX_DAYS and was shortened. */
  shortened: boolean
}

export type WindowResult = { ok: true; window: InsightsWindow } | { ok: false; message: string }

/**
 * The insights only read closed days: a half-finished day reads as a revenue
 * drop every morning, and a card built on it would stay cached for hours.
 */
export function insightsWindow(
  tz: string, period: unknown, from: unknown, to: unknown, now: Date = new Date(),
): WindowResult {
  const p: Period = isPeriod(period) ? period : '30d'
  const r = windowFor(p, tz, isIsoDate(from) ? from : null, isIsoDate(to) ? to : null, now)
  const today = todayInTz(tz, now)
  const yesterday = shiftDate(today, -1)
  const end = r.to > yesterday ? yesterday : r.to
  if (r.from > end) {
    return {
      ok: false,
      message: 'Este período ainda não tem nenhum dia fechado. A análise usa só dias completos — escolha um período que termine ontem ou antes.',
    }
  }
  let start = r.from
  let shortened = false
  if (daysBetween(start, end) > INSIGHTS_MAX_DAYS) {
    start = shiftDate(end, -(INSIGHTS_MAX_DAYS - 1))
    shortened = true
  }
  const range = { from: start, to: end }
  return {
    ok: true,
    window: {
      ...range, period: shortened ? 'custom' : p, days: daysBetween(start, end), label: rangeBeside(range, { window: range, clockToday: today }),
      cutAtYesterday: r.to > yesterday, shortened,
    },
  }
}

export interface ToolRange extends DateRange {
  /** The preset that produced the dates ('custom' for explicit dates). */
  period: Period
  days: number
  label: string
  /** The window includes the store's current day, which is still running. */
  partial: boolean
}

/** A window the model asked for: a preset, or explicit dates (clamped to
 *  today). Unknown input falls back to the given default preset. */
export function toolRange(
  tz: string, input: { period?: unknown; from?: unknown; to?: unknown }, fallback: Period, now: Date = new Date(),
): ToolRange {
  const explicit = isIsoDate(input.from) && isIsoDate(input.to)
  const p: Period = explicit ? 'custom' : isPeriod(input.period) && input.period !== 'custom' ? input.period : fallback
  const r = windowFor(p, tz, explicit ? (input.from as string) : null, explicit ? (input.to as string) : null, now)
  const today = todayInTz(tz, now)
  return { ...r, period: p, days: daysBetween(r.from, r.to), label: rangeBeside(r, { window: r, clockToday: today }), partial: r.to >= today }
}
