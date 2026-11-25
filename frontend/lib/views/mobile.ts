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
import { parsePeriod, resolutionKey, type NoteCode, type PeriodValue, type Resolution, type ViewerStores } from '../period'
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
  /** The server's clock when it resolved (R19): the phone keeps an offset. */
  serverNow: string
  /** The store facts the server resolved with (R19): the phone adopts them
   *  when facts.version differs from its own. */
  facts: ViewerStores
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
 *    for ALONE by id (its history view). Any id the viewer cannot see is a
 *    404. A list is summed as a Todas of those stores, and a several-store
 *    scope holds active stores only (R2, R10): an archived id in a list is a
 *    400, never read as a live running day.
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
  if (stores.length > 1 && stores.some(s => s!.archived)) throw new StoreSelectionError(400, 'Loja arquivada só pode ser consultada sozinha')
  return { key: ids.join(','), stores: stores as StoreRef[] }
}

export const toOption = (s: StoreRef): MobileStoreOption => ({ id: s.id, name: s.name, timezone: s.timezone, archived: s.archived })

/**
 * The selection a request carries (R19): `period=<preset>` or
 * `period=custom&from&to`, normalised by lib/period (ordered, at most 366
 * days ending at the asked end). Null with a message for a malformed request
 * (the only 400): an unknown period, custom without both dates, dates wholly
 * before 2000. A long or future range is never refused (R9).
 */
export function parseMobilePeriod(sp: URLSearchParams): { value: PeriodValue; notes: NoteCode[] } | { error: string } {
  const period = sp.get('period') ?? 'today'
  const from = sp.get('from') || null
  const to = sp.get('to') || null
  if (period === 'custom' && !(from && to)) return { error: 'Escolha a data inicial e a final' }
  const parsed = parsePeriod({ periodo: period, de: from, ate: to })
  if (parsed.value) return { value: parsed.value, notes: parsed.notes }
  if (parsed.notes.includes('too_early')) return { error: 'Escolha datas a partir de 1 jan 2000' }
  if (parsed.notes.includes('incomplete')) return { error: 'Data inválida' }
  return { error: 'Período inválido' }
}

/** The echo of a selection (the phone drops answers to another selection). */
export function echoOf(key: string, value: PeriodValue): MobileRequestEcho {
  return value.kind === 'preset'
    ? { store: key, period: value.preset, from: null, to: null }
    : { store: key, period: 'custom', from: value.from, to: value.to }
}

// Identical requests in flight share one computation: the 45 s poll, a tab
// coming back to the foreground and a service-worker message often fire within
// the same second. Keyed by the resolution (selection + every member's day),
// so a request from 23:59:59 is never shared with one after midnight.
const inflight = new Map<string, Promise<PortfolioView>>()

export function portfolioOnce(stores: readonly StoreRef[], resolution: Resolution, facts?: ViewerStores | null): Promise<PortfolioView> {
  const k = resolutionKey(resolution)
  const hit = inflight.get(k)
  if (hit) return hit
  const p = buildPortfolio(stores, resolution, {}, facts).finally(() => inflight.delete(k))
  inflight.set(k, p)
  return p
}

