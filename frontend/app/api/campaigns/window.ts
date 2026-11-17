import { daysBetween, isIsoDate, isPeriod, resolveRange, type DateRange, type Period } from '@/lib/engine/dates'

/** Longest window a route will price: a year of ad-days is ~30k rows. */
export const MAX_WINDOW_DAYS = 366

export class BadRequest extends Error {}

/**
 * The calendar days a campaign/creative request asks for, in the store's
 * timezone: ?period=7d|14d|30d|…|custom&from=YYYY-MM-DD&to=YYYY-MM-DD. The old
 * dateFrom/dateTo pair (browser dates) is read as a custom window, clamped to
 * the store's today. Throws BadRequest on bad dates or an over-long window.
 */
export function parseWindow(
  sp: URLSearchParams, tz: string, fallback: Period = '7d', now: Date = new Date(),
): { range: DateRange; period: Period } {
  const from = sp.get('from') ?? sp.get('dateFrom')
  const to = sp.get('to') ?? sp.get('dateTo')
  const raw = sp.get('period')
  const period: Period = isPeriod(raw) ? raw : from || to ? 'custom' : fallback
  if (period === 'custom' && !(isIsoDate(from) && isIsoDate(to))) {
    throw new BadRequest('Datas inválidas: use from e to no formato AAAA-MM-DD')
  }
  const range = resolveRange(period, tz, from, to, now)
  if (daysBetween(range.from, range.to) > MAX_WINDOW_DAYS) {
    throw new BadRequest(`Período longo demais: no máximo ${MAX_WINDOW_DAYS} dias`)
  }
  return { range, period }
}
