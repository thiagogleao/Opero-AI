/**
 * GET /api/mobile: which stores the request is about, and the response shape.
 *
 * The phone polls this every 45 s and after every tap, so two things matter
 * beyond the numbers: the response says exactly which store/period it answers
 * (the client drops any response that no longer matches what is on screen —
 * an old "Todas" answer landing after "MOKOO" was tapped used to overwrite it),
 * and identical requests in flight share one computation.
 */

import type { StoreRef } from '../access'
import type { Period } from '../engine/dates'
import { buildPortfolio, type PortfolioView } from './portfolio'

export interface MobileStoreOption {
  id: string
  /** Disambiguated ("Dumpling Squishy · 8jcp3a"). */
  name: string
  timezone: string
  archived: boolean
}

/** The request as understood, echoed so the client can drop stale answers. */
export interface MobileRequestEcho {
  /** 'all', or the store ids asked for, comma-separated, deduplicated, in the
   *  order received. */
  store: string
  period: Period
  /** The custom dates as received (null for presets). */
  from: string | null
  to: string | null
}

export interface MobileResponse extends PortfolioView {
  request: MobileRequestEcho
  /** Active stores for the store picker, oldest first. */
  storeOptions: MobileStoreOption[]
  /** Archived stores, for the separate "arquivadas" view (never in Todas). */
  archivedStores: MobileStoreOption[]
}

export class StoreSelectionError extends Error {
  constructor(public status: 400 | 404, message: string) { super(message) }
}

export const MAX_STORES_PER_REQUEST = 50

/**
 * Resolve the `store` parameter against the stores the viewer may see.
 *  - missing, '' or 'all': every ACTIVE store (archived ones never enter Todas);
 *  - 'id' or 'id1,id2': exactly those stores — an archived one only when asked
 *    for by id (its history view). Any id the viewer cannot see is a 404.
 */
export function selectStores(param: string | null, visible: readonly StoreRef[]): { key: string; stores: StoreRef[] } {
  const raw = (param ?? '').trim()
  if (raw === '' || raw === 'all') return { key: 'all', stores: visible.filter(s => !s.archived) }
  const ids = [...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))]
  if (!ids.length) return { key: 'all', stores: visible.filter(s => !s.archived) }
  if (ids.length > MAX_STORES_PER_REQUEST) throw new StoreSelectionError(400, 'Lojas demais')
  const byId = new Map(visible.map(s => [s.id, s]))
  const stores = ids.map(id => byId.get(id))
  if (stores.some(s => !s)) throw new StoreSelectionError(404, 'Loja não encontrada')
  return { key: ids.join(','), stores: stores as StoreRef[] }
}

export const toOption = (s: StoreRef): MobileStoreOption => ({ id: s.id, name: s.name, timezone: s.timezone, archived: s.archived })

// Identical requests in flight share one computation: the 45 s poll, a tab
// coming back to the foreground and a service-worker message often fire within
// the same second.
const inflight = new Map<string, Promise<PortfolioView>>()

export function portfolioOnce(
  key: string, stores: readonly StoreRef[], period: Period, from: string | null, to: string | null,
): Promise<PortfolioView> {
  const k = `${key}|${period}|${from ?? ''}|${to ?? ''}`
  const hit = inflight.get(k)
  if (hit) return hit
  const p = buildPortfolio(stores, period, from, to).finally(() => inflight.delete(k))
  inflight.set(k, p)
  return p
}
