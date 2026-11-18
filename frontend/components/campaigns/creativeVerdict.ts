/**
 * The verdict card of one ad (/creatives/[id]): its signal from the shared ad
 * verdict (lib/creativeSignal via lib/data/creatives), its estimated profit
 * and the plain lines around it. Pure.
 */

import type { CreativeDetail } from '@/lib/data/creatives'
import type { Verdict, VerdictChip, VerdictLine } from '@/lib/views/verdict'
import { SPLIT_SHARE } from '@/lib/views/verdict'
import type { PnL } from '@/lib/engine/pnl'
import { formatDate, formatMoney, formatRoas, plural } from '@/lib/format'
import { adSignalChip, ptText } from './text'

const line = (...parts: (string | { text: string; strong?: boolean; tone?: 'pos' | 'neg' | 'warn' })[]): VerdictLine => {
  const ps = parts.map(p => (typeof p === 'string' ? { text: p } : p))
  return { parts: ps, text: ps.map(p => p.text).join('') }
}
/** A sentence without its closing period(s), so exactly one can be added. */
const stripStop = (t: string) => t.trim().replace(/[.\s]+$/, '')

export function buildCreativeVerdict(input: {
  detail: CreativeDetail
  storeTotals: PnL
  rangeLabel: string
  periodPhrase: string
  partialLabel: string | null
  today: string
  /** "Hoje" before EARLY_DAY_MINUTES: Meta is still attributing the day's sales. */
  early?: boolean
  split?: boolean
}): Verdict {
  const { detail: d, periodPhrase } = input
  const c = d.creative
  const k = input.split ? SPLIT_SHARE : 1
  const chips: VerdictChip[] = []
  const details: VerdictLine[] = []
  const notes: VerdictLine[] = []
  // The partial clock is its own chip; the date line stays the range only.
  const when = input.rangeLabel
  const early = !!input.early
  const base = {
    when, totals: input.storeTotals, comparisonTotals: null, excluded: [], partial: !!input.partialLabel,
    split: !!input.split, storeCount: 1, roas: null, early, fewOrders: false,
  }

  if (!d.hasSpend) {
    chips.push({ code: 'sem_vendas', label: 'Sem gasto neste período', tone: 'neu', icon: 'ring' })
    return {
      ...base, tone: 'neu', chips,
      headline: `Este anúncio não gastou ${periodPhrase}.`,
      amount: null, amountTone: 'neu', amountCaption: 'escolha um período maior para ver o histórico dele',
      details: [line(c.lastSpendDay ? `Último dia com gasto: ${formatDate(c.lastSpendDay, input.today)}.` : 'Nenhum gasto registrado nas datas escolhidas.')],
      notes, basis: 'none',
    }
  }

  const sig = c.verdict.signal
  if (early) {
    chips.push({ code: 'cedo', label: 'Cedo demais para julgar', tone: 'neu', icon: 'clock' })
  } else if (sig) {
    const spec = adSignalChip(sig, c.roas, d.breakEvenRoas)
    chips.push({ code: sig === 'kill' ? 'prejuizo' : sig === 'scale' ? 'lucro' : 'margem_fina', label: spec.label, tone: spec.tone === 'mut' ? 'neu' : spec.tone, icon: spec.icon })
  } else if (!c.running) {
    chips.push({ code: 'sem_vendas', label: 'Pausado', tone: 'neu', icon: 'ring' })
  }
  if (!d.configured) chips.push({ code: 'sem_custos', label: 'Custos não configurados', tone: 'cfg', icon: 'sliders' })
  if (c.shared) chips.push({ code: 'sem_custos', label: 'Conta compartilhada', tone: 'warn', icon: 'alert' })
  if (input.partialLabel) chips.push({ code: 'parcial', label: input.partialLabel, tone: 'info', icon: 'clock' })

  const est = c.estimatedProfit
  const be = d.breakEvenRoas
  let headline: string
  if (early) {
    headline = 'Cedo demais para julgar este anúncio hoje: o Meta ainda está atribuindo as vendas do dia.'
  } else if (est !== null) {
    headline = `Este anúncio deu ${est >= 0 ? 'lucro' : 'prejuízo'} ${periodPhrase}, pela atribuição do Meta: ROAS ${formatRoas(c.roas)}${be !== null ? ` contra empate ${formatRoas(be)}` : ''}.`
  } else if (c.shared) {
    headline = `Este anúncio rodou em conta compartilhada: as vendas dele podem ser de outra loja.`
  } else {
    headline = `Este anúncio gastou ${formatMoney(c.spend)} ${periodPhrase} e o Meta credita ${formatMoney(c.purchaseValue)} a ele.`
  }

  // The reason may already end its sentence (the shared-account note does):
  // one period, never "..". For a shared-account ad the reason IS that note
  // (lib/creativeSignal returns sharedNote as the reason), so it is said here
  // once and not repeated in the fine print below.
  const reason = stripStop(ptText(c.verdict.reason))
  details.push(line({ text: reason, strong: true }, '.'))
  details.push(line(`Gasto ${formatMoney(c.spend)} em ${plural(c.daysWithSpend, 'dia', 'dias')} · ${plural(c.purchases, 'compra atribuída', 'compras atribuídas')}`,
    c.cpa !== null ? ` · CPA ${formatMoney(c.cpa)}` : '', ` · vendas atribuídas ${formatMoney(c.purchaseValue)}.`))
  if (d.bestDay && d.worstDay) {
    // The partner's half, like the amount above and the page's day table.
    const val = (x: typeof d.bestDay) => (x!.estimatedProfit !== null ? formatMoney(x!.estimatedProfit * k) : `ROAS ${formatRoas(x!.roas)}`)
    const half = input.split && d.bestDay.estimatedProfit !== null ? ', sua parte do lucro estimado' : ''
    details.push(line(`Melhor dia ${formatDate(d.bestDay.date, input.today)} (${val(d.bestDay)}), pior dia ${formatDate(d.worstDay.date, input.today)} (${val(d.worstDay)}) — só dias com $10 ou mais de gasto${half}.`))
  }
  if (c.shared && stripStop(ptText(c.shared.note)) !== reason) notes.push(line(c.shared.note))

  if (est === null) {
    return {
      ...base, tone: 'neu', chips, headline,
      amount: d.configured ? null : (c.purchaseValue - c.spend) * k,
      amountTone: 'neu',
      amountCaption: d.configured ? 'sem margem para estimar o lucro deste anúncio' : `${input.split ? 'sua parte de ' : ''}vendas atribuídas − gasto, sem o custo dos produtos`,
      details, notes, basis: d.configured ? 'none' : 'revenue_minus_ads',
    }
  }
  return {
    ...base,
    tone: early ? 'neu' : sig === 'kill' ? 'neg' : est >= 0 ? 'pos' : 'neg',
    chips,
    headline,
    amount: est * k,
    amountTone: early ? 'neu' : est >= 0 ? 'pos' : 'neg',
    amountCaption: `${input.split ? 'sua parte (50%) do ' : 'de '}lucro estimado: vendas atribuídas × margem da loja − gasto`,
    details,
    notes,
    basis: 'profit',
  }
}
