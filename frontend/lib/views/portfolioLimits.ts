/**
 * Limits of the portfolio view. The window rules themselves (the 366-day cap,
 * the 2000 floor, fitting to today) live in lib/period (value.ts
 * normaliseDates / fitValue, R9), the single source for the desktop, the
 * phone and the APIs; these are re-exported for the screens that print them.
 */

export { MAX_WINDOW_DAYS, MIN_DATE as MIN_WINDOW_DATE } from '../period/value'

/** MIN_WINDOW_DATE in words, always with its year (it is never this year). */
export const MIN_WINDOW_LABEL = '1 jan 2000'

/** Newest sales the live feed carries (loadLiveFeed's LIMIT): the list on the
 *  phone is "the N most recent", never "all". */
export const LIVE_FEED_SIZE = 40
