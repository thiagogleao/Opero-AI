/**
 * InsightsSlot — the Resumo's AI card, decided on the server: a window the
 * server would refuse is said as such before anyone presses "Gerar leitura".
 *
 *  - before the store's first sale → the card's notStarted state;
 *  - an archived store's window after its archive day (verdict `frozen`) →
 *    nothingToRead 'frozen', whatever the window before it held: nothing in
 *    this one was read, so "vendas caíram a zero" would be wrong;
 *  - this window and the one before it empty (lib/ai/insights/readable, the
 *    server's own no_data rule) → nothingToRead 'quiet';
 *  - otherwise the live card.
 *
 * Async server component: put it inside <Suspense>. The quiet check costs
 * nothing when a day of the page's window had activity, and two engine passes
 * otherwise; a failed check falls back to the live card (the server still
 * refuses an empty window on click).
 */

import type { DateRange } from '@/lib/engine/dates'
import type { DayPnL } from '@/lib/engine/pnl'
import { quietInsightsWindow } from '@/lib/ai/insights/readable'
import { InsightsCard } from './InsightsCard'
import type { NothingToRead, NotStarted } from './insightsModel'

export async function InsightsSlot({ store, range, split, daily, notStarted, frozen, now }: {
  store: { id: string; name: string; timezone: string }
  range: DateRange
  split: boolean
  /** The page's own days for `range` (StoreSummary pnl.daily). */
  daily: readonly DayPnL[]
  notStarted: NotStarted | null
  /** The verdict's frozen window: the archive day as printed, or null when
   *  unknown; undefined when the window is not frozen. */
  frozen?: { archivedOn: string | null }
  now: Date
}) {
  let nothing: NothingToRead | null = null
  if (!notStarted && frozen) {
    nothing = { kind: 'frozen', storeName: store.name, archivedOn: frozen.archivedOn }
  } else if (!notStarted) {
    try {
      const q = await quietInsightsWindow(store, range, daily, now)
      if (q) nothing = { kind: 'quiet', window: q.window.label, previous: q.previous.label }
    } catch (err) {
      console.error('[resumo] insights readability', store.id, err)
    }
  }
  return <InsightsCard storeId={store.id} from={range.from} to={range.to} split={split}
    notStarted={notStarted} nothingToRead={nothing} />
}
