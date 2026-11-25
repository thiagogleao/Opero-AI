/**
 * R12: the fixed windows some blocks judge on their own (Campanhas/Criativos
 * verdicts, the creative chip): the last 7 closed days on the store's clock,
 * and the 7 before them. Such a block names its own dates beside its verdict.
 * An archived store has no decision block (R10).
 */

import { shiftDate } from '../engine/dates'
import { todayIn } from './clock'
import type { DateRange } from './types'

export const DECISION_DAYS = 7

export function decisionWindow(tz: string, now: Date, days = DECISION_DAYS): { window: DateRange; previous: DateRange } {
  return decisionWindowOn(todayIn(tz, now), days)
}

/** decisionWindow on a store whose today is `storeToday` (already read on its
 *  clock): the `days` closed days before it, and the `days` before those. */
export function decisionWindowOn(storeToday: string, days = DECISION_DAYS): { window: DateRange; previous: DateRange } {
  const to = shiftDate(storeToday, -1)
  const window = { from: shiftDate(to, -(days - 1)), to }
  return { window, previous: { from: shiftDate(window.from, -days), to: shiftDate(window.from, -1) } }
}
