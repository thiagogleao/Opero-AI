/**
 * Compatibility re-export: the date presets live in lib/engine/dates.ts.
 *
 * Kept so existing importers (lib/scaleSignals, app/api/mobile/detail) keep
 * compiling; new code should import from '@/lib/engine/dates' directly.
 */

import { daysBetween, shiftDate, type DateRange } from './engine/dates'

export {
  todayInTz, shiftDate, REFERENCE_TZ, resolveRange, anchorTz, PERIODS, type Period,
} from './engine/dates'

/**
 * The window of the same length ending the day before `from`. Prefer
 * comparisonRange from lib/engine/dates, which also knows calendar months and
 * "today until this hour".
 */
export function previousRange(from: string, to: string): DateRange {
  const n = daysBetween(from, to)
  return { from: shiftDate(from, -n), to: shiftDate(from, -1) }
}
