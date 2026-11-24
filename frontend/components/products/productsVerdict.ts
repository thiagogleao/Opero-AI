/**
 * The verdict card of Produtos: which products carried the period, how
 * concentrated the sales are, and which products lose money before ads. The
 * big number is the products' contribution (= the store's, the engine adds it
 * up to the cent). Pure.
 */

import type { PnL } from '@/lib/engine/pnl'
import type { Verdict, VerdictChip, VerdictLine } from '@/lib/views/verdict'
import { formatMoney, formatPct, plural } from '@/lib/format'
import { beforeStartVerdict, isBeforeStart, type BeforeStartInput } from '@/components/campaigns/storeStart'

export interface ProductLike {
  key: string
  title: string
  /** Store name, in "Todas". */
  store?: string
  units: number
  orders: number
  revenue: number
  /** Null for a product of a store without cost settings (in "Todas"). */
  contribution: number | null
}

/** Free-gift lines ("Free Gift", "Brinde"): a negative contribution there is by
 *  design. A bare "gift" is not enough ("Gift Box" is sold). */
const GIFT = /free gift|brinde|gr[aá]tis/i

/** Given away: no revenue at all, or named as a gift. Its cost is real, but it
 *  is the promotion's cost, not a product selling below cost. */
const isGift = (p: ProductLike) => p.revenue <= 0.005 || GIFT.test(p.title)

/** A margin only means something with this many orders. */
export const MIN_PRODUCT_ORDERS = 5

const line = (...parts: (string | { text: string; strong?: boolean; tone?: 'pos' | 'neg' | 'warn' })[]): VerdictLine => {
  const ps = parts.map(p => (typeof p === 'string' ? { text: p } : p))
  return { parts: ps, text: ps.map(p => p.text).join('') }
}
const pct0 = (v: number) => formatPct(v, { digits: 0 })
const named = (p: ProductLike) => (p.store ? `${p.title} (${p.store})` : p.title)

export function buildProductsVerdict(input: {
  /** "a MOKOO" / "suas lojas" (object of "puxou"). */
  subject: string
  /** "da MOKOO" / "das suas lojas". */
  subjectOf: string
  /** "na MOKOO" / "nas suas lojas". */
  subjectIn: string
  products: ProductLike[]
  totals: PnL
  configured: boolean
  /** "Todas": contribution of the stores with costs, and the names of the
   *  stores left out of it. */
  contributionTotal?: number
  excludedStores?: string[]
  rangeLabel: string
  periodPhrase: string
  partialLabel: string | null
  dayLabel: string | null
  split?: boolean
  /** One store with a known first sale: a window that ends before it reads
   *  "Vende desde 7 nov", like the Resumo (components/campaigns/storeStart). */
  firstSale?: BeforeStartInput | null
}): Verdict {
  const { products, totals, configured, periodPhrase, subject, subjectOf, subjectIn } = input
  const chips: VerdictChip[] = []
  const details: VerdictLine[] = []
  // The partial clock is a chip of its own; the date line stays the range.
  const when = input.rangeLabel
  const base = {
    when, totals, comparisonTotals: null, excluded: [], partial: !!input.partialLabel, split: !!input.split,
    storeCount: 1, roas: null, early: false, fewOrders: false, notes: [],
  }
  if (input.partialLabel) chips.push({ code: 'parcial', label: input.partialLabel, tone: 'info', icon: 'clock' })
  if (input.dayLabel) chips.push({ code: 'dia_fuso', label: input.dayLabel, tone: 'info', icon: 'clock' })

  if (!products.length || totals.revenue <= 0) {
    const fs = input.firstSale
    if (fs && isBeforeStart(fs.firstOrderDate, fs.range, { orders: totals.orders, revenue: totals.revenue, spend: totals.adSpend })) {
      return beforeStartVerdict({ ...fs, rangeLabel: input.rangeLabel, dayLabel: input.dayLabel, totals, configured, split: input.split })
    }
    chips.unshift({ code: 'sem_vendas', label: input.partialLabel ? 'Sem vendas ainda' : 'Sem vendas no período', tone: 'neu', icon: 'ring' })
    return {
      ...base, tone: 'neu', chips, headline: `Nenhuma venda ${subjectIn} ${periodPhrase}.`,
      amount: null, amountTone: 'neu', amountCaption: 'sem pedidos no período', details, basis: 'none',
    }
  }

  const byRevenue = [...products].sort((a, b) => b.revenue - a.revenue)
  const top = byRevenue[0]
  const topShare = (top.revenue / totals.revenue) * 100
  const priced = products.filter((p): p is ProductLike & { contribution: number } => p.contribution !== null)
  const contributionTotal = input.contributionTotal ?? totals.contribution
  const excluded = input.excludedStores ?? []
  const negative = configured ? priced.filter(p => p.contribution < 0).sort((a, b) => a.contribution - b.contribution) : []
  const gifts = negative.filter(isGift)
  const losers = negative.filter(p => !isGift(p))
  if (!configured) chips.unshift({ code: 'sem_custos', label: 'Custos não configurados', tone: 'cfg', icon: 'sliders' })
  if (topShare >= 50) chips.unshift({ code: 'margem_fina', label: `1 produto = ${pct0(topShare)} das vendas`, tone: 'info', icon: 'diamond' })
  // A share of 2 orders is not a pattern: say how small the sample is.
  if (totals.orders < MIN_PRODUCT_ORDERS * 2) chips.push({ code: 'poucos_pedidos', label: `Só ${plural(totals.orders, 'pedido', 'pedidos')}`, tone: 'warn', icon: 'alert' })
  if (configured && !losers.length && contributionTotal > 0) chips.unshift({ code: 'lucro', label: 'Todos acima do custo', tone: 'pos', icon: 'check' })
  if (losers.length) chips.unshift({ code: 'prejuizo', label: `${losers.length} no prejuízo antes dos anúncios`, tone: 'neg', icon: 'down' })

  let headline: string
  if (configured && contributionTotal > 0 && top.contribution !== null) {
    const cShare = (top.contribution / contributionTotal) * 100
    headline = topShare >= 24.5
      ? `${named(top)} puxou ${subject} ${periodPhrase}: ${pct0(topShare)} das vendas e ${pct0(cShare)} da contribuição.`
      : `As vendas ${subjectOf} estão espalhadas ${periodPhrase}: o maior produto, ${named(top)}, fez ${pct0(topShare)}.`
  } else {
    headline = topShare >= 24.5
      ? `${named(top)} puxou ${subject} ${periodPhrase}: ${pct0(topShare)} das vendas.`
      : `As vendas ${subjectOf} estão espalhadas ${periodPhrase}: o maior produto, ${named(top)}, fez ${pct0(topShare)}.`
  }

  details.push(line(`${plural(products.length, 'produto vendido', 'produtos vendidos')} em ${plural(totals.orders, 'pedido', 'pedidos')} · `,
    { text: plural(totals.units, 'unidade', 'unidades'), strong: true }, ` · ${formatMoney(totals.revenue)} em vendas.`))
  if (configured) {
    if (excluded.length) details.push(line(`Fora da contribuição: ${excluded.join(', ')} (custos não configurados) — só vendas e unidades.`))
    const judged = priced.filter(p => p.orders >= MIN_PRODUCT_ORDERS && p.revenue > 0)
    if (judged.length > 1) {
      const worst = judged.reduce((a, b) => (b.contribution / b.revenue < a.contribution / a.revenue ? b : a))
      details.push(line(`Menor margem entre os produtos com ${MIN_PRODUCT_ORDERS}+ pedidos: `,
        { text: named(worst), strong: true }, `, ${formatPct((worst.contribution / worst.revenue) * 100)} de contribuição.`))
    }
    const giftCost = -gifts.reduce((s, p) => s + p.contribution, 0)
    const giftText = gifts.length
      // The participle agrees with the count: "1 brinde (dado de graça) custou".
      ? `${plural(gifts.length, 'brinde', 'brindes')} (${gifts.length === 1 ? 'dado' : 'dados'} de graça) ${gifts.length === 1 ? 'custou' : 'custaram'} ${formatMoney(giftCost)}`
      : ''
    details.push(losers.length
      ? line({ text: plural(losers.length, 'produto vendido saiu', 'produtos vendidos saíram'), strong: true, tone: 'neg' },
        ` no prejuízo antes dos anúncios: ${losers.slice(0, 3).map(named).join(', ')}${losers.length > 3 ? ' e outros' : ''}.${giftText ? ` À parte, ${giftText}.` : ''}`)
      : gifts.length
        ? line('Nenhum produto vendido saiu no prejuízo antes dos anúncios; ', { text: giftText }, ` — ${gifts.slice(0, 2).map(named).join(', ')}${gifts.length > 2 ? ' e outros' : ''}.`)
        : line('Nenhum produto saiu no prejuízo antes dos anúncios.'))
  } else {
    details.push(line('Sem o custo dos produtos, a tabela mostra vendas, unidades e pedidos — não a contribuição.'))
  }

  return {
    ...base,
    tone: losers.length ? 'warn' : 'neu',
    chips,
    headline,
    amount: configured ? contributionTotal : totals.revenue,
    amountTone: configured ? (contributionTotal >= 0 ? 'pos' : 'neg') : 'neu',
    amountCaption: configured
      ? `de contribuição dos produtos: vendas − produto, frete e taxas, antes dos anúncios${excluded.length ? ` (sem ${excluded.join(', ')})` : ''}`
      : 'em vendas — sem custos configurados, não há contribuição',
    details: details.slice(0, 3),
    basis: configured ? 'profit' : 'revenue_minus_ads',
  }
}
