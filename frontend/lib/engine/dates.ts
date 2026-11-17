/**
 * Calendar arithmetic and the period presets, in one place.
 *
 * Every date in Opero is a plain YYYY-MM-DD string in some store's timezone.
 * A period is resolved on the server, never in the browser: the browser's
 * clock is whatever the laptop says, and the store's day is what Shopify and
 * the supplier bill against.
 */

export const REFERENCE_TZ = 'America/Sao_Paulo'

export type Period =
  | 'today' | 'yesterday' | '7d' | '14d' | '30d' | '90d' | 'mtd' | 'lastmonth' | 'custom'

export const PERIODS: { key: Period; label: string; short: string }[] = [
  { key: 'today',     label: 'Hoje',           short: 'Hoje' },
  { key: 'yesterday', label: 'Ontem',          short: 'Ontem' },
  { key: '7d',        label: 'Últimos 7 dias', short: '7 dias' },
  { key: '14d',       label: 'Últimos 14 dias', short: '14 dias' },
  { key: '30d',       label: 'Últimos 30 dias', short: '30 dias' },
  { key: 'mtd',       label: 'Este mês',       short: 'Este mês' },
  { key: 'lastmonth', label: 'Mês passado',    short: 'Mês passado' },
  { key: '90d',       label: 'Últimos 90 dias', short: '90 dias' },
  { key: 'custom',    label: 'Escolher datas', short: 'Datas' },
]

const PERIOD_KEYS = new Set(PERIODS.map(p => p.key))

export function isPeriod(v: unknown): v is Period {
  return typeof v === 'string' && PERIOD_KEYS.has(v as Period)
}

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/

/** A real calendar date in YYYY-MM-DD form. Anything else is rejected rather
 *  than handed to SQL, where a typo becomes a 500. */
export function isIsoDate(v: unknown): v is string {
  if (typeof v !== 'string' || !DATE_RE.test(v)) return false
  const [y, m, d] = v.split('-').map(Number)
  const dt = new Date(Date.UTC(y, m - 1, d))
  return dt.getUTCFullYear() === y && dt.getUTCMonth() === m - 1 && dt.getUTCDate() === d
}

export function isTimeZone(tz: unknown): tz is string {
  if (typeof tz !== 'string' || !tz) return false
  try { new Intl.DateTimeFormat('en-US', { timeZone: tz }); return true } catch { return false }
}

export function safeTz(tz: string | null | undefined): string {
  return isTimeZone(tz) ? tz : 'UTC'
}

/** YYYY-MM-DD for `now` in an IANA timezone. */
export function todayInTz(tz: string, now: Date = new Date()): string {
  return now.toLocaleDateString('en-CA', { timeZone: safeTz(tz) })
}

/** Minutes since local midnight in `tz`. */
export function minutesIntoDay(tz: string, now: Date = new Date()): number {
  const parts = new Intl.DateTimeFormat('en-GB', {
    timeZone: safeTz(tz), hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(now)
  const h = Number(parts.find(p => p.type === 'hour')?.value ?? 0) % 24
  const m = Number(parts.find(p => p.type === 'minute')?.value ?? 0)
  return h * 60 + m
}

/** Shift a YYYY-MM-DD string by N days without DST drift. */
export function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

/** Inclusive number of days from `from` to `to`. */
export function daysBetween(from: string, to: string): number {
  return Math.round((Date.parse(`${to}T00:00:00Z`) - Date.parse(`${from}T00:00:00Z`)) / 86400000) + 1
}

/** Every date from `from` to `to`, inclusive. */
export function eachDay(from: string, to: string): string[] {
  const n = daysBetween(from, to)
  const out: string[] = []
  for (let i = 0; i < n; i++) out.push(shiftDate(from, i))
  return out
}

export interface DateRange { from: string; to: string }

/**
 * Resolve a preset to absolute dates in `tz`.
 *
 * Rolling windows ("7 dias", "30 dias") are complete days that end yesterday,
 * the way Shopify and Meta count them, so the numbers can be compared with
 * either and a half-finished morning does not drag a week down. Calendar
 * windows ("Este mês") run through today and are flagged as partial.
 */
export function resolveRange(
  period: Period,
  tz: string,
  from?: string | null,
  to?: string | null,
  now: Date = new Date(),
): DateRange {
  const today = todayInTz(tz, now)
  if (period === 'custom') {
    if (isIsoDate(from) && isIsoDate(to)) {
      const [a, b] = from <= to ? [from, to] : [to, from]
      // Never past today in the store's own calendar.
      return { from: a > today ? today : a, to: b > today ? today : b }
    }
    return { from: today, to: today }
  }
  const [y, m] = today.split('-').map(Number)
  const iso = (d: Date) => d.toISOString().slice(0, 10)
  switch (period) {
    case 'yesterday': { const d = shiftDate(today, -1); return { from: d, to: d } }
    case '7d':  return { from: shiftDate(today, -7),  to: shiftDate(today, -1) }
    case '14d': return { from: shiftDate(today, -14), to: shiftDate(today, -1) }
    case '30d': return { from: shiftDate(today, -30), to: shiftDate(today, -1) }
    case '90d': return { from: shiftDate(today, -90), to: shiftDate(today, -1) }
    case 'mtd': return { from: iso(new Date(Date.UTC(y, m - 1, 1))), to: today }
    case 'lastmonth': return {
      from: iso(new Date(Date.UTC(y, m - 2, 1))),
      to:   iso(new Date(Date.UTC(y, m - 1, 0))),
    }
    case 'today':
    default: return { from: today, to: today }
  }
}

/** What a period is compared with, and how to say it. */
export interface Comparison extends DateRange {
  label: string
  /** True when the current window is still running and the comparison is cut
   *  at the same point of the day. */
  sameTimeOfDay: boolean
}

/**
 * The comparison window for a period.
 *  - Today → yesterday, cut at the same time of day (the cut itself is applied
 *    by the engine per store, on each store's own clock).
 *  - This month → the same days of last month.
 *  - Last month → the month before.
 *  - Anything else → the window of the same length right before it.
 */
export function comparisonRange(period: Period, range: DateRange, tz: string, now: Date = new Date()): Comparison {
  const today = todayInTz(tz, now)
  if (period === 'today' || (range.from === range.to && range.to === today)) {
    const d = shiftDate(range.from, -1)
    return { from: d, to: d, label: 'ontem até esta hora', sameTimeOfDay: true }
  }
  if (period === 'mtd') {
    const [y, m, d] = range.to.split('-').map(Number)
    const prevMonthDays = new Date(Date.UTC(y, m - 1, 0)).getUTCDate()
    const from = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10)
    const to = new Date(Date.UTC(y, m - 2, Math.min(d, prevMonthDays))).toISOString().slice(0, 10)
    return { from, to, label: `mesmos dias do mês passado`, sameTimeOfDay: range.to === today }
  }
  if (period === 'lastmonth') {
    const [y, m] = range.from.split('-').map(Number)
    const from = new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10)
    const to = new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10)
    return { from, to, label: 'mês anterior', sameTimeOfDay: false }
  }
  const n = daysBetween(range.from, range.to)
  const label = n === 1 ? 'dia anterior' : `${n} dias anteriores`
  return { from: shiftDate(range.from, -n), to: shiftDate(range.from, -1), label, sameTimeOfDay: false }
}

/** The timezone a period is resolved in: the store's own when there is one
 *  store, the reference clock (Brasília) when several are summed. Each store
 *  is then measured on that same calendar date in its own timezone. */
export function anchorTz(timezones: (string | null | undefined)[]): string {
  return timezones.length === 1 ? safeTz(timezones[0] || REFERENCE_TZ) : REFERENCE_TZ
}

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

/** "17 nov", "10–16 nov", "28 out – 3 nov", "1 set 2025 – 3 jan 2026". */
export function formatRange(r: DateRange, today?: string): string {
  const [y1, m1, d1] = r.from.split('-').map(Number)
  const [y2, m2, d2] = r.to.split('-').map(Number)
  const thisYear = today ? Number(today.slice(0, 4)) : y2
  const yr = (y: number) => (y !== thisYear ? ` ${y}` : '')
  if (r.from === r.to) return `${d1} ${MONTHS[m1 - 1]}${yr(y1)}`
  if (y1 === y2 && m1 === m2) return `${d1}–${d2} ${MONTHS[m2 - 1]}${yr(y2)}`
  if (y1 === y2) return `${d1} ${MONTHS[m1 - 1]} – ${d2} ${MONTHS[m2 - 1]}${yr(y2)}`
  return `${d1} ${MONTHS[m1 - 1]} ${y1} – ${d2} ${MONTHS[m2 - 1]} ${y2}`
}
