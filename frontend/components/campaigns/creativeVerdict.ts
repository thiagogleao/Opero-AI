/**
 * The verdict card of one ad (/creatives/[id]): its signal from the shared ad
 * verdict (lib/creativeSignal via lib/data/creatives), its estimated profit
 * and the plain lines around it. Pure.
 */

import type { CreativeDetail } from '@/lib/data/creatives'
import type { Verdict, VerdictChip, VerdictLine } from '@/lib/views/verdict'
import { SPLIT_SHARE } from '@/lib/views/verdict'
import type { PnL } from '@/lib/engine/pnl'
import { BELOW_BREAK_EVEN_LABEL, KEEP_LABEL, type CreativeVerdict } from '@/lib/creativeSignal'
import { eachDay, type DateRange } from '@/lib/engine/dates'
import { formatDate, formatMoney, formatRangeLabel, formatRoas, plural } from '@/lib/format'
import { adVerdictChip, ptText } from './text'
import { dateBeside } from './storeStart'
import { dateBeside as periodDateBeside } from '@/lib/period'

const line = (...parts: (string | { text: string; strong?: boolean; tone?: 'pos' | 'neg' | 'warn' })[]): VerdictLine => {
  const ps = parts.map(p => (typeof p === 'string' ? { text: p } : p))
  return { parts: ps, text: ps.map(p => p.text).join('') }
}
/** A sentence without its closing period(s), so exactly one can be added. */
const stripStop = (t: string) => t.trim().replace(/[.\s]+$/, '')

const sameRange = (a: DateRange, b: DateRange) => a.from === b.from && a.to === b.to

/** "O veredito vem dos 7 dias fechados (17–23 nov): neles, …": the days a
 *  verdict judged on, named where the headline reads against it. */
function verdictSource(w: DateRange, dates: string, what: string): string {
  const days = eachDay(w.from, w.to).length
  return days === 1
    ? `O veredito vem do último dia fechado (${dates}): nele, ${what}.`
    : `O veredito vem dos ${days} dias fechados (${dates}): neles, ${what}.`
}

/**
 * What the verdict says the ad did over ITS window, when that reads against
 * the page window's estimate: a "Desligar" over a day that made money, a
 * "Manter" over a window that lost it. Null when the two agree or the verdict
 * has no direction (no signal, refresh).
 */
function verdictAgainstWindow(v: CreativeVerdict, windowProfit: number): string | null {
  const bad = v.signal === 'kill' || (v.signal === 'ok' && v.label === BELOW_BREAK_EVEN_LABEL)
  const good = v.signal === 'scale' || (v.signal === 'ok' && v.label === KEEP_LABEL)
  if (windowProfit >= 0 && bad) return v.signal === 'kill' ? 'ficou abaixo de 80% do empate' : 'ficou abaixo do empate'
  if (windowProfit < 0 && good) return v.signal === 'scale' ? 'ficou 40% ou mais acima do empate' : 'ficou no empate ou acima'
  return null
}

/** The text after "não teve gasto": "hoje", "em 24 nov", "em 10–16 nov" —
 *  never "entre 24 nov e 24 nov". */
export function noSpendWhen(range: DateRange, today: string): string {
  if (range.from === range.to) return range.from === today ? 'hoje' : `em ${periodDateBeside(range.from, { window: range, clockToday: today })}`
  return `em ${formatRangeLabel(range, today)}`
}

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
    // The ad's last spend on record, any window: the window's own is always
    // empty here, which left "Último dia com gasto" unreachable.
    const last = d.lastSpendDayEver ?? c.lastSpendDay
    const lastText = last ? dateBeside(last, [d.range.from, d.range.to], input.today) : null
    chips.push({ code: 'sem_vendas', label: 'Sem gasto neste período', tone: 'neu', icon: 'ring' })
    return {
      ...base, tone: 'neu', chips,
      headline: `Este anúncio não gastou ${periodPhrase}.`,
      // Point at the day that has data: "escolha um período maior" sat over
      // "Último dia com gasto: 24 nov", after a window ending on 5 nov — no
      // longer window ending there would show anything.
      amount: null, amountTone: 'neu',
      amountCaption: lastText ? `escolha um período que inclua ${lastText} para ver o histórico dele` : 'nenhum gasto registrado para este anúncio',
      details: [line(lastText ? `Último dia com gasto: ${lastText}.` : 'Nenhum gasto registrado para este anúncio.')],
      notes, basis: 'none',
    }
  }

  const sig = c.verdict.signal
  // The verdict's own word: it is judged on the campaigns' last closed days
  // (d.verdictWindow), not on this window's ROAS. When those are other days
  // than the page's, the chip carries its own dates ("Desligar · 17–23 nov"):
  // next to the card's "24 nov" a bare "Desligar" read as the verdict on a
  // day the ad made money (ROAS 5,75× against 1,34×).
  const ownWindow = !sameRange(d.verdictWindow, d.range)
  const verdictDates = formatRangeLabel(d.verdictWindow, input.today)
  const spec = adVerdictChip(c.verdict)
  const decided = !!(sig && spec)
  // "Cedo" is about TODAY's figures. It replaces the verdict only when the
  // verdict itself is judged on the running day; one judged on closed days
  // (ownWindow) stands. Otherwise at 01h the page said "Cedo demais para
  // julgar" over the kill reason of the 7 closed days, while Campanhas →
  // Criativos said "Desligar" for the same ad at the same moment.
  const earlyHidesVerdict = early && (!ownWindow || !decided)
  if (earlyHidesVerdict) {
    chips.push({ code: 'cedo', label: 'Cedo demais para julgar', tone: 'neu', icon: 'clock' })
  } else if (sig && spec) {
    chips.push({
      code: sig === 'kill' ? 'prejuizo' : sig === 'scale' ? 'lucro' : 'margem_fina',
      label: ownWindow ? `${spec.label} · ${verdictDates}` : spec.label,
      tone: spec.tone === 'mut' ? 'neu' : spec.tone, icon: spec.icon,
    })
  } else if (!c.running) {
    chips.push({ code: 'sem_vendas', label: 'Pausado', tone: 'neu', icon: 'ring' })
  }
  if (!d.configured) chips.push({ code: 'sem_custos', label: 'Custos não configurados', tone: 'cfg', icon: 'sliders' })
  if (c.shared) chips.push({ code: 'sem_custos', label: 'Conta compartilhada', tone: 'warn', icon: 'alert' })
  if (input.partialLabel) chips.push({ code: 'parcial', label: input.partialLabel, tone: 'info', icon: 'clock' })

  const est = c.estimatedProfit
  const be = d.breakEvenRoas
  let headline: string
  if (earlyHidesVerdict) {
    headline = 'Cedo demais para julgar este anúncio hoje: o Meta ainda está atribuindo as vendas do dia.'
  } else if (early) {
    const days = eachDay(d.verdictWindow.from, d.verdictWindow.to).length
    const closed = days === 1 ? `do último dia fechado (${verdictDates})` : `dos ${days} dias fechados (${verdictDates})`
    headline = `Os números de hoje ainda são cedo: o Meta está atribuindo as vendas do dia. O veredito ${closed} continua valendo: ${spec!.label}.`
  } else if (est !== null) {
    // A window still running is told in the present, "até agora", as the
    // Campanhas verdict does (adsVerdict): "deu lucro hoje" beside the chip
    // "parcial · até 22h09" read as a closed day.
    const result = est >= 0 ? 'lucro' : 'prejuízo'
    const did = input.partialLabel ? `está dando ${result} ${periodPhrase}, até agora` : `deu ${result} ${periodPhrase}`
    headline = `Este anúncio ${did}, pela atribuição do Meta: ROAS ${formatRoas(c.roas)}${be !== null ? ` contra empate ${formatRoas(be)}` : ''}.`
    // A verdict from other days that points the other way is said here, in
    // the sentence it contradicts, not only in the fine print below.
    const against = ownWindow ? verdictAgainstWindow(c.verdict, est) : null
    if (against) headline += ` ${verdictSource(d.verdictWindow, verdictDates, against)}`
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
    // The card's colour is the window's result, like the amount under it. On
    // the verdict's own window a kill is always a loss (ROAS under 80% of the
    // break-even), so this only differs when the verdict judged other days,
    // and then a profitable day stays green with the chip naming its days.
    tone: early ? 'neu' : est >= 0 ? 'pos' : 'neg',
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
