import type { DateRange, Period } from '@/lib/engine/dates'
import { MAX_WINDOW_DAYS as PERIOD_MAX_DAYS, parsePeriod, resolve, viewerStores, type Note, type PeriodValue } from '@/lib/period'

/** Longest window a route will price (lib/period MAX_WINDOW_DAYS). */
export const MAX_WINDOW_DAYS = PERIOD_MAX_DAYS

export class BadRequest extends Error {}

/**
 * The calendar days a campaign/creative request asks for, in the store's
 * timezone, through lib/period (R9, R19): ?period=<preset> or
 * ?period=custom&from=YYYY-MM-DD&to=YYYY-MM-DD, normalised and fitted on the
 * store's clock, with the notes of any fit. The old dateFrom/dateTo pair
 * (browser dates) is read as a custom window. A long or future range is never
 * refused (it is cut and announced); 400 only for a malformed request.
 */
export function parseWindow(
  sp: URLSearchParams, tz: string, fallback: Period = '7d', now: Date = new Date(), // clock-ok: request instant default
): { range: DateRange; period: Period; notes: Note[] } {
  const from = sp.get('from') ?? sp.get('dateFrom')
  const to = sp.get('to') ?? sp.get('dateTo')
  const raw = sp.get('period')
  const periodo = raw ?? (from || to ? 'custom' : fallback)
  const parsed = parsePeriod({ periodo, de: from, ate: to })
  if (!parsed.value) {
    if (parsed.notes.includes('bad_param')) throw new BadRequest('Período inválido')
    if (parsed.notes.includes('too_early')) throw new BadRequest('Escolha datas a partir de 1 jan 2000')
    throw new BadRequest('Datas inválidas: use from e to no formato AAAA-MM-DD')
  }
  const value: PeriodValue = parsed.value
  const vs = viewerStores([{ id: 'store', name: 'loja', timezone: tz, archived: false }])
  const r = resolve({ scope: { kind: 'store', id: 'store' }, period: value, split: false }, vs, now)
  const notes = [...parsed.notes.map(code => ({ code })), ...r.notes.filter(n => n.code === 'future_start' || n.code === 'future_end')]
  return { range: r.window, period: value.kind === 'preset' ? value.preset : 'custom', notes }
}
