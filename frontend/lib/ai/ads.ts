import {
  ORPHAN_CAMPAIGN_NAME, loadAdDayFacts, loadAdInfo, loadCampaignJourneyStores, sharedAccountFlag,
  type AdDayFact,
} from '@/lib/data/meta'
import { creativeVerdict, type Signal } from '@/lib/creativeSignal'
import {
  DEFAULT_THRESHOLDS, decideCampaign, estimateProfit, isRunning,
  type CampaignAction, type ScaleThresholds, type TrendArrow,
} from '@/lib/campaignSignal'
import { computeStorePnL, daysBetween, shiftDate, todayInTz, type DateRange } from '@/lib/engine'
import { DECISION_DAYS, decisionWindowOn } from '@/lib/period/decision'
import { r2, safeDiv } from './format'

/**
 * Ad and campaign numbers for the model, and the verdicts on them.
 *
 * The facts are lib/data/meta's single read of fb_ad_daily_metrics (every row,
 * phantom purchases removed), so the ads of a window add up to the Meta spend
 * the profit engine charges the store. The verdicts are the app's own:
 * creativeVerdict for an ad, decideCampaign for a campaign, both against the
 * engine's contribution break-even. The model explains them; it never gets to
 * invent its own thresholds, and it never sees a "top by score" list that
 * cannot contain a losing ad (the old prompt's kill card had nothing to kill).
 *
 * Frequency and hook rate are deliberately absent: the stored reach is daily
 * and the stored plays count autoplay, so neither can be computed (see the
 * header of lib/creativeSignal.ts).
 *
 * Shared ad accounts follow the screens' rule (sharedAccountFlag over our own
 * journey data): a campaign whose tracked orders land in another store gets no
 * verdict and no estimated profit, and a store's own campaign in a shared
 * account is judged normally. Checking only "ran in a shared account" got both
 * wrong: CAMP HALLOW's campaign in EPOCH's old account (338 of 338 tracked
 * orders in CAMP HALLOW) came out as "escalar" for EPOCH, while EPOCH's own
 * campaigns there were told their sales may be someone else's.
 */

// ─── Aggregation ──────────────────────────────────────────────────────────────

export interface AdAggregate {
  adId: string
  name: string
  /** False when the catalog has spend for this ad but no description yet. */
  known: boolean
  campaignId: string | null
  campaignName: string | null
  adsetName: string | null
  /** The campaign's ad account, else the row's own. */
  accountId: string | null
  /** Set when the ad's campaign is another store's (sharedAccountFlag): the
   *  sentence that replaces a verdict. */
  sharedNote: string | null
  /** The ad's, its ad set's and its campaign's status as set in Ads Manager. */
  status: string | null
  adsetStatus: string | null
  campaignStatus: string | null
  createdDay: string | null
  spend: number
  purchaseValue: number
  purchases: number
  /** Meta purchase value dropped as phantom (ad-days above $20,000). */
  phantomValue: number
  phantomDays: number
  impressions: number
  linkClicks: number
  daysWithSpend: number
  firstSpendDay: string | null
  lastSpendDay: string | null
}

export interface AdData {
  storeId: string
  range: DateRange
  /** Every ad-day loaded, possibly starting before `range` (see loadAdData). */
  facts: AdDayFact[]
  /** Ads with spend or purchase value inside `range`. */
  ads: AdAggregate[]
  /** Tracked orders per store for each campaign, all time (where its sales landed). */
  journeys: ReadonlyMap<string, ReadonlyMap<string, number>>
}

/** The screens' shared-account sentence for a campaign, or null when its sales
 *  are this store's. No store names: "outra loja" is enough for the model, and
 *  nothing about a store the viewer may not see can leak. */
export function sharedNoteOf(
  data: Pick<AdData, 'storeId' | 'journeys'>, campaignId: string | null, accountId: string | null,
): string | null {
  return sharedAccountFlag(data.storeId, accountId, campaignId ? data.journeys.get(campaignId) : undefined)?.note ?? null
}

/** The store-calendar day of a timestamptz rendered as text by Postgres
 *  ("2026-10-28 02:10:00+00"); the UTC date when it cannot be parsed. */
export function localDay(pgTimestamp: string, tz: string): string {
  const d = new Date(pgTimestamp.replace(' ', 'T').replace(/([+-]\d\d)$/, '$1:00'))
  return Number.isNaN(d.getTime()) ? pgTimestamp.slice(0, 10) : todayInTz(tz, d)
}

/**
 * Ads of a store over `range`. `extraDaysBefore` loads that many earlier days
 * as well, for the campaign trend; they never enter the ad totals. `tz` is the
 * store's timezone, for the day an ad was created.
 */
export async function loadAdData(storeId: string, range: DateRange, tz: string, extraDaysBefore = 0): Promise<AdData> {
  const loadFrom = extraDaysBefore > 0 ? shiftDate(range.from, -extraDaysBefore) : range.from
  const facts = await loadAdDayFacts(storeId, { from: loadFrom, to: range.to })
  const inRange = facts.filter(f => f.date >= range.from && f.date <= range.to)

  const byAd = new Map<string, AdAggregate>()
  for (const f of inRange) {
    const a = byAd.get(f.adId) ?? {
      adId: f.adId, name: f.adId, known: false, campaignId: f.campaignId, campaignName: null, adsetName: null,
      accountId: f.accountId, sharedNote: null, status: null, adsetStatus: null, campaignStatus: null, createdDay: null,
      spend: 0, purchaseValue: 0, purchases: 0, phantomValue: 0, phantomDays: 0, impressions: 0, linkClicks: 0,
      daysWithSpend: 0, firstSpendDay: null, lastSpendDay: null,
    }
    a.spend += f.spend
    a.purchaseValue += f.purchaseValue
    a.purchases += f.purchases
    a.phantomValue += f.phantomValue
    if (f.phantomValue > 0) a.phantomDays += 1
    a.impressions += f.impressions
    a.linkClicks += f.linkClicks
    if (f.spend > 0) {
      a.daysWithSpend += 1
      if (!a.firstSpendDay || f.date < a.firstSpendDay) a.firstSpendDay = f.date
      if (!a.lastSpendDay || f.date > a.lastSpendDay) a.lastSpendDay = f.date
    }
    byAd.set(f.adId, a)
  }
  const ads = [...byAd.values()].filter(a => a.spend > 0 || a.purchaseValue > 0)
  const ids = ads.map(a => a.adId)
  const campaignIds = [...new Set(facts.map(f => f.campaignId).filter((x): x is string => !!x))]
  const [info, journeys] = await Promise.all([loadAdInfo(ids), loadCampaignJourneyStores(campaignIds)])
  const data: AdData = { storeId, range, facts, ads, journeys }
  for (const a of ads) {
    const i = info.get(a.adId)
    if (i) {
      a.name = i.name
      a.known = i.known
      a.campaignId = i.campaignId ?? a.campaignId
      a.campaignName = i.campaignName
      a.adsetName = i.adsetName
      a.campaignStatus = i.campaignStatus
      a.adsetStatus = i.adsetStatus
      a.status = i.status
      a.accountId = i.campaignAccountId ?? a.accountId
      a.createdDay = i.createdTime ? localDay(i.createdTime, tz) : null
    }
    a.sharedNote = sharedNoteOf(data, a.campaignId, a.accountId)
  }
  return data
}

// ─── Ads ──────────────────────────────────────────────────────────────────────

export type RunState = 'ativo' | 'pausado' | 'desconhecido'

const isActive = (s: string | null) => s === null || s.toUpperCase() === 'ACTIVE'

/** Is the ad delivering? The creatives screen's rule (lib/data/creatives
 *  adRunning), so a verdict here is the badge there: ad, ad set and campaign
 *  active; an ad the catalog does not know is judged by whether it spent on
 *  the last day of the window. (fb_ads.effective_status is not used: it goes
 *  stale and kept 39 paused Hibikura ads "ativo" with a verdict.) */
export function adRunning(
  a: Pick<AdAggregate, 'known' | 'status' | 'adsetStatus' | 'campaignStatus' | 'lastSpendDay'>, windowEnd: string,
): boolean {
  if (!a.known || a.status === null) return a.lastSpendDay === windowEnd
  return a.status.toUpperCase() === 'ACTIVE' && isActive(a.adsetStatus) && isActive(a.campaignStatus)
}

function runState(a: AdAggregate, windowEnd: string): RunState {
  if (!a.known || a.status === null) return 'desconhecido'
  return adRunning(a, windowEnd) ? 'ativo' : 'pausado'
}

export interface AdView {
  adId: string
  name: string
  campaign: string | null
  status: RunState
  /** Day the ad was created in Meta, and its spend days inside the window. */
  createdDay: string | null
  daysWithSpend: number
  lastSpendDay: string | null
  spend: number | null
  purchases: number
  purchaseValue: number | null
  metaRoas: number | null
  cpa: number | null
  ctr: number | null
  /** Null: no recommendation (paused, no costs configured, no spend). */
  verdict: Signal | null
  reason: string
}

export function adView(a: AdAggregate, breakEven: number | null, windowEnd: string, costsConfigured?: boolean): AdView {
  const roas = safeDiv(a.purchaseValue, a.spend)
  const v = creativeVerdict({
    spend: a.spend, roas, purchases: a.purchases, breakEven, costsConfigured,
    // Never the summed daily reach: see the header.
    frequency: null,
    running: adRunning(a, windowEnd),
    sharedNote: a.sharedNote,
  })
  return {
    adId: a.adId, name: a.name, campaign: a.campaignName, status: runState(a, windowEnd),
    createdDay: a.createdDay, daysWithSpend: a.daysWithSpend, lastSpendDay: a.lastSpendDay,
    spend: r2(a.spend), purchases: Math.round(a.purchases), purchaseValue: r2(a.purchaseValue),
    metaRoas: r2(roas), cpa: r2(safeDiv(a.spend, a.purchases)),
    ctr: r2(a.impressions > 0 ? (a.linkClicks / a.impressions) * 100 : null),
    verdict: v.signal, reason: v.reason,
  }
}

export interface AdTotals {
  adsWithSpend: number
  spend: number | null
  purchaseValue: number | null
  purchases: number
  metaRoas: number | null
  /** Ad-days whose purchase value was dropped as phantom (> $20,000). */
  phantomAdDays: number
  phantomValueDropped: number | null
}

export function adTotals(ads: AdAggregate[]): AdTotals {
  const spend = ads.reduce((s, a) => s + a.spend, 0)
  const pv = ads.reduce((s, a) => s + a.purchaseValue, 0)
  return {
    adsWithSpend: ads.filter(a => a.spend > 0).length,
    spend: r2(spend), purchaseValue: r2(pv),
    purchases: Math.round(ads.reduce((s, a) => s + a.purchases, 0)),
    metaRoas: r2(safeDiv(pv, spend)),
    phantomAdDays: ads.reduce((s, a) => s + a.phantomDays, 0),
    phantomValueDropped: r2(ads.reduce((s, a) => s + a.phantomValue, 0)),
  }
}

/** What a list left out, summed, so a partial list is never read as a total. */
export interface Omitted { count: number; spend: number | null; purchaseValue: number | null }

function omittedOf(rest: { spend: number | null; purchaseValue: number | null }[]): Omitted {
  return {
    count: rest.length,
    spend: r2(rest.reduce((s, a) => s + (a.spend ?? 0), 0)),
    purchaseValue: r2(rest.reduce((s, a) => s + (a.purchaseValue ?? 0), 0)),
  }
}

export type VerdictCounts = Record<Signal | 'none', number>

export interface AdLists {
  breakEven: number | null
  totals: AdTotals
  verdictCounts: VerdictCounts
  /** Every ad with the kill verdict, biggest spend first. */
  kill: AdView[]
  killOmitted: Omitted
  scale: AdView[]
  scaleOmitted: Omitted
  /** Biggest spenders whatever their verdict. */
  topSpend: AdView[]
  topSpendOmitted: Omitted
}

export function adLists(
  ads: AdAggregate[], breakEven: number | null, windowEnd: string,
  limits = { kill: 15, scale: 10, top: 10 }, costsConfigured?: boolean,
): AdLists {
  const views = ads.filter(a => a.spend > 0).map(a => adView(a, breakEven, windowEnd, costsConfigured))
    .sort((a, b) => (b.spend ?? 0) - (a.spend ?? 0))
  const kill = views.filter(v => v.verdict === 'kill')
  const scale = views.filter(v => v.verdict === 'scale')
  const counts: VerdictCounts = { kill: 0, scale: 0, refresh: 0, ok: 0, none: 0 }
  for (const v of views) counts[v.verdict ?? 'none']++
  return {
    breakEven,
    totals: adTotals(ads),
    verdictCounts: counts,
    kill: kill.slice(0, limits.kill), killOmitted: omittedOf(kill.slice(limits.kill)),
    scale: scale.slice(0, limits.scale), scaleOmitted: omittedOf(scale.slice(limits.scale)),
    topSpend: views.slice(0, limits.top), topSpendOmitted: omittedOf(views.slice(limits.top)),
  }
}

// ─── Campaigns ────────────────────────────────────────────────────────────────

/** The days a campaign is judged on (R12): lib/period decisionWindow, the
 *  last 7 closed days on the store's clock — the days Campanhas and the scale
 *  push judge, whatever window the conversation or the insights card reads.
 *  It is never clipped to that window (Mês passado judged 25–31 out while
 *  Campanhas judged 17–23 nov; a 3-day window gave a 3-day "decision"). */
export function judgedDays(storeToday: string, days = DECISION_DAYS): { window: DateRange; previous: DateRange } {
  return decisionWindowOn(storeToday, days)
}

export interface CampaignView {
  campaignId: string | null
  name: string
  status: RunState
  ads: number
  spend: number | null
  purchaseValue: number | null
  purchases: number
  metaRoas: number | null
  cpa: number | null
  /** Meta purchase value × store contribution rate − Meta spend, over the
   *  window. Meta's attribution: Shopify orders carry no campaign. */
  estimatedProfit: number | null
  /** The campaign screens' verdict, over `decision.window`. */
  decision: {
    window: DateRange
    action: CampaignAction | null
    reason: string
    trend: TrendArrow | null
  } | null
  /** Set when the campaign's sales land in another store (screens' rule): no
   *  verdict and no estimated profit then. */
  sharedAccount: string | null
}

export interface CampaignList {
  totalCampaigns: number
  rows: CampaignView[]
  omitted: Omitted
}

/**
 * What the campaign screens judge with, for the judged window of `range`: the
 * engine's contribution rate over those same closed days (not over the whole
 * window) and the owner's scale threshold from the alert settings — so the
 * AI's "escalar" is the badge the screen and the push alert show.
 */
export interface DecisionBasis {
  /** lib/period decisionWindow (R12); null for an archived store (R10: no
   *  decision block). */
  window: DateRange | null
  previous: DateRange | null
  /** Ad-day facts of previous + window, by campaign: the judged days are not
   *  the window's, so they are loaded on their own. */
  facts: AdDayFact[]
  contributionRate: number | null
  costsConfigured: boolean
  thresholds: ScaleThresholds
}

export async function loadDecisionBasis(
  storeId: string, storeToday: string, now?: Date, opts: { archived?: boolean } = {},
): Promise<DecisionBasis> {
  // Loaded lazily: lib/alerts pulls in web-push, which nothing else here needs.
  const { getAlertConfig } = await import('@/lib/alerts')
  const thresholds: ScaleThresholds = { ...DEFAULT_THRESHOLDS, minMargin: (await getAlertConfig()).scaleAlerts.threshold }
  if (opts.archived) return { window: null, previous: null, facts: [], contributionRate: null, costsConfigured: false, thresholds }
  const { window, previous } = judgedDays(storeToday, thresholds.windowDays)
  const [p, facts] = await Promise.all([
    computeStorePnL(storeId, window, {}, now),
    loadAdDayFacts(storeId, { from: previous.from, to: window.to }),
  ])
  const configured = !!p?.configured
  return {
    window, previous, facts, thresholds, costsConfigured: configured,
    contributionRate: p ? contributionRateOf(configured, p.totals.revenue, p.totals.contribution) : null,
  }
}

export function campaignViews(
  data: AdData,
  opts: {
    /** Window rate, for the estimated profit over the whole window. */
    contributionRate: number | null
    storeToday: string
    limit: number
    /** The screens' verdict basis; without it the window rate and default
     *  thresholds are used (tests). */
    decision?: DecisionBasis
  },
): CampaignList {
  const { range } = data
  const basis = opts.decision
  const judged = basis ? basis.window : judgedDays(opts.storeToday).window
  // The judged days' facts by campaign (they lie outside the window when it
  // is closed, e.g. Mês passado); without a basis (tests), the window's.
  const decisionFacts = new Map<string, AdDayFact[]>()
  for (const f of basis ? basis.facts : data.facts) {
    const key = f.campaignId ?? '__unsynced__'
    const list = decisionFacts.get(key) ?? []
    list.push(f)
    decisionFacts.set(key, list)
  }
  const groups = new Map<string, { campaignId: string | null; facts: AdDayFact[] }>()
  for (const f of data.facts) {
    const key = f.campaignId ?? '__unsynced__'
    const g = groups.get(key) ?? { campaignId: f.campaignId, facts: [] }
    g.facts.push(f)
    groups.set(key, g)
  }
  const adsById = new Map(data.ads.map(a => [a.adId, a]))
  const all: { view: CampaignView; spend: number }[] = []
  for (const g of groups.values()) {
    const inRange = g.facts.filter(f => f.date >= range.from && f.date <= range.to)
    const spend = inRange.reduce((s, f) => s + f.spend, 0)
    const pv = inRange.reduce((s, f) => s + f.purchaseValue, 0)
    if (spend <= 0 && pv <= 0) continue
    const purchases = inRange.reduce((s, f) => s + f.purchases, 0)
    const adIds = new Set(inRange.filter(f => f.spend > 0).map(f => f.adId))
    const sample = [...adIds].map(id => adsById.get(id)).find(Boolean)
    const name = g.campaignId === null ? ORPHAN_CAMPAIGN_NAME : sample?.campaignName ?? `Campanha ${g.campaignId}`
    const sharedAccount = sharedNoteOf(data, g.campaignId, sample?.accountId ?? g.facts[0]?.accountId ?? null)
    const campaignStatus = sample?.campaignStatus ?? null
    const lastDay = inRange.filter(f => f.spend > 0).reduce<string | null>((m, f) => (!m || f.date > m ? f.date : m), null)
    const running = campaignStatus ? isRunning(campaignStatus, lastDay === range.to) : lastDay === range.to

    let decision: CampaignView['decision'] = null
    if (judged) {
      const n = daysBetween(judged.from, judged.to)
      const d = decideCampaign({
        days: (decisionFacts.get(g.campaignId ?? '__unsynced__') ?? []).map(f => ({ date: f.date, spend: f.spend, revenue: f.purchaseValue, purchases: f.purchases })),
        window: judged,
        previous: { from: shiftDate(judged.from, -n), to: shiftDate(judged.from, -1) },
        contributionRate: basis ? basis.contributionRate : opts.contributionRate,
        ...(basis ? { costsConfigured: basis.costsConfigured, thresholds: basis.thresholds } : {}),
        status: campaignStatus,
        sharedAccount,
        unsynced: g.campaignId === null,
      })
      decision = { window: judged, action: d.action, reason: d.reason, trend: d.trend }
    }
    all.push({ spend, view: {
      campaignId: g.campaignId, name,
      status: campaignStatus || lastDay ? (running ? 'ativo' : 'pausado') : 'desconhecido',
      ads: adIds.size, spend: r2(spend), purchaseValue: r2(pv), purchases: Math.round(purchases),
      metaRoas: r2(safeDiv(pv, spend)), cpa: r2(safeDiv(spend, purchases)),
      // Never priced with this store's margin when the sales are another store's.
      estimatedProfit: opts.contributionRate === null || sharedAccount ? null : r2(estimateProfit(pv, spend, opts.contributionRate)),
      decision, sharedAccount,
    } })
  }
  all.sort((a, b) => b.spend - a.spend)
  const rows = all.slice(0, opts.limit).map(x => x.view)
  return { totalCampaigns: all.length, rows, omitted: omittedOf(all.slice(opts.limit).map(x => x.view)) }
}

/** Contribution ÷ revenue for the window, the rate campaign profit is
 *  estimated with; null without cost settings or revenue. */
export function contributionRateOf(configured: boolean, revenue: number, contribution: number): number | null {
  return configured && revenue > 0 ? contribution / revenue : null
}
