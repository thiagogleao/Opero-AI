/**
 * What the phone asks the server for (R19): the SHOWN selection (lib/period
 * phone shownSelection), never resolved dates. The server resolves with its
 * own clock; the client shows the server's resolution and drops an answer
 * only when it answers a different selection than the current one.
 */

import type { Selection } from '@/lib/period'

/** A stable key of a selection: scope and period value (a preset keeps its
 *  key across midnight; the turn watcher refetches it, R8). */
export function selectionKey(s: Selection): string {
  const scope = s.scope.kind === 'all' ? 'all' : s.scope.id
  return s.period.kind === 'preset' ? `${scope}|${s.period.preset}` : `${scope}|custom|${s.period.from}|${s.period.to}`
}

/** `store=all|<id>&period=<preset>` or `…&period=custom&from=&to=`. */
export function apiQuery(s: Selection): string {
  const q = new URLSearchParams()
  q.set('store', s.scope.kind === 'all' ? 'all' : s.scope.id)
  if (s.period.kind === 'preset') q.set('period', s.period.preset)
  else { q.set('period', 'custom'); q.set('from', s.period.from); q.set('to', s.period.to) }
  return q.toString()
}

export interface Echo { store: string; period: string; from: string | null; to: string | null }

/** The answer is about this selection (scope and period value). */
export function echoMatches(echo: Echo | null | undefined, s: Selection): boolean {
  if (!echo) return false
  const store = s.scope.kind === 'all' ? 'all' : s.scope.id
  if (echo.store !== store) return false
  if (s.period.kind === 'preset') return echo.period === s.period.preset
  return echo.period === 'custom' && echo.from === s.period.from && echo.to === s.period.to
}

/** The detail tabs, in order (lib/period/phone PHONE_TABS). */
export const TABS: { key: import('@/lib/period/phone').Tab; label: string }[] = [
  { key: 'campanhas', label: 'Campanhas' },
  { key: 'criativos', label: 'Criativos' },
  { key: 'produtos', label: 'Produtos' },
  { key: 'paises', label: 'Países' },
  { key: 'clientes', label: 'Clientes' },
]
