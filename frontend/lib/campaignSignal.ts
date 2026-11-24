/**
 * What to do with a campaign: the one verdict every screen shows.
 *
 * Before this file there were three: a money tag on the campaign table
 * (lucro / no fio / prejuízo), a trend tag that called every profitable
 * campaign "Escalar" whenever the window had no earlier days to compare with,
 * and the scale panel's rule. One page could show "↑ Escalar" and, a few
 * centimetres lower, "CORTAR" for the same campaign. Now there is one action,
 * decided here, and a separate trend arrow that only appears when there is a
 * real earlier period to compare against.
 *
 * Pure functions: no database, safe to import from client components.
 *
 * Money definitions (the engine's, see lib/engine/pnl.ts):
 *   contribution rate  store contribution ÷ store revenue over the window: the
 *                      share of a sale left after product, supplier fees,
 *                      packaging, shipping, Shopify and payment fees and
 *                      per-order extras. Shopify's own ads (Shop Campaigns) and
 *                      fixed monthly costs are NOT in it: they do not scale with
 *                      Meta spend, and charging them to Meta campaigns made
 *                      Dumpling's break-even read 2.51x instead of 1.31x.
 *   break-even ROAS    1 ÷ contribution rate (= the engine's breakEvenRoas).
 *   estimated profit   Meta purchase value × contribution rate − Meta spend.
 *                      Meta's attribution, not Shopify's orders: Shopify orders
 *                      carry no campaign, so this is the only per-campaign
 *                      revenue there is. The report states the gap between
 *                      Meta's total and the store's real revenue next to it.
 *   margin             estimated profit ÷ Meta purchase value, in %.
 */

import { eachDay, shiftDate, daysBetween, type DateRange } from './engine/dates'
import { formatCount, formatMoney, formatPct } from './format'

// ─── Types ────────────────────────────────────────────────────────────────────

export type CampaignAction = 'escalar' | 'manter' | 'cortar' | 'observar'

/** Which way the campaign moved against the same number of days before. */
export type TrendArrow = 'melhorando' | 'piorando' | 'estavel'

/** Why the action is what it is (or why there is none). */
export type DecisionBasis =
  | 'margem'               // judged on the window's margin
  | 'tendencia'            // the margin would scale it, the last days say hold
  | 'volume'               // too few orders or too little spend to judge
  | 'sem_gasto'            // no spend in the window
  | 'pausada'              // paused campaigns never get an action
  | 'conta_compartilhada'  // its sales may belong to another store
  | 'nao_sincronizada'     // spend of ads the catalog does not know yet
  | 'sem_custos'           // the store has no cost settings: no margin to judge
  | 'sem_margem'           // costs are set, but no store sales to measure a margin on

export interface ScaleThresholds {
  /** Margin (%) over the window that earns more budget: the store threshold. */
  minMargin: number
  /** At or below this margin (%), with enough volume, the campaign burns money. */
  cutMargin: number
  /** Below these, a margin is noise and the campaign is only watched. */
  minOrders: number
  minSpend: number
  /** Length of the judged window, in closed days. */
  windowDays: number
}

export const DEFAULT_THRESHOLDS: ScaleThresholds = {
  minMargin: 20,
  cutMargin: -10,
  minOrders: 10,
  minSpend: 150,
  windowDays: 7,
}

/** A trend needs this much spend, on this many days, in both periods. */
const TREND_MIN_SPEND = 30
const TREND_MIN_DAYS = 2
/** A ROAS change smaller than this is the noise of a refund or a late order. */
const TREND_CHANGE = 15
/** The last days of the window, against the days before them in it. */
const RECENT_DAYS = 3
/** A ROAS fall this steep in the last days holds an "escalar" back to "manter":
 *  budget added on the way down buys the decline. */
const COLLAPSE_DROP = 30
const COLLAPSE_MIN_SPEND = 20
/** With few orders, a loss is only called when it survives 50% more sales. */
const ROBUST_CUT_UPLIFT = 1.5

export interface DecisionDay {
  date: string
  spend: number
  /** Meta purchase value, phantom ad-days already removed. */
  revenue: number
  purchases: number
}

export interface DecisionInput {
  /** Daily rows of the campaign; any dates, the function slices by calendar. */
  days: DecisionDay[]
  /** The judged window: closed days in the store's timezone. */
  window: DateRange
  /** The comparison window; defaults to the same number of days right before. */
  previous?: DateRange | null
  /** Store contribution ÷ store revenue over the judged window (may be ≤ 0
   *  when every sale loses money before ads). Null when it cannot be measured:
   *  costs not configured, or no store revenue in the window. */
  contributionRate: number | null
  /** False when the store has no cost settings. Defaults to true. */
  costsConfigured?: boolean
  /** fb_campaigns.status ('ACTIVE' / 'PAUSED'), null when unknown. */
  status: string | null
  /** Set when the campaign ran in an ad account shared with another store and
   *  its sales cannot be shown to be this store's: the sentence to show. */
  sharedAccount?: string | null
  /** The spend of ads the catalog does not know yet, grouped as one row. */
  unsynced?: boolean
  thresholds?: Partial<ScaleThresholds>
}

export interface DecisionStripDay {
  date: string
  spend: number
  revenue: number
  purchases: number
  /** Null on a day without spend (no data, not zero) or without cost settings. */
  estimatedProfit: number | null
  margin: number | null
}

export interface CampaignDecision {
  /** Null for paused, shared-account, unsynced, no-spend and no-costs rows. */
  action: CampaignAction | null
  basis: DecisionBasis
  /** One sentence, Portuguese, the reason first. */
  reason: string
  /** Supporting evidence, only when it is real. */
  notes: string[]
  /** Null when there is no real earlier period to compare with. */
  trend: TrendArrow | null
  /** ROAS change against the previous period, in %. */
  trendChange: number | null
  window: DateRange
  previous: DateRange
  running: boolean
  spend: number
  purchases: number
  revenue: number
  estimatedProfit: number | null
  margin: number | null
  roas: number | null
  cpa: number | null
  previousSpend: number
  previousRoas: number | null
  /** ROAS of the last 3 days against the days before them in the window, %. */
  recentRoasChange: number | null
  /** Every date of the window, in order, empty days included. */
  days: DecisionStripDay[]
  thresholds: ScaleThresholds
}

// ─── Money helpers ────────────────────────────────────────────────────────────

/** Estimated profit = Meta purchase value × contribution rate − Meta spend. */
export function estimateProfit(revenue: number, spend: number, contributionRate: number): number {
  return revenue * contributionRate - spend
}

/** Estimated profit as a share of Meta purchase value (%); null without sales. */
export function marginPct(revenue: number, spend: number, contributionRate: number): number | null {
  if (revenue <= 0) return null
  return (estimateProfit(revenue, spend, contributionRate) / revenue) * 100
}

/** The ROAS at which a campaign pays exactly for itself; null when the rate is
 *  unknown or no ROAS can (every sale loses money before ads). */
export function breakEvenRoas(contributionRate: number | null): number | null {
  return contributionRate !== null && contributionRate > 0 ? 1 / contributionRate : null
}

const sum = <T>(xs: T[], f: (x: T) => number) => xs.reduce((s, x) => s + f(x), 0)
const roasOf = (rev: number, spend: number) => (spend > 0 ? rev / spend : null)
const pctChange = (now: number, before: number) => ((now - before) / Math.abs(before)) * 100
// Every sentence here is shown as is on the desktop, the phone, in pushes and
// to the AI, right next to numbers from lib/format: so pt-BR with a true minus
// sign ("$1.234", "$45,50", "−10%"), never "$1,234" or "-10%".
const money = (n: number) => formatMoney(n)
/** A threshold the owner set: a round amount, never "$50,00". */
const limit = (n: number) => formatMoney(n, { cents: 'never' })
const pct = (n: number) => formatPct(n, { digits: 0 })
// The volume counts Meta's attributed purchases, not Shopify orders, next to
// the row's own 'Gasto' and 'compras': '2 pedidos e $602 em 7 dias' read the
// spend as sales and Meta's purchases as the store's orders.
const purchaseCount = (n: number) => `${formatCount(n)} ${Math.round(n) === 1 ? 'compra atribuída' : 'compras atribuídas'}`
const purchasesShort = (n: number) => `${formatCount(n)} ${Math.round(n) === 1 ? 'compra' : 'compras'}`

function totals(days: DecisionDay[]) {
  const spend = sum(days, d => d.spend)
  const revenue = sum(days, d => d.revenue)
  const purchases = sum(days, d => d.purchases)
  return { spend, revenue, purchases, spendDays: days.filter(d => d.spend > 0).length }
}

export function isRunning(status: string | null, spentOnLastDay: boolean): boolean {
  if (status === null || status === '') return spentOnLastDay
  return status.toUpperCase() === 'ACTIVE'
}

// ─── The decision ─────────────────────────────────────────────────────────────

/**
 * Escalar / Manter / Cortar / Observar, over the judged window (the last 7
 * closed days on the campaign screens and in the push alerts):
 *
 *   no action    no spend, paused, shared ad account, unsynced ads, no cost
 *                settings, or no store sales to measure a margin on;
 *   cortar       margin ≤ cutMargin with ≥ minOrders and ≥ minSpend; or, with
 *                fewer orders, ≥ minSpend spent and the loss still there with
 *                50% more sales (no sales at all included);
 *   escalar      margin ≥ minMargin with ≥ minOrders and ≥ minSpend, unless
 *                the last 3 days' ROAS fell ≥ 30% against the days before
 *                them (then manter);
 *   manter       0 < margin < minMargin with enough volume;
 *   observar     enough volume but margin between cutMargin and 0, or too
 *                little volume to say anything.
 *
 * The trend arrow compares the window's ROAS with the previous period's and is
 * left out unless both periods had real spend on at least two days.
 */
export function decideCampaign(input: DecisionInput): CampaignDecision {
  const t: ScaleThresholds = { ...DEFAULT_THRESHOLDS, ...(input.thresholds ?? {}) }
  const { window } = input
  const n = daysBetween(window.from, window.to)
  const previous = input.previous ?? { from: shiftDate(window.from, -n), to: shiftDate(window.from, -1) }
  // A campaign whose sales may belong to another store is never priced with
  // this store's margin, not even in the supporting numbers.
  const rate = input.sharedAccount || input.costsConfigured === false ? null : input.contributionRate

  const byDate = new Map<string, DecisionDay>()
  for (const d of input.days) {
    const cur = byDate.get(d.date)
    byDate.set(d.date, cur
      ? { date: d.date, spend: cur.spend + d.spend, revenue: cur.revenue + d.revenue, purchases: cur.purchases + d.purchases }
      : { ...d })
  }
  const pick = (r: DateRange) => eachDay(r.from, r.to).map(date => byDate.get(date) ?? { date, spend: 0, revenue: 0, purchases: 0 })
  const winDays = pick(window)
  const prevDays = pick(previous)

  const w = totals(winDays)
  const p = totals(prevDays)
  const estimatedProfit = rate === null ? null : estimateProfit(w.revenue, w.spend, rate)
  const margin = rate === null ? null : marginPct(w.revenue, w.spend, rate)
  const roas = roasOf(w.revenue, w.spend)
  const previousRoas = roasOf(p.revenue, p.spend)

  const lastDay = winDays[winDays.length - 1]
  const running = isRunning(input.status, !!lastDay && lastDay.spend > 0)

  // Trend: only against a real earlier period.
  let trend: TrendArrow | null = null
  let trendChange: number | null = null
  const realPeriods = w.spend >= TREND_MIN_SPEND && w.spendDays >= TREND_MIN_DAYS
    && p.spend >= TREND_MIN_SPEND && p.spendDays >= TREND_MIN_DAYS
  if (realPeriods && roas !== null && previousRoas !== null) {
    if (previousRoas > 0) {
      trendChange = pctChange(roas, previousRoas)
      trend = trendChange >= TREND_CHANGE ? 'melhorando' : trendChange <= -TREND_CHANGE ? 'piorando' : 'estavel'
    } else {
      trend = roas > 0 ? 'melhorando' : 'estavel'
    }
  }

  // The last days against the rest of the window, by calendar and weighted by
  // spend (sum of revenue over sum of spend), never by row position.
  const recent = winDays.slice(-RECENT_DAYS)
  const before = winDays.slice(0, -RECENT_DAYS)
  const r = totals(recent), b = totals(before)
  const recentRoasChange = r.spend >= COLLAPSE_MIN_SPEND && b.spend >= COLLAPSE_MIN_SPEND && b.revenue > 0
    ? pctChange(r.revenue / r.spend, b.revenue / b.spend)
    : null

  const days: DecisionStripDay[] = winDays.map(d => ({
    ...d,
    estimatedProfit: rate !== null && d.spend > 0 ? estimateProfit(d.revenue, d.spend, rate) : null,
    margin: rate !== null && d.spend > 0 ? marginPct(d.revenue, d.spend, rate) : null,
  }))

  const base = {
    trend, trendChange, window, previous, running,
    spend: w.spend, purchases: w.purchases, revenue: w.revenue, estimatedProfit, margin, roas,
    cpa: w.spend > 0 && w.purchases > 0 ? w.spend / w.purchases : null,
    previousSpend: p.spend, previousRoas, recentRoasChange, days, thresholds: t,
  }
  const evidence = (action: CampaignAction): string[] => {
    const out: string[] = []
    if (trend === 'melhorando' && trendChange !== null) out.push(`ROAS ${pct(trendChange)} melhor que nos ${n} dias anteriores`)
    if (trend === 'piorando' && trendChange !== null) out.push(`ROAS ${pct(Math.abs(trendChange))} pior que nos ${n} dias anteriores`)
    if (recentRoasChange !== null && recentRoasChange <= -COLLAPSE_DROP && action !== 'manter') {
      out.push(`ROAS caiu ${pct(Math.abs(recentRoasChange))} nos últimos ${RECENT_DAYS} dias`)
    }
    if (recentRoasChange !== null && recentRoasChange >= COLLAPSE_DROP) {
      out.push(`ROAS subiu ${pct(recentRoasChange)} nos últimos ${RECENT_DAYS} dias`)
    }
    return out
  }
  const none = (basis: DecisionBasis, reason: string, notes: string[] = []): CampaignDecision =>
    ({ ...base, action: null, basis, reason, notes })
  const act = (action: CampaignAction, basis: DecisionBasis, reason: string): CampaignDecision =>
    ({ ...base, action, basis, reason, notes: evidence(action) })

  if (input.unsynced) {
    return none('nao_sincronizada', 'Gasto de anúncios que a sincronização ainda não descreveu — sem campanha para julgar')
  }
  if (w.spend <= 0) return none('sem_gasto', `Sem gasto nos ${n} dias julgados`)
  if (!running) return none('pausada', 'Pausada — sem recomendação')
  if (input.sharedAccount) return none('conta_compartilhada', input.sharedAccount)
  if (input.costsConfigured === false) {
    return none('sem_custos', 'Custos da loja não configurados — sem margem para julgar')
  }
  if (rate === null) {
    return none('sem_margem', `A loja não teve vendas nos ${n} dias julgados — sem margem de contribuição para medir`)
  }

  const volume = `${purchaseCount(w.purchases)} e ${money(w.spend)} de gasto em ${n} dias`
  const enough = w.purchases >= t.minOrders && w.spend >= t.minSpend

  if (enough && margin !== null) {
    if (margin <= t.cutMargin) {
      return act('cortar', 'margem', `Margem de ${pct(margin)} em ${n} dias — está queimando dinheiro`)
    }
    if (margin >= t.minMargin) {
      if (recentRoasChange !== null && recentRoasChange <= -COLLAPSE_DROP) {
        return act('manter', 'tendencia',
          `Margem de ${pct(margin)} em ${n} dias, mas o ROAS caiu ${pct(Math.abs(recentRoasChange))} nos últimos ${RECENT_DAYS} dias — segure antes de escalar`)
      }
      return act('escalar', 'margem', `Margem de ${pct(margin)} em ${n} dias, acima dos ${pct(t.minMargin)} para escalar`)
    }
    if (margin > 0) return act('manter', 'margem', `Margem de ${pct(margin)}, abaixo dos ${pct(t.minMargin)} para escalar`)
    return act('observar', 'margem', `Margem de ${pct(margin)} — no limite, sem folga para mais orçamento`)
  }

  // Too few orders for a margin to mean much. A loss is still a loss when it
  // survives 50% more sales — including a campaign that sold nothing at all.
  if (w.spend >= t.minSpend) {
    const robustMargin = marginPct(w.revenue * ROBUST_CUT_UPLIFT, w.spend, rate)
    if (robustMargin === null || robustMargin <= t.cutMargin) {
      return act('cortar', 'margem', w.revenue > 0
        ? `${volume}: mesmo com 50% mais vendas ficaria no prejuízo`
        : `${money(w.spend)} em ${n} dias sem nenhuma venda atribuída pelo Meta`)
    }
  }
  return act('observar', 'volume', `Pouco volume para julgar: ${volume} (mínimo ${purchasesShort(t.minOrders)} e ${limit(t.minSpend)})`)
}

// ─── Labels and ordering ──────────────────────────────────────────────────────

export const ACTION_LABEL: Record<CampaignAction, string> = {
  escalar: 'Escalar', manter: 'Manter', cortar: 'Cortar', observar: 'Observar',
}

export const TREND_ARROW_LABEL: Record<TrendArrow, string> = {
  melhorando: 'Melhorando', piorando: 'Piorando', estavel: 'Estável',
}

/** Money burning first, then room to grow; rows without an action last. */
export const ACTION_RANK: Record<CampaignAction | 'none', number> = {
  cortar: 0, escalar: 1, manter: 2, observar: 3, none: 4,
}

export function actionRank(a: CampaignAction | null): number {
  return ACTION_RANK[a ?? 'none']
}

/** The rule behind each badge, in plain words, for a legend or tooltip. */
export function describeThresholds(t: ScaleThresholds = DEFAULT_THRESHOLDS): Record<CampaignAction, string> {
  return {
    escalar: `Margem de ${pct(t.minMargin)} ou mais nos últimos ${t.windowDays} dias fechados, com pelo menos ${purchaseCount(t.minOrders)} e ${limit(t.minSpend)} de gasto, sem queda forte do ROAS nos últimos ${RECENT_DAYS} dias.`,
    manter: `Dá lucro, mas abaixo de ${pct(t.minMargin)} de margem — ou passaria para escalar, mas o ROAS caiu ${pct(COLLAPSE_DROP)} ou mais nos últimos ${RECENT_DAYS} dias.`,
    cortar: `Margem de ${pct(t.cutMargin)} ou pior com volume suficiente; ou ${limit(t.minSpend)} gastos e o prejuízo continuaria mesmo com 50% mais vendas.`,
    observar: `Entre ${pct(t.cutMargin)} e 0% de margem, ou pouco volume para julgar (menos de ${purchaseCount(t.minOrders)} ou ${limit(t.minSpend)} de gasto).`,
  }
}

// ─── Legacy surface ───────────────────────────────────────────────────────────
//
// Kept only because components/CampaignAnalysis.tsx and
// app/api/mobile/detail/route.ts (other areas) still import them. They are the
// old window money tag and trend tag; new code uses decideCampaign. Two fixes
// are applied in place so those screens stop lying meanwhile: the trend no
// longer says "Escalar" when there is no earlier period, and the margin no
// longer charges Shop Campaigns and fixed costs to Meta campaigns.

/** @deprecated Use CampaignAction from decideCampaign. */
export type CampaignVerdict = 'lucro' | 'empate' | 'prejuizo' | 'pouco_dado'

/** @deprecated */
export interface CampaignInput { spend: number; revenue: number; purchases: number; marginRate: number }

/** @deprecated */
export interface CampaignResult {
  roas: number; breakEven: number; contribution: number; profit: number; profitPct: number
  cpa: number | null; contributionPerOrder: number | null; verdict: CampaignVerdict
}

const LEGACY_MIN_SPEND = 15
const LEGACY_FLAT_BAND = 0.05

/** @deprecated Window money tag. Use decideCampaign for the action. */
export function campaignSignal(c: CampaignInput): CampaignResult {
  const spend = Math.max(0, Number(c.spend) || 0)
  const revenue = Math.max(0, Number(c.revenue) || 0)
  const orders = Math.max(0, Number(c.purchases) || 0)
  const rate = Number(c.marginRate) || 0
  const rateOk = rate > 0 && rate <= 1
  const contribution = rateOk ? revenue * rate : 0
  const profit = rateOk ? contribution - spend : 0
  let verdict: CampaignVerdict
  if (!rateOk || spend < LEGACY_MIN_SPEND || (orders === 0 && spend < LEGACY_MIN_SPEND * 2)) verdict = 'pouco_dado'
  else {
    const band = spend * LEGACY_FLAT_BAND
    verdict = profit > band ? 'lucro' : profit < -band ? 'prejuizo' : 'empate'
  }
  return {
    roas: spend > 0 ? revenue / spend : 0,
    breakEven: rateOk ? 1 / rate : 0,
    contribution, profit,
    profitPct: rateOk && revenue > 0 ? (profit / revenue) * 100 : 0,
    cpa: orders > 0 ? spend / orders : null,
    contributionPerOrder: rateOk && orders > 0 ? contribution / orders : null,
    verdict,
  }
}

/** @deprecated */
export const CAMPAIGN_RANK: Record<CampaignVerdict, number> = { prejuizo: 0, empate: 1, lucro: 2, pouco_dado: 3 }
/** @deprecated */
export const VERDICT_LABEL: Record<CampaignVerdict, string> = { lucro: 'Lucro', empate: 'No fio', prejuizo: 'Prejuízo', pouco_dado: 'Pouco dado' }
/** @deprecated */
export const VERDICT_COLOR: Record<CampaignVerdict, string> = { lucro: '#10B981', empate: '#F59E0B', prejuizo: '#F43F5E', pouco_dado: '#64748B' }

/** @deprecated Use TrendArrow from decideCampaign. */
export type CampaignTrend = 'escalar' | 'esfriando' | 'estavel' | 'curto'
/** @deprecated */
export interface TrendDay { date: string; spend: number; revenue: number }
/** @deprecated */
export interface TrendResult {
  trend: CampaignTrend; recentDays: number; recentSpend: number; recentRoas: number; recentProfit: number
  baseRoas: number; lift: number | null; accelerating: boolean
}

/**
 * @deprecated Use decideCampaign (trend arrow). Fixed: with no earlier period
 * inside the window (the 7-day view) the trend is 'curto', not 'escalar'.
 */
export function campaignTrend(series: TrendDay[], dateTo: string, marginRate: number): TrendResult {
  const breakEven = marginRate > 0 ? 1 / marginRate : 0
  const recentCut = shiftDate(dateTo, -6)
  const edgeCut = shiftDate(dateTo, -1)
  const agg = (ds: TrendDay[]) => {
    const spend = sum(ds, d => d.spend), revenue = sum(ds, d => d.revenue)
    return { spend, roas: spend > 0 ? revenue / spend : 0, profit: marginRate > 0 ? revenue * marginRate - spend : 0 }
  }
  const recent = series.filter(d => d.date >= recentCut && d.spend > 0)
  const r = agg(recent)
  const b = agg(series.filter(d => d.date < recentCut))
  const e = agg(series.filter(d => d.date >= edgeCut))
  const lift = b.roas > 0 ? ((r.roas - b.roas) / b.roas) * 100 : null
  const accelerating = marginRate > 0 && b.spend > 0 && r.roas >= breakEven && e.roas >= r.roas && r.roas > b.roas
  let trend: CampaignTrend = 'estavel'
  if (marginRate <= 0 || r.spend < TREND_MIN_SPEND || recent.length < 2 || b.spend <= 0) trend = 'curto'
  else if (r.profit > 0 && (accelerating || (lift !== null && lift >= TREND_CHANGE))) trend = 'escalar'
  else if (r.profit < 0 && b.profit > 0) trend = 'esfriando'
  const r2 = (x: number) => Math.round(x * 100) / 100
  return {
    trend, recentDays: recent.length, recentSpend: r2(r.spend), recentRoas: r2(r.roas), recentProfit: r2(r.profit),
    baseRoas: r2(b.roas), lift: lift !== null ? Math.round(lift * 10) / 10 : null, accelerating,
  }
}

/** @deprecated */
export const TREND_LABEL: Record<CampaignTrend, string> = { escalar: 'Melhorando', esfriando: 'Esfriando', estavel: 'Estável', curto: '' }
/** @deprecated */
export const TREND_COLOR: Record<CampaignTrend, string> = { escalar: '#10B981', esfriando: '#F59E0B', estavel: '#64748B', curto: '#64748B' }
/** @deprecated */
export const TREND_RANK: Record<CampaignTrend, number> = { escalar: 0, esfriando: 1, estavel: 2, curto: 3 }

/**
 * @deprecated Use the engine's contributionMargin. Fixed: the rate is the
 * contribution rate (1 ÷ break-even), so Shop Campaigns and fixed costs no
 * longer leak into a Meta campaign's margin.
 */
export function marginRateFromSummary(s: { configured: boolean; totalRevenue: number; breakEvenRoas: number }): number {
  if (!s.configured || s.totalRevenue <= 0 || !(s.breakEvenRoas > 0)) return 0
  const rate = 1 / s.breakEvenRoas
  return rate > 0 && rate <= 1 ? rate : 0
}
