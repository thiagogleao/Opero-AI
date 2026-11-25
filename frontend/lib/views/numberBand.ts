/**
 * The number band: the six numbers every Resumo, Todas and the phone home
 * open with — lucro, margem, receita, pedidos, anúncios, ROAS × empate — each
 * with its ▲▼ against the comparison window, a short status line of chips and
 * everything the verdict used to say in sentences, kept for "Detalhes do
 * período". Presentation only: every number is read from the verdict
 * (lib/views/verdict buildVerdict) and the engine's totals it carries; nothing
 * is recomputed here.
 *
 * Shared by the desktop (server components) and the phone (a client
 * component), so this module is PURE and client-safe, with the same import
 * discipline as verdict.ts: relative imports, types from the engine,
 * lib/format, ./verdict, ./adChannel and two pure helpers of components/.
 *
 * Entry points:
 *   buildNumberBand({ input, verdict, scope, extraChips?, tileTags? })
 *   bandDelta(kind, cur, prev, vs)       the ▲▼ rule for one pair (phone readout, tests)
 *   followBand(band, kind, cur, prev, k)  a ▲▼ outside the band under the band's state (Resumo "Por dia e por pedido")
 *   ticketOf(totals)                     receita ÷ pedidos, as lib/views/store aov
 *   *_INFO                               the ⓘ definitions (StoreKpis imports them back)
 */

import type { PnL } from '../engine/pnl'
import type { Verdict, VerdictInput, VerdictLine, ChipIcon, VerdictChip } from './verdict'
import {
  adjustmentsWhat, CASH_HIT_SHARE, isIdle, judgedStores, MIN_ORDERS, noSalesCashHit, notSellingYet, SPLIT_SHARE, storeRoas,
  THIN_MARGIN_PCT,
} from './verdict'
import { adChannelOf, channelRoas, MINOR_CHANNEL_SHARE, ROAS_LABEL, type AdChannel } from './adChannel'
import {
  formatCount, formatMoney, formatPct, formatPp, formatRangeLabel, formatRoas, pctChange, plural, readablePctChange,
} from '../format'
import { comparisonFullAmong } from '../period'
import { reasonText, roasGapPct } from '../../components/ui/roasReason'
import { kpiComparisonLabel } from '../../components/dashboard/comparisonLabel'
import { splitChipText } from '../../components/shell/splitChip'

// ─── Types (the phone codes against these: see the spec §2) ─────────────────

export type BandTileKey = 'lucro' | 'margem' | 'receita' | 'pedidos' | 'anuncios' | 'roas'
export type BandTone = 'pos' | 'neg' | 'warn' | 'neu' | 'mut'
export type BandChipTone = 'pos' | 'neg' | 'warn' | 'neu' | 'info' | 'cfg' | 'mut'

/** A short label next to a value or in the status line. `info` is the prose
 *  that used to be a sentence or a callout: shown in an InfoTip (tap, hover,
 *  focus). Never longer than ~4 words in `label`. */
export interface BandChip {
  code: string                 // verdict ChipCode, or: 'lojas_na_soma' | 'arquivada' | 'quieta' | 'conta_compartilhada' | 'fuso' | page codes
  label: string                // "parcial · até 13h52", "só Meta", "sua parte (50%)"
  tone: BandChipTone
  icon?: ChipIcon
  info?: string                // plain text, may be several sentences
  action?: 'configure_costs'   // desktop renders a link to /profit; phone ignores
}

export interface BandDelta {
  kind: 'pct' | 'pp' | 'diff' | 'was' | 'none'
  /** null for kind 'none', and for a 'was' with no current value (the lucro
   *  of a window with nothing in it beside a base that had a result). */
  dir: 'up' | 'down' | 'flat' | null
  /** Colour: 'up' green, 'down' coral, 'neutral' steel blue (receita, pedidos, anúncios). */
  good: 'up' | 'down' | 'neutral' | null
  /** "31%", "21,4 p.p.", "$248 a mais", "era −$4.608", "era 1,30×"; for 'none' the short tag:
   *  "sem base" | "base incompleta" | "sem comparação" | "outro canal" — or '' (an empty row
   *  that keeps the tiles aligned: one side has no value). */
  text: string
  /** Previous value as printed ("$35.283"), for titles; null for 'none'. */
  previousText: string | null
  /** Screen-reader sentence: "subiu 31% vs mesmos dias do mês passado (1–25 out, até 13h52)". */
  aria: string
}

export interface BandSub { text: string; tone?: 'pos' | 'neg' | 'warn' | 'mut' }

export interface BandTile {
  key: BandTileKey
  label: string                // "Lucro real" | "Receita − anúncios" | "Margem" | "Receita" | "Pedidos" | "Anúncios" | "ROAS do Meta × empate" …
  value: string                // formatted, "—" when none
  raw: number | null           // the number behind `value` (already halved for lucro under split)
  tone: BandTone
  size: 'xl' | 'md'            // xl: lucro, margem
  subs: BandSub[]              // priority order; desktop renders ≤ 2, phone ≤ 1
  /** ADDED (see interface_changes.md): the one sub line for the phone when it
   *  differs from subs[0] — anúncios joins "Meta $25.906 · Shopify $554".
   *  Absent: use subs[0]. */
  phoneSub?: BandSub
  /** ADDED (r1): a shorter label for the phone's 2-line tile label, when the
   *  full one would be cut ("ROAS Meta + Shopify × empate"). Absent: label. */
  phoneLabel?: string
  tags: BandChip[]             // rendered right after the value
  /** null: no delta row at all (empty window, frozen, no comparison). */
  delta: BandDelta | null
  info: string                 // the ⓘ text (definition + caveats)
  /** ROAS tile only: what a mini gauge needs. */
  gauge?: { roas: number; breakEven: number | null; state: 'pos' | 'neg' | 'unknown'; reason: string | null }
}

export interface NumberBand {
  tiles: [BandTile, BandTile, BandTile, BandTile, BandTile, BandTile]   // fixed order lucro…roas
  status: BandChip[]           // §1.4 items 1–3, in order
  /** §1.4 item 4. null when there is nothing to say (empty / frozen window). */
  comparison: { short: string; full: string; kind: 'ok' | 'none' | 'partial' | 'empty_base' } | null
  /** The window has no data (verdict.beforeStart / verdict.frozen): every tile is "—". */
  empty: { kind: 'not_yet' | 'frozen'; text: string } | null
  /** ADDED (r3): a running day too young to judge (C4): deltas are uncoloured.
   *  Read by followBand for the deltas outside the band. */
  early?: boolean
  /** Everything for "Detalhes do período" (§1.6 items 1–5). */
  details: {
    headline: string
    lines: VerdictLine[]       // verdict.details
    when: string               // verdict.when
    notes: VerdictLine[]       // verdict.notes
    roasExplain: string | null
    count: number              // items shown in the summary row
  }
}

export interface NumberBandInput {
  /** The exact input buildVerdict received (stores, comparison, today, split). */
  input: VerdictInput
  /** buildVerdict(input) — on the desktop Resumo, the `v` actually rendered
   *  (rebuilt with comparison null when frozen). */
  verdict: Verdict
  scope: 'store' | 'all'
  /** Chips the page words itself (archived, quiet store, shared account, clock). */
  extraChips?: BandChip[]
  /** Page tags per tile (Hibikura receita: "vende em JPY"; CAMP anúncios/roas: shared account). */
  tileTags?: Partial<Record<BandTileKey, BandChip[]>>
}

// ─── The ⓘ definitions (one copy: StoreKpis imports them) ───────────────────

/** "10%": the share under which a second ad channel stays out of the ROAS. */
const MINOR_PCT = formatPct(MINOR_CHANNEL_SHARE * 100, { digits: 0 })

export const LUCRO_INFO = 'Vendas menos produto, frete, taxas, Anúncios Meta, Anúncios Shopify e custos fixos. Reembolsos e chargebacks ficam fora: entram no resultado de caixa.'
export const REVENUE_MINUS_ADS_INFO = 'Sem custos configurados não dá para saber o lucro: este número é a receita menos o gasto em anúncios, sem o custo dos produtos, do frete e das taxas.'
export const SPLIT_LUCRO_INFO = 'Na visão de sócio só o lucro é dividido; receita, gasto, margem e ROAS são da loja inteira.'
/** Todas: the same sentence for the sum of the stores (C8: "antes da divisão"). */
export const SPLIT_LUCRO_INFO_ALL = 'Na visão de sócio só o lucro é dividido; receita, gasto, margem e ROAS são da soma inteira das lojas, antes da divisão.'
/** The "poucos pedidos" ⓘ, from the verdict's threshold. */
export const FEW_ORDERS_INFO = `Menos de ${MIN_ORDERS} pedidos no período: pouca amostra para cravar uma tendência.`
// Revenue and orders per day start at the first sale; spend per day at the
// store's start, which an ad before the first sale moves earlier (Glooty:
// ads from 4 nov, first order on 6 nov). Each ⓘ says which days it divides by.
export const SALES_PER_DAY_INFO = 'Média por dia: só os dias fechados desde a primeira venda da loja; o dia de hoje, ainda em andamento, fica de fora.'
export const SPEND_PER_DAY_INFO = 'Média por dia: só os dias fechados desde que a loja começou (a primeira venda ou o primeiro anúncio, o que veio antes: anúncio antes da primeira venda é gasto de verdade); o dia de hoje, ainda em andamento, fica de fora.'
export const REVENUE_INFO = 'Total pago pelos clientes nos pedidos não reembolsados nem cancelados, com impostos e frete, nas datas do fuso da loja. Um pedido reembolsado por inteiro sai do dia em que foi feito. Vendas em outra moeda entram convertidas em dólar.'
export const ORDERS_INFO = 'Pedidos pagos no período (reembolsados e cancelados não entram). Ticket médio = receita ÷ pedidos.'
export const MARGIN_INFO = 'Margem = lucro real ÷ receita: quantos centavos de cada dólar vendido sobram depois de todos os custos (não muda na visão de sócio).'
export const META_SPEND_INFO = 'Gasto em Facebook e Instagram das contas de anúncio da loja, dia a dia. Uma conta desligada deixa de ser coletada, mas o gasto que já teve continua nas contas.'
export const SHOP_SPEND_INFO = 'Shop Campaigns, cobrados na fatura da Shopify, fora do Meta. Entram no lucro como custo próprio e nunca no ROAS do Meta.'
export const ROAS_INFO = 'ROAS = receita da loja ÷ gasto em anúncios. Com um só canal gastando, é esse canal. Com Meta e Anúncios Shopify gastando, '
  + 'é o gasto dos dois somado, porque dividir a receita só pelo Meta daria ao Meta as vendas que os Anúncios Shopify trouxeram. '
  + `A exceção: um canal com menos de ${MINOR_PCT} do gasto em anúncios fica fora do ROAS, que passa a ser o do outro canal, e entra só no lucro. `
  + 'Empate = receita ÷ (receita − produto − frete − taxas): o ROAS em que os anúncios comem toda a margem. Acima dele, os anúncios deixam lucro '
  + 'antes dos custos fixos. Sem custos configurados, o empate é desconhecido.'

/** A comparison base with fewer orders than this is too small to read a margin
 *  change from (the verdict's "poucos pedidos" threshold). */
export const FEW_BASE_ORDERS = MIN_ORDERS

/** What "a loja começou em …" means (lib/period: first activity day). */
const START_DAY_NOTE = 'começou = o primeiro dia com venda ou anúncio; a primeira venda pode ter vindo depois'

/** Status-line chips, most important first: when two rows are not enough,
 *  the view folds the lowest into a "+N" chip (spec C9). Unknown codes rank
 *  with the page chips, after `margem_fina`. */
export const BAND_CHIP_PRIORITY: readonly string[] = [
  'lucro', 'prejuizo', 'cedo', 'sem_vendas', 'comecando',
  'sem_custos', 'parcial', 'arquivada', 'dia_fuso', 'fuso', 'conta_compartilhada_warn',
  'margem_fina', 'poucos_pedidos', 'lojas_na_soma', 'conta_compartilhada', 'quieta',
]
/** Rank of a status chip for folding (lower = kept longer). */
export function chipRank(c: BandChip): number {
  const code = c.code === 'conta_compartilhada' && c.tone === 'warn' ? 'conta_compartilhada_warn' : c.code
  const i = BAND_CHIP_PRIORITY.indexOf(code)
  return i < 0 ? BAND_CHIP_PRIORITY.indexOf('margem_fina') + 0.5 : i
}

/**
 * The ROAS tile's channel tag (spec §1.2): which spend the ratio divides by.
 * `só Meta` when Shopify spent but sits outside the ratio, `Meta` when Meta
 * is the only spend, `Meta + Shopify`, `só Shopify`. Null without a channel.
 * Shared by the band, the Campanhas page row and the phone's Atenção rows.
 */
export function roasChannelTag(t: Pick<PnL, 'metaSpend' | 'shopSpend' | 'roas'>, channel: AdChannel | null): BandChip | null {
  if (!channel) return null
  if (channel === 'meta') {
    return t.shopSpend > 0
      ? { code: 'canal', label: 'só Meta', tone: 'info', info: `Os ${formatMoney(t.shopSpend)} de Anúncios Shopify ficam fora deste ROAS (menos de ${MINOR_PCT} do gasto em anúncios), mas entram no lucro.` }
      : { code: 'canal', label: 'Meta', tone: 'info', info: 'Todo o gasto em anúncios do período foi no Meta.' }
  }
  if (channel === 'shop') {
    return { code: 'canal', label: 'só Shopify', tone: 'info', info: t.metaSpend > 0
      ? `Os ${formatMoney(t.metaSpend)} de Meta ficam fora deste ROAS (menos de ${MINOR_PCT} do gasto em anúncios), mas entram no lucro.`
      : 'Todo o gasto em anúncios do período foi em Anúncios Shopify.' }
  }
  return { code: 'canal', label: 'Meta + Shopify', tone: 'info', info: 'Meta e Anúncios Shopify somados: dividir a receita só pelo Meta daria ao Meta as vendas que os Anúncios Shopify trouxeram.'
    // The engine's revenue ÷ Meta spend (PnL.roas), as the old KPI said it.
    + (t.metaSpend > 0 && t.roas !== null ? ` Só o Meta: ${formatRoas(t.roas)}, que credita ao Meta também as vendas dos Anúncios Shopify.` : '') }
}

// ─── Small helpers ───────────────────────────────────────────────────────────

/** The ad channel in a sentence ("foi medido em Meta + Shopify"). */
const CHANNEL_WORDS: Record<AdChannel, string> = { meta: 'Meta', shop: 'Anúncios Shopify', both: 'Meta + Shopify' }

/** Receita ÷ pedidos — the expression of lib/views/store `aov`. */
export function ticketOf(t: Pick<PnL, 'revenue' | 'orders'>): number | null {
  return t.orders > 0 ? t.revenue / t.orders : null
}

/** "A", "A e B", "A, B e C". One copy for the band and the phone. */
export function joinNames(names: string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}
const EMPTY_ROW = (): BandDelta => ({ kind: 'none', dir: null, good: null, text: '', previousText: null, aria: '' })
const noneDelta = (text: string, aria: string): BandDelta => ({ kind: 'none', dir: null, good: null, text, previousText: null, aria })
/** "sem base: a loja começou em 4 nov", never "sem base: sem base: …": the
 *  tag prefixes the reason only when the reason does not already open with it. */
export function tagged(tag: string, text: string): string {
  return text.toLowerCase().startsWith(tag.toLowerCase()) ? text : `${tag}: ${text}`
}

type DeltaKind = 'money_result' | 'money' | 'count' | 'pp' | 'roas'

function fmtPrev(kind: DeltaKind, v: number): string {
  return kind === 'count' ? formatCount(v) : kind === 'pp' ? formatPct(v) : kind === 'roas' ? formatRoas(v) : formatMoney(v)
}

/**
 * The §1.3 rule for one pair. `k` is the partner share for a money result:
 * `cur` and `prev` arrive already multiplied by it, and the readability of a
 * percentage is judged on the whole numbers (the base of $80 is not $40).
 */
function deltaOf(kind: DeltaKind, cur: number | null, prev: number | null, vs: { short: string; full: string }, k = 1): BandDelta | null {
  const ariaOf = (d: 'up' | 'down' | 'flat' | null, text: string) =>
    // "subiu; era −$4.631 vs …": a 'was' text after the verb needs the break.
    `${d === 'up' ? 'subiu' : d === 'down' ? 'caiu' : d === 'flat' ? 'estável' : 'antes'}${/^era /.test(text) ? ';' : ''} ${text} ${vs.full}`.replace(/\s+/g, ' ').trim()
  const goodOf = (d: 'up' | 'down' | 'flat'): BandDelta['good'] => (d === 'flat' ? 'neutral' : d)

  if (kind === 'money_result') {
    if (prev === null) return cur === null ? null : EMPTY_ROW()
    const previousText = formatMoney(prev)
    if (cur === null) {
      const text = `era ${previousText}`
      return { kind: 'was', dir: null, good: null, text, previousText, aria: `antes: ${previousText} ${vs.full}` }
    }
    const d = cur - prev
    if (cur >= 0 && prev > 0) {
      const ch = readablePctChange(cur / k, prev / k)
      if (ch !== null) {
        const dir = Math.abs(ch) < 0.5 ? 'flat' : ch > 0 ? 'up' : 'down'
        const text = formatPct(Math.abs(ch), { digits: 0 })
        return { kind: 'pct', dir, good: goodOf(dir), text, previousText, aria: ariaOf(dir, text) }
      }
      const dir = Math.abs(d) < 0.005 ? 'flat' : d > 0 ? 'up' : 'down'
      const text = dir === 'flat' ? 'igual' : `${formatMoney(Math.abs(d))} a ${d > 0 ? 'mais' : 'menos'}`
      return { kind: 'diff', dir, good: goodOf(dir), text, previousText, aria: ariaOf(dir, text) }
    }
    const dir = Math.abs(d) < 0.005 ? 'flat' : d > 0 ? 'up' : 'down'
    const text = `era ${previousText}`
    return { kind: 'was', dir, good: goodOf(dir), text, previousText, aria: ariaOf(dir, text) }
  }

  if (kind === 'money' || kind === 'count') {
    if (cur === null || prev === null) return EMPTY_ROW()
    // The Delta component's rules (components/ui/Display): nothing on both
    // sides is no news; a percentage only from a positive base and within
    // readable bounds (no minimum base), else the difference, else "era".
    if (cur === 0 && prev === 0) return EMPTY_ROW()
    const previousText = fmtPrev(kind, prev)
    const pct = cur < 0 ? null : pctChange(cur, prev)
    const change = pct !== null && readablePctChange(cur, prev, { minBase: 0 }) === null ? null : pct
    if (change === null && pct !== null) {
      const d = cur - prev
      const dir = d > 0 ? 'up' : 'down'
      const text = `${kind === 'money' ? formatMoney(Math.abs(d)) : formatCount(Math.abs(d))} a ${d > 0 ? 'mais' : 'menos'}`
      return { kind: 'diff', dir, good: 'neutral', text, previousText, aria: ariaOf(dir, text) }
    }
    if (change === null) {
      const d = cur - prev
      const dir = Math.abs(d) < 0.005 ? 'flat' : d > 0 ? 'up' : 'down'
      const text = `era ${previousText}`
      return { kind: 'was', dir, good: 'neutral', text, previousText, aria: ariaOf(dir, text) }
    }
    const dir = Math.abs(change) < 0.5 ? 'flat' : change > 0 ? 'up' : 'down'
    const text = formatPct(Math.abs(change), { digits: 0 })
    return { kind: 'pct', dir, good: 'neutral', text, previousText, aria: ariaOf(dir, text) }
  }

  if (kind === 'pp') {
    if (cur === null || prev === null) return EMPTY_ROW()
    const ch = cur - prev
    const dir = Math.abs(ch) < 0.05 ? 'flat' : ch > 0 ? 'up' : 'down'
    const text = formatPp(Math.abs(ch))
    return { kind: 'pp', dir, good: goodOf(dir), text, previousText: formatPct(prev), aria: ariaOf(dir, text) }
  }

  // roas: never a percentage of a ratio.
  if (cur === null || prev === null) return EMPTY_ROW()
  const d = cur - prev
  const dir = Math.abs(d) < 0.005 ? 'flat' : d > 0 ? 'up' : 'down'
  const previousText = formatRoas(prev)
  const text = `era ${previousText}`
  return { kind: 'was', dir, good: goodOf(dir), text, previousText, aria: ariaOf(dir, text) }
}

/** The §1.3 delta rule for one pair (no partner share): the phone's readout and the tests. */
export function bandDelta(
  kind: 'money_result' | 'money' | 'count' | 'pp' | 'roas',
  cur: number | null, prev: number | null,
  vs: { short: string; full: string },
): BandDelta | null {
  return deltaOf(kind, cur, prev, vs, 1)
}

/**
 * A ▲▼ outside the band (the Resumo's "Por dia e por pedido") under the
 * band's own comparison state, so a card never prints a % the band refuses:
 * no row when the band has no measured comparison (sem base, base incompleta,
 * sem comparação, frozen or empty window — the band's status line says why,
 * once), uncoloured while the day is too young to judge (C4), and a money
 * result under the partner split judged on the whole numbers (`k`, as the
 * band's lucro): `cur` and `prev` arrive already multiplied by it.
 */
export function followBand(
  band: Pick<NumberBand, 'comparison' | 'early'>,
  kind: 'money_result' | 'money' | 'count',
  cur: number | null, prev: number | null, k = 1,
): BandDelta | null {
  const c = band.comparison
  if (!c || c.kind !== 'ok') return null
  const d = deltaOf(kind, cur, prev, { short: c.short, full: c.full }, k)
  return d && band.early && d.good !== null ? { ...d, good: 'neutral' } : d
}

// ─── Chip infos ──────────────────────────────────────────────────────────────

function verdictChipInfo(c: VerdictChip, v: Verdict): Pick<BandChip, 'info' | 'action'> {
  const find = (re: RegExp, lines: VerdictLine[]) => lines.find(l => re.test(l.text))?.text
  switch (c.code) {
    case 'parcial': {
      const countdown = v.notes.find(n => n.countdown)?.text
      return { info: `${countdown ? `${countdown} ` : ''}Os números mudam até o dia fechar.` }
    }
    case 'sem_custos': {
      if (c.label === 'Custos não configurados') {
        return {
          info: 'Sem o custo dos produtos, do frete e das taxas, esta tela mostra receita − anúncios, que não é lucro.',
          action: 'configure_costs',
        }
      }
      const split = v.split
      const info = v.excluded.map(x => (x.revenue <= 0 && x.adSpend <= 0
        ? `${x.name} fica fora da soma: sem custos configurados (sem vendas nem anúncios no período).`
        : `${x.name} fica fora da soma: sem custos configurados (${split ? 'sua parte da ' : ''}receita − anúncios: ${formatMoney(x.revenueMinusAds)}).`)).join(' ')
      // Page verdicts (Campanhas · Todas) raise "1 loja sem custos" with no
      // excluded list: their own sentence naming the store is the ⓘ.
      return { info: info || find(/custos configurados/, v.details) || find(/custos configurados/, v.notes) || undefined }
    }
    case 'dia_fuso':
      return { info: find(/^Dia de /, v.notes) ?? 'A loja fecha o dia no fuso dela, que pode não bater com o de Brasília.' }
    case 'poucos_pedidos':
      return { info: find(/pouca amostra/, v.details) ?? FEW_ORDERS_INFO }
    case 'cedo':
      return { info: find(/ainda não diz nada|o gasto já passou das vendas/, v.details) ?? 'O dia acabou de começar ou tem poucos pedidos: o resultado ainda não diz nada.' }
    case 'margem_fina':
      return { info: `Menos de ${THIN_MARGIN_PCT} centavos de lucro em cada dólar vendido.` }
    case 'comecando':
    case 'sem_vendas':
      return { info: v.headline }
    default:
      return {}
  }
}

// ─── The band ────────────────────────────────────────────────────────────────

export function buildNumberBand(i: NumberBandInput): NumberBand {
  const { input, verdict: v, scope } = i
  const k = v.split ? SPLIT_SHARE : 1
  const T = v.totals
  const P = v.comparisonTotals
  const L = v.likeTotals ?? T
  const likeDiffers = scope === 'all' && L !== T
  const withCosts = v.basis !== 'revenue_minus_ads'
  // C4 keys on what the reader sees: the status chip "Cedo demais para julgar".
  // The verdict also raises it with no sales yet, spend and an early day while
  // `v.early` stays false (Hibikura Hoje at 03h): same neutral deltas, same tag.
  const early = v.early || v.chips.some(c => c.code === 'cedo')
  // The verdict's resultOf (keys on withCosts: basis 'none' is profit).
  const res = (x: PnL) => (withCosts ? x.operatingProfit : x.revenue - x.adSpend)
  const empty: NumberBand['empty'] = v.beforeStart
    ? { kind: 'not_yet', text: v.amountCaption }
    : v.frozen ? { kind: 'frozen', text: v.amountCaption } : null

  // The stores of the sum (Todas): the verdict's own rule, through its exported helpers.
  const { judged } = judgedStores(input.stores)
  const many = input.stores.length > 1
  const idle = many ? judged.filter(s => isIdle(s.totals)) : []
  const nStores = judged.length - idle.length

  // ── The comparison state (§1.3)
  const cmp = input.comparison
  type State = { kind: 'off' } | { kind: 'tag'; tag: string; text: string; ck: 'none' | 'partial' | 'empty_base' } | { kind: 'ok' }
  let state: State
  if (empty) state = { kind: 'off' }
  else if (!cmp || cmp.none === '') state = { kind: 'off' }
  else if (cmp.none) state = { kind: 'tag', tag: 'sem base', text: cmp.none, ck: 'none' }
  else if (cmp.partialBase) state = { kind: 'tag', tag: 'base incompleta', text: `${cmp.partialBase} · a variação não é medida`, ck: 'partial' }
  else if (!P || (P.orders === 0 && P.adSpend === 0)) {
    const range = cmp.rangeText ?? formatRangeLabel({ from: cmp.from, to: cmp.to }, input.today)
    state = { kind: 'tag', tag: 'sem comparação', text: `sem vendas para comparar em ${range}`, ck: 'empty_base' }
  } else state = { kind: 'ok' }

  const label = cmp && state.kind === 'ok' ? kpiComparisonLabel(cmp, input.today) : null
  let comparison: NumberBand['comparison'] = null
  /** Todas, like for like (R6): stores the deltas leave out. */
  let likeNames: string[] = []
  if (state.kind === 'tag') {
    // "a loja começou em 4 nov" is lib/period's first ACTIVITY day (a sale or
    // an ad, whichever came first); the verdict may name the first SALE (Glooty:
    // ads from 4 nov, first order 6 nov). The ⓘ says which day this is.
    const full = state.ck !== 'empty_base' && /começou em/.test(state.text) ? `${state.text} (${START_DAY_NOTE})` : state.text
    comparison = { short: state.text, full, kind: state.ck }
  }
  if (state.kind === 'ok' && cmp && label) {
    let short = label.short
    let full = label.full
    if (scope === 'all') {
      // Like for like (verdict newSinceCmp): stores of the sum that had no
      // fair base are named, unless lib/period's clause already did.
      const win = { from: cmp.from, to: cmp.to }
      const newSince = many
        ? judged.filter(s => !idle.includes(s) && !!s.comparison
          && (!s.comparison.included || notSellingYet({ totals: s.comparison.totals, firstOrderDate: s.firstOrderDate }, win)))
        : []
      const names = newSince.map(s => s.name)
      likeNames = [...new Set([...names, ...(cmp.leftOut ?? [])])]
      if (names.length && !names.every(n => short.includes(n))) short = `${short} · sem ${joinNames(names)}`
      full = comparisonFullAmong(cmp, judged.map(s => s.id)) ?? full
    }
    comparison = { short, full, kind: 'ok' }
  }
  const vs = comparison ? { short: comparison.short, full: comparison.full } : { short: '', full: '' }

  // A thin base (Hibikura 1–26 out: 16 orders, $0 of ads against 223 orders
  // and $10k of ads): the deltas are true, but a margin with no ads in its
  // base is not the same kind of margin, and a handful of orders is not a
  // trend. The base's size is said once, beside the comparison words, and the
  // margin delta loses its colour (as C4 does early in the day).
  const baseNoAds = state.kind === 'ok' && !!P && P.adSpend < 1 && L.adSpend >= 1
  const baseFew = state.kind === 'ok' && !!P && P.orders > 0 && P.orders < FEW_BASE_ORDERS
  const thinBase = baseNoAds || baseFew
  if (thinBase && P && comparison) {
    const size = `base: ${plural(P.orders, 'pedido', 'pedidos')}${baseNoAds ? ', sem anúncios' : ''}`
    comparison = {
      ...comparison,
      short: `${comparison.short} · ${size}`,
      full: `${comparison.full}. Na base, ${plural(P.orders, 'pedido', 'pedidos')}${baseNoAds ? ' e nenhum gasto em anúncios' : ''}: `
        + `${baseNoAds ? 'a margem de antes não pagava anúncios, ' : ''}a variação da margem não diz tendência.`,
    }
  }

  /** The delta row of a tile under the current comparison state. */
  const deltaFor = (kind: DeltaKind, cur: number | null, prev: number | null, kk = 1): BandDelta | null => {
    if (state.kind === 'off') return null
    if (state.kind === 'tag') return noneDelta(state.tag, tagged(state.tag, state.text))
    let d = deltaOf(kind, cur, prev, vs, kk)
    // Todas with stores left out of the delta (R6): the arrow of an "era X"
    // compares the like-for-like sum, not the tile's full value beside it, so
    // it could point down under a value that rose. Drop the arrow and say the
    // like-for-like value in the aria (pct deltas stay: they read as a rate).
    if (d && d.kind === 'was' && d.dir !== null && likeDiffers && cur !== null) {
      const who = likeNames.length ? `sem ${joinNames(likeNames)}` : 'mesmas lojas'
      d = { ...d, dir: null, good: null, aria: `${who}: ${fmtPrev(kind, cur)} agora; era ${d.previousText} ${vs.full}`.replace(/\s+/g, ' ').trim() }
    }
    // A running day too young to judge (C4): the deltas stay, uncoloured.
    if (d && early && d.good !== null) return { ...d, good: 'neutral' }
    return d
  }

  /** A thin base's margin delta: kept, uncoloured, and the aria says why. */
  const thinDelta = (d: BandDelta | null): BandDelta | null => {
    if (!d || !thinBase || !P || d.kind === 'none') return d
    const why = `base de ${plural(P.orders, 'pedido', 'pedidos')}${baseNoAds ? ', sem anúncios' : ''}`
    return { ...d, good: d.good === null ? null : 'neutral', aria: `${d.aria} (${why})` }
  }

  const extraTags = (key: BandTileKey) => i.tileTags?.[key] ?? []
  const dash = '—'

  // ── 1 lucro
  const amount = v.amount
  const raw = res(T)
  const noSales = T.orders === 0 && T.revenue <= 0
  const adj = T.adjustments
  // The verdict's cashHit predicate, verbatim (C3).
  const cashHit = adj >= 0.005 && (noSales
    || (raw >= 0
      ? (v.basis === 'profit' && T.cashResult < 0) || adj >= CASH_HIT_SHARE * raw
      : adj >= CASH_HIT_SHARE * -raw))
  const lucroSubs: BandSub[] = []
  if (k < 1 && amount !== null) {
    lucroSubs.push({ text: `${scope === 'all' ? 'antes da divisão' : 'loja inteira'} ${formatMoney(amount / k)}` })
  }
  if (cashHit) {
    if (!noSales && v.basis === 'profit') {
      const cash = T.cashResult * k
      lucroSubs.push({ text: `caixa ${formatMoney(cash)} · ${adjustmentsWhat(T) ?? 'reembolsos e chargebacks'}`, tone: cash < 0 ? 'neg' : undefined })
    } else {
      const hit = noSalesCashHit(T)
      const out = (hit ? hit.amount : -adj) * k
      lucroSubs.push({ text: `${formatMoney(out)} no caixa · ${(hit ? hit.what : adjustmentsWhat(T)) ?? 'reembolsos e chargebacks'}`, tone: out < 0 ? 'neg' : undefined })
    }
  }
  if (v.basis === 'profit' && T.orders > 0 && T.profitPerOrder !== null) {
    lucroSubs.push({ text: `${formatMoney(T.profitPerOrder * k)} por pedido` })
  }
  if (amount === null) lucroSubs.push({ text: v.amountCaption, tone: 'mut' })
  const lucroTags: BandChip[] = []
  if (k < 1) lucroTags.push({ code: 'sua_parte', label: 'sua parte (50%)', tone: 'info', icon: undefined, info: splitChipText(true).title })
  if (v.basis === 'revenue_minus_ads') lucroTags.push({ code: 'sem_custos', label: 'sem custos', tone: 'cfg', icon: 'sliders', info: REVENUE_MINUS_ADS_INFO })
  if (early) lucroTags.push({ code: 'cedo', label: 'cedo', tone: 'neu', icon: 'clock', info: 'Cedo demais para julgar: poucos pedidos ou o dia acabou de começar.' })
  lucroTags.push(...extraTags('lucro'))
  const lucroInfo = [
    v.basis === 'revenue_minus_ads' ? REVENUE_MINUS_ADS_INFO : LUCRO_INFO,
    amount !== null ? `${formatMoney(amount)} ${v.amountCaption}.` : null,
    k < 1 ? (scope === 'all' ? SPLIT_LUCRO_INFO_ALL : SPLIT_LUCRO_INFO) : null,
  ].filter(Boolean).join(' ')
  const lucro: BandTile = {
    key: 'lucro',
    label: v.basis === 'revenue_minus_ads' ? 'Receita − anúncios' : 'Lucro real',
    value: amount === null ? dash : formatMoney(amount),
    raw: amount,
    tone: amount === null ? 'mut' : v.amountTone,
    size: 'xl',
    subs: lucroSubs,
    tags: lucroTags,
    delta: deltaFor('money_result', amount === null ? null : res(L) * k, P ? res(P) * k : null, k),
    info: lucroInfo,
  }

  // ── 2 margem
  const margin = v.basis === 'profit' ? T.margin : null
  const margemTags: BandChip[] = []
  if (v.basis === 'revenue_minus_ads') margemTags.push({ code: 'sem_custos', label: 'custos não configurados', tone: 'cfg', icon: 'sliders', info: REVENUE_MINUS_ADS_INFO })
  if (early && margin !== null) margemTags.push({ code: 'cedo', label: 'cedo', tone: 'neu', icon: 'clock', info: 'Com poucos pedidos a margem ainda oscila muito.' })
  margemTags.push(...extraTags('margem'))
  const margem: BandTile = {
    key: 'margem',
    label: 'Margem',
    value: margin === null || empty ? dash : formatPct(margin),
    raw: empty ? null : margin,
    tone: margin === null || empty ? 'mut' : early ? 'neu' : margin < 0 ? 'neg' : margin < THIN_MARGIN_PCT ? 'warn' : 'pos',
    size: 'xl',
    subs: [],
    tags: margemTags,
    delta: thinDelta(deltaFor('pp', v.basis === 'profit' ? L.margin : null, v.basis === 'profit' && P ? P.margin : null)),
    info: MARGIN_INFO,
  }

  // Todas: receita, pedidos and anúncios are the judged sum (C7).
  const sumNote = scope === 'all' && many
    ? ` Soma das ${plural(nStores, 'loja', 'lojas')}${v.excluded.length ? ' com custos' : ''}${v.excluded.length
      ? `; sem ${joinNames(v.excluded.map(x => `${x.name} (receita ${formatMoney(x.revenue)}, anúncios ${formatMoney(x.adSpend)})`))}`
      : ''}.`
    : ''

  // ── 3 receita
  const receita: BandTile = {
    key: 'receita', label: 'Receita',
    value: empty ? dash : formatMoney(T.revenue), raw: empty ? null : T.revenue,
    tone: empty ? 'mut' : 'neu', size: 'md', subs: [], tags: [...extraTags('receita')],
    delta: deltaFor('money', L.revenue, P ? P.revenue : null),
    info: REVENUE_INFO + sumNote,
  }

  // ── 4 pedidos
  const ticket = ticketOf(T)
  const pedidosTags: BandChip[] = []
  if (v.fewOrders) pedidosTags.push({ code: 'poucos_pedidos', label: 'poucos pedidos', tone: 'neu', icon: 'ring', info: FEW_ORDERS_INFO })
  pedidosTags.push(...extraTags('pedidos'))
  const pedidos: BandTile = {
    key: 'pedidos', label: 'Pedidos',
    value: empty ? dash : formatCount(T.orders), raw: empty ? null : T.orders,
    tone: empty ? 'mut' : 'neu', size: 'md',
    subs: !empty && ticket !== null ? [{ text: `ticket ${formatMoney(ticket)}` }] : [],
    tags: pedidosTags,
    delta: deltaFor('count', L.orders, P ? P.orders : null),
    info: ORDERS_INFO + sumNote,
  }

  // ── 5 anúncios
  const spendSubs: BandSub[] = []
  if (!empty) {
    if (T.metaSpend >= 0.005) spendSubs.push({ text: `Meta ${formatMoney(T.metaSpend)}` })
    if (T.shopSpend >= 0.005) spendSubs.push({ text: `Shopify ${formatMoney(T.shopSpend)}` })
    if (!spendSubs.length) spendSubs.push({ text: 'nenhum gasto em anúncios', tone: 'mut' })
  }
  const underADollar = P ? Math.max(Math.abs(L.adSpend), Math.abs(P.adSpend)) < 1 : false
  const anuncios: BandTile = {
    key: 'anuncios', label: 'Anúncios',
    value: empty ? dash : formatMoney(T.adSpend), raw: empty ? null : T.adSpend,
    tone: empty ? 'mut' : 'neu', size: 'md',
    subs: spendSubs,
    phoneSub: spendSubs.length > 1 ? { text: spendSubs.map(s => s.text).join(' · ') } : undefined,
    tags: [...extraTags('anuncios')],
    delta: underADollar && state.kind === 'ok' ? EMPTY_ROW() : deltaFor('money', L.adSpend, P ? P.adSpend : null),
    info: `Anúncios Meta: ${META_SPEND_INFO} Anúncios Shopify: ${SHOP_SPEND_INFO}${sumNote}`,
  }

  // ── 6 roas
  const r = scope === 'store' ? v.roas : storeRoas(T, v.basis === 'profit')
  const channel = adChannelOf(T)
  const roasTags: BandChip[] = []
  const chTag = r && !empty ? roasChannelTag(T, channel) : null
  if (chTag) roasTags.push(chTag)
  let somaInfo: string | null = null
  if (scope === 'all' && many && r) {
    somaInfo = `ROAS da soma das ${plural(nStores, 'loja', 'lojas')}${v.excluded.length ? ' com custos' : ''}, no mesmo canal; cada loja na tabela abaixo. Não é a média dos ROAS das lojas.`
      + (v.excluded.length ? ` ${joinNames(v.excluded.map(x => x.name))} (sem custos) ${v.excluded.length === 1 ? 'fica' : 'ficam'} fora.` : '')
    if (!empty) roasTags.push({ code: 'soma_das_lojas', label: 'soma das lojas', tone: 'neu', info: somaInfo })
  }
  roasTags.push(...extraTags('roas'))
  const gap = r && r.breakEven !== null ? roasGapPct(r.roas, r.breakEven) : null
  const roasSubs: BandSub[] = empty ? [] : !r
    ? [{ text: 'sem gasto em anúncios', tone: 'mut' }]
    : r.breakEven !== null && gap !== null
      ? [{ text: `empate ${formatRoas(r.breakEven)} · ${formatPct(Math.abs(gap), { digits: 0 })} ${gap >= 0 ? 'acima' : 'abaixo'}` }]
      : [{ text: reasonText(r.reason ?? 'unknown', true), tone: r.state === 'neg' ? 'neg' : 'warn' }]
  const sameChannel = P ? adChannelOf(P) === adChannelOf(L) : false
  let roasDelta = deltaFor('roas', channelRoas(L), P ? channelRoas(P) : null)
  if (state.kind === 'ok' && P && !sameChannel && adChannelOf(P) && adChannelOf(L)) {
    // Not comparable, but the previous value is still worth showing (in the
    // aria / the phone's tooltip): "antes: 1,30× no Meta + Shopify".
    const prevR = channelRoas(P)
    const prevText = prevR !== null ? formatRoas(prevR) : null
    roasDelta = {
      ...noneDelta('outro canal', `outro canal: o ROAS de antes${prevText ? ` (${prevText})` : ''} foi medido em ${CHANNEL_WORDS[adChannelOf(P)!]}, o de agora em ${CHANNEL_WORDS[adChannelOf(L)!]}: a variação não se compara ${vs.full}`.trim()),
      previousText: prevText,
    }
  } else if (state.kind === 'ok' && P && !sameChannel && !adChannelOf(P) && adChannelOf(L)) {
    // No ad spend in the base: no ROAS to compare, and the row says so (the
    // other no-delta cases all carry a reason).
    const range = cmp?.rangeText ?? (cmp ? formatRangeLabel({ from: cmp.from, to: cmp.to }, input.today) : '')
    roasDelta = noneDelta('sem gasto antes', `sem gasto antes: nenhum gasto em anúncios${range ? ` em ${range}` : ''}, então não há ROAS para comparar`)
  } else if (state.kind === 'ok' && P && !sameChannel) {
    roasDelta = EMPTY_ROW()
  }
  const roas: BandTile = {
    key: 'roas',
    label: channel ? `${ROAS_LABEL[channel]} × empate` : 'ROAS × empate',
    phoneLabel: channel === 'both' ? 'ROAS Meta + Shopify × empate' : channel === 'shop' ? 'ROAS Shopify × empate' : undefined,
    value: r && !empty ? formatRoas(r.roas) : dash,
    raw: r && !empty ? r.roas : null,
    tone: !r || empty ? 'mut' : r.state === 'pos' ? 'pos' : r.state === 'neg' ? 'neg' : 'warn',
    size: 'md',
    subs: roasSubs,
    tags: roasTags,
    delta: roasDelta,
    info: [ROAS_INFO, scope === 'store' ? r?.explain ?? null : somaInfo].filter(Boolean).join(' '),
    gauge: r && !empty ? { roas: r.roas, breakEven: r.breakEven, state: r.state, reason: r.reason } : undefined,
  }

  // ── Status line (§1.4)
  const status: BandChip[] = statusChipsOf(v)
  if (scope === 'all' && many) {
    const info = [v.when, ...v.notes.map(n => n.text)].join(' ')
    status.push({ code: 'lojas_na_soma', label: plural(nStores, 'loja na soma', 'lojas na soma'), tone: 'neu', icon: 'ring', info })
  }
  // A page chip that repeats a verdict chip's code merges into it (the
  // phone's "dia de Tóquio · 02h00" replaces the verdict's "dia de Tóquio").
  for (const x of i.extraChips ?? []) {
    const same = x.code === 'fuso' ? status.findIndex(s => s.code === 'dia_fuso') : -1
    if (same >= 0) status[same] = { ...status[same], ...x, code: 'dia_fuso', info: x.info ?? status[same].info }
    else status.push(x)
  }

  // ── Detalhes (§1.6 items 1–5)
  const roasExplain = scope === 'store' ? v.roas?.explain ?? null : somaInfo
  const count = (v.headline ? 1 : 0) + v.details.length + (v.when ? 1 : 0) + v.notes.length + (roasExplain ? 1 : 0)

  return {
    tiles: [lucro, margem, receita, pedidos, anuncios, roas],
    status,
    comparison,
    empty,
    early,
    details: { headline: v.headline, lines: v.details, when: v.when, notes: v.notes, roasExplain, count },
  }
}

// ─── Page rows (Campanhas, Produtos, Países, Atribuição, Criativo) ───────────

/** A page verdict's chips as status-line chips, with the same ⓘ texts as the band. */
export function statusChipsOf(v: Verdict): BandChip[] {
  return v.chips.map(c => ({ code: c.code, label: c.label, tone: c.tone, icon: c.icon, ...verdictChipInfo(c, v) }))
}

/** A page verdict's prose for "Detalhes do período". */
export function detailsOf(v: Pick<Verdict, 'headline' | 'details' | 'when' | 'notes'>, roasExplain: string | null = null): NumberBand['details'] {
  const count = (v.headline ? 1 : 0) + v.details.length + (v.when ? 1 : 0) + v.notes.length + (roasExplain ? 1 : 0)
  return { headline: v.headline, lines: v.details, when: v.when, notes: v.notes, roasExplain, count }
}
