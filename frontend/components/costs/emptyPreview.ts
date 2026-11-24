/**
 * Why the cost preview's window has nothing to price, and the words for it,
 * when "no sales" is not what happened: the window ends before the store's
 * first sale, or the store is archived and nothing is read after its archive
 * day. Every other block for the same window already says so
 * (components/dashboard/emptyWindow: "sem dados: loja arquivada desde 10
 * nov"); the preview read "Sem vendas … Escolha um período maior" for Squishy
 * World's 17–23 nov, a week after it was archived, where no longer window
 * ending there has data either. Pure: the page resolves the dates on the
 * server, the panel only words them.
 */

import type { DateRange } from '@/lib/engine/dates'
import { dateBeside } from '@/components/campaigns/storeStart'
import { isFrozenWindow, type EmptyWindow } from '@/components/dashboard/emptyWindow'

export interface EmptyPreviewInput {
  range: DateRange
  /** The store's today, on its own calendar. */
  today: string
  /** ISO date of the store's first kept order, or null (none, or unread). */
  firstSale: string | null
  archived: boolean
  /** ISO archive day on the store's calendar, or null (active, or unread). */
  archivedOn: string | null
}

/**
 * The reason a window would be empty, with its dates as printed ("7 nov";
 * with the year when the window is in another year). Decided from the window
 * alone: the panel uses it only when the window priced nothing, which makes it
 * the same rule as the other pages' (isFrozenWindow with an empty window).
 * Before the first sale wins, as the verdict's emptyWindowOf does.
 */
export function emptyPreviewWhy(i: EmptyPreviewInput): EmptyWindow | null {
  const shown = [i.range.from, i.range.to]
  if (i.firstSale && i.range.to < i.firstSale) {
    return { kind: 'before_start', firstSale: dateBeside(i.firstSale, shown, i.today) }
  }
  if (isFrozenWindow({ archived: i.archived, archivedOn: i.archivedOn }, i.range, i.today, { orders: 0, revenue: 0, spend: 0 })) {
    return { kind: 'frozen', archivedOn: i.archivedOn ? dateBeside(i.archivedOn, shown, i.today) : null }
  }
  return null
}

export interface EmptyPreviewText {
  /** The big word in place of the number. */
  title: string
  /** The line under it; `strong` parts are dates, set in figures. */
  parts: { text: string; strong?: boolean }[]
}

const WHERE = ' no topo da página.'

/** The empty preview's words; null is a window with simply no sale or ad in it. */
export function emptyPreviewText(why: EmptyWindow | null): EmptyPreviewText {
  if (why?.kind === 'frozen') {
    // The same sentences as the Resumo's blocks (emptyWindowText), pointed at
    // the period picker above.
    return why.archivedOn
      ? {
          title: 'Sem dados',
          parts: [
            { text: 'A loja está arquivada desde ' }, { text: why.archivedOn, strong: true },
            { text: ': nada é lido depois disso, não há o que precificar. Para ver o histórico, escolha um período até ' },
            { text: why.archivedOn, strong: true }, { text: WHERE },
          ],
        }
      : {
          title: 'Sem dados',
          parts: [{ text: 'A loja está arquivada: nada é lido depois do arquivamento, não há o que precificar. Para ver o histórico, escolha no topo da página um período de quando a loja ainda sincronizava.' }],
        }
  }
  const lead = 'Nenhum pedido e nenhum anúncio neste período: não há o que precificar. Escolha um período '
  return why?.kind === 'before_start'
    ? { title: 'Sem vendas', parts: [{ text: `${lead}a partir de ` }, { text: why.firstSale, strong: true }, { text: WHERE }] }
    : { title: 'Sem vendas', parts: [{ text: `${lead}maior${WHERE}` }] }
}
