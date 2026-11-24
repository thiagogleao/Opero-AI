/**
 * The archive day of the store on screen, for the pages that build their own
 * verdict (Campanhas, Produtos, Países e clientes, Atribuição) and must read
 * an archived store's empty window as the Resumo does (./emptyWindow
 * archivedEmptyVerdict). Server only. The page context already read the day
 * for an archived store (ctx.archivedOn, lib/views/page archivedWindow); the
 * query here (lib/views/portfolio loadArchiveDates) is only the fallback when
 * that read came back empty.
 */

import 'server-only'
import { loadArchiveDates } from '@/lib/views/portfolio'
import type { PageContext } from '@/lib/views/page'
import type { FrozenVerdictInput } from './emptyWindow'

export type ArchivedStoreInput = Pick<FrozenVerdictInput, 'storeName' | 'archivedOn' | 'period' | 'range' | 'today'>

/** Null for "Todas" and for a store that is not archived. A failed read keeps
 *  the store archived with its day unknown (the running day still freezes). */
export async function loadArchivedStore(ctx: PageContext): Promise<ArchivedStoreInput | null> {
  const store = ctx.scope === 'store' ? ctx.store : null
  if (!store?.archived) return null
  const archivedOn = ctx.archivedOn ?? await loadArchiveDates([store.id])
    .then(m => m.get(store.id) ?? null)
    .catch(err => { console.error('[archived store]', err); return null })
  return { storeName: store.name, archivedOn, period: ctx.period, range: ctx.range, today: ctx.today }
}
