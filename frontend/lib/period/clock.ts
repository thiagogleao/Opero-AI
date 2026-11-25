/**
 * The only clock primitives of the period rules (spec §2, R8). Every function
 * takes `now`: nothing here reads the device clock, so tests run the same
 * scenarios at 23:59 and 00:01 Brasília and Tokyo.
 *
 * They agree with lib/engine/dates todayInTz / minutesIntoDay (the engine
 * prices days with those), with cached formatters because a resolution asks
 * for a handful of clocks per member and the turn search asks ~12 times.
 */

import { anchorTz, REFERENCE_TZ, safeTz } from '../engine/dates'
import type { IsoDate } from './types'

const fmtCache = new Map<string, Intl.DateTimeFormat>()

function fmt(tz: string): Intl.DateTimeFormat {
  const key = safeTz(tz)
  let f = fmtCache.get(key)
  if (!f) {
    f = new Intl.DateTimeFormat('en-GB', {
      timeZone: key, year: 'numeric', month: '2-digit', day: '2-digit',
      hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false,
    })
    fmtCache.set(key, f)
  }
  return f
}

interface Wall { y: number; mo: number; d: number; h: number; mi: number; s: number }

function wall(tz: string, now: Date): Wall {
  const p: Record<string, string> = {}
  for (const part of fmt(tz).formatToParts(now)) p[part.type] = part.value
  return { y: Number(p.year), mo: Number(p.month), d: Number(p.day), h: Number(p.hour) % 24, mi: Number(p.minute), s: Number(p.second) }
}

const pad = (n: number) => String(n).padStart(2, '0')

/** YYYY-MM-DD of `now` in `tz`. */
export function todayIn(tz: string, now: Date): IsoDate {
  const w = wall(tz, now)
  return `${String(w.y).padStart(4, '0')}-${pad(w.mo)}-${pad(w.d)}`
}

/** Minutes since local midnight in `tz`. */
export function minutesInto(tz: string, now: Date): number {
  const w = wall(tz, now)
  return w.h * 60 + w.mi
}

/** UTC offset of `tz` at `now`, in minutes (Tokyo +540, Brasília −180). */
export function offsetMinutes(tz: string, now: Date): number {
  const w = wall(tz, now)
  const asUtc = Date.UTC(w.y, w.mo - 1, w.d, w.h, w.mi, w.s)
  const t = Math.floor(now.getTime() / 1000) * 1000
  return Math.round((asUtc - t) / 60000)
}

const MIN = 60_000

/**
 * The first instant after `now` at which todayIn(tz) changes. Searched, not
 * computed from "1440 − minutes", so a DST day (23 or 25 hours) is right for
 * any future US or European store. Midnights fall on whole minutes for every
 * real timezone, so the search runs over minutes.
 */
export function nextMidnight(tz: string, now: Date): Date {
  const today = todayIn(tz, now)
  let lo = Math.floor(now.getTime() / MIN) // minute containing now: still today
  let hi = lo + 26 * 60 // no day is longer than 25 h
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (todayIn(tz, new Date(mid * MIN)) === today) lo = mid
    else hi = mid
  }
  return new Date(hi * MIN)
}

/** The instant today began in `tz`. */
export function startOfDay(tz: string, now: Date): Date {
  const today = todayIn(tz, now)
  let hi = Math.floor(now.getTime() / MIN) // today
  let lo = hi - 26 * 60 // yesterday
  while (hi - lo > 1) {
    const mid = Math.floor((lo + hi) / 2)
    if (todayIn(tz, new Date(mid * MIN)) === today) hi = mid
    else lo = mid
  }
  return new Date(hi * MIN)
}

/** Length of today in `tz`, in minutes (1440; 1380 or 1500 on a DST day). */
export function dayMinutes(tz: string, now: Date): number {
  return Math.round((nextMidnight(tz, now).getTime() - startOfDay(tz, now).getTime()) / MIN)
}

/**
 * Whole minutes left before the day closes. Capped at dayMinutes − 1, so
 * 00:00:00.000 reads 23h59, never 24h00 (bug L95).
 */
export function minutesLeft(tz: string, now: Date): number {
  const left = Math.floor((nextMidnight(tz, now).getTime() - now.getTime()) / MIN)
  return Math.max(0, Math.min(left, dayMinutes(tz, now) - 1))
}

/** "Falta menos de 1 min", "Falta 1 min", "Faltam 5 min", "Faltam 1h20" (R8). */
export function countdownText(left: number): string {
  if (left <= 0) return 'Falta menos de 1 min'
  if (left === 1) return 'Falta 1 min'
  if (left < 60) return `Faltam ${left} min`
  const h = Math.floor(left / 60)
  return `${h === 1 ? 'Falta' : 'Faltam'} ${h}h${pad(left % 60)}`
}

/** The clock's UTC offset differs from Brasília's at `now`: the screen counts
 *  days on another calendar ("dia de Tóquio", R7). */
export function offsetDiffers(tz: string, now: Date): boolean {
  return offsetMinutes(tz, now) !== offsetMinutes(REFERENCE_TZ, now)
}

/** 'HHhMM' for minutes into a day. */
export function clockText(minutes: number): string {
  return `${pad(Math.floor(minutes / 60) % 24)}h${pad(minutes % 60)}`
}

/** The clock of a set of stores: the store's own for one, Brasília for
 *  several (or none). The owner's rule (R2). */
export function anchorOf(tzs: readonly string[]): string {
  return anchorTz([...tzs])
}
