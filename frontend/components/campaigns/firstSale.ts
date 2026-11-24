/**
 * The store's first sale for the pages' "window before the store existed"
 * state (./storeStart). Server only: one MIN over the store's kept orders,
 * the same read the Resumo uses (lib/views/portfolio loadFirstOrderDates).
 */

import 'server-only'
import { loadFirstOrderDates } from '@/lib/views/portfolio'
import type { PageContext } from '@/lib/views/page'
import type { BeforeStartInput } from './storeStart'

/** Null for "Todas", a store without orders, or a failed read (the page then
 *  keeps its ordinary empty state, as before). */
export async function loadFirstSale(ctx: PageContext): Promise<BeforeStartInput | null> {
  const store = ctx.scope === 'store' ? ctx.store : null
  if (!store) return null
  const first = await loadFirstOrderDates([store.id])
    .then(m => m.get(store.id) ?? null)
    .catch(err => { console.error('[first sale]', err); return null })
  return first ? { storeName: store.name, firstOrderDate: first, period: ctx.period, range: ctx.range, today: ctx.today } : null
}

/** Every selected store's first sale, for "Todas" (./storeStart
 *  firstSaleOfAll). Empty on a failed read: the page keeps its ordinary
 *  empty state, as before. */
export async function loadFirstSales(ctx: PageContext): Promise<Map<string, string>> {
  if (ctx.scope !== 'all' || !ctx.storeIds.length) return new Map()
  return loadFirstOrderDates(ctx.storeIds)
    .catch(err => { console.error('[first sales]', err); return new Map<string, string>() })
}
