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
import { notSellingYet, type Verdict, type VerdictChip, type VerdictLine } from '@/lib/views/verdict'
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
  /** Other dates printed beside the window (the Resumo's comparison): a year
   *  in them puts the year on the first sale too (dateBeside). */
  alsoShown?: readonly (string | null | undefined)[]
}

export interface BeforeStartText {
  /** The first sale as printed beside the window ("7 nov", "11 abr 2026"). */
  first: string
  /** "Vende desde 7 nov". */
  chip: string
  /** "A Hibikura começou a vender em 7 nov — não há dados de 28 out – 3 nov." */
  headline: string
  /** Under the empty big number. */
  caption: string
  /** "Escolha um período a partir de 7 nov para ver o resultado." */
  detail: VerdictLine
}

/**
 * A date printed beside a window, with its year whenever the window or
 * anything shown with it (`shown`: its ends, a comparison's) is in another
 * year than today's — the rule of lib/views/verdict dayText. "começou a
 * vender em 11 abr" beside "15 dez 2025 – 15 jan 2026" read as 11 abr 2025.
 * Otherwise formatDate's own rule (a year only when not this year).
 */
export function dateBeside(iso: string, shown: readonly (string | null | undefined)[], today: string): string {
  const thisYear = today.slice(0, 4)
  return shown.some(d => !!d && d.slice(0, 4) !== thisYear) ? `${formatDate(iso)} ${iso.slice(0, 4)}` : formatDate(iso, today)
}

/** The Resumo's sentences for a window before the first sale. */
export function beforeStartText(i: BeforeStartInput): BeforeStartText {
  const first = dateBeside(i.firstOrderDate, [i.range.from, i.range.to, ...(i.alsoShown ?? [])], i.today)
  const span = i.period === 'lastmonth' ? monthLong(i.range.from)
    : i.range.from === i.range.to ? formatDate(i.range.from, i.today)
      : formatRangeLabel(i.range, i.today)
  const parts = [{ text: 'Escolha um período a partir de ' }, { text: first, strong: true }, { text: ' para ver o resultado.' }]
  return {
    first,
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
    // The blocks under the card read the same reason from here
    // (./emptyWhy), as the Resumo's do from its verdict.
    beforeStart: { date: i.firstOrderDate, text: text.first },
  }
}

// ─── Several stores ("Todas"), none of which had started ─────────────────────

/**
 * The earliest first sale when EVERY store's window is before its own first
 * sale with nothing in it (lib/views/verdict notSellingYet, the Resumo's
 * `firstOfAll` rule); null otherwise, or when a store's first sale is unknown.
 * Todas · Produtos and Países read 1–31 jan 2025 as "Nenhuma venda nas suas
 * lojas" while the Overview said no store had started yet.
 */
export function firstSaleOfAll(
  stores: readonly { totals: Pick<PnL, 'orders' | 'revenue' | 'adSpend' | 'adjustments' | 'fixedCosts'>; firstOrderDate?: string | null }[],
  range: DateRange,
): string | null {
  if (!stores.length || !stores.every(s => notSellingYet(s, range))) return null
  return stores.map(s => s.firstOrderDate!).reduce((a, b) => (b < a ? b : a))
}

/** What a page passes its verdict builder for "Todas" when no store had started. */
export interface AllBeforeStartInput {
  /** The earliest first sale (firstSaleOfAll). */
  firstOrderDate: string
  range: DateRange
  /** Today on the page's clock (for the year in dates). */
  today: string
  storeCount: number
}

/** The Overview's verdict for a window before every store's first sale, word
 *  for word (lib/views/verdict buildVerdict, `firstOfAll`). */
export function beforeStartAllVerdict(i: AllBeforeStartInput & {
  /** "em 1–31 jan 2025", "no mês passado". */
  periodPhrase: string
  rangeLabel: string
  totals: PnL
  split?: boolean
}): Verdict {
  const first = dateBeside(i.firstOrderDate, [i.range.from, i.range.to], i.today)
  const parts = [{ text: 'Escolha um período a partir de ' }, { text: first, strong: true }, { text: ' para ver o resultado.' }]
  return {
    tone: 'neu',
    chips: [{ code: 'comecando', label: `1ª venda em ${first}`, tone: 'info', icon: 'clock' }],
    when: i.rangeLabel,
    headline: `Nenhuma das lojas vendia ainda ${i.periodPhrase}: a primeira venda foi em ${first}.`,
    amount: null, amountTone: 'neu', amountCaption: 'nenhuma das lojas vendia ainda nesse período',
    details: [{ parts, text: parts.map(p => p.text).join('') }], notes: [], basis: 'none',
    totals: i.totals, comparisonTotals: null, excluded: [], roas: null,
    early: false, fewOrders: false, partial: false, split: !!i.split, storeCount: i.storeCount,
    beforeStart: { date: i.firstOrderDate, text: first },
  }
}
