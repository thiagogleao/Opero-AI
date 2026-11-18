/**
 * GET /api/mobile/detail: the phone's detail tabs (campanhas, criativos,
 * produtos, países, clientes), built on lib/data/* — the same modules the
 * desktop pages read — for one store or several.
 *
 * Same request rules as GET /api/mobile, so a tab never shows another window
 * than the headline above it: the same period presets, a custom period needs
 * both dates (a 400, never a silent "today"), the same store selection
 * (lib/views/mobile selectStores) and the same calendar (one store on its own
 * clock, several on the reference date, each read in its own timezone).
 *
 * The request is echoed back (`request`) so the phone drops an answer that no
 * longer matches what is on screen, and a store whose section failed is named
 * in `failedStores` instead of silently counting as zero.
 *
 * Several stores are merged here, never averaged: every ratio is recomputed
 * from summed money, each campaign and ad keeps its own store's break-even,
 * and a store without cost settings never lends a fake margin to a merged row.
 */

import type { StoreRef } from '../access'
import {
  anchorTz, formatRange, isIsoDate, isPeriod, resolveRange, safeTz, todayInTz,
  type DateRange, type Period,
} from '../engine/dates'
import { getCampaignReport, type CampaignReport } from '../data/campaigns'
import { getCreativesReport, type CreativesReport } from '../data/creatives'
import { getProductReport, type ProductReport } from '../data/products'
import {
  getCountryReport, rollUpCountries, META_COUNTRY_CAVEAT, META_COUNTRY_LABEL, SMALL_SAMPLE, TERRITORIES_NOTE,
  type CountryReport,
} from '../data/countries'
import { getCustomerLtv, getCustomerSplit, LTV_SEGMENTS, type CustomerLtv, type CustomerSplit, type LtvSegment } from '../data/customers'
import {
  ACTION_LABEL, TREND_ARROW_LABEL, actionRank, describeThresholds, DEFAULT_THRESHOLDS,
  type CampaignAction, type ScaleThresholds, type TrendArrow,
} from '../campaignSignal'
import { SIGNAL_LABEL, signalRank, type Signal } from '../creativeSignal'
import { formatMoney } from '../format'

// ─── Request ──────────────────────────────────────────────────────────────────

export const DETAIL_SECTIONS = ['campanhas', 'criativos', 'produtos', 'paises', 'clientes'] as const
export type DetailSection = (typeof DETAIL_SECTIONS)[number]

export function isDetailSection(v: unknown): v is DetailSection {
  return typeof v === 'string' && (DETAIL_SECTIONS as readonly string[]).includes(v)
}

/** The query as understood (before the store ids are checked). */
export interface DetailQuery {
  section: DetailSection
  period: Period
  /** Custom dates; null for presets (they are ignored there, as in /api/mobile). */
  from: string | null
  to: string | null
  /** The raw `store` parameter ('all', an id or ids), resolved by selectStores. */
  store: string | null
}

export class DetailQueryError extends Error {
  readonly status = 400
}

/**
 * ?section=&period=&store=&from=&to= → DetailQuery, or a DetailQueryError
 * (400) with a Portuguese message. Pure.
 */
export function parseDetailQuery(sp: URLSearchParams): DetailQuery {
  const section = sp.get('section')
  if (!isDetailSection(section)) throw new DetailQueryError('Seção inválida')
  const period = sp.get('period') ?? 'today'
  if (!isPeriod(period)) throw new DetailQueryError('Período inválido')
  const from = sp.get('from') || null
  const to = sp.get('to') || null
  if ((from && !isIsoDate(from)) || (to && !isIsoDate(to))) throw new DetailQueryError('Data inválida')
  const custom = period === 'custom'
  if (custom && !(from && to)) throw new DetailQueryError('Escolha a data inicial e a final')
  return { section, period, from: custom ? from : null, to: custom ? to : null, store: sp.get('store') }
}

// ─── Response types ───────────────────────────────────────────────────────────

/** The request as answered, so the phone can drop stale answers. `store` is
 *  the same key /api/mobile echoes ('all' or the ids, comma-joined). */
export interface DetailRequestEcho {
  section: DetailSection
  store: string
  period: Period
  from: string | null
  to: string | null
}

export interface DetailStore {
  id: string
  name: string
  timezone: string
  /** Null when the section does not know (customers do not need costs). */
  configured: boolean | null
}

interface DetailBase {
  request: DetailRequestEcho
  generatedAt: string
  /** The window on the anchor clock; each store reads these dates in its own timezone. */
  range: DateRange
  rangeLabel: string
  anchorTimezone: string
  /** The window includes the current day of at least one store. */
  partial: boolean
  /** Stores whose section loaded. */
  stores: DetailStore[]
  /** Stores whose section could not be loaded: named, never counted as zero. */
  failedStores: { id: string; name: string }[]
}

// Campaigns

export interface MobileCampaign {
  key: string
  storeId: string
  store: string
  campaignId: string | null
  name: string
  status: string | null
  running: boolean
  /** The "Anúncios ainda não sincronizados" row. */
  unsynced: boolean
  spend: number
  purchaseValue: number
  purchases: number
  roas: number | null
  cpa: number | null
  /** Meta purchase value × the store's contribution rate − spend (null without
   *  costs or for a shared-account campaign). */
  estimatedProfit: number | null
  margin: number | null
  /** The store's own break-even ROAS for the money window (null without costs). */
  breakEvenRoas: number | null
  /** The one action, judged on the last 7 closed days (decisionWindow). */
  action: CampaignAction | null
  actionLabel: string | null
  reason: string
  notes: string[]
  trend: TrendArrow | null
  trendLabel: string | null
  /** ROAS change vs the previous 7 days, %. */
  trendChange: number | null
  decisionWindow: DateRange
  /** Why its sales may belong to another store (no margin, no action). */
  shared: string | null
  /** Estimated profit per day of the money window (null = no spend or no costs). */
  days: { date: string; spend: number; estimatedProfit: number | null }[]
}

export interface CampaignStoreNote {
  storeId: string
  store: string
  configured: boolean
  breakEvenRoas: number | null
  decisionBreakEvenRoas: number | null
  /** (Meta purchase value − store revenue) ÷ store revenue, %: how optimistic
   *  Meta's attribution is for this store. */
  metaVsStoreRevenueGap: number | null
  /** Σ campaign spend − the engine's Meta spend; 0 unless something is off. */
  spendGap: number
  /** Campaigns whose orders land here but whose spend is in another store's books. */
  billedElsewhere: { name: string; billedStoreName: string; spend: number }[]
}

export interface CampaignsDetail extends DetailBase {
  section: 'campanhas'
  /** Money burning first (Cortar), then room to grow (Escalar), Manter,
   *  Observar, no action; bigger spend first within each. */
  campaigns: MobileCampaign[]
  /** Campaigns before the phone's cut. */
  totalCampaigns: number
  totals: {
    spend: number
    purchaseValue: number
    purchases: number
    roas: number | null
    /** Sum over priced rows; null when no row is priced. */
    estimatedProfit: number | null
    /** Spend of rows not priced (shared accounts, stores without costs). */
    unpricedSpend: number
    actions: Record<CampaignAction, number>
  }
  /** Each action's rule in plain words, for the legend. */
  rules: Record<CampaignAction, string>
  formula: string
  /** The judged windows (one per calendar: Hibikura's Tokyo week differs). */
  decisionWindows: { range: DateRange; label: string; stores: string[] }[]
  storeNotes: CampaignStoreNote[]
}

// Creatives

export interface MobileCreative {
  key: string
  storeId: string
  store: string
  adId: string
  name: string
  campaignName: string | null
  running: boolean
  thumbnailUrl: string | null
  spend: number
  purchaseValue: number
  purchases: number
  roas: number | null
  cpa: number | null
  /** Link clicks ÷ impressions, %. */
  ctr: number | null
  estimatedProfit: number | null
  /** The store's own break-even ROAS (null without costs). */
  breakEvenRoas: number | null
  signal: Signal | null
  signalLabel: string | null
  reason: string
  /** Null for image ads. playRate counts autoplay: it is not a hook rate. */
  video: { playRate: number | null; retention25: number | null; retention50: number | null; retention75: number | null; retention100: number | null } | null
  /** Exact only for single-day windows; null otherwise (see notes). */
  frequency: number | null
  shared: string | null
  daysWithSpend: number
  lastSpendDay: string | null
}

export interface CreativesDetail extends DetailBase {
  section: 'criativos'
  /** Desligar first, then Escalar, Trocar criativo, OK, no verdict; bigger
   *  spend first within each. */
  creatives: MobileCreative[]
  totalCreatives: number
  totals: {
    spend: number
    purchaseValue: number
    purchases: number
    estimatedProfit: number | null
    verdicts: Record<Signal | 'none', number>
  }
  notes: { hookRate: string; frequency: string | null }
  formula: string
}

// Products

export interface MobileProduct {
  key: string
  title: string
  imageUrl: string | null
  /** Stores that sold it (clone stores share a catalogue). */
  stores: string[]
  units: number
  orders: number
  revenue: number
  revenueShare: number | null
  /** Null when any store that sold it has no cost settings. */
  contribution: number | null
  contributionMargin: number | null
  /** Meta spend the journeys link to its orders: an attribution, not the books. */
  attributedSpend: number
  contributionAfterAttributedSpend: number | null
}

export interface ProductsDetail extends DetailBase {
  section: 'produtos'
  /** Biggest revenue first. */
  products: MobileProduct[]
  totalProducts: number
  totals: { revenue: number; units: number; contribution: number | null; attributedSpend: number }
  attribution: { label: string; note: string }
  unconfiguredStores: string[]
}

// Countries

export interface MobileCountry {
  country: string
  name: string
  orders: number
  revenue: number
  revenueShare: number | null
  /** Null when any store that sold there has no cost settings. */
  contribution: number | null
  contributionMargin: number | null
  contributionPerOrder: number | null
  /** Fewer than SMALL_SAMPLE orders: too few to judge the country. */
  smallSample: boolean
  meta: { spend: number; purchases: number; purchaseValue: number; capturePct: number | null }
  mergedCountries?: number
}

export interface CountriesDetail extends DetailBase {
  section: 'paises'
  /** Biggest revenue first, then one "outros" row; sums to the stores' totals. */
  countries: MobileCountry[]
  totals: { orders: number; revenue: number; contribution: number | null }
  meta: { label: string; caveat: string; coveredSpend: number; totalSpend: number; coveragePct: number | null; missingDays: number }
  notes: string[]
  smallSample: number
  unconfiguredStores: string[]
}

// Customers

export interface CustomersDetail extends DetailBase {
  section: 'clientes'
  split: Omit<CustomerSplit, 'storeId' | 'range' | 'daily'>
  /** Whole collected history, whatever the window (null when it failed). */
  ltv: Omit<CustomerLtv, 'storeId'> | null
  /** With several stores a person who bought in two is two customers. */
  perStoreCustomers: boolean
}

export type MobileDetailResponse = CampaignsDetail | CreativesDetail | ProductsDetail | CountriesDetail | CustomersDetail

// ─── Limits ───────────────────────────────────────────────────────────────────

/** Rows a phone screen can usefully show; the totals still cover every row. */
export const DETAIL_LIMIT: Record<Exclude<DetailSection, 'clientes'>, number> = {
  campanhas: 40, criativos: 30, produtos: 30, paises: 12,
}

/** Stores loaded at once: each report runs several queries on a small pool. */
const STORE_CONCURRENCY = 3

// ─── Pure merging (exported for the tests) ────────────────────────────────────

const round2 = (v: number) => Math.round(v * 100) / 100
const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null)
const pct = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null)
const emptyActions = (): Record<CampaignAction, number> => ({ escalar: 0, manter: 0, cortar: 0, observar: 0 })

export interface Loaded<T> { store: StoreRef; value: T }

/**
 * The decision texts come from lib/campaignSignal and lib/creativeSignal,
 * which write numbers the English way ("ROAS 0.96x", "$1,234", "$1234",
 * "-16%"). Every other number on the phone is pt-BR, and the same row shows
 * "ROAS 0,96×" right under the reason, so the texts are rewritten here. A
 * text already in pt-BR passes through unchanged, so this becomes a no-op once
 * those modules format with lib/format. Pure.
 */
export function ptReason(text: string): string {
  return text
    .replace(/(\d+)\.(\d+)x\b/g, '$1,$2×')
    .replace(/\$(\d{1,3}(?:,\d{3})+)(?![\d,])/g, (_, n: string) => formatMoney(Number(n.replace(/,/g, ''))))
    .replace(/\$(\d{4,})(?![\d.,])/g, (_, n: string) => formatMoney(Number(n)))
    .replace(/(Frequência \d+)\.(\d)/g, '$1,$2')
    .replace(/(^|[\s(])-(\d)/g, '$1\u2212$2')
}

export function mergeCampaigns(loaded: Loaded<CampaignReport>[], limit = DETAIL_LIMIT.campanhas): Omit<CampaignsDetail, keyof DetailBase | 'section'> {
  const rows: MobileCampaign[] = []
  const totals = { spend: 0, purchaseValue: 0, purchases: 0, estimatedProfit: 0, priced: 0, unpricedSpend: 0, actions: emptyActions() }
  const windows = new Map<string, { range: DateRange; stores: string[] }>()
  const storeNotes: CampaignStoreNote[] = []
  let thresholds: ScaleThresholds = DEFAULT_THRESHOLDS
  let formula = ''

  for (const { store, value: r } of loaded) {
    thresholds = r.thresholds
    formula = r.formula
    const wk = `${r.decisionWindow.from}|${r.decisionWindow.to}`
    const w = windows.get(wk) ?? { range: r.decisionWindow, stores: [] }
    w.stores.push(store.name)
    windows.set(wk, w)
    storeNotes.push({
      storeId: store.id, store: store.name, configured: r.configured,
      breakEvenRoas: r.breakEvenRoas, decisionBreakEvenRoas: r.decisionBreakEvenRoas,
      metaVsStoreRevenueGap: r.metaVsStoreRevenueGap,
      spendGap: round2(r.reconciliation.gap),
      billedElsewhere: r.billedElsewhere.map(b => ({ name: b.name, billedStoreName: b.billedStoreName, spend: b.spend })),
    })
    for (const c of r.campaigns) {
      totals.spend += c.spend
      totals.purchaseValue += c.purchaseValue
      totals.purchases += c.purchases
      if (c.estimatedProfit !== null) { totals.estimatedProfit += c.estimatedProfit; totals.priced++ } else totals.unpricedSpend += c.spend
      if (c.decision.action) totals.actions[c.decision.action]++
      rows.push({
        key: `${store.id}:${c.campaignId ?? `sem-id:${c.name}`}`,
        storeId: store.id, store: store.name,
        campaignId: c.campaignId, name: c.name, status: c.status, running: c.running, unsynced: c.unsynced,
        spend: c.spend, purchaseValue: c.purchaseValue, purchases: c.purchases, roas: c.roas, cpa: c.cpa,
        estimatedProfit: c.estimatedProfit, margin: c.margin,
        breakEvenRoas: c.shared ? null : r.breakEvenRoas,
        action: c.decision.action,
        actionLabel: c.decision.action ? ACTION_LABEL[c.decision.action] : null,
        reason: ptReason(c.decision.reason), notes: c.decision.notes.map(ptReason),
        trend: c.decision.trend, trendLabel: c.decision.trend ? TREND_ARROW_LABEL[c.decision.trend] : null,
        trendChange: c.decision.trendChange,
        decisionWindow: c.decision.window,
        shared: c.shared?.note ?? null,
        days: c.days.map(d => ({ date: d.date, spend: d.spend, estimatedProfit: d.estimatedProfit })),
      })
    }
  }

  rows.sort((a, b) => actionRank(a.action) - actionRank(b.action) || b.spend - a.spend)
  return {
    campaigns: rows.slice(0, limit),
    totalCampaigns: rows.length,
    totals: {
      spend: round2(totals.spend), purchaseValue: round2(totals.purchaseValue), purchases: totals.purchases,
      roas: ratio(totals.purchaseValue, totals.spend),
      estimatedProfit: totals.priced > 0 ? round2(totals.estimatedProfit) : null,
      unpricedSpend: round2(totals.unpricedSpend),
      actions: totals.actions,
    },
    rules: Object.fromEntries(Object.entries(describeThresholds(thresholds)).map(([k, v]) => [k, ptReason(v)])) as Record<CampaignAction, string>,
    formula,
    decisionWindows: [...windows.values()].map(w => ({ range: w.range, label: formatRange(w.range), stores: w.stores })),
    storeNotes,
  }
}

export function mergeCreatives(loaded: Loaded<CreativesReport>[], limit = DETAIL_LIMIT.criativos): Omit<CreativesDetail, keyof DetailBase | 'section'> {
  const rows: MobileCreative[] = []
  const verdicts: Record<Signal | 'none', number> = { kill: 0, scale: 0, refresh: 0, ok: 0, none: 0 }
  let spend = 0, pv = 0, purchases = 0, profit = 0, priced = 0
  let notes: CreativesDetail['notes'] = { hookRate: '', frequency: null }
  let formula = ''
  for (const { store, value: r } of loaded) {
    notes = r.notes
    formula = r.formula
    for (const c of r.creatives) {
      verdicts[c.verdict.signal ?? 'none']++
      spend += c.spend; pv += c.purchaseValue; purchases += c.purchases
      if (c.estimatedProfit !== null) { profit += c.estimatedProfit; priced++ }
      rows.push({
        key: `${store.id}:${c.adId}`, storeId: store.id, store: store.name,
        adId: c.adId, name: c.name, campaignName: c.campaignName, running: c.running, thumbnailUrl: c.thumbnailUrl,
        spend: c.spend, purchaseValue: c.purchaseValue, purchases: c.purchases, roas: c.roas, cpa: c.cpa, ctr: c.ctr,
        estimatedProfit: c.estimatedProfit,
        breakEvenRoas: c.shared ? null : r.breakEvenRoas,
        signal: c.verdict.signal, signalLabel: c.verdict.signal ? SIGNAL_LABEL[c.verdict.signal] : null,
        reason: ptReason(c.verdict.reason),
        video: c.video ? {
          playRate: c.video.playRate, retention25: c.video.retention25, retention50: c.video.retention50,
          retention75: c.video.retention75, retention100: c.video.retention100,
        } : null,
        frequency: c.frequency, shared: c.shared?.note ?? null,
        daysWithSpend: c.daysWithSpend, lastSpendDay: c.lastSpendDay,
      })
    }
  }
  rows.sort((a, b) => signalRank(a.signal) - signalRank(b.signal) || b.spend - a.spend)
  return {
    creatives: rows.slice(0, limit),
    totalCreatives: rows.length,
    totals: {
      spend: round2(spend), purchaseValue: round2(pv), purchases,
      estimatedProfit: priced > 0 ? round2(profit) : null, verdicts,
    },
    notes, formula,
  }
}

/** Clone stores sell one catalogue under different product ids: merge by title. */
const titleKey = (t: string) => t.trim().toLowerCase().replace(/\s+/g, ' ')

export function mergeProducts(loaded: Loaded<ProductReport>[], limit = DETAIL_LIMIT.produtos): Omit<ProductsDetail, keyof DetailBase | 'section'> {
  const by = new Map<string, MobileProduct & { unconfigured: boolean; contrib: number }>()
  let revenue = 0, units = 0, attributed = 0, contribution = 0
  const unconfigured: string[] = []
  let attribution = { label: '', note: '' }
  for (const { store, value: r } of loaded) {
    revenue += r.totals.revenue
    attribution = { label: r.attribution.label, note: r.attribution.note }
    if (!r.configured && r.totals.revenue > 0) unconfigured.push(store.name)
    contribution += r.totals.contribution
    for (const p of r.products) {
      units += p.units
      attributed += p.attributedSpend
      const k = titleKey(p.title)
      const cur = by.get(k) ?? {
        key: k, title: p.title, imageUrl: null, stores: [], units: 0, orders: 0, revenue: 0, revenueShare: null,
        contribution: null, contributionMargin: null, attributedSpend: 0, contributionAfterAttributedSpend: null,
        unconfigured: false, contrib: 0,
      }
      cur.imageUrl ??= p.imageUrl
      if (!cur.stores.includes(store.name)) cur.stores.push(store.name)
      cur.units += p.units
      cur.orders += p.orders
      cur.revenue += p.revenue
      cur.attributedSpend += p.attributedSpend
      cur.contrib += p.contribution
      if (!r.configured) cur.unconfigured = true
      by.set(k, cur)
    }
  }
  const all = [...by.values()].map(({ unconfigured: u, contrib, ...p }): MobileProduct => ({
    ...p,
    revenueShare: pct(p.revenue, revenue),
    contribution: u ? null : contrib,
    contributionMargin: u ? null : pct(contrib, p.revenue),
    contributionAfterAttributedSpend: u ? null : contrib - p.attributedSpend,
  }))
  all.sort((a, b) => b.revenue - a.revenue)
  return {
    products: all.slice(0, limit),
    totalProducts: all.length,
    totals: {
      revenue: round2(revenue), units, attributedSpend: round2(attributed),
      contribution: unconfigured.length ? null : round2(contribution),
    },
    attribution,
    unconfiguredStores: unconfigured,
  }
}

/** Stores without cost settings that sold in the window: their countries show no contribution. */
export const unconfiguredCountriesNote = (stores: string[]) =>
  `${stores.join(', ')} sem custos configurados: nos países onde ${stores.length > 1 ? 'essas lojas venderam' : 'ela vendeu'}, a contribuição não aparece.`

export function mergeCountries(loaded: Loaded<CountryReport>[], limit = DETAIL_LIMIT.paises): Omit<CountriesDetail, keyof DetailBase | 'section'> {
  type Acc = { country: string; orders: number; revenue: number; variableCosts: number; contribution: number; metaSpend: number; metaPurchaseValue: number; purchases: number }
  const by = new Map<string, Acc>()
  const unconfiguredCountries = new Set<string>()
  let revenue = 0, orders = 0, contribution = 0
  let covered = 0, total = 0, missing = 0
  const unconfigured: string[] = []
  const notes = new Set<string>()
  for (const { store, value: r } of loaded) {
    revenue += r.totals.revenue
    orders += r.totals.orders
    contribution += r.totals.contribution
    covered += r.meta.coveredSpend
    total += r.meta.totalSpend
    missing += r.meta.missingDays.length
    if (!r.configured && r.totals.revenue > 0) unconfigured.push(store.name)
    // One store's "custos não configurados: a contribuição é a própria
    // receita" is wrong here: this view blanks those countries' contribution
    // instead, and the note showed up in Todas even when that store sold
    // nothing. Replaced by unconfiguredCountriesNote().
    for (const n of r.notes) if (!n.startsWith('Custos não configurados')) notes.add(n)
    for (const c of r.rows) {
      const cur = by.get(c.country) ?? { country: c.country, orders: 0, revenue: 0, variableCosts: 0, contribution: 0, metaSpend: 0, metaPurchaseValue: 0, purchases: 0 }
      cur.orders += c.orders
      cur.revenue += c.revenue
      cur.variableCosts += c.variableCosts
      cur.contribution += c.contribution
      cur.metaSpend += c.meta.spend
      cur.metaPurchaseValue += c.meta.purchaseValue
      cur.purchases += c.meta.purchases
      if (!r.configured && c.revenue > 0) unconfiguredCountries.add(c.country)
      by.set(c.country, cur)
    }
  }
  // rollUpCountries sums the tail into "outros" and recomputes every ratio
  // from the summed money, exactly as one store's report does.
  const head = [...by.values()].sort((a, b) => b.revenue - a.revenue || b.metaSpend - a.metaSpend).slice(0, Math.max(0, limit))
  const headCodes = new Set(head.map(c => c.country))
  const tailUnconfigured = [...unconfiguredCountries].some(c => !headCodes.has(c))
  const rows = rollUpCountries([...by.values()], revenue, limit).map((row): MobileCountry => {
    const blind = row.country === 'outros' ? tailUnconfigured : unconfiguredCountries.has(row.country)
    return {
      country: row.country, name: row.name, orders: row.orders, revenue: row.revenue, revenueShare: row.revenueShare,
      contribution: blind ? null : row.contribution,
      contributionMargin: blind ? null : row.contributionMargin,
      contributionPerOrder: blind ? null : row.contributionPerOrder,
      smallSample: row.smallSample, meta: row.meta,
      ...(row.mergedCountries ? { mergedCountries: row.mergedCountries } : {}),
    }
  })
  return {
    countries: rows,
    totals: { orders, revenue: round2(revenue), contribution: unconfigured.length ? null : round2(contribution) },
    meta: {
      label: META_COUNTRY_LABEL, caveat: META_COUNTRY_CAVEAT,
      coveredSpend: round2(covered), totalSpend: round2(total), coveragePct: pct(covered, total), missingDays: missing,
    },
    notes: [
      TERRITORIES_NOTE, ...[...notes].filter(n => n !== TERRITORIES_NOTE),
      ...(unconfigured.length ? [unconfiguredCountriesNote(unconfigured)] : []),
    ],
    smallSample: SMALL_SAMPLE,
    unconfiguredStores: unconfigured,
  }
}

export function mergeCustomers(
  splits: Loaded<CustomerSplit>[], ltvs: Loaded<CustomerLtv>[] | null,
): Omit<CustomersDetail, keyof DetailBase | 'section'> {
  const s = {
    historyStart: null as string | null, orders: 0, revenue: 0, newOrders: 0, returningOrders: 0, guestOrders: 0,
    newRevenue: 0, returningRevenue: 0, guestRevenue: 0, customers: 0, newCustomers: 0, returningCustomers: 0,
    repeatOrdersOfNewCustomers: 0,
  }
  for (const { value: c } of splits) {
    if (c.historyStart && (!s.historyStart || c.historyStart < s.historyStart)) s.historyStart = c.historyStart
    s.orders += c.orders; s.revenue += c.revenue
    s.newOrders += c.newOrders; s.returningOrders += c.returningOrders; s.guestOrders += c.guestOrders
    s.newRevenue += c.newRevenue; s.returningRevenue += c.returningRevenue; s.guestRevenue += c.guestRevenue
    s.customers += c.customers; s.newCustomers += c.newCustomers; s.returningCustomers += c.returningCustomers
    s.repeatOrdersOfNewCustomers += c.repeatOrdersOfNewCustomers
  }
  const split = { ...s, repeatOrderPct: pct(s.returningOrders, s.newOrders + s.returningOrders) }

  let ltv: CustomersDetail['ltv'] = null
  if (ltvs && ltvs.length) {
    const acc = { historyStart: null as string | null, customers: 0, orders: 0, revenue: 0, repeatCustomers: 0, guestOrders: 0 }
    const seg = new Map<LtvSegment, { customers: number; orders: number; revenue: number }>()
    for (const { value: l } of ltvs) {
      if (l.historyStart && (!acc.historyStart || l.historyStart < acc.historyStart)) acc.historyStart = l.historyStart
      acc.customers += l.customers; acc.orders += l.orders; acc.revenue += l.revenue
      acc.repeatCustomers += l.repeatCustomers; acc.guestOrders += l.guestOrders
      for (const b of l.buckets) {
        const cur = seg.get(b.segment) ?? { customers: 0, orders: 0, revenue: 0 }
        // The bucket's averages times its count give back its sums.
        cur.customers += b.customers
        cur.orders += (b.avgOrders ?? 0) * b.customers
        cur.revenue += (b.avgLtv ?? 0) * b.customers
        seg.set(b.segment, cur)
      }
    }
    ltv = {
      scope: 'histórico completo',
      historyStart: acc.historyStart,
      customers: acc.customers, orders: acc.orders, revenue: round2(acc.revenue),
      repeatCustomers: acc.repeatCustomers,
      repeatCustomerPct: pct(acc.repeatCustomers, acc.customers),
      avgLtv: ratio(acc.revenue, acc.customers),
      avgOrders: ratio(acc.orders, acc.customers),
      guestOrders: acc.guestOrders,
      buckets: LTV_SEGMENTS.map(segment => {
        const b = seg.get(segment) ?? { customers: 0, orders: 0, revenue: 0 }
        return {
          segment, customers: b.customers, pct: pct(b.customers, acc.customers),
          avgOrders: ratio(b.orders, b.customers), avgLtv: ratio(b.revenue, b.customers), avgOrderValue: ratio(b.revenue, b.orders),
        }
      }),
    }
  }
  return { split, ltv, perStoreCustomers: splits.length > 1 }
}

// ─── Loading ──────────────────────────────────────────────────────────────────

/** Run `fn` per store, at most `limit` at a time; a store that throws or
 *  returns null is reported, never silently dropped. */
export async function perStore<T>(
  stores: readonly StoreRef[], fn: (s: StoreRef) => Promise<T | null>, limit = STORE_CONCURRENCY,
): Promise<{ ok: Loaded<T>[]; failed: StoreRef[] }> {
  const results: ({ value: T } | null)[] = new Array(stores.length).fill(null)
  let next = 0
  const worker = async () => {
    while (next < stores.length) {
      const i = next++
      try {
        const value = await fn(stores[i])
        results[i] = value === null ? null : { value }
      } catch (err) {
        console.error('[mobile/detail]', stores[i].id, err)
        results[i] = null
      }
    }
  }
  await Promise.all(Array.from({ length: Math.min(limit, stores.length) }, worker))
  const ok: Loaded<T>[] = []
  const failed: StoreRef[] = []
  stores.forEach((s, i) => {
    const r = results[i]
    if (r) ok.push({ store: s, value: r.value })
    else failed.push(s)
  })
  return { ok, failed }
}

export class DetailFailedError extends Error {}

export interface DetailContext {
  /** Owner's scale threshold (alert settings), the same the push alerts use. */
  thresholds?: Partial<ScaleThresholds>
  /** Every store the viewer may see (id → name), to say where shared sales went. */
  storeNames?: ReadonlyMap<string, string>
  now?: Date
}

/**
 * Build one section for `stores` (already resolved by selectStores). Throws
 * DetailFailedError when every store failed.
 */
export async function buildMobileDetail(
  q: DetailQuery & { storeKey: string }, stores: readonly StoreRef[], ctx: DetailContext = {},
): Promise<MobileDetailResponse> {
  const now = ctx.now ?? new Date()
  const anchor = anchorTz(stores.map(s => s.timezone))
  const range = resolveRange(q.period, anchor, q.from, q.to, now)
  const base = (configured: (s: StoreRef) => boolean | null, ok: StoreRef[], failed: StoreRef[]): DetailBase => ({
    request: { section: q.section, store: q.storeKey, period: q.period, from: q.from, to: q.to },
    generatedAt: now.toISOString(),
    range,
    rangeLabel: formatRange(range, todayInTz(anchor, now)),
    anchorTimezone: anchor,
    partial: stores.some(s => range.to >= todayInTz(safeTz(s.timezone), now)),
    stores: ok.map(s => ({ id: s.id, name: s.name, timezone: s.timezone, configured: configured(s) })),
    failedStores: failed.map(s => ({ id: s.id, name: s.name })),
  })
  const guard = (okCount: number) => {
    if (stores.length > 0 && okCount === 0) throw new DetailFailedError('Nenhuma loja respondeu')
  }

  switch (q.section) {
    case 'campanhas': {
      const r = await perStore(stores, s => getCampaignReport(s, range, { thresholds: ctx.thresholds, storeNames: ctx.storeNames, now }))
      guard(r.ok.length)
      const cfg = new Map(r.ok.map(l => [l.store.id, l.value.configured]))
      return { section: 'campanhas', ...base(s => cfg.get(s.id) ?? null, r.ok.map(l => l.store), r.failed), ...mergeCampaigns(r.ok) }
    }
    case 'criativos': {
      const r = await perStore(stores, s => getCreativesReport(s, range, { storeNames: ctx.storeNames, now }))
      guard(r.ok.length)
      const cfg = new Map(r.ok.map(l => [l.store.id, l.value.configured]))
      return { section: 'criativos', ...base(s => cfg.get(s.id) ?? null, r.ok.map(l => l.store), r.failed), ...mergeCreatives(r.ok) }
    }
    case 'produtos': {
      const r = await perStore(stores, s => getProductReport(s, range))
      guard(r.ok.length)
      const cfg = new Map(r.ok.map(l => [l.store.id, l.value.configured]))
      return { section: 'produtos', ...base(s => cfg.get(s.id) ?? null, r.ok.map(l => l.store), r.failed), ...mergeProducts(r.ok) }
    }
    case 'paises': {
      // Every country per store (250 is the module's cap), merged and cut once.
      const r = await perStore(stores, s => getCountryReport(s, range, { limit: 250 }))
      guard(r.ok.length)
      const cfg = new Map(r.ok.map(l => [l.store.id, l.value.configured]))
      return { section: 'paises', ...base(s => cfg.get(s.id) ?? null, r.ok.map(l => l.store), r.failed), ...mergeCountries(r.ok) }
    }
    case 'clientes': {
      const [splits, ltvs] = await Promise.all([
        perStore(stores, s => getCustomerSplit(s, range)),
        perStore(stores, s => getCustomerLtv(s), 2),
      ])
      guard(splits.ok.length)
      // The lifetime block is context: it is shown only when every store answered.
      const ltvComplete = ltvs.failed.length === 0 ? ltvs.ok : null
      return { section: 'clientes', ...base(() => null, splits.ok.map(l => l.store), splits.failed), ...mergeCustomers(splits.ok, ltvComplete) }
    }
  }
}

// Identical requests in flight share one computation (a tab reopened while
// its first answer is still being built, two devices at once).
const inflight = new Map<string, Promise<MobileDetailResponse>>()

export function mobileDetailOnce(
  q: DetailQuery & { storeKey: string }, stores: readonly StoreRef[], ctx: DetailContext = {},
): Promise<MobileDetailResponse> {
  const k = `${q.section}|${q.storeKey}|${q.period}|${q.from ?? ''}|${q.to ?? ''}`
  const hit = inflight.get(k)
  if (hit) return hit
  const p = buildMobileDetail(q, stores, ctx).finally(() => inflight.delete(k))
  inflight.set(k, p)
  return p
}
