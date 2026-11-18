/**
 * The verdict on a store's Meta ads, and the strip that reconciles what Meta
 * credits to the campaigns with what the store actually sold. Pure: no
 * database, unit-tested, fed by lib/data/campaigns (the campaign report) and
 * the engine's P&L of the same store and window.
 *
 * Two ROAS, never mixed (CLAUDE.md: the account ROAS rises by itself when
 * spend falls, because organic revenue stays):
 *   ROAS da loja      store revenue ÷ Meta spend — every sale, credited or not;
 *                     shown in the VerdictCard's ROAS box (verdict.roas).
 *   ROAS atribuído    Meta purchase value ÷ Meta spend, over the campaigns whose
 *                     sales are this store's (shared-account rows left out).
 * The headline judges the campaigns on the second (their estimated profit),
 * and says when the store as a whole disagrees.
 *
 * The bridge from the campaigns to the store's real profit is an identity of
 * the engine's definitions (rate = contribution ÷ revenue for the window):
 *   Σ estimated profit of priced campaigns   (= credited value × rate − their spend)
 * + (store revenue − credited value) × rate (sales no campaign is credited with)
 * − spend of shared-account campaigns       (in the books, not priced)
 * − Shopify ads − fixed costs
 * = operatingProfit
 * Any residual (a list that does not add up to the books) is shown, not hidden.
 */

import type { PnL } from '@/lib/engine/pnl'
import type { Period } from '@/lib/engine/dates'
import type { CampaignAction } from '@/lib/campaignSignal'
import type { CampaignReport } from '@/lib/data/campaigns'
import {
  EARLY_DAY_MINUTES, SPLIT_SHARE, roasSummary,
  type Verdict, type VerdictChip, type VerdictLine,
} from '@/lib/views/verdict'
import { formatMoney, formatPct, formatRoas, plural } from '@/lib/format'
import { actionCountsText } from './text'

type Part = { text: string; strong?: boolean; tone?: 'pos' | 'neg' | 'warn' }
const line = (...parts: (string | Part)[]): VerdictLine => {
  const ps = parts.map(p => (typeof p === 'string' ? { text: p } : p))
  return { parts: ps, text: ps.map(p => p.text).join('') }
}
const strong = (text: string, tone?: Part['tone']): Part => ({ text, strong: true, tone })
const money = (v: number) => formatMoney(v)

/** Within this share of the break-even, a campaign set is "no limite". */
export const EDGE_BAND = 0.1

export type ReportForVerdict = Pick<CampaignReport,
  'configured' | 'contributionRate' | 'breakEvenRoas' | 'campaigns' | 'totals' | 'reconciliation' | 'thresholds' | 'storeRevenue'>

export interface AdsWindow {
  period: Period
  /** "10–16 nov". */
  rangeLabel: string
  /** "nos últimos 7 dias", "hoje". */
  periodPhrase: string
  partial: boolean
  /** "parcial · até 13h38" or null. */
  partialLabel: string | null
  minutesIntoDay: number
  /** "dia de Tóquio" or null. */
  dayLabel: string | null
}

export interface AdsVerdictInput {
  storeName: string
  /** The campaign report for the page's window. */
  report: ReportForVerdict
  /** The engine P&L of the store for the same window. */
  pnl: PnL
  window: AdsWindow
  /** Action counts and the window they were judged on (last 7 closed days). */
  decision: { actions: Record<CampaignAction, number>; rangeLabel: string } | null
  /** Campaigns whose orders land here but whose spend is in another store's
   *  books (CAMP HALLOW's ads in EPOCH's account). */
  billedElsewhere?: { spend: number; campaigns: number; stores: string[] } | null
  split?: boolean
}

export interface ReconciliationBridge {
  /** Σ estimated profit of the priced campaigns. */
  campaigns: number
  /** (store revenue − credited value) × contribution rate. Negative when Meta
   *  credits more than the store sold. */
  uncreditedContribution: number
  /** Spend of shared-account campaigns: in the books, without a margin. */
  unpricedSpend: number
  shopSpend: number
  fixedCosts: number
  /** operatingProfit − the lines above; 0 unless the list and the books disagree. */
  residual: number
  /** The engine's operatingProfit. */
  storeProfit: number
}

export interface Reconciliation {
  storeRevenue: number
  orders: number
  metaSpend: number
  /** Meta purchase value of the campaigns whose sales are this store's. */
  credited: number
  /** Purchase value of shared-account campaigns (their sales may be another store's). */
  creditedShared: number
  /** storeRevenue − credited (negative: Meta credits more than the store sold). */
  uncredited: number
  /** credited ÷ storeRevenue, %. */
  creditedPct: number | null
  configured: boolean
  /** Contribution ÷ revenue for the window, 0..1. */
  rate: number | null
  /** Null without cost settings or without store revenue (no margin). */
  bridge: ReconciliationBridge | null
  /** Store revenue − all ads: the honest number without cost settings. */
  revenueMinusAds: number
}

export function buildReconciliation(report: ReportForVerdict, pnl: PnL): Reconciliation {
  let credited = 0, creditedShared = 0
  for (const c of report.campaigns) {
    if (c.shared) creditedShared += c.purchaseValue
    else credited += c.purchaseValue
  }
  const revenue = pnl.revenue
  const rate = report.configured ? report.contributionRate : null
  let bridge: ReconciliationBridge | null = null
  if (rate !== null && revenue > 0) {
    const campaigns = report.totals.estimatedProfit ?? 0
    const uncreditedContribution = (revenue - credited) * rate
    const unpricedSpend = report.totals.unpricedSpend
    const known = campaigns + uncreditedContribution - unpricedSpend - pnl.shopSpend - pnl.fixedCosts
    bridge = {
      campaigns, uncreditedContribution, unpricedSpend,
      shopSpend: pnl.shopSpend, fixedCosts: pnl.fixedCosts,
      residual: pnl.operatingProfit - known,
      storeProfit: pnl.operatingProfit,
    }
  }
  return {
    storeRevenue: revenue,
    orders: pnl.orders,
    metaSpend: pnl.metaSpend,
    credited,
    creditedShared,
    uncredited: revenue - credited,
    creditedPct: revenue > 0 ? (credited / revenue) * 100 : null,
    configured: report.configured,
    rate,
    bridge,
    revenueMinusAds: revenue - pnl.adSpend,
  }
}

const chip = (code: VerdictChip['code'], label: string, tone: VerdictChip['tone'], icon: VerdictChip['icon']): VerdictChip =>
  ({ code, label, tone, icon })

/** ROAS of the campaigns whose sales are this store's. */
function attributedRoas(report: ReportForVerdict): { roas: number | null; spend: number; value: number; campaigns: number } {
  let spend = 0, value = 0, campaigns = 0
  for (const c of report.campaigns) {
    if (c.shared) continue
    spend += c.spend
    value += c.purchaseValue
    if (!c.unsynced) campaigns++
  }
  return { roas: spend > 0 ? value / spend : null, spend, value, campaigns }
}

export function buildAdsVerdict(input: AdsVerdictInput): { verdict: Verdict; reconciliation: Reconciliation } {
  const { report, pnl, window: w, storeName } = input
  const split = !!input.split
  const k = split ? SPLIT_SHARE : 1
  const rec = buildReconciliation(report, pnl)
  const spend = report.totals.spend
  const own = attributedRoas(report)
  const be = report.configured ? report.breakEvenRoas : null
  // The partial clock is a chip of its own; the date line stays the range.
  const when = w.rangeLabel
  const campaignsCount = report.totals.campaigns

  const chips: VerdictChip[] = []
  const details: VerdictLine[] = []
  const notes: VerdictLine[] = []
  const base = {
    when, totals: pnl, comparisonTotals: null, excluded: [], partial: w.partial, split, storeCount: 1,
  }

  // ── No Meta spend: nothing to judge, never a fake $0.
  if (!(spend > 0)) {
    chips.push(chip('sem_vendas', w.partial ? 'Sem gasto no Meta ainda' : 'Sem gasto no Meta', 'neu', 'ring'))
    if (w.dayLabel) chips.push(chip('dia_fuso', w.dayLabel, 'info', 'clock'))
    details.push(line(
      pnl.revenue > 0
        ? `A loja vendeu ${money(pnl.revenue)} ${w.periodPhrase} sem nenhum gasto no Meta registrado nela.`
        : `Nenhuma venda e nenhum gasto no Meta ${w.periodPhrase}.`,
    ))
    const elsewhere = input.billedElsewhere
    if (elsewhere && elsewhere.campaigns > 0) {
      const one = elsewhere.campaigns === 1
      details.push(line('Mas ', strong(`${one ? '1 campanha paga' : `${elsewhere.campaigns} campanhas pagas`} na conta da ${elsewhere.stores.join(' e ')}`),
        ` ${one ? 'trouxe' : 'trouxeram'} vendas para cá: ${money(elsewhere.spend)} de gasto que está na contabilidade de lá. Some as duas lojas para julgar o resultado.`))
    }
    return {
      verdict: {
        ...base, tone: 'neu', chips,
        headline: `A ${storeName} não gastou no Meta ${w.periodPhrase}.`,
        amount: null, amountTone: 'neu', amountCaption: 'sem campanhas com gasto no período',
        details, notes, basis: 'none', roas: null, early: false, fewOrders: false,
      },
      reconciliation: rec,
    }
  }

  const early = w.period === 'today' && w.partial && w.minutesIntoDay < EARLY_DAY_MINUTES
  const fewPurchases = !early && report.totals.purchases < report.thresholds.minOrders
  const roasLine = (r: number | null) => (r === null ? '—' : formatRoas(r))

  // Details shared by every judged state.
  details.push(line(
    'Gasto no Meta: ', strong(money(spend)), ` em ${plural(campaignsCount, 'campanha', 'campanhas')}. O Meta credita a elas `,
    strong(money(own.value)), ' em vendas — ROAS atribuído ', strong(roasLine(own.roas)),
    be !== null ? ' contra empate ' : '', be !== null ? strong(formatRoas(be)) : '', be !== null ? '.' : ' (sem custos, não há empate).',
  ))
  if (pnl.revenue > 0) {
    const share = (Math.abs(rec.uncredited) / pnl.revenue) * 100
    details.push(rec.uncredited >= 0
      ? line(`A loja vendeu ${money(pnl.revenue)} no total: `, strong(formatPct(share, { digits: 0 })),
        ' disso não é creditado a nenhuma campanha (orgânico, e-mail, recompra ou venda que o pixel não viu).')
      : line(`A loja vendeu ${money(pnl.revenue)}: o Meta credita `, strong(`${formatPct(share, { digits: 0 })} a mais`, 'warn'),
        ' do que entrou — as estimativas por campanha saem otimistas.'))
  }
  if (input.decision && report.configured) {
    details.push(line(`Nos últimos 7 dias fechados (${input.decision.rangeLabel}): ${actionCountsText(input.decision.actions)}.`))
  }

  // Fine print.
  if (w.partial) notes.push(line('Hoje ainda está em andamento e o Meta atribui vendas com atraso: os números de hoje tendem a subir.'))
  if (report.totals.unpricedSpend > 0) {
    notes.push(line(`${money(report.totals.unpricedSpend)} de gasto em campanhas de conta compartilhada ficam fora do lucro estimado: as vendas delas podem ter caído em outra loja.`))
  }
  if (report.reconciliation.phantomValueDropped > 0) {
    notes.push(line(`O Meta reportou ${money(report.reconciliation.phantomValueDropped)} em compras impossíveis (acima de $20.000 num dia de um anúncio); foram descartadas.`))
  }
  if (report.reconciliation.unsyncedSpend > 0) {
    notes.push(line(`${formatMoney(report.reconciliation.unsyncedSpend)} de anúncios que a sincronização ainda não descreveu estão na linha "Anúncios ainda não sincronizados".`))
  }
  if (Math.abs(report.reconciliation.gap) >= 0.01) {
    notes.push(line(`A lista soma ${money(report.reconciliation.listedSpend)} e a contabilidade ${money(report.reconciliation.engineMetaSpend)}: diferença de ${formatMoney(report.reconciliation.gap)}.`))
  }

  const storeRoas = pnl.metaSpend > 0 && pnl.roas !== null ? roasSummary(pnl.roas, be) : null

  // ── No cost settings: revenue − ads, flagged; no estimated profit.
  if (!report.configured) {
    const noSales = pnl.revenue <= 0
    chips.push(chip('sem_custos', 'Custos não configurados', 'cfg', 'sliders'))
    if (noSales) chips.unshift(chip('prejuizo', 'Gasto sem vendas', 'neg', 'down'))
    else if (rec.revenueMinusAds < 0) chips.unshift(chip('prejuizo', 'Vendas abaixo dos anúncios', 'neg', 'down'))
    if (w.partialLabel) chips.push(chip('parcial', w.partialLabel, 'info', 'clock'))
    if (w.dayLabel) chips.push(chip('dia_fuso', w.dayLabel, 'info', 'clock'))
    return {
      verdict: {
        ...base,
        tone: rec.revenueMinusAds < 0 ? 'neg' : 'warn',
        chips,
        headline: noSales
          ? `A ${storeName} gastou ${money(spend)} no Meta ${w.periodPhrase} e não vendeu nada.`
          : rec.revenueMinusAds < 0
          ? `A ${storeName} vendeu menos do que gastou em anúncios ${w.periodPhrase} — e ainda falta o custo dos produtos.`
          : `Sem custos configurados não dá para dizer se os anúncios da ${storeName} se pagam.`,
        amount: rec.revenueMinusAds * k,
        amountTone: rec.revenueMinusAds < 0 ? 'neg' : 'neu',
        amountCaption: `${split ? 'sua parte de ' : ''}vendas da loja − anúncios, sem o custo dos produtos`,
        details, notes, basis: 'revenue_minus_ads', roas: storeRoas, early, fewOrders: fewPurchases,
      },
      reconciliation: rec,
    }
  }

  const estimated = report.totals.estimatedProfit
  // ── Costs set but nothing to price with (no store revenue, or every
  //    campaign in a shared account).
  if (estimated === null || be === null) {
    const noSales = pnl.revenue <= 0
    chips.push(noSales
      ? chip('prejuizo', 'Gasto sem vendas', 'neg', 'down')
      : chip('prejuizo', 'Sem margem para os anúncios', 'neg', 'down'))
    if (w.partialLabel) chips.push(chip('parcial', w.partialLabel, 'info', 'clock'))
    if (w.dayLabel) chips.push(chip('dia_fuso', w.dayLabel, 'info', 'clock'))
    const headline = noSales
      ? `A ${storeName} gastou ${money(spend)} no Meta ${w.periodPhrase} e não vendeu nada.`
      : estimated === null
        ? `As campanhas da ${storeName} ${w.periodPhrase} rodaram em conta compartilhada: não dá para estimar o lucro delas.`
        : `Cada venda da ${storeName} já perde dinheiro antes do anúncio ${w.periodPhrase}: nenhum ROAS empata.`
    return {
      verdict: {
        ...base, tone: early ? 'neu' : 'neg', chips, headline,
        amount: (estimated ?? -spend) * k, amountTone: early ? 'neu' : 'neg',
        amountCaption: estimated !== null
          ? `${split ? 'sua parte (50%) do ' : 'de '}lucro estimado das campanhas: cada venda já sai no prejuízo`
          : `${split ? 'sua parte do ' : ''}gasto no Meta sem margem para cobri-lo`,
        details, notes, basis: 'profit', roas: storeRoas, early, fewOrders: fewPurchases,
      },
      reconciliation: rec,
    }
  }

  // ── The judged case.
  const inProfit = estimated >= 0
  const storeCovers = storeRoas?.state === 'pos'
  const atEdge = own.roas !== null && Math.abs(own.roas / be - 1) < EDGE_BAND
  if (early) chips.push(chip('cedo', 'Cedo demais para julgar', 'neu', 'clock'))
  else chips.push(inProfit ? chip('lucro', 'Campanhas no lucro', 'pos', 'up') : chip('prejuizo', 'Campanhas no prejuízo', 'neg', 'down'))
  if (atEdge && !early) chips.push(chip('margem_fina', 'No limite do empate', 'warn', 'diamond'))
  if (fewPurchases) chips.push(chip('poucos_pedidos', 'Poucas compras atribuídas', 'warn', 'alert'))
  if (w.partialLabel) chips.push(chip('parcial', w.partialLabel, 'info', 'clock'))
  if (w.dayLabel) chips.push(chip('dia_fuso', w.dayLabel, 'info', 'clock'))

  let headline: string
  if (early) {
    headline = `Cedo demais para julgar os anúncios da ${storeName} hoje: o Meta ainda está atribuindo as vendas.`
  } else {
    headline = `As campanhas da ${storeName} deram ${inProfit ? 'lucro' : 'prejuízo'} ${w.periodPhrase}, pela atribuição do Meta`
    if (!inProfit && storeCovers) headline += ' — mas a loja inteira cobriu o gasto com anúncios.'
    else if (inProfit && storeRoas?.state === 'neg') headline += ' — mas a loja inteira não cobriu o gasto com anúncios.'
    else headline += '.'
  }

  return {
    verdict: {
      ...base,
      tone: early ? 'neu' : inProfit ? (atEdge ? 'warn' : 'pos') : 'neg',
      chips,
      headline,
      amount: estimated * k,
      amountTone: early ? 'neu' : inProfit ? 'pos' : 'neg',
      amountCaption: `${split ? 'sua parte (50%) do ' : 'de '}lucro estimado das campanhas: vendas atribuídas × margem da loja − gasto`,
      details: details.slice(0, 3),
      notes,
      basis: 'profit',
      roas: storeRoas,
      early,
      fewOrders: fewPurchases,
    },
    reconciliation: rec,
  }
}
