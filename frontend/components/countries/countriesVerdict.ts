/**
 * The verdict card of "Países e clientes": the biggest market, how many
 * countries are too small to judge, and how much of the period came from
 * returning customers. The big number is the contribution of every country
 * (= the store's, from the engine). Pure.
 */

import type { CountryRow } from '@/lib/data/countries'
import { SMALL_SAMPLE } from '@/lib/data/countries'
import type { PnL } from '@/lib/engine/pnl'
import type { Verdict, VerdictChip, VerdictLine } from '@/lib/views/verdict'
import { formatPct, plural } from '@/lib/format'
import { beforeStartAllVerdict, beforeStartVerdict, isBeforeStart, type AllBeforeStartInput, type BeforeStartInput } from '@/components/campaigns/storeStart'
import type { ArchivedStoreInput } from '@/components/dashboard/archivedStore'
import { archivedEmptyVerdict } from '@/components/dashboard/emptyWindow'

const line = (...parts: (string | { text: string; strong?: boolean; tone?: 'pos' | 'neg' | 'warn' })[]): VerdictLine => {
  const ps = parts.map(p => (typeof p === 'string' ? { text: p } : p))
  return { parts: ps, text: ps.map(p => p.text).join('') }
}
const pct0 = (v: number | null) => formatPct(v, { digits: 0 })

export interface CustomerCounts {
  orders: number
  newOrders: number
  returningOrders: number
  guestOrders: number
}

/**
 * The new / returning / guest shares of the orders in words. A part that has
 * orders but rounds to 0% reads "menos de 1%" — MOKOO's 2 guest orders out of
 * 630 read "0% sem cadastro" next to 26% + 73%, a zero for a count that is not
 * zero. The guest part names its count then ("2 pedidos sem cadastro (menos
 * de 1%)"). Null guest when there were none.
 */
export function customerMixShares(c: CustomerCounts): { returning: string; new: string; guest: string | null } {
  const share = (n: number) => {
    const p = c.orders > 0 ? (n / c.orders) * 100 : 0
    return n > 0 && Math.round(p) === 0 ? null : pct0(p)
  }
  const guestPct = share(c.guestOrders)
  return {
    returning: share(c.returningOrders) ?? 'menos de 1%',
    new: share(c.newOrders) ?? 'menos de 1%',
    guest: c.guestOrders <= 0 ? null
      : guestPct !== null ? `${guestPct} sem cadastro`
        : `${plural(c.guestOrders, 'pedido', 'pedidos')} sem cadastro (menos de 1%)`,
  }
}

export function buildCountriesVerdict(input: {
  /** "da MOKOO" / "das suas lojas". */
  subjectOf: string
  /** "na MOKOO" / "nas suas lojas". */
  subjectIn: string
  rows: CountryRow[]
  /** Countries with orders, and how many under the sample size, over the
   *  FULL list (the rows may end in an "outros" row). */
  counts: { withOrders: number; small: number }
  totals: PnL
  configured: boolean
  customers: CustomerCounts | null
  /** Stores left out of a several-store sum (no cost settings). */
  excludedStores?: string[]
  rangeLabel: string
  periodPhrase: string
  partialLabel: string | null
  dayLabel: string | null
  split?: boolean
  /** One store with a known first sale: a window that ends before it reads
   *  "Vende desde 7 nov", like the Resumo (components/campaigns/storeStart). */
  firstSale?: BeforeStartInput | null
  /** One archived store (components/dashboard/archivedStore): a window after
   *  its archive day reads "sem dados", word for word the Resumo's verdict,
   *  not "Nenhum pedido". */
  archived?: ArchivedStoreInput | null
  /** "Todas" when no store had made its first sale by the end of the window
   *  (components/campaigns/storeStart firstSaleOfAll): the Overview's
   *  "Nenhuma das lojas vendia ainda", not "Nenhum pedido nas suas lojas". */
  firstSaleAll?: AllBeforeStartInput | null
}): Verdict {
  const { rows, totals, configured, periodPhrase, subjectOf } = input
  if (input.firstSaleAll && !(totals.orders > 0)) {
    return beforeStartAllVerdict({ ...input.firstSaleAll, periodPhrase, rangeLabel: input.rangeLabel, totals, split: input.split })
  }
  const fs = input.firstSale
  if (fs && isBeforeStart(fs.firstOrderDate, fs.range, { orders: totals.orders, revenue: totals.revenue, spend: totals.adSpend, adjustments: totals.adjustments })) {
    return beforeStartVerdict({ ...fs, rangeLabel: input.rangeLabel, dayLabel: input.dayLabel, totals, split: input.split })
  }
  // An archived store's empty window, by the Resumo's rule (see Produtos):
  // "sem dados" after the archive day, "não teve vendas em 1–10 nov" with the
  // archive note for a window that runs past it.
  const ar = input.archived
  const archivedV = ar ? archivedEmptyVerdict({ ...ar, rangeLabel: input.rangeLabel, dayLabel: input.dayLabel, totals, configured, split: input.split }, { orders: totals.orders, revenue: totals.revenue, spend: totals.adSpend }) : null
  if (archivedV) return archivedV
  const chips: VerdictChip[] = []
  const details: VerdictLine[] = []
  const excluded = input.excludedStores ?? []
  // The partial clock is a chip of its own; the date line stays the range.
  const when = input.rangeLabel
  const base = {
    when, totals, comparisonTotals: null, excluded: [], partial: !!input.partialLabel, split: !!input.split,
    storeCount: 1, roas: null, early: false, fewOrders: false, notes: [],
  }
  if (!configured) chips.push({ code: 'sem_custos', label: 'Custos não configurados', tone: 'cfg', icon: 'sliders' })
  if (excluded.length) chips.push({ code: 'sem_custos', label: excluded.length === 1 ? '1 loja sem custos' : `${excluded.length} lojas sem custos`, tone: 'cfg', icon: 'sliders' })
  if (input.partialLabel) chips.push({ code: 'parcial', label: input.partialLabel, tone: 'info', icon: 'clock' })
  if (input.dayLabel) chips.push({ code: 'dia_fuso', label: input.dayLabel, tone: 'info', icon: 'clock' })

  const countries = rows.filter(r => r.country !== 'outros' && r.orders > 0)
  if (!countries.length || totals.orders === 0) {
    chips.unshift({ code: 'sem_vendas', label: input.partialLabel ? 'Sem vendas ainda' : 'Sem vendas no período', tone: 'neu', icon: 'ring' })
    return {
      ...base, tone: 'neu', chips, headline: `Nenhum pedido ${input.subjectIn} ${periodPhrase}.`,
      amount: null, amountTone: 'neu', amountCaption: 'sem pedidos no período', details, basis: 'none',
    }
  }

  const top = [...countries].sort((a, b) => b.revenue - a.revenue)[0]
  const cShare = configured && totals.contribution > 0 ? (top.contribution / totals.contribution) * 100 : null
  const headline = `Maior mercado ${subjectOf} ${periodPhrase}: ${top.name}, com ${pct0(top.revenueShare)} das vendas${cShare !== null ? ` e ${pct0(cShare)} da contribuição` : ''}.`
  const { withOrders: countryCount, small } = input.counts
  // The verdict opens with a chip in words, how concentrated the sales are,
  // placed after the cost-settings chips (those matter more).
  // 40%+ in one country is concentration, not "spread" (49,7% reads as 50%).
  const concentration: VerdictChip = (top.revenueShare ?? 0) >= 40
    ? { code: 'margem_fina', label: `${top.name}: ${pct0(top.revenueShare)} das vendas`, tone: 'info', icon: 'diamond' }
    : { code: 'margem_fina', label: `Vendas espalhadas: maior país com ${pct0(top.revenueShare)}`, tone: 'info', icon: 'diamond' }
  chips.splice(chips.filter(c => c.code === 'sem_custos').length, 0, concentration)
  // "Todos" only of several countries: Hibikura sells to Japan alone, and
  // "Vendeu para 1 país; todos com menos de 30 pedidos" read as a crowd.
  const one = countryCount === 1
  if (small === countryCount) {
    chips.push({ code: 'poucos_pedidos', label: one ? `Menos de ${SMALL_SAMPLE} pedidos` : `Todos com menos de ${SMALL_SAMPLE} pedidos`, tone: 'warn', icon: 'alert' })
  }

  const sample = ` com menos de ${SMALL_SAMPLE} pedidos — amostra pequena para decidir por país.`
  details.push(line(`Vendeu para ${plural(countryCount, 'país', 'países')}`,
    !small ? '.' : one ? `,${sample}` : `; ${small === countryCount ? 'todos' : `${small} deles`}${sample}`))
  if (input.customers && input.customers.orders > 0) {
    const mix = customerMixShares(input.customers)
    details.push(line({ text: mix.returning, strong: true }, ' dos pedidos foram recompra, ',
      { text: mix.new, strong: true }, ' de clientes novos', mix.guest ? ` e ${mix.guest}.` : '.'))
  }
  if (configured) {
    const judged = countries.filter(c => c.orders >= SMALL_SAMPLE && c.contributionMargin !== null)
    if (judged.length >= 2) {
      const best = judged.reduce((a, b) => ((b.contributionMargin ?? 0) > (a.contributionMargin ?? 0) ? b : a))
      const worst = judged.reduce((a, b) => ((b.contributionMargin ?? 0) < (a.contributionMargin ?? 0) ? b : a))
      details.push(line(`Entre os países com ${SMALL_SAMPLE}+ pedidos, a melhor margem é `, { text: `${best.name} (${formatPct(best.contributionMargin)})`, strong: true },
        ' e a pior, ', { text: `${worst.name} (${formatPct(worst.contributionMargin)})`, strong: true }, '.'))
    } else if (excluded.length) {
      details.push(line(`Fora da soma: ${excluded.join(', ')} (custos não configurados).`))
    }
  }

  return {
    ...base,
    tone: 'neu',
    chips,
    headline,
    amount: configured ? totals.contribution : totals.revenue,
    amountTone: configured ? (totals.contribution >= 0 ? 'pos' : 'neg') : 'neu',
    amountCaption: configured
      ? `de contribuição somando todos os países, antes dos anúncios${excluded.length ? ` (sem ${excluded.join(', ')})` : ''}`
      : 'em vendas, sem custos configurados para calcular a contribuição',
    details: details.slice(0, 3),
    basis: configured ? 'profit' : 'revenue_minus_ads',
  }
}
