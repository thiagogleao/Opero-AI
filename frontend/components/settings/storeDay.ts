import { todayInTz } from '@/lib/engine/dates'

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
