import { todayInTz } from '@/lib/engine/dates'
import { formatDate } from '@/lib/format'

/**
 * The calendar day (YYYY-MM-DD) an instant falls on in a store's timezone.
 *
 * Timestamps come from the database as UTC ISO strings ("2026-11-11T01:30:00Z").
 * Slicing the first ten characters takes the UTC date, which is already the
 * next day after 21h in Brazil (and still the previous day before 9h in
 * Tokyo); every date on screen is the store's own day, like the rest of the app.
 */
export function storeDay(at: string, tz: string): string {
  return todayInTz(tz, new Date(at))
}

/**
 * An instant as the app's short date on the store's calendar ("12 jan 2027",
 * the year only when it is not `today`'s), or null when `at` is not a date.
 * For a token's expiry: Meta gives an instant, and its UTC date is already
 * the next day after 21h in Brazil.
 */
export function storeDateLabel(at: string, tz: string, today: string): string | null {
  return Number.isNaN(Date.parse(at)) ? null : formatDate(storeDay(at, tz), today)
}
