/**
 * Chargebacks in words (pure, tested in __tests__/disputes.test.ts): the
 * status split the Resumo prints next to a count, built so the parts add up to
 * that count.
 *
 *   healthParts(h)        the 90-day line: "7 em aberto · 5 perdidas · 11
 *                         ganhas · 8 evitadas"
 *   rateWithoutPrevented  the 90-day rate if the prevented disputes did not
 *                         count (they do here, the prudent side)
 *   windowStatusText(c)   what became of the chargebacks that arrived in the
 *                         period, today: "Situação hoje: 16 em aberto · 14
 *                         perdidas · 7 evitadas. Mais 3 ganhas, que não
 *                         custam nada."
 */

import type { ChargebackHealth, DisputeStatusCounts } from '@/lib/adjustments'
import { formatCount } from '@/lib/format'

/** An archived store's archive instant as lib/period archiveMoment says it
 *  ("10 nov", "09h02"); day null when unknown. */
export interface ArchivedAt { day: string | null; time?: string | null }

type Counts = Pick<ChargebackHealth, 'open' | 'lost' | 'won' | 'prevented' | 'other'>

const word = (n: number, one: string, many: string) => `${formatCount(n)} ${n === 1 ? one : many}`

/**
 * The 90-day breakdown next to "31 de 700 pedidos". Open, lost and won are
 * always named (a zero there is news); prevented and any other status only
 * when there are some — but they ARE named, so the parts add up to the count
 * (CAMP HALLOW read "7 em aberto · 5 perdidas · 11 ganhas" = 23 next to 31).
 */
export function healthParts(h: Counts): string[] {
  const prevented = h.prevented ?? 0
  const other = h.other ?? 0
  return [
    `${formatCount(h.open)} em aberto`,
    word(h.lost, 'perdida', 'perdidas'),
    word(h.won, 'ganha', 'ganhas'),
    ...(prevented > 0 ? [word(prevented, 'evitada', 'evitadas')] : []),
    ...(other > 0 ? [`${formatCount(other)} em outra situação`] : []),
  ]
}

/** The 90-day rate with the prevented disputes left out, or null when there
 *  are none (nothing to say). */
export function rateWithoutPrevented(h: Pick<ChargebackHealth, 'count' | 'orders' | 'prevented'>): number | null {
  const prevented = h.prevented ?? 0
  if (prevented <= 0 || h.orders <= 0) return null
  return ((h.count - prevented) / h.orders) * 100
}

/**
 * What became of the chargebacks that arrived in the period, today. The
 * engine's count is every one but the won (those cost nothing): the parts that
 * cost — open, lost, prevented, other — add up to it, and the won ones are
 * said apart. Null when nothing arrived.
 *
 * An archived store (`archived`: its archive day when known, and today for
 * the date's year) is not read any more: the status is the one read when it
 * was archived, not today's, and open ones may have moved since — the phone's
 * caveat. "Situação hoje: 10 em aberto" sat right above "Até 10 nov, quando a
 * loja foi arquivada…" in the same block.
 */
export function windowStatusText(c: DisputeStatusCounts, archived?: ArchivedAt | null): string | null {
  const parts = [
    c.open > 0 ? `${formatCount(c.open)} em aberto` : null,
    c.lost > 0 ? word(c.lost, 'perdida', 'perdidas') : null,
    c.prevented > 0 ? word(c.prevented, 'evitada', 'evitadas') : null,
    c.other > 0 ? `${formatCount(c.other)} em outra situação` : null,
  ].filter((x): x is string => x !== null)
  const free = `não ${c.won === 1 ? 'custa' : 'custam'} nada`
  if (!parts.length) return c.won > 0 ? `${word(c.won, 'disputa ganha', 'disputas ganhas')} no período: ${free}.` : null
  const asOf = !archived ? 'Situação hoje'
    : archived.day ? `Situação em ${archived.day}${archived.time ? ` às ${archived.time}` : ''}, quando a loja foi arquivada` : 'Situação quando a loja foi arquivada'
  const moved = archived && c.open > 0 ? ` O estado ${c.open === 1 ? 'da aberta' : 'das abertas'} pode ter mudado desde então.` : ''
  return `${asOf}: ${parts.join(' · ')}.${c.won > 0 ? ` Mais ${word(c.won, 'ganha', 'ganhas')}, que ${free}.` : ''}${moved}`
}
