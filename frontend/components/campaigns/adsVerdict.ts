/**
 * The verdict on a store's Meta ads, and the strip that reconciles what Meta
 * credits to the campaigns with what the store actually sold. Pure: no
 * database, unit-tested, fed by lib/data/campaigns (the campaign report) and
 * the engine's P&L of the same store and window.
 *
 * Two ROAS, never mixed (CLAUDE.md: the account ROAS rises by itself when
 * spend falls, because organic revenue stays):
 *   ROAS da loja      store revenue ÷ ad spend — every sale, credited or not —
 *                     measured on the Resumo's ad channel (lib/views/verdict
 *                     storeRoas: Meta, Anúncios Shopify, or both when each
 *                     carries 10%+ of the spend); shown in the VerdictCard's
 *                     ROAS box (verdict.roas) with the Resumo's label.
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
  EARLY_DAY_MINUTES, SPLIT_SHARE, storeRoas as channelStoreRoas,
  type Verdict, type VerdictChip, type VerdictLine,
} from '@/lib/views/verdict'
import { formatMoney, formatPct, formatRoas, plural } from '@/lib/format'
import { breakEvenReason } from '@/components/ui/roasReason'
import { actionCountsText } from './text'
import { beforeStartVerdict, isBeforeStart, type BeforeStartInput } from './storeStart'

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
  /** The store's first sale: a window that ends before it, with nothing in
   *  it, reads "Vende desde 7 nov" like the Resumo (./storeStart). */
  firstSale?: BeforeStartInput | null
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

/** ROAS of the campaigns whose sales are this store's: the one "ROAS
 *  atribuído" of the page (verdict, gauge and the table's Total row). */
export function ownAttributedRoas(report: Pick<ReportForVerdict, 'campaigns'>): { roas: number | null; spend: number; value: number; campaigns: number } {
  let spend = 0, value = 0, campaigns = 0
  for (const c of report.campaigns) {
    if (c.shared) continue
    spend += c.spend
    value += c.purchaseValue
    if (!c.unsynced) campaigns++
  }
  return { roas: spend > 0 ? value / spend : null, spend, value, campaigns }
}

/** Spend, credited value and count of the shared-account campaigns: in the
 *  books, outside the attributed ROAS and the estimated profit. */
export function sharedCampaigns(report: Pick<ReportForVerdict, 'campaigns'>): { spend: number; value: number; campaigns: number } {
  let spend = 0, value = 0, campaigns = 0
  for (const c of report.campaigns) {
    if (!c.shared) continue
    spend += c.spend
    value += c.purchaseValue
    if (!c.unsynced) campaigns++
  }
  return { spend, value, campaigns }
}

/**
 * Why there is no break-even, in the words of the ROAS sentence. A null
 * break-even is "sem custos" only when the store has no cost settings: the
 * engine has none either without sales or when the sales did not cover
 * product, shipping and fees — EPOCH at 09h with $347 of Meta and no order
 * yet was told "sem custos" with its costs set. Same causes as
 * components/ui/roasReason, same words as lib/views/store empateGap.
 */
export function noEmpateWhy(configured: boolean, t: Pick<PnL, 'revenue' | 'contribution'>): string {
  const why = breakEvenReason({ breakEven: null, configured, revenue: t.revenue, contribution: t.contribution })
  switch (why) {
    case 'no_costs': return 'sem custos, não há empate'
    case 'no_sales': return 'sem vendas no período, não há empate'
    case 'no_margin':
    case 'no_contribution': return 'as vendas não cobrem produto, frete e taxas: nenhum ROAS empata'
    default: return 'empate desconhecido'
  }
}

/** What the sales Meta does not credit can be. A store that also runs
 *  Shopify's own ads gets those first: Dumpling 8jcp3a's "99% orgânico,
 *  e-mail, recompra" mostly rode on $1.867 of Shop Campaigns. */
export function uncreditedSources(shopSpend: number): string {
  const rest = 'orgânico, e-mail, recompra ou venda que o pixel não viu'
  return shopSpend > 0 ? `Anúncios Shopify, com ${formatMoney(shopSpend)} de gasto no período; ${rest}` : rest
}

/** The sentence under the "ROAS atribuído" gauge, on the same campaigns as
 *  the gauge (shared-account ones left out) and the same list of
 *  uncredited sources as the verdict. */
export function attributedRoasNote(input: { sharedSpend: number; shopSpend: number }): string {
  const what = input.sharedSpend > 0
    ? `Vendas que o Meta credita às campanhas desta loja ÷ o gasto delas (os ${formatMoney(input.sharedSpend)} das campanhas de conta compartilhada ficam fora).`
    : 'Vendas que o Meta credita às campanhas ÷ gasto no Meta.'
  const sources = input.shopSpend > 0 ? 'Anúncios Shopify, orgânico, e-mail, recompra' : 'orgânico, e-mail, recompra'
  return `${what} Fica abaixo do ROAS do quadro ao lado (todas as vendas da loja) quando há venda que o Meta não credita (${sources}) — julgue as campanhas por ele e a loja pelo lucro real.`
}

/** "47%", or "menos de 1%" for a share that has money but rounds to 0. */
const shareText = (part: number, whole: number) => {
  const p = whole > 0 ? (part / whole) * 100 : 0
  return part > 0 && Math.round(p) === 0 ? 'menos de 1%' : formatPct(p, { digits: 0 })
}

export function buildAdsVerdict(input: AdsVerdictInput): { verdict: Verdict; reconciliation: Reconciliation } {
  const { report, pnl, window: w, storeName } = input
  const split = !!input.split
  const k = split ? SPLIT_SHARE : 1
  const rec = buildReconciliation(report, pnl)
  const spend = report.totals.spend
  const own = ownAttributedRoas(report)
  const shared = sharedCampaigns(report)
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
    const fs = input.firstSale
    if (fs && !input.billedElsewhere?.campaigns && isBeforeStart(fs.firstOrderDate, fs.range, { orders: pnl.orders, revenue: pnl.revenue, spend: pnl.adSpend })) {
      return {
        verdict: beforeStartVerdict({ ...fs, rangeLabel: w.rangeLabel, dayLabel: w.dayLabel, totals: pnl, configured: report.configured, split }),
        reconciliation: rec,
      }
    }
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
      // The whole campaigns' spend, not only the ads credited with an order
      // here (Atribuição's "gasto desses anúncios" is that smaller number):
      // said in the sentence so the two pages don't read as a contradiction.
      details.push(line('Mas ', strong(`${one ? '1 campanha paga' : `${elsewhere.campaigns} campanhas pagas`} na conta da ${elsewhere.stores.join(' e ')}`),
        ` ${one ? 'vende' : 'vendem'} sobretudo aqui: ${money(elsewhere.spend)} de gasto ${one ? 'da campanha inteira' : 'dessas campanhas inteiras'} no período, na contabilidade de lá. Some as duas lojas para julgar o resultado.`))
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

  // Details shared by every judged state. Both sides of the ROAS sentence
  // stand on the same campaigns: with shared-account campaigns, "Gasto no
  // Meta: $47.220 … ROAS atribuído 1,35×" read as 0,72× to anyone dividing;
  // 1,35× is the store's own $33.910 over its own $25.162.
  const empate: (string | Part)[] = be !== null
    ? [' contra empate ', strong(formatRoas(be)), '.']
    : [` (${noEmpateWhy(report.configured, pnl)}).`]
  details.push(shared.spend > 0
    ? line(
      'Gasto no Meta: ', strong(money(own.spend)), ` em ${plural(own.campaigns, 'campanha', 'campanhas')} desta loja (mais ${money(shared.spend)} em ${shared.campaigns} de conta compartilhada). O Meta credita ${own.campaigns === 1 ? 'à' : 'às'} da loja `,
      strong(money(own.value)), ' em vendas — ROAS atribuído ', strong(roasLine(own.roas)), ...empate)
    : line(
      // The pronoun agrees with the count: "em 1 campanha. O Meta credita a ela".
      'Gasto no Meta: ', strong(money(spend)), ` em ${plural(campaignsCount, 'campanha', 'campanhas')}. O Meta credita ${campaignsCount === 1 ? 'a ela' : 'a elas'} `,
      strong(money(own.value)), ' em vendas — ROAS atribuído ', strong(roasLine(own.roas)), ...empate))
  if (pnl.revenue > 0) {
    const share = (Math.abs(rec.uncredited) / pnl.revenue) * 100
    details.push(rec.uncredited >= 0
      ? line(`A loja vendeu ${money(pnl.revenue)} no total: `, strong(formatPct(share, { digits: 0 })),
        ` disso não é creditado a nenhuma campanha do Meta (${uncreditedSources(pnl.shopSpend)}).`)
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

  // The Resumo's ROAS box, number and words: revenue ÷ Meta spend alone made a
  // store whose ads are mostly Shop Campaigns read "319× → no lucro"
  // (Dumpling 8jcp3a) next to a Resumo that said 2,97×.
  const storeRoas = channelStoreRoas(pnl, report.configured)

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
  const noSales = pnl.revenue <= 0
  // ── Costs set but nothing to price with: no store revenue, every campaign
  //    in a shared account, or sales that do not cover their own costs.
  //    No sales is decided first. On such a day lib/data/campaigns prices a
  //    row Meta credited nothing at −spend (a certain loss), so the estimate
  //    is no longer null — read as "cada venda já sai no prejuízo" it told a
  //    store with no sale that each sale lost money, and with one campaign
  //    credited and the others not it would be only part of the spend.
  if (noSales || estimated === null || be === null) {
    chips.push(noSales
      ? chip('prejuizo', 'Gasto sem vendas', 'neg', 'down')
      : chip('prejuizo', 'Sem margem para os anúncios', 'neg', 'down'))
    if (w.partialLabel) chips.push(chip('parcial', w.partialLabel, 'info', 'clock'))
    if (w.dayLabel) chips.push(chip('dia_fuso', w.dayLabel, 'info', 'clock'))
    const lossPerSale = !noSales && estimated !== null
    const headline = noSales
      ? `A ${storeName} gastou ${money(spend)} no Meta ${w.periodPhrase} e não vendeu nada.`
      : estimated === null
        ? `As campanhas da ${storeName} ${w.periodPhrase} rodaram em conta compartilhada: não dá para estimar o lucro delas.`
        : `Cada venda da ${storeName} já perde dinheiro antes do anúncio ${w.periodPhrase}: nenhum ROAS empata.`
    return {
      verdict: {
        ...base, tone: early ? 'neu' : 'neg', chips, headline,
        amount: (lossPerSale ? estimated : -spend) * k, amountTone: early ? 'neu' : 'neg',
        amountCaption: lossPerSale
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
    // The judgement leaves the shared-account campaigns out (no margin of
    // this store applies to them): say how much of the spend that is — 47%
    // of EPOCH's October.
    if (shared.spend > 0) headline += `, sem contar ${shareText(shared.spend, spend)} do gasto (campanhas de conta compartilhada)`
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
      amountCaption: `${split ? 'sua parte (50%) do ' : 'de '}lucro estimado das campanhas${shared.spend > 0 ? ' desta loja' : ''}: vendas atribuídas × margem da loja − gasto`,
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
