/**
 * Campaigns of one store: money over a window, and what to do with each one.
 *
 * Replaces queries.getCampaignMetrics / getCampaignDaily / getAdsetMetrics,
 * scaleSignals' own SQL and the inline SQL of /api/profit/campaigns. Each of
 * those lost money differently (INNER JOIN on fb_ads, no phantom filter, a
 * margin with Shop Campaigns in it). Everything here is built from one fact
 * read (lib/data/meta.ts), so:
 *
 *   Σ campaign spend = the Meta spend the engine charges the store
 *
 * for the same dates — the report carries that check (`reconciliation`).
 *
 * Estimated profit of a campaign (ESTIMATED_PROFIT_FORMULA):
 *
 *   Meta purchase value × store contribution rate − Meta spend
 *
 * where the contribution rate is the engine's contribution ÷ revenue for the
 * same window. Meta's attribution, because Shopify orders carry no campaign;
 * the report states how far Meta's total sits from the store's real revenue.
 *
 * The action (Escalar / Manter / Cortar / Observar) is decided by
 * campaignSignal.decideCampaign over the LAST 7 CLOSED DAYS in the store's
 * timezone, whatever window the money columns show: it is advice about now.
 */

import {
  decideCampaign, describeThresholds, actionRank, estimateProfit, marginPct,
  DEFAULT_THRESHOLDS,
  type CampaignAction, type CampaignDecision, type DecisionDay, type ScaleThresholds,
} from '../campaignSignal'
import { eachDay, shiftDate, todayInTz, type DateRange, type Period } from '../engine/dates'
import {
  inRange, loadAdInfo, loadCampaignInfo, loadCampaignJourneyStores, loadCampaignsBilledElsewhere,
  loadFactsCovering, loadFirstTouchOrders, loadStoreMargin, orphanAdName, reconcile, round2,
  sharedAccountFlag, ORPHAN_CAMPAIGN_NAME,
  type AdDayFact, type CampaignBilledElsewhere, type CampaignInfo, type SharedAccountFlag,
  type SpendReconciliation, type StoreMargin, type StoreTz,
} from './meta'
import type { CreativeNotes, CreativeRow } from './creatives'

export const ESTIMATED_PROFIT_FORMULA =
  'Lucro estimado = receita atribuída pelo Meta × margem de contribuição da loja − gasto no Meta. ' +
  'A margem de contribuição é o que sobra de cada venda depois de produto, fornecedor, embalagem, frete, ' +
  'taxas da Shopify e do pagamento (no mesmo período, pelo motor de lucro). Anúncios da Shopify e custos ' +
  'fixos não entram: não crescem com o gasto no Meta.'

// ─── Windows ──────────────────────────────────────────────────────────────────

/** The judged window (the last `days` closed days in `tz`) and the one before. */
export function decisionWindows(tz: string, now: Date = new Date(), days = DEFAULT_THRESHOLDS.windowDays): {
  window: DateRange; previous: DateRange
} {
  const to = shiftDate(todayInTz(tz, now), -1)
  const window = { from: shiftDate(to, -(days - 1)), to }
  return { window, previous: { from: shiftDate(window.from, -days), to: shiftDate(window.from, -1) } }
}

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CampaignDayPoint {
  date: string
  spend: number
  purchaseValue: number
  purchases: number
  /** Null on a day with neither spend nor sales, and on rows not priced with
   *  this store's margin. Days add up to the row's estimatedProfit. */
  estimatedProfit: number | null
}

export interface MetaTotals {
  spend: number
  /** Meta purchase value, phantom ad-days removed. */
  purchaseValue: number
  purchases: number
  impressions: number
  linkClicks: number
  roas: number | null
  cpa: number | null
  /** Link clicks ÷ impressions, %. */
  ctr: number | null
  cpm: number | null
  cpc: number | null
  aov: number | null
}

export interface CampaignRow extends MetaTotals {
  /** Null for the row of ads the sync has not described yet. */
  campaignId: string | null
  name: string
  /** fb_campaigns.status as set in Ads Manager; null when unknown. */
  status: string | null
  /** Running on the last day of the decision window (status, or spend when
   *  the status is unknown). Paused campaigns never get an action. */
  running: boolean
  objective: string | null
  accountId: string | null
  /** True for the "Anúncios ainda não sincronizados" row. */
  unsynced: boolean
  /** The ads of the unsynced row ("Anúncio sem nome (id …)"), biggest first. */
  unsyncedAds: { adId: string; name: string; spend: number }[]
  /** Set when the campaign's sales may belong to another store: no margin,
   *  no estimated profit, no action. Its spend still counts in the totals —
   *  it is in this store's books. */
  shared: SharedAccountFlag | null
  ads: number
  adsets: number
  /** Window: Meta purchase value × contribution rate − spend; null without
   *  cost settings, without store revenue, or for shared rows. */
  estimatedProfit: number | null
  /** estimatedProfit ÷ purchaseValue, %. */
  margin: number | null
  /** Orders of this store whose first tracked touch was this campaign, on the
   *  window's dates. A cross-check of Meta's count (journeys see ~60%). */
  journeyOrders: number
  /** Meta purchase value dropped from this row as phantom ad-days. */
  phantomValueDropped: number
  /** Every date of the window, empty days included. */
  days: CampaignDayPoint[]
  /** The action, over the decision window (last 7 closed days). */
  decision: CampaignDecision
}

export interface CampaignTotals {
  spend: number
  purchaseValue: number
  purchases: number
  roas: number | null
  /** Sum over rows priced with the store's margin; null without one. */
  estimatedProfit: number | null
  /** Spend of rows not priced (shared accounts): in the books, not in the
   *  estimated profit above. */
  unpricedSpend: number
  campaigns: number
  actions: Record<CampaignAction, number>
  trends: { melhorando: number; piorando: number }
}

export interface BilledElsewhereRow extends CampaignBilledElsewhere {
  billedStoreName: string
}

export interface CampaignReport {
  storeId: string
  timezone: string
  /** The money window. */
  range: DateRange
  /** The window includes the store's current day (still running). */
  partial: boolean
  configured: boolean
  /** Engine contribution ÷ revenue for the money window (0..1, may be ≤ 0). */
  contributionRate: number | null
  /** The same in %, for display. */
  contributionMargin: number | null
  /** Engine break-even ROAS (revenue ÷ contribution) for the money window. */
  breakEvenRoas: number | null
  /** What the action is judged on: the last 7 closed days, and the 7 before
   *  for the trend arrow. */
  decisionWindow: DateRange
  previousWindow: DateRange
  decisionContributionRate: number | null
  decisionBreakEvenRoas: number | null
  thresholds: ScaleThresholds
  /** Each action's rule in plain words, for a legend. */
  rules: Record<CampaignAction, string>
  formula: string
  campaigns: CampaignRow[]
  totals: CampaignTotals
  reconciliation: SpendReconciliation
  storeRevenue: number
  /** (Meta purchase value − store revenue) ÷ store revenue, %, over the rows
   *  whose sales are this store's (shared-account rows left out: their sales
   *  landed in another shop, so counting them made EPOCH's October read +75%
   *  when its own campaigns claimed 19% LESS than the store took in).
   *  Positive: Meta claims more than the store took in, and every priced row
   *  is optimistic. Null without store revenue or without own Meta spend. */
  metaVsStoreRevenueGap: number | null
  /** Campaigns whose orders land here but whose spend is in another store's
   *  books (CAMP HALLOW's ads in EPOCH's account). Information only. When
   *  storeNames is given (every route), only rows billed in a store the
   *  viewer may see. */
  billedElsewhere: BilledElsewhereRow[]
}

/** GET /api/campaigns/analysis */
export interface CampaignAnalysisResponse extends CampaignReport {
  storeName: string
  period: Period
}

export interface CampaignReportOptions {
  /** Overrides of the action thresholds; minMargin is the owner's scale
   *  threshold (alert settings). */
  thresholds?: Partial<ScaleThresholds>
  /** Names of the stores the viewer can see, to say where a shared campaign's
   *  orders went. Stores not in the map read "outra loja". */
  storeNames?: ReadonlyMap<string, string>
  now?: Date
}

// ─── Pure building blocks ─────────────────────────────────────────────────────

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null)

interface Acc {
  spend: number; purchaseValue: number; purchases: number; impressions: number; linkClicks: number
  phantom: number
}
const emptyAcc = (): Acc => ({ spend: 0, purchaseValue: 0, purchases: 0, impressions: 0, linkClicks: 0, phantom: 0 })
function add(a: Acc, f: AdDayFact) {
  a.spend += f.spend; a.purchaseValue += f.purchaseValue; a.purchases += f.purchases
  a.impressions += f.impressions; a.linkClicks += f.linkClicks; a.phantom += f.phantomValue
}

export function metaTotals(a: Pick<Acc, 'spend' | 'purchaseValue' | 'purchases' | 'impressions' | 'linkClicks'>): MetaTotals {
  return {
    spend: round2(a.spend), purchaseValue: round2(a.purchaseValue), purchases: a.purchases,
    impressions: a.impressions, linkClicks: a.linkClicks,
    roas: ratio(a.purchaseValue, a.spend),
    cpa: ratio(a.spend, a.purchases),
    ctr: a.impressions > 0 ? (a.linkClicks / a.impressions) * 100 : null,
    cpm: a.impressions > 0 ? (a.spend / a.impressions) * 1000 : null,
    cpc: ratio(a.spend, a.linkClicks),
    aov: ratio(a.purchaseValue, a.purchases),
  }
}

/** Facts of ads the catalog does not know have no campaign; they are grouped
 *  per ad account so a shared account's orphans are not priced as ours. */
const UNSYNCED_KEY = 'unsynced:'
export const groupKey = (f: AdDayFact) => f.campaignId ?? `${UNSYNCED_KEY}${f.accountId ?? ''}`

export interface BuildCampaignInput {
  storeId: string
  range: DateRange
  decision: { window: DateRange; previous: DateRange }
  /** Facts covering `range` and the decision windows (any extra dates ignored). */
  facts: AdDayFact[]
  campaigns: ReadonlyMap<string, CampaignInfo>
  /** Unsynced ads' names when known (fb_ads may gain the row mid-request). */
  adNames?: ReadonlyMap<string, string>
  journeys: ReadonlyMap<string, ReadonlyMap<string, number>>
  firstTouch: ReadonlyMap<string, number>
  margin: Pick<StoreMargin, 'configured' | 'contributionRate'>
  decisionMargin: Pick<StoreMargin, 'configured' | 'contributionRate'>
  thresholds: ScaleThresholds
  storeNames?: ReadonlyMap<string, string>
}

/**
 * One row per campaign with spend or sales in the window, plus one row per
 * account for spend of ads not yet described by the sync. No database.
 */
export function buildCampaignRows(input: BuildCampaignInput): CampaignRow[] {
  const { range, decision } = input
  const decisionSpan = { from: decision.previous.from, to: decision.window.to }
  const dates = eachDay(range.from, range.to)

  interface Group {
    key: string; campaignId: string | null; accountId: string | null
    win: Acc; byDate: Map<string, Acc>; decisionDays: Map<string, DecisionDay>
    ads: Set<string>; adsets: Set<string>; adSpend: Map<string, number>
  }
  const groups = new Map<string, Group>()
  const group = (f: AdDayFact): Group => {
    const key = groupKey(f)
    let g = groups.get(key)
    if (!g) {
      g = {
        key, campaignId: f.campaignId, accountId: f.accountId, win: emptyAcc(), byDate: new Map(),
        decisionDays: new Map(), ads: new Set(), adsets: new Set(), adSpend: new Map(),
      }
      groups.set(key, g)
    }
    return g
  }

  for (const f of input.facts) {
    const inWin = inRange(f.date, range)
    const inDecision = inRange(f.date, decisionSpan)
    if (!inWin && !inDecision) continue
    const g = group(f)
    if (inWin) {
      add(g.win, f)
      const d = g.byDate.get(f.date) ?? emptyAcc()
      add(d, f)
      g.byDate.set(f.date, d)
      if (f.spend > 0) { g.ads.add(f.adId); if (f.adsetId) g.adsets.add(f.adsetId) }
      g.adSpend.set(f.adId, (g.adSpend.get(f.adId) ?? 0) + f.spend)
    }
    if (inDecision) {
      const d = g.decisionDays.get(f.date) ?? { date: f.date, spend: 0, revenue: 0, purchases: 0 }
      d.spend += f.spend; d.revenue += f.purchaseValue; d.purchases += f.purchases
      g.decisionDays.set(f.date, d)
    }
  }

  const rows: CampaignRow[] = []
  for (const g of groups.values()) {
    if (!(g.win.spend > 0 || g.win.purchases > 0 || g.win.purchaseValue > 0)) continue
    const unsynced = g.campaignId === null
    const info = g.campaignId ? input.campaigns.get(g.campaignId) : undefined
    const accountId = info?.accountId ?? g.accountId
    const shared = sharedAccountFlag(
      input.storeId, accountId, g.campaignId ? input.journeys.get(g.campaignId) : undefined, input.storeNames,
    )
    const rate = input.margin.configured && !shared ? input.margin.contributionRate : null

    const decisionResult = decideCampaign({
      days: [...g.decisionDays.values()],
      window: decision.window,
      previous: decision.previous,
      contributionRate: input.decisionMargin.contributionRate,
      costsConfigured: input.decisionMargin.configured,
      status: info?.status ?? null,
      sharedAccount: shared?.note ?? null,
      unsynced,
      thresholds: input.thresholds,
    })

    const days: CampaignDayPoint[] = dates.map(date => {
      const d = g.byDate.get(date) ?? emptyAcc()
      const active = d.spend > 0 || d.purchaseValue > 0
      return {
        date, spend: round2(d.spend), purchaseValue: round2(d.purchaseValue), purchases: d.purchases,
        estimatedProfit: rate !== null && active ? round2(estimateProfit(d.purchaseValue, d.spend, rate)) : null,
      }
    })

    rows.push({
      ...metaTotals(g.win),
      campaignId: g.campaignId,
      name: unsynced ? ORPHAN_CAMPAIGN_NAME : info?.name ?? `Campanha ${g.campaignId}`,
      status: info?.status ?? null,
      running: decisionResult.running,
      objective: info?.objective ?? null,
      accountId,
      unsynced,
      unsyncedAds: unsynced
        ? [...g.adSpend.entries()].sort((a, b) => b[1] - a[1])
            .map(([adId, spend]) => ({ adId, name: input.adNames?.get(adId) ?? orphanAdName(adId), spend: round2(spend) }))
        : [],
      shared,
      ads: g.ads.size,
      adsets: g.adsets.size,
      estimatedProfit: rate !== null ? round2(estimateProfit(g.win.purchaseValue, g.win.spend, rate)) : null,
      margin: rate !== null ? marginPct(g.win.purchaseValue, g.win.spend, rate) : null,
      journeyOrders: g.campaignId ? input.firstTouch.get(g.campaignId) ?? 0 : 0,
      phantomValueDropped: round2(g.win.phantom),
      days,
      decision: decisionResult,
    })
  }

  // Money burning first, then room to grow; inside each, the biggest spend.
  return rows.sort((a, b) =>
    actionRank(a.decision.action) - actionRank(b.decision.action) || b.spend - a.spend)
}

export function campaignTotals(rows: CampaignRow[], configured: boolean): CampaignTotals {
  const actions: Record<CampaignAction, number> = { escalar: 0, manter: 0, cortar: 0, observar: 0 }
  const trends = { melhorando: 0, piorando: 0 }
  let spend = 0, pv = 0, purchases = 0, profit = 0, unpriced = 0, priced = 0
  for (const r of rows) {
    spend += r.spend; pv += r.purchaseValue; purchases += r.purchases
    if (r.estimatedProfit !== null) { profit += r.estimatedProfit; priced++ } else if (r.shared) unpriced += r.spend
    if (r.decision.action) actions[r.decision.action]++
    if (r.decision.trend === 'melhorando') trends.melhorando++
    if (r.decision.trend === 'piorando') trends.piorando++
  }
  return {
    spend: round2(spend), purchaseValue: round2(pv), purchases, roas: ratio(pv, spend),
    estimatedProfit: configured && priced > 0 ? round2(profit) : null,
    unpricedSpend: round2(unpriced),
    campaigns: rows.filter(r => !r.unsynced).length,
    actions, trends,
  }
}

// ─── Loading ──────────────────────────────────────────────────────────────────

/**
 * Every campaign of a store with spend or sales in `range`, from every ad
 * account whose metrics the store holds, priced with the engine's margin for
 * the same window and judged on the last 7 closed days.
 */
export async function getCampaignReport(
  store: StoreTz, range: DateRange, opts: CampaignReportOptions = {},
): Promise<CampaignReport> {
  const now = opts.now ?? new Date()
  const thresholds: ScaleThresholds = { ...DEFAULT_THRESHOLDS, ...(opts.thresholds ?? {}) }
  const decision = decisionWindows(store.timezone, now, thresholds.windowDays)
  const sameAsDecision = range.from === decision.window.from && range.to === decision.window.to

  const [facts, margin, decisionMarginOrNull, firstTouch, elsewhere] = await Promise.all([
    loadFactsCovering(store.id, [range, { from: decision.previous.from, to: decision.window.to }]),
    loadStoreMargin(store.id, range, now),
    sameAsDecision ? Promise.resolve(null) : loadStoreMargin(store.id, decision.window, now),
    loadFirstTouchOrders(store.id, range),
    loadCampaignsBilledElsewhere(store.id, range),
  ])
  const decisionMargin = decisionMarginOrNull ?? margin

  const windowFacts = facts.filter(f => inRange(f.date, range))
  const campaignIds = [...new Set(facts.map(f => f.campaignId).filter((x): x is string => !!x))]
  const orphanIds = [...new Set(windowFacts.filter(f => !f.campaignId).map(f => f.adId))]
  const [campaigns, journeys, orphanInfo] = await Promise.all([
    loadCampaignInfo(campaignIds),
    loadCampaignJourneyStores(campaignIds),
    loadAdInfo(orphanIds),
  ])

  const rows = buildCampaignRows({
    storeId: store.id, range, decision, facts, campaigns, journeys, firstTouch,
    adNames: new Map([...orphanInfo.values()].map(i => [i.adId, i.name])),
    margin, decisionMargin, thresholds, storeNames: opts.storeNames,
  })
  const totals = campaignTotals(rows, margin.configured)
  const own = rows.filter(r => !r.shared)
  const ownPurchaseValue = own.reduce((s, r) => s + r.purchaseValue, 0)
  const ownSpend = own.reduce((s, r) => s + r.spend, 0)
  // A campaign billed in another store's books is that store's data: list it
  // only to a viewer who may see that store (partner isolation).
  const visible = opts.storeNames
  const visibleElsewhere = visible ? elsewhere.filter(e => visible.has(e.billedStoreId)) : elsewhere

  return {
    storeId: store.id,
    timezone: store.timezone,
    range,
    partial: margin.partial,
    configured: margin.configured,
    contributionRate: margin.contributionRate,
    contributionMargin: margin.contributionRate !== null ? margin.contributionRate * 100 : null,
    breakEvenRoas: margin.breakEvenRoas,
    decisionWindow: decision.window,
    previousWindow: decision.previous,
    decisionContributionRate: decisionMargin.contributionRate,
    decisionBreakEvenRoas: decisionMargin.breakEvenRoas,
    thresholds,
    rules: describeThresholds(thresholds),
    formula: ESTIMATED_PROFIT_FORMULA,
    campaigns: rows,
    totals,
    reconciliation: reconcile(windowFacts, margin.metaSpend),
    storeRevenue: round2(margin.revenue),
    // Without Meta spend of its own there is no attribution to compare: a
    // "−100%" would only say the store sold without ads.
    metaVsStoreRevenueGap: margin.revenue > 0 && ownSpend > 0
      ? ((ownPurchaseValue - margin.revenue) / margin.revenue) * 100
      : null,
    billedElsewhere: visibleElsewhere.map(e => ({ ...e, billedStoreName: opts.storeNames?.get(e.billedStoreId) ?? 'outra loja' })),
  }
}

// ─── Ad sets of one campaign ──────────────────────────────────────────────────

export interface AdsetRow extends MetaTotals {
  /** Null for ads whose ad set is not on record. */
  adsetId: string | null
  name: string
  status: string | null
  ads: number
  estimatedProfit: number | null
  margin: number | null
}

/** GET /api/campaigns/<campaignId>: the ad sets and the ads of one campaign. */
export interface CampaignDetailResponse extends AdsetReport {
  /** The campaign's ads, judged by creativeVerdict, best estimated profit first. */
  ads: CreativeRow[]
  notes: CreativeNotes
}

export interface AdsetReport {
  storeId: string
  campaignId: string
  campaignName: string
  range: DateRange
  configured: boolean
  contributionRate: number | null
  breakEvenRoas: number | null
  shared: SharedAccountFlag | null
  adsets: AdsetRow[]
}

/**
 * The ad sets of one campaign of this store over `range`. Null when the store
 * holds no metrics of that campaign in the window (another store's campaign
 * reads as not found, never as someone else's numbers).
 */
export async function getAdsetReport(
  store: StoreTz, campaignId: string, range: DateRange,
  opts: { storeNames?: ReadonlyMap<string, string>; margin?: StoreMargin; now?: Date } = {},
): Promise<AdsetReport | null> {
  const [facts, margin, campaigns, journeys] = await Promise.all([
    loadFactsCovering(store.id, [range], { campaignId }),
    opts.margin ? Promise.resolve(opts.margin) : loadStoreMargin(store.id, range, opts.now),
    loadCampaignInfo([campaignId]),
    loadCampaignJourneyStores([campaignId]),
  ])
  if (!facts.length) return null
  const info = campaigns.get(campaignId)
  const shared = sharedAccountFlag(store.id, info?.accountId ?? facts[0].accountId, journeys.get(campaignId), opts.storeNames)
  const rate = margin.configured && !shared ? margin.contributionRate : null
  const adInfo = await loadAdInfo([...new Set(facts.map(f => f.adId))])

  const groups = new Map<string, { acc: Acc; ads: Set<string> }>()
  for (const f of facts) {
    const key = f.adsetId ?? ''
    const g = groups.get(key) ?? { acc: emptyAcc(), ads: new Set<string>() }
    add(g.acc, f)
    if (f.spend > 0) g.ads.add(f.adId)
    groups.set(key, g)
  }
  const adsetName = new Map<string, { name: string | null; status: string | null }>()
  for (const i of adInfo.values()) if (i.adsetId) adsetName.set(i.adsetId, { name: i.adsetName, status: i.adsetStatus })

  const adsets: AdsetRow[] = [...groups.entries()].map(([key, g]) => ({
    ...metaTotals(g.acc),
    adsetId: key || null,
    name: key ? adsetName.get(key)?.name ?? `Conjunto ${key}` : 'Conjunto não sincronizado',
    status: key ? adsetName.get(key)?.status ?? null : null,
    ads: g.ads.size,
    estimatedProfit: rate !== null ? round2(estimateProfit(g.acc.purchaseValue, g.acc.spend, rate)) : null,
    margin: rate !== null ? marginPct(g.acc.purchaseValue, g.acc.spend, rate) : null,
  })).sort((a, b) => b.spend - a.spend)

  return {
    storeId: store.id, campaignId, campaignName: info?.name ?? `Campanha ${campaignId}`, range,
    configured: margin.configured, contributionRate: rate, breakEvenRoas: shared ? null : margin.breakEvenRoas,
    shared, adsets,
  }
}
