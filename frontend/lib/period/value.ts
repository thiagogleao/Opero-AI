/**
 * The period value and its URL form (R1, R7, R9).
 *
 * A preset has no dates of its own: it gets them only when resolved, at a
 * given `now`, in the clock of the scope that shows it. Dates stay dates. No
 * function here converts one into the other (P2) — that conversion, made each
 * time a period was carried somewhere, caused every period regression of the
 * last five rounds (spec §0).
 */

import { daysBetween, formatRange, isIsoDate, resolveRange, shiftDate } from '../engine/dates'
import type { DateRange, IsoDate, NoteCode, PeriodValue, Preset } from './types'

/** Longest window priced at once, in days. */
export const MAX_WINDOW_DAYS = 366
/** No date before this one (older years break plain-date arithmetic). */
export const MIN_DATE = '2000-01-01'

export interface PresetInfo {
  preset: Preset
  /** "Últimos 7 dias". */
  label: string
  /** The button text: "7 dias". */
  button: string
  /** For sentences: "nos últimos 7 dias". */
  phrase: string
}

export const PRESETS: readonly PresetInfo[] = [
  { preset: 'today', label: 'Hoje', button: 'Hoje', phrase: 'hoje' },
  { preset: 'yesterday', label: 'Ontem', button: 'Ontem', phrase: 'ontem' },
  { preset: '7d', label: 'Últimos 7 dias', button: '7 dias', phrase: 'nos últimos 7 dias' },
  { preset: '14d', label: 'Últimos 14 dias', button: '14 dias', phrase: 'nos últimos 14 dias' },
  { preset: '30d', label: 'Últimos 30 dias', button: '30 dias', phrase: 'nos últimos 30 dias' },
  { preset: '90d', label: 'Últimos 90 dias', button: '90 dias', phrase: 'nos últimos 90 dias' },
  { preset: 'mtd', label: 'Este mês', button: 'Este mês', phrase: 'neste mês' },
  { preset: 'lastmonth', label: 'Mês passado', button: 'Mês passado', phrase: 'no mês passado' },
]

const PRESET_SET = new Set<string>(PRESETS.map(p => p.preset))

export function isPreset(v: unknown): v is Preset {
  return typeof v === 'string' && PRESET_SET.has(v)
}

export function presetInfo(p: Preset): PresetInfo {
  return PRESETS.find(x => x.preset === p)!
}

/** One menu for both platforms (R7): four main buttons, the rest under "Mais".
 *  90 dias has a desktop entry too, so a link that carries it is representable. */
export const MENU = {
  main: ['today', 'yesterday', '7d', '30d'] as readonly Preset[],
  more: ['14d', '90d', 'mtd', 'lastmonth'] as readonly Preset[],
} as const

export const preset = (p: Preset): PeriodValue => ({ kind: 'preset', preset: p })
export const dates = (from: IsoDate, to: IsoDate): PeriodValue =>
  from <= to ? { kind: 'dates', from, to } : { kind: 'dates', from: to, to: from }

export type Platform = 'desktop' | 'phone'

/** Platform defaults (briefs, not period rules): desktop 7 dias; phone Hoje. */
export function defaultPeriod(platform: Platform): PeriodValue {
  return preset(platform === 'desktop' ? '7d' : 'today')
}

export function isDefault(value: PeriodValue, platform: Platform): boolean {
  return samePeriod(value, defaultPeriod(platform))
}

export function samePeriod(a: PeriodValue | null | undefined, b: PeriodValue | null | undefined): boolean {
  if (!a || !b) return a === b
  if (a.kind === 'preset') return b.kind === 'preset' && a.preset === b.preset
  return b.kind === 'dates' && a.from === b.from && a.to === b.to
}

/** A string key for a period value ("p:7d", "d:2026-11-01:2026-11-10"). */
export function periodKey(v: PeriodValue): string {
  return v.kind === 'preset' ? `p:${v.preset}` : `d:${v.from}:${v.to}`
}

// ─── Normalising (clock-independent, what links carry) ───────────────────────

export interface Normalised {
  /** Null: the dates are wholly before MIN_DATE (note too_early). */
  value: Extract<PeriodValue, { kind: 'dates' }> | null
  notes: Extract<NoteCode, 'floor' | 'too_early' | 'too_long'>[]
}

/**
 * R9: orders the dates, raises a start before MIN_DATE to MIN_DATE (drops the
 * value when the end is before it too) and keeps the last 366 days ending at
 * the ASKED end. Clock-independent and idempotent: links, the phone's saved
 * view and API requests carry this, never a clock-dependent fit, so a round
 * trip keeps what was asked (C2-H5).
 */
export function normaliseDates(from: IsoDate, to: IsoDate): Normalised {
  const b = from <= to ? to : from
  let a = from <= to ? from : to
  if (b < MIN_DATE) return { value: null, notes: ['too_early'] }
  const notes: Normalised['notes'] = []
  if (a < MIN_DATE) { a = MIN_DATE; notes.push('floor') }
  if (daysBetween(a, b) > MAX_WINDOW_DAYS) {
    a = shiftDate(b, -(MAX_WINDOW_DAYS - 1))
    // The 366-day cut moved the start past 2000: the floor no longer shapes
    // what is shown, and its note would not hold on the canonical URL
    // (ajusteHolds: floor only when the dates start on MIN_DATE), so the
    // redirect ran twice and dropped it the second time (R15: one redirect,
    // canonical(canonical(x)) = canonical(x)). Only codes that hold are emitted.
    const f = notes.indexOf('floor')
    if (f >= 0 && a > MIN_DATE) notes.splice(f, 1)
    notes.push('too_long')
  }
  return { value: { kind: 'dates', from: a, to: b }, notes }
}

// ─── Parsing the URL form ────────────────────────────────────────────────────

export interface RawPeriod {
  periodo?: string | null
  de?: string | null
  ate?: string | null
}

export interface ParsedPeriod {
  /** Null: nothing usable (the caller uses its default or saved period). */
  value: PeriodValue | null
  /** Why the URL's period was not used, or how it was normalised. */
  notes: NoteCode[]
  /** The URL said nothing about a period (no periodo, no de/ate). */
  absent: boolean
}

/**
 * The period part of a URL (R15 steps 3, 4 and 6; the legacy `volta`/`dia`
 * steps live in url.ts and push.ts). Never throws; every rejection is a note.
 *  - periodo = a preset → that preset; stray de/ate are dropped, no note;
 *  - periodo=custom (or de + ate without periodo) with two real dates → dates,
 *    normalised;
 *  - periodo=custom with one date or none, or a date that is not a real
 *    YYYY-MM-DD → 'incomplete';
 *  - periodo not in the enum → 'bad_param';
 *  - dates wholly before 2000 → 'too_early'.
 */
export function parsePeriod(raw: RawPeriod): ParsedPeriod {
  const p = raw.periodo ?? null
  const de = raw.de ?? null
  const ate = raw.ate ?? null
  if (p && isPreset(p)) return { value: preset(p), notes: [], absent: false }
  if (p && p !== 'custom') return { value: null, notes: ['bad_param'], absent: false }
  if (!p && !de && !ate) return { value: null, notes: [], absent: true }
  if (!(isIsoDate(de) && isIsoDate(ate))) {
    // de/ate without periodo, one of them broken: as incomplete.
    return { value: null, notes: ['incomplete'], absent: false }
  }
  const n = normaliseDates(de, ate)
  return { value: n.value, notes: [...n.notes], absent: false }
}

/** The URL keys of a period value: periodo (+ de, ate). */
export function periodParams(value: PeriodValue): { periodo: string; de?: IsoDate; ate?: IsoDate } {
  return value.kind === 'preset' ? { periodo: value.preset } : { periodo: 'custom', de: value.from, ate: value.to }
}

// ─── Resolving on a clock ────────────────────────────────────────────────────

/** A preset's dates on a clock whose today is `today` (the engine's meanings,
 *  lib/engine/dates resolveRange): rolling windows are complete days ending
 *  yesterday; Este mês runs to today; Mês passado is the calendar month. */
export function presetRange(p: Preset, today: IsoDate): DateRange {
  // resolveRange reads "today" from (tz, now); noon UTC of `today` in UTC is
  // that same date, so the engine's own arithmetic is reused, not copied.
  return resolveRange(p, 'UTC', null, null, new Date(`${today}T12:00:00Z`))
}

export interface Fitted {
  window: DateRange
  /** The value the window shows: a dates value that has not begun shows Hoje. */
  effective: PeriodValue
  notes: Extract<NoteCode, 'future_start' | 'future_end'>[]
}

/**
 * R9: what a screen shows for a value on a clock whose today is `clockToday`.
 *  1. a start after today → Hoje of this clock, note future_start;
 *  2. an end after today → cut to today, note future_end.
 * The selection is not rewritten (P1): the screen shows this window with the
 * note, and the dates asked keep travelling.
 */
export function fitValue(value: PeriodValue, clockToday: IsoDate): Fitted {
  if (value.kind === 'preset') return { window: presetRange(value.preset, clockToday), effective: value, notes: [] }
  if (value.from > clockToday) {
    return { window: { from: clockToday, to: clockToday }, effective: preset('today'), notes: ['future_start'] }
  }
  if (value.to > clockToday) return { window: { from: value.from, to: clockToday }, effective: value, notes: ['future_end'] }
  return { window: { from: value.from, to: value.to }, effective: value, notes: [] }
}

/** The check of the "Escolher datas" forms, desktop and phone alike (R9):
 *  `max` is the shown clock's today. Returns the value to apply or an error. */
export function checkPickedDates(
  from: string, to: string, max: IsoDate,
): { ok: true; value: Extract<PeriodValue, { kind: 'dates' }> } | { ok: false; error: string } {
  if (!isIsoDate(from) || !isIsoDate(to)) return { ok: false, error: 'Escolha as duas datas.' }
  const [a, b] = from <= to ? [from, to] : [to, from]
  if (a > max) return { ok: false, error: 'A data inicial não pode passar de hoje.' }
  if (b > max) return { ok: false, error: 'A data final não pode passar de hoje.' }
  if (b < MIN_DATE || a < MIN_DATE) return { ok: false, error: 'Escolha datas a partir de 1 jan 2000.' }
  if (daysBetween(a, b) > MAX_WINDOW_DAYS) return { ok: false, error: `No máximo ${MAX_WINDOW_DAYS} dias por vez.` }
  return { ok: true, value: { kind: 'dates', from: a, to: b } }
}

/**
 * What an "Escolher datas" form starts with (R7, R9): a dates selection shows
 * its dates AS ASKED, never the fitted window (the fit is in the note), so
 * editing one field keeps the other as asked; a preset shows the window on
 * screen. `max` is the clock's today, or the asked end when the selection
 * asked beyond it (Tokyo's 25 nov on a Brasília screen): a round trip through
 * the form keeps the 25th, as links do (C2-H5).
 */
export function pickerDates(current: PeriodValue, window: DateRange, clockToday: IsoDate): { from: IsoDate; to: IsoDate; max: IsoDate } {
  if (current.kind === 'dates') {
    return { from: current.from, to: current.to, max: current.to > clockToday ? current.to : clockToday }
  }
  return { from: window.from, to: window.to, max: clockToday }
}

// ─── Names ───────────────────────────────────────────────────────────────────

/** The compact form of dates for a button: "23 nov", "3–12 nov", "25/10–23/11",
 *  never with a year (it goes to the second line, datesButtonYear). */
export function datesButton(r: DateRange): string {
  const [y1, m1, d1] = r.from.split('-').map(Number)
  const [y2, m2, d2] = r.to.split('-').map(Number)
  if (y1 === y2 && m1 === m2) return formatRange(r, r.to)
  return `${d1}/${m1}–${d2}/${m2}`
}

/** "2025", "2025–26" when either end is not in today's year, else null. */
export function datesButtonYear(r: DateRange, today: IsoDate): string | null {
  const y1 = r.from.slice(0, 4)
  const y2 = r.to.slice(0, 4)
  const thisYear = today.slice(0, 4)
  if (y1 === thisYear && y2 === thisYear) return null
  return y1 === y2 ? y1 : `${y1}–${y2.slice(2)}`
}

/** The name of a value without a clock (what was asked): "Últimos 7 dias",
 *  "1–15 nov". For a saved view's label ("Todas · 7 dias") use short=true. */
export function valueName(v: PeriodValue, today?: IsoDate, short = false): string {
  if (v.kind === 'preset') return short ? presetInfo(v.preset).button : presetInfo(v.preset).label
  return formatRange({ from: v.from, to: v.to }, today)
}
