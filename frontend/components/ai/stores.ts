/**
 * The viewer's stores for the Copilot header and, on "Todas", the store
 * chooser; the insights card reads a store's timezone here to know whether the
 * window on screen has a closed day yet (GET /api/stores: presence flags only,
 * never a credential). Fetched once per page load and shared by every caller.
 */

import type { StoreSummary } from '@/lib/integrations/types'

export interface StoreChoice { id: string; name: string; timezone: string | null }

let pending: Promise<StoreChoice[]> | null = null
let loaded: StoreChoice[] | null = null

export function cachedStores(): StoreChoice[] | null {
  return loaded
}

export function loadStores(force = false): Promise<StoreChoice[]> {
  if (force) { pending = null; loaded = null }
  pending ??= fetch('/api/stores', { cache: 'no-store' })
    .then(async res => {
      if (!res.ok) throw new Error(`HTTP ${res.status}`)
      const j = (await res.json()) as { stores?: StoreSummary[] }
      loaded = (j.stores ?? []).filter(x => !x.archived).map(x => ({ id: x.id, name: x.name, timezone: x.timezone || null }))
      return loaded
    })
    .catch(err => { pending = null; throw err })
  return pending
}
