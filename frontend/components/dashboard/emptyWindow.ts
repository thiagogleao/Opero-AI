/**
 * Why a store's window has nothing in it when "no sales" is not what
 * happened: the store had not made its first sale yet, or it is archived and
 * nothing is read after its archive day. The verdict decides both
 * (lib/views/verdict buildVerdict `beforeStart` / `frozen`); every block
 * beside it says the same instead of "$0 · nenhum pedido no período" (the
 * Resumo's KPI grid, its lists, refunds, chart and campaigns read like a dead
 * window next to "A Hibikura começou a vender em 7 nov" or "A Squishy World
 * está arquivada desde 10 nov"). The phone already words it this way
 * (app/m/_components/Home.tsx); these are the desktop's words, one place.
 *
 * Also the whole verdict card for an archived store's empty window, for the
 * pages that build their own verdict (Campanhas, Produtos, Países e clientes,
 * Atribuição: archivedEmptyVerdict), as components/campaigns/storeStart does
 * for a window before the first sale — frozen (nothing read) or read up to
 * the archive day (frozenTail), by the Resumo's rule. Pure.
 */

import type { DateRange, Period } from '@/lib/engine/dates'
import type { PnL } from '@/lib/engine/pnl'
import { formatRangeLabel } from '@/lib/format'
import { periodPhrase, type Verdict, type VerdictChip, type VerdictLine } from '@/lib/views/verdict'
import { dateBeside } from '@/components/campaigns/storeStart'

export type EmptyWindow =
  /** The window ends before the first sale; `firstSale` as the verdict prints it ("7 nov"). */
  | { kind: 'before_start'; firstSale: string }
  /** An archived store's window after its archive day (or its current day):
   *  `archivedOn` as printed ("10 nov"), null when the day is unknown. */
  | { kind: 'frozen'; archivedOn: string | null }

/** The verdict's own reading of the window, so no block can disagree with it. */
export function emptyWindowOf(v: Pick<Verdict, 'beforeStart' | 'frozen'>): EmptyWindow | null {
  if (v.beforeStart) return { kind: 'before_start', firstSale: v.beforeStart.text }
  if (v.frozen) return { kind: 'frozen', archivedOn: v.frozen.text }
  return null
}

export interface EmptyWindowText {
  /** Under a number shown as "—": "a loja ainda não vendia (1ª venda em 7 nov)",
   *  "sem dados: loja arquivada desde 10 nov". */
  note: string
  /** A block's empty state: "A loja ainda não vendia",
   *  "Sem dados de 17–23 nov: a loja está arquivada desde 10 nov". */
  title: string
  /** The line under that title: what to pick instead. */
  text: string
}

export function emptyWindowText(e: EmptyWindow, rangeLabel: string): EmptyWindowText {
  if (e.kind === 'before_start') {
    return {
      note: `a loja ainda não vendia (1ª venda em ${e.firstSale})`,
      title: 'A loja ainda não vendia',
      text: `A 1ª venda foi em ${e.firstSale}: escolha um período a partir dessa data.`,
    }
  }
  const since = e.archivedOn ? ` desde ${e.archivedOn}` : ''
  return {
    note: `sem dados: loja arquivada${since}`,
    title: `Sem dados de ${rangeLabel}: a loja está arquivada${since}`,
    text: e.archivedOn
      ? `Nada é lido depois disso. Para ver o histórico, escolha um período até ${e.archivedOn}.`
      : 'Nada é lido depois do arquivamento. Para ver o histórico, escolha um período de quando a loja ainda sincronizava.',
  }
}

const CENT = 0.005

/** Nothing happened in the window: no order, no sale, no ad spend. */
const nothingIn = (a: { orders: number; revenue: number; spend: number }) => !(a.orders > 0 || a.revenue > CENT || a.spend > CENT)

/**
 * The verdict's `frozen` rule (lib/views/verdict buildVerdict) for pages that
 * do not build the Resumo's verdict: an archived store, nothing in the window
 * (no order, no sale, no ad spend), and nothing in it was read — the window
 * starts after the archive day or, when that day is unknown, it is the
 * store's current day. A window that starts on or before the archive day was
 * read up to it (frozenTailOf): "Este mês" (1–24 nov, archived on 10 nov)
 * read "não há dados neste mês" on Campanhas, Produtos, Países and Atribuição
 * while the Resumo said "não teve vendas em 1–10 nov".
 * `archivedOn`: the archive day on the store's calendar (lib/views/portfolio
 * loadArchiveDates), null when unknown.
 */
export function isFrozenWindow(
  store: { archived: boolean; archivedOn: string | null },
  range: DateRange,
  today: string,
  a: { orders: number; revenue: number; spend: number },
): boolean {
  if (!store.archived || !nothingIn(a)) return false
  if (store.archivedOn) return range.from > store.archivedOn
  return range.from <= today && today <= range.to
}

/**
 * The archive day when an archived store's window runs past it — read up to
 * that day, nothing after (the verdict's `frozenTail`) — else null.
 */
export function frozenTailOf(archivedOn: string | null | undefined, range: DateRange): string | null {
  return archivedOn && range.from <= archivedOn && archivedOn < range.to ? archivedOn : null
}

/** "A Squishy World foi arquivada em 10 nov e não sincroniza mais: não há
 *  dados dos dias seguintes." — the Resumo's note for a window that runs past
 *  the archive day (frozenTailOf), word for word. */
export function frozenTailNote(i: Pick<FrozenVerdictInput, 'storeName' | 'range' | 'today' | 'alsoShown'> & { archivedOn: string }): VerdictLine {
  const day = dateBeside(i.archivedOn, [i.range.from, i.range.to, ...(i.alsoShown ?? [])], i.today)
  const parts: VerdictLine['parts'] = [
    { text: `A ${i.storeName} foi arquivada em ` }, { text: day, strong: true }, { text: ' e não sincroniza mais: não há dados dos dias seguintes.' },
  ]
  return { parts, text: parts.map(p => p.text).join('') }
}

export interface FrozenVerdictInput {
  storeName: string
  /** ISO archive day, or null when unknown. */
  archivedOn: string | null
  period: Period
  range: DateRange
  today: string
  /** Other dates printed beside the window (a comparison's ends): a year in
   *  them puts the year on the archive day too (storeStart dateBeside). */
  alsoShown?: readonly (string | null | undefined)[]
  rangeLabel: string
  /** "dia de Tóquio" or null. */
  dayLabel: string | null
  totals: PnL
  /** False adds the "Custos não configurados" chip, as the Resumo does. */
  configured?: boolean
  split?: boolean
}

/** The Resumo's frozen verdict (lib/views/verdict, `frozen`), word for word. */
export function frozenVerdict(i: FrozenVerdictInput): Verdict {
  const day = i.archivedOn ? dateBeside(i.archivedOn, [i.range.from, i.range.to, ...(i.alsoShown ?? [])], i.today) : null
  const P = periodPhrase(i.period, i.range, i.today)
  const headline = day
    ? `A ${i.storeName} está arquivada desde ${day} e não sincroniza mais: não há dados ${P}.`
    : `A ${i.storeName} está arquivada e não sincroniza mais: não há vendas ${P} para mostrar.`
  const parts: VerdictLine['parts'] = day
    ? [{ text: 'Para ver o histórico, escolha um período até ' }, { text: day, strong: true }, { text: ', quando a loja ainda sincronizava.' }]
    : [{ text: 'Para ver o histórico, escolha um período de quando a loja ainda sincronizava.' }]
  const chips: VerdictChip[] = [{ code: 'sem_vendas', label: 'Sem sincronização', tone: 'neu', icon: 'ring' }]
  if (i.configured === false) chips.push({ code: 'sem_custos', label: 'Custos não configurados', tone: 'cfg', icon: 'sliders' })
  if (i.dayLabel) chips.push({ code: 'dia_fuso', label: i.dayLabel, tone: 'info', icon: 'clock' })
  return {
    tone: 'neu', chips, when: i.rangeLabel, headline,
    amount: null, amountTone: 'neu',
    amountCaption: day ? 'loja arquivada: nada é lido depois disso' : 'loja arquivada: nenhum pedido novo chega',
    details: [{ parts, text: parts.map(p => p.text).join('') }], notes: [], basis: 'none',
    totals: i.totals, comparisonTotals: null, excluded: [], roas: null,
    early: false, fewOrders: false, partial: false, split: !!i.split, storeCount: 1,
    frozen: { date: i.archivedOn, text: day },
  }
}

/**
 * The Resumo's verdict for an archived store's window that runs past the
 * archive day with nothing in the days that were read (lib/views/verdict,
 * no sales + `frozenTail`), word for word: "A Squishy World não teve vendas
 * em 1–10 nov." and the note that nothing after 10 nov was read.
 */
export function frozenTailVerdict(i: FrozenVerdictInput & { archivedOn: string }): Verdict {
  const read = formatRangeLabel({ from: i.range.from, to: i.archivedOn }, i.today)
  const chips: VerdictChip[] = [{ code: 'sem_vendas', label: 'Sem vendas no período', tone: 'neu', icon: 'ring' }]
  if (i.configured === false) chips.push({ code: 'sem_custos', label: 'Custos não configurados', tone: 'cfg', icon: 'sliders' })
  if (i.dayLabel) chips.push({ code: 'dia_fuso', label: i.dayLabel, tone: 'info', icon: 'clock' })
  return {
    tone: 'neu', chips, when: i.rangeLabel, headline: `A ${i.storeName} não teve vendas em ${read}.`,
    amount: null, amountTone: 'neu', amountCaption: 'nenhum pedido no período',
    details: [], notes: [frozenTailNote(i)], basis: 'none',
    totals: i.totals, comparisonTotals: null, excluded: [], roas: null,
    early: false, fewOrders: false, partial: false, split: !!i.split, storeCount: 1,
    frozen: null,
  }
}

/**
 * The verdict an archived store's empty window gets on the pages that build
 * their own (Campanhas, Produtos, Países e clientes, Atribuição), by the
 * Resumo's rule: nothing read in it (isFrozenWindow) → frozenVerdict; read up
 * to the archive day with nothing in those days (frozenTailOf) →
 * frozenTailVerdict; anything else → null, the page's own verdict (with
 * frozenTailNote when the window runs past the archive day).
 */
export function archivedEmptyVerdict(i: FrozenVerdictInput, a: { orders: number; revenue: number; spend: number }): Verdict | null {
  const store = { archived: true, archivedOn: i.archivedOn }
  if (isFrozenWindow(store, i.range, i.today, a)) return frozenVerdict(i)
  const tail = frozenTailOf(i.archivedOn, i.range)
  return tail && nothingIn(a) ? frozenTailVerdict({ ...i, archivedOn: tail }) : null
}
