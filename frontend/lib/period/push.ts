/**
 * R17: notification (push) links. One producer, every push carries the dates
 * it is about (never a preset), a nonce `n` and, for Todas, a hash `m` of the
 * members it summed. The phone opens a one-visit view on exactly those dates
 * (R16), never saved and never rolling.
 */

import { presetRange, isPreset, preset, normaliseDates, type Normalised } from './value'
import { isIsoDate } from '../engine/dates'
import type { IsoDate, PeriodValue } from './types'

export interface NotificationLink {
  /** A store id or 'todas'. */
  loja: string
  from: IsoDate
  to: IsoDate
  aba?: string | null
  nonce: string
  /** Todas pushes: the member ids the push summed. */
  members?: readonly string[] | null
}

/** 8 random base36 characters (not a secret). */
export function newNonce(rand: () => number = Math.random): string {
  let out = ''
  for (let i = 0; i < 8; i++) out += Math.floor(rand() * 36).toString(36)
  return out
}

/** A short stable hash of a store set (FNV-1a, 6 base36 chars). */
export function membersHash(ids: readonly string[]): string {
  let h = 0x811c9dc5
  for (const ch of [...ids].sort().join(',')) {
    h ^= ch.charCodeAt(0)
    h = Math.imul(h, 0x01000193) >>> 0
  }
  return h.toString(36).padStart(6, '0').slice(-6)
}

/**
 * `/m?loja=<id|todas>&periodo=custom&de=<from>&ate=<to>[&aba=]&origem=push&n=<nonce>[&m=<hash>]`.
 * `periodo=custom` is redundant for the new parser but lets a PWA window still
 * running the old JS open the right dates during the deploy (C2-H8).
 */
export function notificationHref(l: NotificationLink): string {
  const [from, to] = l.from <= l.to ? [l.from, l.to] : [l.to, l.from]
  const q = new URLSearchParams()
  q.set('loja', l.loja)
  q.set('periodo', 'custom')
  q.set('de', from)
  q.set('ate', to)
  if (l.aba) q.set('aba', l.aba)
  q.set('origem', 'push')
  q.set('n', l.nonce)
  if (l.members && l.loja === 'todas') q.set('m', membersHash(l.members))
  return `/m?${q.toString()}`
}

export interface LegacyRaw {
  periodo: string | null
  de: string | null
  ate: string | null
  dia: string | null
  volta: string | null
}

/**
 * Links still in the tray or an address bar from before the rewrite (R17):
 *  - custom&de&ate with dia and/or volta → those dates;
 *  - periodo=today&dia=D → D–D;
 *  - periodo=<preset>&dia=D → the preset resolved with D as the clock's today
 *    (the 7-day scale push gives the 7 days ending D−1, the days it judged);
 *  - periodo=<preset> without dia → that preset;
 *  - nothing dated → null (`undated`: they cannot be fixed).
 */
export function parseLegacyPush(raw: LegacyRaw): { value: PeriodValue | null; undated: boolean; notes: Normalised['notes'] } {
  // Dates are carried normalised (R9), as every other link: a raw 2024–2026
  // range made the request, the server's echo and the visit disagree, and
  // every answer was dropped ("Carregando…" for ever). The normalising notes
  // travel too (too_long, floor, too_early): a legacy link's cut is announced
  // with the desktop's words, never silently (P5), and dated input wholly
  // before 2000 is too_early, not "Notificação antiga, sem data".
  const dated = (a: IsoDate, b: IsoDate) => {
    const n = normaliseDates(a, b)
    return { value: n.value as PeriodValue | null, undated: false, notes: n.notes }
  }
  if (raw.periodo === 'custom' && isIsoDate(raw.de) && isIsoDate(raw.ate)) return dated(raw.de, raw.ate)
  if (isIsoDate(raw.dia) && isPreset(raw.periodo)) {
    const r = presetRange(raw.periodo, raw.dia)
    return dated(r.from, r.to)
  }
  if (isIsoDate(raw.dia)) return dated(raw.dia, raw.dia)
  if (isPreset(raw.periodo)) return { value: preset(raw.periodo), undated: false, notes: [] }
  return { value: null, undated: true, notes: [] }
}
