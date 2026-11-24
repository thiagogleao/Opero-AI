/**
 * The one number and date formatter. Portuguese (Brazil), US dollars only.
 *
 * Pure and dependency-free so it runs in server components, client
 * components and tests alike. Rules (from the UI brief):
 *   money     $1.313 without cents from $100 up; $9,80 below; negatives with a
 *             true minus sign (−$201); exactly zero is "$0".
 *   percent   12,0%        ROAS   1,95×        count  1.174
 *   dates     17 nov · ter, 17 nov · ranges 10–16 nov (engine formatRange)
 *   time      13h38 · relative "há 4 min"
 * Every label is Portuguese. There is no currency selector any more: values
 * are dollars everywhere.
 */

import { formatRange as engineFormatRange, type DateRange } from './engine/dates'

/** True minus sign (U+2212): the hyphen is too short next to a number. */
export const MINUS = '−'
export const EMPTY = '—'

type Num = number | null | undefined

const isNum = (v: Num): v is number => typeof v === 'number' && Number.isFinite(v)

const nfCache = new Map<string, Intl.NumberFormat>()
function nf(min: number, max: number): Intl.NumberFormat {
  const k = `${min}:${max}`
  let f = nfCache.get(k)
  if (!f) {
    f = new Intl.NumberFormat('pt-BR', { minimumFractionDigits: min, maximumFractionDigits: max })
    nfCache.set(k, f)
  }
  return f
}

/** "1.174", "12,5" — a plain number with pt-BR separators. */
export function formatNumber(v: Num, digits = 0, empty = EMPTY): string {
  if (!isNum(v)) return empty
  const s = nf(digits, digits).format(Math.abs(v))
  return roundsToZero(v, digits) ? s : (v < 0 ? MINUS : '') + s
}

const roundsToZero = (v: number, digits: number) => Math.abs(v) < 0.5 * 10 ** -digits

export interface MoneyOptions {
  /** auto (default): cents only below $100. always/never force it. */
  cents?: 'auto' | 'always' | 'never'
  /** Prefix positives with "+" (for deltas and signed results). */
  sign?: boolean
  /** Shown for null/undefined/NaN. */
  empty?: string
}

/** "$1.313", "$9,80", "−$201", "$0". */
export function formatMoney(v: Num, opts: MoneyOptions = {}): string {
  if (!isNum(v)) return opts.empty ?? EMPTY
  const abs = Math.abs(v)
  const mode = opts.cents ?? 'auto'
  // Decide on the ROUNDED value: $99,996 must read "$100", not "$100,00".
  const centsRounded = Math.round(abs * 100) / 100
  const withCents = mode === 'always' || (mode === 'auto' && centsRounded < 100)
  const shown = withCents ? centsRounded : Math.round(abs)
  // Anything that rounds to nothing is zero, without a sign.
  if (shown === 0) return mode === 'always' ? '$0,00' : '$0'
  const digits = withCents ? 2 : 0
  const prefix = v < 0 ? MINUS : opts.sign ? '+' : ''
  return `${prefix}$${nf(digits, digits).format(shown)}`
}

/** "+$1.313" / "−$201" / "$0": money that is a result, signed both ways. */
export function formatSignedMoney(v: Num, opts: Omit<MoneyOptions, 'sign'> = {}): string {
  return formatMoney(v, { ...opts, sign: true })
}

/** Money on a chart axis: always whole dollars ("$1.200", "−$800"). */
export function formatMoneyAxis(v: number): string {
  return formatMoney(v, { cents: 'never' })
}

export interface PctOptions { digits?: number; sign?: boolean; empty?: string }

/** "12,0%". `v` is already a percentage (12 means 12%). */
export function formatPct(v: Num, opts: PctOptions = {}): string {
  if (!isNum(v)) return opts.empty ?? EMPTY
  const d = opts.digits ?? 1
  const s = nf(d, d).format(Math.abs(v))
  const zero = roundsToZero(v, d)
  return `${zero ? '' : v < 0 ? MINUS : opts.sign ? '+' : ''}${s}%`
}

/** Change in percentage points: "2,3 p.p." (margins are compared this way). */
export function formatPp(v: Num, opts: PctOptions = {}): string {
  if (!isNum(v)) return opts.empty ?? EMPTY
  const d = opts.digits ?? 1
  const zero = roundsToZero(v, d)
  return `${zero ? '' : v < 0 ? MINUS : opts.sign ? '+' : ''}${nf(d, d).format(Math.abs(v))} p.p.`
}

/** "1,95×". */
export function formatRoas(v: Num, empty = EMPTY): string {
  if (!isNum(v)) return empty
  return `${nf(2, 2).format(v)}×`
}

/** "1.174" (whole things: orders, units, customers). */
export function formatCount(v: Num, empty = EMPTY): string {
  return formatNumber(isNum(v) ? Math.round(v) : v, 0, empty)
}

/** "1 pedido" / "14 pedidos". */
export function plural(n: number, one: string, many: string): string {
  return `${formatCount(n)} ${Math.abs(n) === 1 ? one : many}`
}

/** "32¢" — cents of each dollar sold. */
export function formatCents(share: Num, empty = EMPTY): string {
  if (!isNum(share)) return empty
  const r = Math.round(share)
  return `${r < 0 ? MINUS : ''}${Math.abs(r)}¢`
}

/**
 * Whole cents per dollar for parts of a total, by largest remainder so the
 * shown parts add up to exactly 100 when they cover the total. Parts can sum
 * to more than the total (a loss): then each is simply rounded.
 */
export function centsOfDollar(values: number[], total: number): number[] {
  if (!(total > 0)) return values.map(() => 0)
  const raw = values.map(v => (Math.max(0, v) / total) * 100)
  const sum = raw.reduce((a, b) => a + b, 0)
  if (sum > 100.0001) return raw.map(r => Math.round(r))
  const floor = raw.map(Math.floor)
  let left = Math.round(sum) - floor.reduce((a, b) => a + b, 0)
  raw
    .map((r, i) => [r - floor[i], i] as const)
    .sort((a, b) => b[0] - a[0])
    .forEach(([, i]) => { if (left > 0) { floor[i] += 1; left -= 1 } })
  return floor
}

/** Percentage change from `prev` to `cur`, or null when `prev` is not a
 *  positive base (a change "from a loss" has no meaningful percentage). */
export function pctChange(cur: Num, prev: Num): number | null {
  if (!isNum(cur) || !isNum(prev) || prev <= 0) return null
  return ((cur - prev) / prev) * 100
}

/** Below this base (in dollars) a percentage change is noise, not news. */
export const PCT_MIN_BASE = 50
/** Past this change (in %) a percentage stops meaning anything to a reader. */
export const PCT_MAX_CHANGE = 300

/**
 * pctChange, but only when the percentage is worth printing: a positive base
 * of at least `minBase` and a change within ±`maxPct`. A profit of $250 after
 * $1,89 the day before read "13.123% a mais"; the caller should say the
 * difference in dollars instead ("$248 a mais"). Null otherwise.
 */
export function readablePctChange(
  cur: Num, prev: Num, opts: { minBase?: number; maxPct?: number } = {},
): number | null {
  const ch = pctChange(cur, prev)
  if (ch === null || (prev as number) < (opts.minBase ?? PCT_MIN_BASE) || Math.abs(ch) > (opts.maxPct ?? PCT_MAX_CHANGE)) return null
  return ch
}

// ─── Dates and times ─────────────────────────────────────────────────────────

const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']
const MONTHS_LONG = ['janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho', 'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro']
const WEEKDAYS = ['dom', 'seg', 'ter', 'qua', 'qui', 'sex', 'sáb']
const WEEKDAYS_LONG = ['domingo', 'segunda', 'terça', 'quarta', 'quinta', 'sexta', 'sábado']

function parts(iso: string): [number, number, number] {
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number)
  return [y, m, d]
}
const weekdayOf = (iso: string) => {
  const [y, m, d] = parts(iso)
  return new Date(Date.UTC(y, m - 1, d)).getUTCDay()
}

/** "17 nov" (year added when it is not `today`'s year). */
export function formatDate(iso: string, today?: string): string {
  const [y, m, d] = parts(iso)
  const yr = today && Number(today.slice(0, 4)) !== y ? ` ${y}` : ''
  return `${d} ${MONTHS[m - 1]}${yr}`
}

/** "ter, 17 nov". */
export function formatWeekdayDate(iso: string, today?: string): string {
  return `${WEEKDAYS[weekdayOf(iso)]}, ${formatDate(iso, today)}`
}

/** "terça, 17 de novembro". */
export function formatLongDate(iso: string): string {
  const [, m, d] = parts(iso)
  return `${WEEKDAYS_LONG[weekdayOf(iso)]}, ${d} de ${MONTHS_LONG[m - 1]}`
}

/** "17/11". */
export function formatDdMm(iso: string): string {
  return `${iso.slice(8, 10)}/${iso.slice(5, 7)}`
}

/** Short weekday ("ter") and month ("nov") names, for chart axes. */
export function weekdayShort(iso: string): string { return WEEKDAYS[weekdayOf(iso)] }
export function monthShort(iso: string): string { return MONTHS[parts(iso)[1] - 1] }
/** "outubro". */
export function monthLong(iso: string): string { return MONTHS_LONG[parts(iso)[1] - 1] }

/** "10–16 nov", "28 out – 3 nov" (the engine's formatter, re-exported so
 *  every label goes through this module). */
export function formatRangeLabel(r: DateRange, today?: string): string {
  return engineFormatRange(r, today)
}

/** "13h38" from minutes since midnight. */
export function formatClock(minutes: number): string {
  const m = Math.max(0, Math.min(24 * 60, Math.round(minutes)))
  const h = Math.floor(m / 60)
  return `${String(h).padStart(2, '0')}h${String(m % 60).padStart(2, '0')}`
}

/** "13h38" for an instant in a timezone. */
export function formatTimeInTz(at: Date | string, tz: string): string {
  const d = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(d.getTime())) return EMPTY
  const p = new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', minute: '2-digit', hour12: false }).formatToParts(d)
  const h = Number(p.find(x => x.type === 'hour')?.value ?? 0) % 24
  const mi = Number(p.find(x => x.type === 'minute')?.value ?? 0)
  return formatClock(h * 60 + mi)
}

/** "10h18" — a duration in minutes. */
export function formatDuration(minutes: number): string {
  const m = Math.max(0, Math.round(minutes))
  if (m < 60) return `${m} min`
  return `${Math.floor(m / 60)}h${String(m % 60).padStart(2, '0')}`
}

/** "agora", "há 4 min", "há 3 h", "há 2 dias". */
export function formatRelativeTime(at: Date | string | null | undefined, now: Date = new Date()): string {
  if (!at) return 'nunca'
  const d = at instanceof Date ? at : new Date(at)
  if (Number.isNaN(d.getTime())) return 'nunca'
  const min = Math.floor((now.getTime() - d.getTime()) / 60000)
  if (min < 1) return 'agora'
  if (min < 60) return `há ${min} min`
  const h = Math.floor(min / 60)
  if (h < 48) return `há ${h} h`
  return `há ${Math.floor(h / 24)} dias`
}

/** "parcial · até 13h38". */
export function partialLabel(minutesCovered: number): string {
  return `parcial · até ${formatClock(minutesCovered)}`
}

const CITY: Record<string, string> = {
  'Asia/Tokyo': 'Tóquio', 'America/Sao_Paulo': 'São Paulo', 'America/Belem': 'Belém',
  'America/Los_Angeles': 'Los Angeles', 'America/New_York': 'Nova York', 'Europe/London': 'Londres',
  'Europe/Lisbon': 'Lisboa', UTC: 'UTC',
}

/** City name for a timezone ("Tóquio"). Same table as lib/views/portfolio
 *  cityOfTz, duplicated because that module loads the database. */
export function tzCity(tz: string): string {
  return Object.hasOwn(CITY, tz) ? CITY[tz] : (tz.split('/').pop() ?? tz).replace(/_/g, ' ')
}

/** Timezones that keep Brazil's calendar day (no "dia de X" label needed). */
const BRAZIL_DAY = new Set(['America/Sao_Paulo', 'America/Belem', 'America/Fortaleza', 'America/Recife', 'America/Bahia', 'America/Maceio', 'America/Araguaina', 'America/Santarem'])

/** "dia de Tóquio" for a store whose calendar day is not Brazil's, else null. */
export function dayOfLabel(tz: string): string | null {
  return BRAZIL_DAY.has(tz) ? null : `dia de ${tzCity(tz)}`
}
