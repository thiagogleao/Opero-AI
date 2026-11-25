/**
 * The stores of the spec's examples (spec.md, "Stores in the examples") and
 * instants in Brasília / Tokyo. Brasília is UTC−3 (no DST), Tokyo UTC+9.
 */

import { viewerStores } from '../viewer'
import type { ViewerStores } from '../types'

export const MOKOO = 'mokoo'
export const EPOCH = 'epoch'
export const HIBIKURA = 'hibikura'
export const GLOOTY = 'glooty'
export const SQUISHY = 'squishy'
export const CAMP = 'camp'

export const STORES = [
  { id: MOKOO, name: 'MOKOO', timezone: 'America/Belem', archived: false, firstOrderDate: '2026-04-11', firstActivityDate: '2026-04-11' },
  { id: EPOCH, name: 'EPOCH', timezone: 'America/Sao_Paulo', archived: false, firstOrderDate: '2025-06-01', firstActivityDate: '2025-06-01' },
  { id: HIBIKURA, name: 'Hibikura', timezone: 'Asia/Tokyo', archived: false, firstOrderDate: '2026-11-07', firstActivityDate: '2026-11-07' },
  { id: GLOOTY, name: 'Glooty', timezone: 'America/Belem', archived: false, firstOrderDate: '2026-11-06', firstActivityDate: '2026-11-04' },
  { id: CAMP, name: 'CAMP HALLOW', timezone: 'America/Sao_Paulo', archived: false, firstOrderDate: '2025-09-01', firstActivityDate: '2025-09-01' },
  // Archived 10 nov 2026 at 10:00 BRT.
  { id: SQUISHY, name: 'Squishy World', timezone: 'America/Sao_Paulo', archived: true, archivedAt: '2026-11-10T13:00:00.000Z', firstOrderDate: '2025-01-10', firstActivityDate: '2025-01-10' },
]

export const VIEWER: ViewerStores = viewerStores(STORES)

/** A partner with CAMP HALLOW only (no Todas). */
export const PARTNER_ONE: ViewerStores = viewerStores(STORES.filter(s => s.id === CAMP))
/** A partner with CAMP HALLOW and Glooty (Todas allowed), not EPOCH. */
export const PARTNER_TWO: ViewerStores = viewerStores(STORES.filter(s => s.id === CAMP || s.id === GLOOTY))

/** An instant at a Brasília wall time: brt('2026-11-24', '16:00'). */
export function brt(date: string, time: string, sec = '00', ms = '000'): Date {
  return new Date(`${date}T${time}:${sec}.${ms}-03:00`)
}

/** An instant at a Tokyo wall time. */
export function tokyo(date: string, time: string, sec = '00'): Date {
  return new Date(`${date}T${time}:${sec}.000+09:00`)
}

export const store = (id: string) => ({ kind: 'store' as const, id })
export const ALL = { kind: 'all' as const }
