/**
 * Building ViewerStores from what lib/access lists and what the server read
 * about each store (pure; the loader is lib/views/periodFacts.ts).
 */

import { safeTz } from '../engine/dates'
import { todayIn } from './clock'
import type { IsoDate, StoreFacts, ViewerStores } from './types'

export interface StoreFactsInput {
  id: string
  name: string
  timezone: string | null | undefined
  archived: boolean
  archivedAt?: string | null
  firstOrderDate?: IsoDate | null
  firstActivityDate?: IsoDate | null
}

const collator = new Intl.Collator('pt-BR', { sensitivity: 'base' })

/** FALLBACK_ORDER (R5): by name (pt-BR collation), then id. */
export function byFallbackOrder(a: { name: string; id: string }, b: { name: string; id: string }): number {
  return collator.compare(a.name, b.name) || (a.id < b.id ? -1 : a.id > b.id ? 1 : 0)
}

export function storeFacts(s: StoreFactsInput): StoreFacts {
  const tz = safeTz(s.timezone)
  // An archived store whose instant is unknown is still archived: its day is
  // taken as the epoch so nothing after it is read as live.
  const archivedAt = s.archived ? (s.archivedAt ?? '1970-01-01T00:00:00.000Z') : null
  return {
    id: s.id, name: s.name, tz,
    archivedAt,
    archivedOn: archivedAt ? todayIn(tz, new Date(archivedAt)) : null,
    firstOrderDate: s.firstOrderDate ?? null,
    firstActivityDate: s.firstActivityDate ?? s.firstOrderDate ?? null,
  }
}

/** A short hash of the facts (R19): ids, archive instants, first dates. */
export function factsVersion(stores: readonly StoreFacts[]): string {
  const src = [...stores].sort((a, b) => (a.id < b.id ? -1 : 1))
    .map(s => `${s.id}:${s.archivedAt ?? ''}:${s.firstOrderDate ?? ''}:${s.firstActivityDate ?? ''}`).join('|')
  let h = 0x811c9dc5
  for (let i = 0; i < src.length; i++) { h ^= src.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0 }
  return h.toString(36)
}

export function viewerStores(list: readonly StoreFactsInput[]): ViewerStores {
  const facts = list.map(storeFacts)
  const active = facts.filter(s => !s.archivedOn).sort(byFallbackOrder)
  const archived = facts.filter(s => s.archivedOn).sort(byFallbackOrder)
  return { active, archived, allowsAll: active.length >= 2, version: factsVersion(facts) }
}
