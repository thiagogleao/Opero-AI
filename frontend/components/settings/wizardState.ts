/**
 * Pure helpers of the onboarding wizard (tested in __tests__/wizardState.test.ts).
 * No server imports: used by the client wizard.
 */

import { shiftDate, todayInTz } from '@/lib/engine/dates'

/** The import route refuses more than 400 days back (lib/sync/refresh). */
export const MAX_DAYS_BACK = 399

/**
 * Today and the oldest day the import accepts, in `tz`, from the server's
 * render time. Computed from a value the server passes down, the bounds are
 * the same in the server HTML and in the browser (no hydration mismatch), and
 * never "tomorrow" because the server's own clock is UTC (Railway) at 22h in
 * Brazil.
 */
export function dateBounds(nowIso: string, tz: string): { min: string; max: string } {
  const max = todayInTz(tz, new Date(nowIso))
  return { min: shiftDate(max, -MAX_DAYS_BACK), max }
}

/** An opening date fit for the import: empty stays empty, else clamped to the bounds. */
export function clampStart(date: string, bounds: { min: string; max: string }): string {
  if (!date) return date
  return date < bounds.min ? bounds.min : date > bounds.max ? bounds.max : date
}

/** `path` with the site's period state (`keep`, e.g. "periodo=30d") plus the flow's own keys. */
export function withState(path: string, keep: string, own: Record<string, string> = {}): string {
  const q = new URLSearchParams(keep)
  for (const [k, v] of Object.entries(own)) q.set(k, v)
  const qs = q.toString()
  return qs ? `${path}?${qs}` : path
}
