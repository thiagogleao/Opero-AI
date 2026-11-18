/**
 * Small pure helpers shared by the campaign and creative screens: the chip of
 * each campaign action and ad signal, the trend arrow, and a normaliser for
 * the sentences lib/campaignSignal and lib/creativeSignal produce.
 *
 * Those libraries format numbers the en-US way ("ROAS 1.53x", "$2,034",
 * "-34%"). The screens are pt-BR (lib/format: "1,53×", "$2.034", "−34%"), so
 * the sentences go through ptText before they are shown. The proper fix is in
 * those libraries (reported to the lead); this keeps the screens consistent
 * meanwhile and is a no-op on text that is already pt-BR.
 */

import type { CampaignAction, TrendArrow } from '@/lib/campaignSignal'
import { BELOW_BREAK_EVEN_LABEL, KEEP_LABEL, signalLabel, type Signal } from '@/lib/creativeSignal'
import type { ChipTone } from '@/components/ui'
import type { ChipIcon } from '@/lib/views/verdict'
import { formatMoney, formatPct } from '@/lib/format'

const THOUSANDS = '\u0001'

/** "ROAS 1.53x com $2,034 — -34%" → "ROAS 1,53× com $2.034 — −34%". */
export function ptText(s: string): string {
  return s
    // en-US thousands inside money ("$2,034", "$12,500") → placeholder first,
    // so the decimal step below cannot touch them.
    .replace(/\$(\d{1,3}(?:,\d{3})+)(?!\d)/g, (_, n: string) => `$${n.replace(/,/g, THOUSANDS)}`)
    // Money already in pt-BR ("$1.313") keeps its thousands dots.
    .replace(/\$(\d{1,3}(?:\.\d{3})+)(?![\d,])/g, (_, n: string) => `$${n.replace(/\./g, THOUSANDS)}`)
    // en-US decimals ("1.53", "3.6") → pt-BR comma.
    .replace(/(\d)\.(\d)/g, '$1,$2')
    .replace(new RegExp(THOUSANDS, 'g'), '.')
    // "1,53x" → "1,53×" (a multiplier, not the letter).
    .replace(/(\d)x\b/g, '$1×')
    // A minus sign before a number at a word start is the true minus.
    .replace(/(^|[\s(])-(?=\d)/g, '$1−')
}

/** Icons are the verdict chip glyphs, so a spec also fits a VerdictChip. */
export interface ChipSpec { label: string; tone: ChipTone; icon: ChipIcon }

export const ACTION_CHIP: Record<CampaignAction, ChipSpec> = {
  escalar: { label: 'Escalar', tone: 'pos', icon: 'up' },
  manter: { label: 'Manter', tone: 'info', icon: 'check' },
  cortar: { label: 'Cortar', tone: 'neg', icon: 'down' },
  observar: { label: 'Observar', tone: 'neu', icon: 'ring' },
}

export const SIGNAL_CHIP: Record<Signal, ChipSpec> = {
  kill: { label: 'Desligar', tone: 'neg', icon: 'down' },
  scale: { label: 'Escalar', tone: 'pos', icon: 'up' },
  refresh: { label: 'Trocar criativo', tone: 'warn', icon: 'alert' },
  ok: { label: KEEP_LABEL, tone: 'neu', icon: 'check' },
}

/**
 * The chip of one ad's verdict. The signal and its word are the shared ones
 * (lib/creativeSignal signalLabel, the phone says the same), but 'ok' only
 * means "no action": at or above the break-even it reads "Manter"; below it
 * (too little spend to cut, or still above the cut line) a check mark would
 * contradict the reason, so it reads "Abaixo do empate" with a neutral ring.
 */
export function adSignalChip(signal: Signal, roas: number | null, breakEven: number | null): ChipSpec {
  const label = signalLabel(signal, roas, breakEven)
  if (label === BELOW_BREAK_EVEN_LABEL) return { label, tone: 'neu', icon: 'ring' }
  return { ...SIGNAL_CHIP[signal], label }
}

/** What the ad's chip column means, for the column's ⓘ. */
export const AD_VERDICT_RULE =
  'Desligar: ROAS abaixo de 80% do empate com $50 ou mais gastos. Escalar: 40% ou mais acima do empate, com $30 gastos e 3 compras. Manter: sem ação, no empate ou acima. Abaixo do empate: sem ação ainda — pouco gasto para cortar, ou acima da linha de corte. Pausados e anúncios de conta compartilhada não recebem veredito.'

export interface TrendSpec {
  /** "▲ 77%", "▼ 30%", "■ estável", "—". */
  text: string
  tone: 'pos' | 'neg' | 'neu' | 'mut'
  /** Screen-reader / tooltip sentence. */
  title: string
}

/** The trend arrow of a campaign decision (ROAS of the judged 7 days against
 *  the 7 before). Null trend = no real earlier period to compare with. */
export function trendSpec(trend: TrendArrow | null, change: number | null, days: number): TrendSpec {
  if (trend === null) {
    return { text: '—', tone: 'mut', title: `Sem ${days} dias anteriores com gasto suficiente para comparar` }
  }
  const pct = change === null ? '' : formatPct(Math.abs(change), { digits: 0 })
  if (trend === 'melhorando') return { text: `▲ ${pct}`, tone: 'pos', title: `ROAS ${pct} melhor que nos ${days} dias anteriores` }
  if (trend === 'piorando') return { text: `▼ ${pct}`, tone: 'neg', title: `ROAS ${pct} pior que nos ${days} dias anteriores` }
  return { text: '■ estável', tone: 'neu', title: `ROAS praticamente igual ao dos ${days} dias anteriores` }
}

/** "1 campanha para cortar, 2 para manter e nenhuma para escalar". */
export function actionCountsText(actions: Record<CampaignAction, number>): string {
  const order: CampaignAction[] = ['cortar', 'escalar', 'manter', 'observar']
  const parts = order.map((a, i) => {
    const n = actions[a]
    const noun = i === 0 ? (n === 1 ? ' campanha' : ' campanhas') : ''
    return n === 0 ? `nenhuma para ${a}` : `${n}${noun} para ${a}`
  })
  // The first part carries the noun; when it is "nenhuma", name it on the next.
  if (actions.cortar === 0) parts[0] = 'nenhuma campanha para cortar'
  return `${parts.slice(0, -1).join(', ')} e ${parts[parts.length - 1]}`
}

/**
 * The row badge for Meta's impossible purchases dropped from a campaign
 * (above $20.000 on one ad-day, lib/engine/pnl PHANTOM_PURCHASE_VALUE). In
 * words and without a minus sign: "−$183.000 fantasma" sat next to the money
 * columns and read as a loss. The full sentence goes in the tooltip.
 */
export function phantomBadge(value: number): string {
  return `compra fantasma descartada (${formatMoney(value)})`
}

export function phantomNote(value: number): string {
  return `O Meta reportou ${formatMoney(value)} em compras impossíveis (acima de $20.000 num dia de um anúncio). Foram descartadas: não entram nas vendas atribuídas, no ROAS nem no lucro estimado.`
}
