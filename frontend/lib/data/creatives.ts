/**
 * Ads (creatives) of one store over a window, and the detail of one ad.
 *
 * Replaces queries.getTopCreatives / getCreativeDetail. Same fact read as the
 * campaigns (lib/data/meta.ts): ads the sync has not described are kept under
 * "Anúncio sem nome (id …)", phantom purchases are dropped, and the list adds
 * up to the store's Meta spend for the window.
 *
 * Every ad is judged by creativeSignal.creativeVerdict — the one ad verdict
 * every surface uses — on the window its campaign is judged on: the last 7
 * closed days (lib/data/campaigns decisionWindows), against the engine's
 * contribution break-even of those days, whatever window the screen shows.
 * Judged on the screen's window, "Hoje" told the owner at 16h to switch off
 * the best ad of the week ("Desligar", ROAS 0,00× on a morning Meta had not
 * attributed yet) while its campaign said "Escalar". The figures of a row
 * (spend, ROAS, estimated profit) stay the screen's window; the reason names
 * the 7 days when they differ. Rows are ranked by estimated profit (Meta
 * purchase value × contribution rate − spend), not by "revenue − spend",
 * which ignored every cost of the store.
 *
 * Two metrics are deliberately null (see creativeSignal for the evidence):
 *  - hook rate: needs 3-second views; the collector stores play starts;
 *  - frequency over more than one day: needs the period's unique reach; the
 *    collector stores reach per day, and reach does not add across days.
 */

import {
  creativeVerdict, isVideoAd, signalRank, FREQUENCY_UNAVAILABLE, HOOK_RATE_UNAVAILABLE,
  type CreativeVerdict, type Signal,
} from '../creativeSignal'
import { eachDay, type DateRange } from '../engine/dates'
import { DEFAULT_THRESHOLDS } from '../campaignSignal'
import { decisionWindows, estimateRow, metaTotals, ESTIMATED_PROFIT_FORMULA, type MetaTotals } from './campaigns'
import {
  inRange, loadAdInfo, loadCampaignJourneyStores, loadFactsCovering, loadStoreMargin, reconcile, round2,
  sharedAccountFlag,
  type AdDayFact, type AdInfo, type SharedAccountFlag, type SpendReconciliation, type StoreMargin, type StoreTz,
} from './meta'
import { query } from '../db'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CreativeVideo {
  /** Play starts (Meta video_play_actions; autoplay counts). */
  plays: number
  /** Play starts ÷ impressions, %. NOT a hook rate: autoplay starts count. */
  playRate: number | null
  p25: number; p50: number; p75: number; p100: number
  /** Share of play starts that reached 25 / 50 / 75 / 100% of the video, %. */
  retention25: number | null
  retention50: number | null
  retention75: number | null
  retention100: number | null
}

export interface CreativeRow extends MetaTotals {
  adId: string
  name: string
  /** False when fb_ads has no row for this ad yet. */
  known: boolean
  status: string | null
  /** Ad, ad set and campaign all active (unknown parts read as active; an
   *  unknown ad counts as running when it spent on the window's last day). */
  running: boolean
  campaignId: string | null
  campaignName: string | null
  adsetId: string | null
  adsetName: string | null
  /** Null when there is none or its signed Meta link has expired. */
  thumbnailUrl: string | null
  creativeUrl: string | null
  /** The ad had picture links and all of them expired (lib/data/metaCdn). */
  previewExpired?: boolean
  landingUrl: string | null
  createdTime: string | null
  shared: SharedAccountFlag | null
  /** Meta purchase value × contribution rate − spend; null without a margin
   *  or for shared-account ads. */
  estimatedProfit: number | null
  daysWithSpend: number
  lastSpendDay: string | null
  /** Null for image ads (plays under 5% of impressions). */
  video: CreativeVideo | null
  /** Always null: see HOOK_RATE_UNAVAILABLE. */
  hookRate: null
  /** Impressions ÷ unique reach, only for single-day windows (where Meta's
   *  reach is the window's reach); null otherwise, see FREQUENCY_UNAVAILABLE. */
  frequency: number | null
  /** Judged on the verdict window (VerdictWindow: the campaigns' last 7 closed
   *  days), not on the row's figures when the windows differ. */
  verdict: CreativeVerdict
}

/** The closed days an ad's verdict is judged on, and the store's margin over
 *  them: the window and break-even its campaign's action uses. */
export interface VerdictWindow {
  range: DateRange
  margin: Pick<StoreMargin, 'configured' | 'contributionRate' | 'breakEvenRoas'>
}

export interface CreativeNotes {
  hookRate: string
  /** Null when the window is one day and frequency is exact. */
  frequency: string | null
}

export interface CreativesReport {
  storeId: string
  timezone: string
  range: DateRange
  partial: boolean
  configured: boolean
  contributionRate: number | null
  breakEvenRoas: number | null
  /** What every row's verdict is judged on (the campaigns' last 7 closed
   *  days) and the break-even of those days. */
  verdictWindow: DateRange
  verdictBreakEvenRoas: number | null
  formula: string
  /** Ads with spend or sales in the window: estimated profit first (best on
   *  top) when the store has a margin, else by spend. */
  creatives: CreativeRow[]
  totals: {
    ads: number
    spend: number
    purchaseValue: number
    purchases: number
    estimatedProfit: number | null
    verdicts: Record<Signal | 'none', number>
  }
  /** Null when the list is one campaign's ads (it cannot add up to the store). */
  reconciliation: SpendReconciliation | null
  notes: CreativeNotes
}

// ─── Pure building blocks ─────────────────────────────────────────────────────

const isActive = (s: string | null) => s === null || s.toUpperCase() === 'ACTIVE'

/** Running = ad, ad set and campaign active. An ad the catalog does not know
 *  is judged by whether it spent on the last day of the window. */
export function adRunning(info: AdInfo | undefined, spentOnLastDay: boolean): boolean {
  if (!info || !info.known || info.status === null) return spentOnLastDay
  return info.status.toUpperCase() === 'ACTIVE' && isActive(info.adsetStatus) && isActive(info.campaignStatus)
}

export function videoStats(f: Pick<AdDayFact, 'videoPlays' | 'impressions' | 'videoP25' | 'videoP50' | 'videoP75' | 'videoP100'>): CreativeVideo | null {
  if (!isVideoAd(f.videoPlays, f.impressions)) return null
  const share = (n: number) => (f.videoPlays > 0 ? (n / f.videoPlays) * 100 : null)
  return {
    plays: f.videoPlays,
    playRate: f.impressions > 0 ? (f.videoPlays / f.impressions) * 100 : null,
    p25: f.videoP25, p50: f.videoP50, p75: f.videoP75, p100: f.videoP100,
    retention25: share(f.videoP25), retention50: share(f.videoP50),
    retention75: share(f.videoP75), retention100: share(f.videoP100),
  }
}

type Sum = Omit<AdDayFact, 'date' | 'adId' | 'campaignId' | 'adsetId' | 'accountId'>
const emptySum = (): Sum => ({
  spend: 0, purchaseValue: 0, purchases: 0, phantomValue: 0, impressions: 0, reach: 0, linkClicks: 0,
  landingPageViews: 0, addToCart: 0, initiateCheckout: 0, videoPlays: 0, videoP25: 0, videoP50: 0,
  videoP75: 0, videoP100: 0,
})
function addSum(s: Sum, f: AdDayFact) {
  for (const k of Object.keys(s) as (keyof Sum)[]) s[k] += f[k]
}

export interface BuildCreativeInput {
  storeId: string
  range: DateRange
  facts: AdDayFact[]
  info: ReadonlyMap<string, AdInfo>
  journeys: ReadonlyMap<string, ReadonlyMap<string, number>>
  margin: Pick<StoreMargin, 'configured' | 'contributionRate' | 'breakEvenRoas'>
  /** Where the verdicts are judged; `facts` must cover it too. Without it, or
   *  when it is `range` itself, on the row's own figures. */
  verdictWindow?: VerdictWindow
  storeNames?: ReadonlyMap<string, string>
  /** Keep ads with no spend and no sales (a detail page of a quiet ad). */
  keepEmpty?: boolean
}

const sameRange = (a: DateRange, b: DateRange) => a.from === b.from && a.to === b.to

/** The verdict window in words, for a reason shown next to another window's
 *  figures: "nos 7 dias fechados". */
export function verdictWindowPhrase(w: DateRange): string {
  const days = eachDay(w.from, w.to).length
  return days === 1 ? 'no último dia fechado' : `nos ${days} dias fechados`
}

export function buildCreativeRows(input: BuildCreativeInput): CreativeRow[] {
  const { range } = input
  const singleDay = range.from === range.to
  // The verdict's own sums, only when its window is not the row's.
  const vw = input.verdictWindow && !sameRange(input.verdictWindow.range, range) ? input.verdictWindow : null
  const judgedSums = new Map<string, Sum>()
  const byAd = new Map<string, { sum: Sum; days: Set<string>; last: string | null; accountId: string | null; campaignId: string | null }>()
  for (const f of input.facts) {
    if (vw && inRange(f.date, vw.range)) {
      const j = judgedSums.get(f.adId) ?? emptySum()
      addSum(j, f)
      judgedSums.set(f.adId, j)
    }
    if (!inRange(f.date, range)) continue
    const a = byAd.get(f.adId) ?? { sum: emptySum(), days: new Set<string>(), last: null, accountId: f.accountId, campaignId: f.campaignId }
    addSum(a.sum, f)
    if (f.spend > 0) { a.days.add(f.date); if (!a.last || f.date > a.last) a.last = f.date }
    byAd.set(f.adId, a)
  }
  const judgedMargin = input.verdictWindow?.margin ?? input.margin
  const judgedSingleDay = vw ? vw.range.from === vw.range.to : singleDay
  const phrase = vw ? verdictWindowPhrase(vw.range) : null

  const flags = new Map<string, SharedAccountFlag | null>()
  const rows: CreativeRow[] = []
  for (const [adId, a] of byAd) {
    const s = a.sum
    if (!input.keepEmpty && !(s.spend > 0 || s.purchases > 0 || s.purchaseValue > 0)) continue
    const info = input.info.get(adId)
    const campaignId = info?.campaignId ?? a.campaignId
    const accountId = info?.campaignAccountId ?? a.accountId
    const flagKey = campaignId ?? `acct:${accountId ?? ''}`
    if (!flags.has(flagKey)) {
      flags.set(flagKey, sharedAccountFlag(
        input.storeId, accountId, campaignId ? input.journeys.get(campaignId) : undefined, input.storeNames,
      ))
    }
    const shared = flags.get(flagKey) ?? null
    const totals = metaTotals(s)
    const running = adRunning(info, a.last === range.to)
    const frequency = singleDay && s.reach > 0 ? s.impressions / s.reach : null
    // The verdict's figures: the verdict window's when it differs (an ad with
    // nothing there reads "Sem gasto nos 7 dias fechados"), else the row's.
    const j = vw ? judgedSums.get(adId) ?? emptySum() : s
    const judgedTotals = vw ? metaTotals(j) : totals
    const judgedBreakEven = judgedMargin.configured && !shared ? judgedMargin.breakEvenRoas : null
    const judgedFrequency = judgedSingleDay && j.reach > 0 ? j.impressions / j.reach : null

    rows.push({
      ...totals,
      adId,
      name: info?.name ?? `Anúncio sem nome (id ${adId})`,
      known: info?.known ?? false,
      status: info?.status ?? null,
      running,
      campaignId, campaignName: info?.campaignName ?? null,
      adsetId: info?.adsetId ?? null, adsetName: info?.adsetName ?? null,
      thumbnailUrl: info?.thumbnailUrl ?? null, creativeUrl: info?.creativeUrl ?? null, previewExpired: !!info?.previewExpired,
      landingUrl: info?.landingUrl ?? null, createdTime: info?.createdTime ?? null,
      shared,
      // The campaign rows' rule (estimateRow): with costs set and no sales in
      // the window, an ad Meta credited nothing is a certain loss of its
      // spend. Without it, "CBO - Moomilk !" read −$20,44 over ad sets and
      // ads that all read "—" on the same table.
      estimatedProfit: estimateRow(s.purchaseValue, s.spend, input.margin, !!shared),
      daysWithSpend: a.days.size,
      lastSpendDay: a.last,
      video: videoStats(s),
      hookRate: null,
      frequency,
      verdict: creativeVerdict({
        spend: j.spend, roas: judgedTotals.roas, purchases: j.purchases, breakEven: judgedBreakEven,
        costsConfigured: judgedMargin.configured, frequency: judgedFrequency, running, sharedNote: shared?.note ?? null,
        window: phrase,
      }),
    })
  }
  const configured = input.margin.configured && input.margin.contributionRate !== null
  return rows.sort((x, y) => configured
    ? (y.estimatedProfit ?? -Infinity) - (x.estimatedProfit ?? -Infinity) || y.spend - x.spend
    : y.spend - x.spend)
}

export function creativeNotes(range: DateRange): CreativeNotes {
  return { hookRate: HOOK_RATE_UNAVAILABLE, frequency: range.from === range.to ? null : FREQUENCY_UNAVAILABLE }
}

// ─── Loading ──────────────────────────────────────────────────────────────────

export interface CreativesOptions {
  storeNames?: ReadonlyMap<string, string>
  /** The engine margin for the same window, when the caller already has it. */
  margin?: StoreMargin
  /** The engine margin over the verdict window (the campaign report's
   *  decision margin), when the caller already has it. Ignored when the
   *  window is the page's own (then `margin` is it). */
  verdictMargin?: VerdictWindow['margin']
  /** Length of the verdict window in closed days: the campaigns' windowDays. */
  windowDays?: number
  /** Only the ads of this campaign. */
  campaignId?: string
  now?: Date
}

/** The closed days the verdicts are judged on for this store now. */
const verdictRange = (store: StoreTz, opts: CreativesOptions): DateRange =>
  decisionWindows(store.timezone, opts.now ?? new Date(), opts.windowDays ?? DEFAULT_THRESHOLDS.windowDays).window

/** The verdict window and its margin: the page's margin when the windows are
 *  the same, else the caller's, else one more engine pass. */
async function loadVerdictWindow(
  store: StoreTz, window: DateRange, range: DateRange, margin: Promise<StoreMargin>, opts: CreativesOptions,
): Promise<VerdictWindow> {
  const m = sameRange(window, range) ? await margin : opts.verdictMargin ?? await loadStoreMargin(store.id, window, opts.now)
  return { range: window, margin: { configured: m.configured, contributionRate: m.contributionRate, breakEvenRoas: m.breakEvenRoas } }
}

export async function getCreativesReport(store: StoreTz, range: DateRange, opts: CreativesOptions = {}): Promise<CreativesReport> {
  const marginP = opts.margin ? Promise.resolve(opts.margin) : loadStoreMargin(store.id, range, opts.now)
  const window = verdictRange(store, opts)
  const [allFacts, margin, verdictWindow] = await Promise.all([
    loadFactsCovering(store.id, [range, window], opts.campaignId ? { campaignId: opts.campaignId } : {}),
    marginP,
    loadVerdictWindow(store, window, range, marginP, opts),
  ])
  // The verdict window's facts judge; the list, its totals and the
  // reconciliation are the page's window only.
  const facts = allFacts.filter(f => inRange(f.date, range))
  const adIds = [...new Set(facts.map(f => f.adId))]
  const campaignIds = [...new Set(facts.map(f => f.campaignId).filter((x): x is string => !!x))]
  const [info, journeys] = await Promise.all([loadAdInfo(adIds, opts.now), loadCampaignJourneyStores(campaignIds)])
  const creatives = buildCreativeRows({
    storeId: store.id, range, facts: allFacts, info, journeys, margin, verdictWindow, storeNames: opts.storeNames,
  })

  const verdicts: Record<Signal | 'none', number> = { kill: 0, scale: 0, refresh: 0, ok: 0, none: 0 }
  let spend = 0, pv = 0, purchases = 0, profit = 0, priced = 0
  for (const c of creatives) {
    verdicts[c.verdict.signal ?? 'none']++
    spend += c.spend; pv += c.purchaseValue; purchases += c.purchases
    if (c.estimatedProfit !== null) { profit += c.estimatedProfit; priced++ }
  }
  return {
    storeId: store.id, timezone: store.timezone, range, partial: margin.partial,
    configured: margin.configured, contributionRate: margin.contributionRate, breakEvenRoas: margin.breakEvenRoas,
    verdictWindow: verdictWindow.range,
    verdictBreakEvenRoas: verdictWindow.margin.configured ? verdictWindow.margin.breakEvenRoas : null,
    formula: ESTIMATED_PROFIT_FORMULA,
    creatives,
    totals: {
      ads: creatives.length, spend: round2(spend), purchaseValue: round2(pv), purchases,
      estimatedProfit: margin.configured && priced > 0 ? round2(profit) : null, verdicts,
    },
    reconciliation: opts.campaignId ? null : reconcile(facts, margin.metaSpend),
    notes: creativeNotes(range),
  }
}

/** Ordering helper for lists that lead with what needs a decision. */
export function byVerdictThenSpend(a: CreativeRow, b: CreativeRow): number {
  return signalRank(a.verdict.signal) - signalRank(b.verdict.signal) || b.spend - a.spend
}

// ─── One ad ───────────────────────────────────────────────────────────────────

/** A day counts for "melhor / pior dia" only with this much spend: a $0.50
 *  day with one sale is a 80x ROAS that means nothing. */
export const DETAIL_DAY_MIN_SPEND = 10

export interface CreativeDay {
  date: string
  spend: number
  purchaseValue: number
  purchases: number
  impressions: number
  linkClicks: number
  /** Null on a day without spend (no data, not zero). */
  roas: number | null
  estimatedProfit: number | null
}

export interface CreativeDetail {
  storeId: string
  timezone: string
  range: DateRange
  configured: boolean
  contributionRate: number | null
  breakEvenRoas: number | null
  /** What creative.verdict is judged on (the campaigns' last 7 closed days)
   *  and the break-even of those days (null for a shared-account ad). */
  verdictWindow: DateRange
  verdictBreakEvenRoas: number | null
  formula: string
  creative: CreativeRow
  /** Every date of the window, empty days included. */
  daily: CreativeDay[]
  /** Among days with ≥ DETAIL_DAY_MIN_SPEND: by estimated profit when the store
   *  has a margin, else by ROAS. Null when no day qualifies. */
  bestDay: CreativeDay | null
  worstDay: CreativeDay | null
  /** False when the ad has no spend in the window ("sem gasto neste período"). */
  hasSpend: boolean
  /** Video or image over the ad's whole history on record (adFormatOf), not
   *  this window's; null when the store has no impressions for it. */
  format: AdFormat | null
  /** The ad's last day with spend on record, any window (creative.lastSpendDay
   *  is the window's): what a page without spend points to. */
  lastSpendDayEver: string | null
  notes: CreativeNotes
}

export type AdFormat = 'video' | 'image'

/**
 * Video or image, from the plays over every day on record. Meta's creative
 * type is empty on every stored ad (fb_ads.creative_type: 8.874 of 8.874 null
 * on 24/11/2026), so the plays are the only witness; read over the window
 * instead, a video ad on a day without spend had no plays and its page said
 * "Formato imagem". Null without impressions: unknown, never "imagem".
 */
export function adFormatOf(videoPlays: number, impressions: number): AdFormat | null {
  if (!(impressions > 0)) return null
  return isVideoAd(videoPlays, impressions) ? 'video' : 'image'
}

interface AdLifetime { owned: boolean; format: AdFormat | null; lastSpendDay: string | null }

/** adBelongsToStore's rule (the store has metrics for the ad, any date), the
 *  ad's format and its last day with spend, from those same rows in one read. */
async function loadAdLifetime(storeId: string, adId: string): Promise<AdLifetime> {
  const none: AdLifetime = { owned: false, format: null, lastSpendDay: null }
  if (!storeId || !adId) return none
  const rows = await query<{ days: number; plays: number | string; impressions: number | string; last_spend: string | null }>(
    `SELECT COUNT(*)::int AS days, COALESCE(SUM(video_plays), 0)::float8 AS plays, COALESCE(SUM(impressions), 0)::float8 AS impressions,
            (MAX(date) FILTER (WHERE spend > 0))::text AS last_spend
       FROM fb_ad_daily_metrics WHERE tenant_id = $1 AND ad_id = $2`,
    [storeId, adId],
  )
  const r = rows[0]
  if (!r || !(Number(r.days) > 0)) return none
  return { owned: true, format: adFormatOf(Number(r.plays) || 0, Number(r.impressions) || 0), lastSpendDay: r.last_spend ?? null }
}

/**
 * Whether this store has ever had metrics for this ad, whatever the window:
 * the one rule for "this ad is this store's". getCreativeDetail returns null
 * without it (loadAdLifetime: the same predicate, read with the ad's format),
 * and the creative page's tab title (generateMetadata) asks it alone, so a 404
 * reads "Página não encontrada" without pricing anything.
 */
export async function adBelongsToStore(storeId: string, adId: string): Promise<boolean> {
  if (!storeId || !adId) return false
  const rows = await query<{ ok: boolean }>(
    `SELECT EXISTS (SELECT 1 FROM fb_ad_daily_metrics WHERE tenant_id = $1 AND ad_id = $2) AS ok`,
    [storeId, adId],
  )
  return rows[0]?.ok === true
}

/**
 * One ad of this store. Null when the store has never had metrics for this ad
 * (another store's ad reads as not found; adBelongsToStore). An ad of this
 * store with no spend in the window returns hasSpend false and an all-empty
 * series, so the page can say "sem gasto neste período" instead of "não
 * encontrado".
 */
export async function getCreativeDetail(
  store: StoreTz, adId: string, range: DateRange, opts: CreativesOptions = {},
): Promise<CreativeDetail | null> {
  const marginP = opts.margin ? Promise.resolve(opts.margin) : loadStoreMargin(store.id, range, opts.now)
  const window = verdictRange(store, opts)
  const [allFacts, margin, lifetime, verdictWindow] = await Promise.all([
    loadFactsCovering(store.id, [range, window], { adId }),
    marginP,
    loadAdLifetime(store.id, adId),
    loadVerdictWindow(store, window, range, marginP, opts),
  ])
  if (!lifetime.owned) return null
  const facts = allFacts.filter(f => inRange(f.date, range))
  const info = await loadAdInfo([adId], opts.now)
  const campaignId = info.get(adId)?.campaignId ?? null
  const journeys = campaignId ? await loadCampaignJourneyStores([campaignId]) : new Map()
  const emptyFact: AdDayFact = {
    date: range.from, adId, campaignId, adsetId: info.get(adId)?.adsetId ?? null, accountId: info.get(adId)?.campaignAccountId ?? null,
    spend: 0, purchaseValue: 0, purchases: 0, phantomValue: 0, impressions: 0, reach: 0, linkClicks: 0,
    landingPageViews: 0, addToCart: 0, initiateCheckout: 0, videoPlays: 0, videoP25: 0, videoP50: 0, videoP75: 0, videoP100: 0,
  }
  // The empty fact (in the window, all zeros) keeps a row for an ad that is
  // quiet here, even when it spent in the verdict window.
  const [creative] = buildCreativeRows({
    storeId: store.id, range, facts: facts.length ? allFacts : [...allFacts, emptyFact], info, journeys, margin, verdictWindow,
    storeNames: opts.storeNames, keepEmpty: true,
  })
  const rate = margin.configured && !creative.shared ? margin.contributionRate : null

  const byDate = new Map(facts.map(f => [f.date, f]))
  const daily: CreativeDay[] = eachDay(range.from, range.to).map(date => {
    const f = byDate.get(date)
    const spend = f?.spend ?? 0, pv = f?.purchaseValue ?? 0
    return {
      date, spend: round2(spend), purchaseValue: round2(pv), purchases: f?.purchases ?? 0,
      impressions: f?.impressions ?? 0, linkClicks: f?.linkClicks ?? 0,
      roas: spend > 0 ? pv / spend : null,
      estimatedProfit: spend > 0 || pv > 0 ? estimateRow(pv, spend, margin, !!creative.shared) : null,
    }
  })
  const ranked = daily.filter(d => d.spend >= DETAIL_DAY_MIN_SPEND)
    .sort((a, b) => rate !== null
      ? (b.estimatedProfit ?? 0) - (a.estimatedProfit ?? 0)
      : (b.roas ?? 0) - (a.roas ?? 0))
  return {
    storeId: store.id, timezone: store.timezone, range,
    configured: margin.configured, contributionRate: rate, breakEvenRoas: creative.shared ? null : margin.breakEvenRoas,
    verdictWindow: verdictWindow.range,
    verdictBreakEvenRoas: creative.shared || !verdictWindow.margin.configured ? null : verdictWindow.margin.breakEvenRoas,
    formula: ESTIMATED_PROFIT_FORMULA,
    creative, daily,
    bestDay: ranked[0] ?? null,
    worstDay: ranked.length > 1 ? ranked[ranked.length - 1] : null,
    hasSpend: creative.spend > 0,
    format: lifetime.format,
    lastSpendDayEver: lifetime.lastSpendDay,
    notes: creativeNotes(range),
  }
}
