/**
 * One-store windows for server routes that still take engine-style
 * parameters (?period=&from=&to=): the AI tools, the products and export
 * routes, the cost preview. They resolve through lib/period (fitValue on the
 * store's own clock, the R6 comparison rule), so no route keeps its own copy
 * of the window or comparison rules (spec §5 grep test).
 */

import { isIsoDate, type Comparison, type DateRange } from '../engine/dates'
import { minutesInto, todayIn } from './clock'
import { compareRange, comparisonFor, ruleOf, ruleWords } from './compare'
import { dateBeside } from './facts'
import { fitValue, isPreset, MIN_DATE, normaliseDates, preset } from './value'
import type { IsoDate, PeriodValue } from './types'

/** The value of engine-style params: a preset, or custom dates (normalised).
 *  Custom without two real dates is Hoje (the engine's old reading). */
export function valueOf(period: string, from?: string | null, to?: string | null): PeriodValue {
  if (isPreset(period)) return preset(period)
  if (isIsoDate(from) && isIsoDate(to)) return normaliseDates(from, to).value ?? preset('today')
  return preset('today')
}

/** The window of a period on one store's clock (`tz`) at `now`. */
export function windowFor(period: string, tz: string, from: string | null | undefined, to: string | null | undefined, now: Date): DateRange {
  return fitValue(valueOf(period, from, to), todayIn(tz, now)).window
}

/** A comparison with where its last day stops (R6 cut rule). */
export interface WindowComparison extends Comparison {
  /** The minute the comparison's last day is cut at: a window still running
   *  (it reaches the store's today) is compared up to this minute on the
   *  store's clock, whatever its rule; null for whole days. */
  cutAtMinute: number | null
  /** R6 "base before the first activity", the page's own rule
   *  (comparisonFor): 'none' — the comparison lies wholly before the store's
   *  first activity, there is nothing to compare ("sem base: a loja começou
   *  em 7 nov"); 'partial' — it starts before it, the base may be shown but
   *  no delta % ("base incompleta: …"); 'full' otherwise. */
  base: 'full' | 'partial' | 'none'
  /** R6's words for a base that is not full, else null. */
  baseNote: string | null
}

/** The comparison of a window by R6 (Comparison, with the engine-era label
 *  words): `period` is the value the window was resolved from. A running
 *  window (Este mês, Hoje, custom dates ending today) cuts its last
 *  comparison day at this minute — price it with that cut (lib/views/store
 *  priceComparison), never as whole days. */
export function previousFor(
  period: string, range: DateRange, tz: string, now: Date,
  /** The store's first activity (StoreFacts): the AI tools and the insights
   *  say "sem base" / "base incompleta" exactly where the page does (R6).
   *  Omitted: unknown, before every window (a full base). */
  firstActivityDate?: IsoDate | null,
): WindowComparison {
  const today = todayIn(tz, now)
  const value = isPreset(period) ? preset(period) : { kind: 'dates' as const, from: range.from, to: range.to }
  const rule = ruleOf(value, range, today)
  const r = compareRange(rule, range)
  const cut = range.to >= today
  const cutAtMinute = cut ? minutesInto(tz, now) : null
  const facts = firstActivityDate === undefined ? MIN_DATE : firstActivityDate
  const { compare } = comparisonFor(rule, range, facts, cutAtMinute)
  const base = compare ? compare.base : 'none'
  const day = facts && base !== 'full' ? dateBeside(facts, { window: range, comparison: r, clockToday: today }) : null
  const baseNote = base === 'none' ? (day ? `sem base: a loja começou em ${day}` : 'sem base de comparação')
    : base === 'partial' && day ? `base incompleta: a loja começou em ${day}` : null
  return { from: r.from, to: r.to, label: ruleWords(rule, r, cut), sameTimeOfDay: cut, cutAtMinute, base, baseNote }
}

/** The window of the same length right before `range` (n days before). */
export function daysBefore(range: DateRange): DateRange {
  return compareRange('n_days', range)
}
