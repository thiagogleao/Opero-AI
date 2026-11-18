/**
 * QuietStoreNote — on a store's Resumo, when the store's last sale is days
 * old (no orders in the window, or none in its last days): when it last sold,
 * whether the order reading is current (so the silence is the store's, not
 * the sync's) and whether the ads stopped too. Glooty's last order was on 10 nov and its ads stopped after
 * 15 nov; without this its week read "$0, nenhum pedido" next to a fresh
 * "atualizado há 5 min", which looks like a collector that stopped.
 *
 * Async server component: streams in <Suspense fallback={null}> and renders
 * nothing when the store sold recently or a read fails. The window's own days
 * answer the common case (a sale yesterday or today) without any query.
 * The rule lives in components/portfolio/model quietNote (tested).
 */

import type { PageContext } from '@/lib/views/page'
import type { StoreRef } from '@/lib/access'
import type { StoreSummary } from '@/lib/views/store'
import { daysBetween, shiftDate } from '@/lib/engine/dates'
import { getFreshness } from '@/lib/sync/status'
import { Callout } from '@/components/ui'
import { loadLastActivity } from '@/components/portfolio/data'
import { lastSaleDate, laneState, QUIET_AFTER_DAYS, quietNote } from '@/components/portfolio/model'

export async function QuietStoreNote({ ctx, store, summary }: { ctx: PageContext; store: StoreRef; summary: StoreSummary }) {
  if (ctx.range.to < shiftDate(ctx.today, -1)) return null
  const soldIn = summary.pnl.daily.filter(d => d.orders > 0).map(d => d.date).sort().pop()
  if (soldIn && daysBetween(soldIn, ctx.today) - 1 < QUIET_AFTER_DAYS) return null
  let note
  try {
    const [activity, fresh] = await Promise.all([loadLastActivity([store.id]), getFreshness([store.id], ctx.now)])
    const a = activity.get(store.id)
    const f = fresh.find(x => x.storeId === store.id)
    note = quietNote({
      range: ctx.range,
      today: ctx.today,
      lastSaleDate: lastSaleDate(a?.lastSaleAt, store.timezone),
      lastAdDate: a?.lastAdDate ?? null,
      ordersLane: laneState(f?.shopify ?? null),
      metaLane: laneState(f?.facebook ?? null),
    })
  } catch (err) {
    console.error('[resumo] quiet store note', store.id, err)
    return null
  }
  if (!note) return null
  return (
    <Callout tone={note.tone} icon={note.tone === 'warn' ? 'alert' : 'clock'} title={note.title}>
      {note.lines.join(' ')}
    </Callout>
  )
}
