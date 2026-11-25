/**
 * R2 "Live feed on Todas": the feed and the sale chime are not resolutions,
 * but on Todas a running window lists as its own only orders inside some
 * member's `read`. Hibikura's orders from Tokyo's next day (Todas · Hoje on
 * 24 nov at 21h07 BRT is Tokyo's 25 nov 09h07) go on one dim line per store,
 * "Hibikura · 2 vendas já em 25 nov (dia de Tóquio, fora deste Hoje)", never
 * among today's sales. The chime still rings: a sale happened. Pure.
 */

import { tzCity } from '../format'
import { todayIn } from './clock'
import { dateBeside } from './facts'
import type { IsoDate, Resolution } from './types'

export interface FeedItemDay { storeId: string; placedAt: string | null; receivedAt: string }

/** Sales of one store already on a day after its member's read. */
export interface FeedAhead { storeId: string; day: IsoDate; count: number }

/**
 * The feed split by R2. Applies only on Todas with a window that reaches the
 * clock's today (Hoje, Este mês, dates ending today): the case where a
 * member's own day has moved past the window. A closed window's feed is the
 * list of recent sales it always was. `tzOf`: the store's timezone.
 */
export function feedSplit<T extends FeedItemDay>(
  items: readonly T[],
  r: Pick<Resolution, 'selection' | 'members' | 'window' | 'clockToday'> | null | undefined,
  tzOf: (storeId: string) => string | null | undefined,
): { inRead: T[]; ahead: FeedAhead[] } {
  if (!r || r.selection.scope.kind !== 'all' || r.window.to < r.clockToday) return { inRead: [...items], ahead: [] }
  const inRead: T[] = []
  const ahead = new Map<string, FeedAhead>()
  for (const o of items) {
    const m = r.members.find(x => x.storeId === o.storeId)
    const tz = tzOf(o.storeId)
    const day = tz ? todayIn(tz, new Date(o.placedAt ?? o.receivedAt)) : null
    if (m?.read && day && day > m.read.to) {
      const k = `${o.storeId}|${day}`
      const a = ahead.get(k) ?? { storeId: o.storeId, day, count: 0 }
      a.count += 1
      ahead.set(k, a)
    } else {
      inRead.push(o)
    }
  }
  return { inRead, ahead: [...ahead.values()] }
}

/** "Hibikura · 2 vendas já em 25 nov (dia de Tóquio, fora deste Hoje)". */
export function feedAheadText(
  a: FeedAhead, name: string, tz: string,
  r: Pick<Resolution, 'selection' | 'window' | 'clockToday'>,
): string {
  const day = dateBeside(a.day, { window: r.window, clockToday: r.clockToday })
  const what = a.count === 1 ? '1 venda' : `${a.count} vendas`
  const sel = r.selection.period
  const of = sel.kind === 'preset' && sel.preset === 'today' ? 'deste Hoje' : 'deste período'
  return `${name} · ${what} já em ${day} (dia de ${tzCity(tz)}, fora ${of})`
}
