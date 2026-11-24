/**
 * The verdict's reason a window is empty, in a block's words, for the pages
 * that build their own verdict card (Campanhas, Produtos, Países e clientes,
 * Atribuição). The Resumo's blocks read it from the verdict
 * (components/dashboard/emptyWindow); these pages only had the card, and the
 * blocks under "A Hibikura começou a vender em 7 nov" still said "Nenhum
 * pedido no período" / "Sem gasto no Meta neste período", describing a window
 * that was read and found empty. Every such block takes `why` from here.
 *
 * Several stores ("Todas", none of which had started) speak of the stores:
 * the Resumo's words are about one store.
 */

import { EmptyState } from '@/components/ui'
import type { DateRange } from '@/lib/engine/dates'
import type { Verdict } from '@/lib/views/verdict'
import { emptyWindowOf, emptyWindowText, isFrozenWindow, type EmptyWindow, type EmptyWindowText } from '@/components/dashboard/emptyWindow'
import { dateBeside, isBeforeStart } from './storeStart'

export type { EmptyWindowText }

/** The block text for an empty window; `stores` > 1 reads in the plural. */
export function emptyWindowWords(e: EmptyWindow, rangeLabel: string, stores = 1): EmptyWindowText {
  if (e.kind === 'before_start' && stores > 1) {
    return {
      note: `nenhuma das lojas vendia ainda (1ª venda em ${e.firstSale})`,
      title: 'Nenhuma das lojas vendia ainda',
      text: `A 1ª venda foi em ${e.firstSale}: escolha um período a partir dessa data.`,
    }
  }
  return emptyWindowText(e, rangeLabel)
}

/** The verdict's reading of the window as block text, or null when the
 *  window was read (its blocks keep their own empty states). */
export function emptyWhy(v: Pick<Verdict, 'beforeStart' | 'frozen' | 'storeCount'>, rangeLabel: string): EmptyWindowText | null {
  const e = emptyWindowOf(v)
  return e ? emptyWindowWords(e, rangeLabel, v.storeCount) : null
}

/**
 * The same reading for a window that is not the verdict's: Campanhas' "Onde há
 * folga para escalar" always judges the last closed days, whatever the page
 * shows. Squishy World (archived 10 nov) read "Nenhuma campanha gastou nos
 * últimos 7 dias fechados" on every window, for days never read.
 *
 * Only the window and its ad spend are known here, not its orders: a window
 * that ends before the first sale has none by definition, and one that starts
 * after the archive day has none read. Null when the window was read.
 */
export function windowWhy(i: {
  range: DateRange
  rangeLabel: string
  /** Today on the store's clock. */
  today: string
  /** The window's ad spend (a window with spend keeps its own reading). */
  spend: number
  firstOrderDate: string | null
  archived: { archivedOn: string | null } | null
}): EmptyWindowText | null {
  const none = { orders: 0, revenue: 0, spend: i.spend }
  const shown = [i.range.from, i.range.to]
  if (i.firstOrderDate && isBeforeStart(i.firstOrderDate, i.range, none)) {
    return emptyWindowText({ kind: 'before_start', firstSale: dateBeside(i.firstOrderDate, shown, i.today) }, i.rangeLabel)
  }
  if (i.archived && isFrozenWindow({ archived: true, archivedOn: i.archived.archivedOn }, i.range, i.today, none)) {
    const on = i.archived.archivedOn
    return emptyWindowText({ kind: 'frozen', archivedOn: on ? dateBeside(on, shown, i.today) : null }, i.rangeLabel)
  }
  return null
}

/** A block's empty state with the verdict's reason (the Resumo's look). */
export function WhyEmpty({ why, compact = true }: { why: EmptyWindowText; compact?: boolean }) {
  return <EmptyState compact={compact} icon="clock" title={why.title}>{why.text}</EmptyState>
}
