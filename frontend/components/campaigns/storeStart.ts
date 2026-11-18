/**
 * A window that ends before the store's first sale is not a dead period: the
 * store did not exist yet. The Resumo already says so (lib/views/verdict
 * buildVerdict, `beforeStart`); Produtos, Países e clientes, Campanhas and
 * Atribuição read the same window as "Sem vendas no período" / "Sem gasto no
 * Meta" (Hibikura, 28 out – 3 nov, first sale 7 nov). Every page builds that
 * state from here, with the Resumo's rule and words, so the five pages tell
 * the same story. Pure.
 *
 * The rule (the Resumo's): one store, nothing in the window — no order, no
 * sale, no ad spend — and the window ends before the first kept order on the
 * store's own calendar (lib/views/portfolio loadFirstOrderDates). A window
 * with ad spend before the first sale keeps its own verdict: money spent
 * before launch was really spent.
 */

import type { DateRange, Period } from '@/lib/engine/dates'
import type { PnL } from '@/lib/engine/pnl'
import type { Verdict, VerdictChip, VerdictLine } from '@/lib/views/verdict'
import { formatDate, formatRangeLabel, monthLong } from '@/lib/format'

const CENT = 0.005

export interface WindowActivity {
  orders: number
  revenue: number
  /** Every ad spend the page knows of (Meta, and Shopify when it has it). */
  spend: number
}

/** True when the window ends before the store's first sale and has nothing in it. */
export function isBeforeStart(firstOrderDate: string | null | undefined, range: DateRange, a: WindowActivity): boolean {
  return !!firstOrderDate && range.to < firstOrderDate && a.orders === 0 && a.revenue <= CENT && a.spend <= CENT
}

export interface BeforeStartInput {
  storeName: string
  firstOrderDate: string
  period: Period
  range: DateRange
  /** Today on the store's clock (for the year in dates). */
  today: string
}

export interface BeforeStartText {
  /** "Vende desde 7 nov". */
  chip: string
  /** "A Hibikura começou a vender em 7 nov — não há dados de 28 out – 3 nov." */
  headline: string
  /** Under the empty big number. */
  caption: string
  /** "Escolha um período a partir de 7 nov para ver o resultado." */
  detail: VerdictLine
}

/** The Resumo's sentences for a window before the first sale. */
export function beforeStartText(i: BeforeStartInput): BeforeStartText {
  const first = formatDate(i.firstOrderDate, i.today)
  const span = i.period === 'lastmonth' ? monthLong(i.range.from)
    : i.range.from === i.range.to ? formatDate(i.range.from, i.today)
      : formatRangeLabel(i.range, i.today)
  const parts = [{ text: 'Escolha um período a partir de ' }, { text: first, strong: true }, { text: ' para ver o resultado.' }]
  return {
    chip: `Vende desde ${first}`,
    headline: `A ${i.storeName} começou a vender em ${first} — não há dados de ${span}.`,
    caption: 'a loja ainda não vendia nesse período',
    detail: { parts, text: parts.map(p => p.text).join('') },
  }
}

/** The "começando" chip with the Resumo's look (tone info, clock icon). */
export function beforeStartChip(text: BeforeStartText): VerdictChip {
  return { code: 'comecando', label: text.chip, tone: 'info', icon: 'clock' }
}

/**
 * The whole verdict card for a window before the first sale, for the pages
 * that render a VerdictCard (Produtos, Países e clientes, Campanhas).
 */
export function beforeStartVerdict(i: BeforeStartInput & {
  rangeLabel: string
  /** "dia de Tóquio" or null. */
  dayLabel: string | null
  totals: PnL
  /** False adds the "Custos não configurados" chip, as the Resumo does. */
  configured?: boolean
  split?: boolean
}): Verdict {
  const text = beforeStartText(i)
  const chips: VerdictChip[] = [beforeStartChip(text)]
  if (i.configured === false) chips.push({ code: 'sem_custos', label: 'Custos não configurados', tone: 'cfg', icon: 'sliders' })
  if (i.dayLabel) chips.push({ code: 'dia_fuso', label: i.dayLabel, tone: 'info', icon: 'clock' })
  return {
    tone: 'neu', chips, when: i.rangeLabel, headline: text.headline,
    amount: null, amountTone: 'neu', amountCaption: text.caption,
    details: [text.detail], notes: [], basis: 'none',
    totals: i.totals, comparisonTotals: null, excluded: [], roas: null,
    early: false, fewOrders: false, partial: false, split: !!i.split, storeCount: 1,
  }
}
