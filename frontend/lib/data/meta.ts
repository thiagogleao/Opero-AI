/**
 * Meta ad facts: one read of fb_ad_daily_metrics that every campaign and
 * creative screen is built from.
 *
 * Every earlier screen had its own copy of this SQL and each copy lost money in
 * its own way: an INNER JOIN on fb_ads dropped the spend of ads the sync had not
 * described yet (all of Glooty's spend on 12–15 Nov), nothing removed the
 * phantom purchases ($183,000 on one EPOCH ad-day), and so a campaign table
 * could not be reconciled with the store's books. Here:
 *
 *  - every metric row of the store and window is read, joined LEFT to fb_ads,
 *    fb_adsets and fb_campaigns, so the sum of any grouping equals the Meta
 *    spend the profit engine charges the store for the same dates;
 *  - purchase value and purchases go through the engine's phantom filter
 *    (purchaseValueSql / purchasesSql), the same rule the books use;
 *  - purchases are the single alias the collector stored for each row
 *    (it takes 'purchase', else 'offsite_conversion.fb_pixel_purchase', never
 *    both), so nothing here adds aliases together.
 *
 * Dates are Meta's own day, which is the ad account's timezone. Each store's
 * account is set to the store's timezone (Hibikura's account is on Tokyo time),
 * so a window of store calendar dates is the same window of Meta dates.
 */

import { query } from '../db'
import { computeStorePnL, KEPT_ORDER_SQL, PHANTOM_PURCHASE_VALUE, purchasesSql, purchaseValueSql } from '../engine/pnl'
import { daysBetween, type DateRange } from '../engine/dates'
import { livePictures } from './metaCdn'
import { formatCount } from '../format'

// ─── Shared ad accounts ───────────────────────────────────────────────────────

/**
 * Ad accounts known to have carried the ads of more than one store. A campaign
 * billed here cannot be judged with the margin of the store whose tenant holds
 * the metrics: its sales may have landed in another shop.
 *
 * Both are EPOCH's retired accounts (metrics stored under EPOCH with no
 * fb_ad_account_id). The CAMP HALLOW campaigns ('CBO - FREDDIE KReUGER - USA'
 * and its copies) ran in them, and so did a few campaigns of stores that are not
 * in Opero at all (EVEREST, BUBBO). act_3618880568247785 is the one CLAUDE.md
 * names; act_1209583407315269 is where the September copies ran, found by
 * reading fb_campaigns.account_id.
 */
export const SHARED_AD_ACCOUNTS: Readonly<Record<string, string>> = {
  act_3618880568247785: 'conta antiga da EPOCH, que também veiculou anúncios da CAMP HALLOW',
  act_1209583407315269: 'conta adicional da EPOCH (desativada), que também veiculou anúncios da CAMP HALLOW',
}

export function isSharedAccount(accountId: string | null | undefined): boolean {
  return !!accountId && Object.prototype.hasOwnProperty.call(SHARED_AD_ACCOUNTS, accountId)
}

/** The name shown for an ad the sync has spend for but no description of. */
export function orphanAdName(adId: string): string {
  return `Anúncio sem nome (id ${adId})`
}

/** The campaign bucket for spend whose ad has no campaign on record yet. */
export const ORPHAN_CAMPAIGN_NAME = 'Anúncios ainda não sincronizados'

/**
 * The catalog row of an ad and of its campaign, at most ONE each.
 *
 * fb_ads / fb_campaigns are keyed by store as well as id (an ad account can
 * move between stores), so the same ad can have a row per store. Joining on
 * the id alone would then repeat every metric row once per copy and add the
 * spend up twice. Each metric row takes the copy of its own store when there
 * is one, else the freshest other copy (which still carries the names).
 * Needs the aliases m (fb_ad_daily_metrics) and, for the campaign, a.
 */
export const AD_FOR_METRIC = `LEFT JOIN LATERAL (
         SELECT a.* FROM fb_ads a
          WHERE a.ad_id = m.ad_id
          ORDER BY (a.tenant_id = m.tenant_id) DESC NULLS LAST, a.synced_at DESC NULLS LAST
          LIMIT 1) a ON true`
export const CAMPAIGN_FOR_AD = `LEFT JOIN LATERAL (
         SELECT c.* FROM fb_campaigns c
          WHERE c.campaign_id = a.campaign_id
          ORDER BY (c.tenant_id = a.tenant_id) DESC NULLS LAST, c.synced_at DESC NULLS LAST
          LIMIT 1) c ON true`

// ─── Facts ────────────────────────────────────────────────────────────────────

/** One ad on one Meta day. Money in USD (every ad account is USD). */
export interface AdDayFact {
  date: string
  adId: string
  campaignId: string | null
  adsetId: string | null
  /** The row's own account when it has one, else the campaign's, else the
   *  store's primary account. */
  accountId: string | null
  spend: number
  /** Meta purchase value with phantom ad-days removed. */
  purchaseValue: number
  purchases: number
  /** The purchase value dropped from this row as a phantom (0 for real rows). */
  phantomValue: number
  impressions: number
  /** Meta's reach for this ad on this day. Reach does not add across days. */
  reach: number
  /** Link clicks (what Ads Manager calls "Cliques no link"). */
  linkClicks: number
  landingPageViews: number
  addToCart: number
  initiateCheckout: number
  /** Video play starts (Meta 'video_play_actions'; autoplay counts). */
  videoPlays: number
  videoP25: number
  videoP50: number
  videoP75: number
  videoP100: number
}

interface FactRow {
  d: string; ad_id: string; campaign_id: string | null; adset_id: string | null; account_id: string | null
  spend: number; pv: number; pc: number; phantom: number
  impressions: number; reach: number; link_clicks: number; lpv: number; atc: number; ic: number
  vp: number; p25: number; p50: number; p75: number; p100: number
}

/** Narrow a fact load to one ad or one campaign (detail pages). */
export interface FactFilter {
  adId?: string
  campaignId?: string
}

/**
 * Every ad-day of a store in [from, to]. No HAVING, no INNER JOIN: a row the
 * catalog does not know is still spend the store paid.
 */
export async function loadAdDayFacts(storeId: string, range: DateRange, filter: FactFilter = {}): Promise<AdDayFact[]> {
  const params: unknown[] = [storeId, range.from, range.to]
  let extra = ''
  if (filter.adId) { params.push(filter.adId); extra += ` AND m.ad_id = $${params.length}` }
  if (filter.campaignId) { params.push(filter.campaignId); extra += ` AND a.campaign_id = $${params.length}` }
  const rows = await query<FactRow>(
    `SELECT m.date::text AS d, m.ad_id, a.campaign_id, a.adset_id,
            COALESCE(m.fb_ad_account_id, c.account_id, t.fb_ad_account_id) AS account_id,
            COALESCE(m.spend, 0)::float8 AS spend,
            ${purchaseValueSql('m.purchase_value')}::float8 AS pv,
            ${purchasesSql('m.purchase_value', 'm.purchases')}::float8 AS pc,
            (CASE WHEN COALESCE(m.purchase_value, 0) > ${PHANTOM_PURCHASE_VALUE}
                  THEN m.purchase_value ELSE 0 END)::float8 AS phantom,
            COALESCE(m.impressions, 0)::float8 AS impressions,
            COALESCE(m.reach, 0)::float8 AS reach,
            COALESCE(m.link_clicks, 0)::float8 AS link_clicks,
            COALESCE(m.landing_page_views, 0)::float8 AS lpv,
            COALESCE(m.add_to_cart, 0)::float8 AS atc,
            COALESCE(m.initiate_checkout, 0)::float8 AS ic,
            COALESCE(m.video_plays, 0)::float8 AS vp,
            COALESCE(m.video_p25, 0)::float8 AS p25,
            COALESCE(m.video_p50, 0)::float8 AS p50,
            COALESCE(m.video_p75, 0)::float8 AS p75,
            COALESCE(m.video_p100, 0)::float8 AS p100
       FROM fb_ad_daily_metrics m
       JOIN tenants t ON t.id = m.tenant_id
       ${AD_FOR_METRIC}
       ${CAMPAIGN_FOR_AD}
      WHERE m.tenant_id = $1 AND m.date BETWEEN $2::date AND $3::date${extra}`,
    params,
  )
  return rows.map(r => ({
    date: r.d, adId: r.ad_id, campaignId: r.campaign_id, adsetId: r.adset_id, accountId: r.account_id,
    spend: num(r.spend), purchaseValue: num(r.pv), purchases: num(r.pc), phantomValue: num(r.phantom),
    impressions: num(r.impressions), reach: num(r.reach), linkClicks: num(r.link_clicks),
    landingPageViews: num(r.lpv), addToCart: num(r.atc), initiateCheckout: num(r.ic),
    videoPlays: num(r.vp), videoP25: num(r.p25), videoP50: num(r.p50), videoP75: num(r.p75), videoP100: num(r.p100),
  }))
}

/** The store a report is about: StoreRef from lib/access satisfies it. */
export interface StoreTz { id: string; timezone: string }

/**
 * Merge date ranges that overlap or sit within `maxGap` days of each other, so
 * a window plus the decision window is one query, while October plus last week
 * is two small ones instead of one covering the month between.
 */
export function mergeRanges(ranges: DateRange[], maxGap = 31): DateRange[] {
  const sorted = ranges.filter(r => r.from <= r.to).map(r => ({ ...r })).sort((a, b) => a.from.localeCompare(b.from))
  const out: DateRange[] = []
  for (const r of sorted) {
    const last = out[out.length - 1]
    // daysBetween is inclusive: adjacent dates give 2, i.e. 0 days between.
    if (last && daysBetween(last.to, r.from) - 2 <= maxGap) {
      if (r.to > last.to) last.to = r.to
    } else out.push(r)
  }
  return out
}

/** Facts covering every range given, each ad-day once. */
export async function loadFactsCovering(storeId: string, ranges: DateRange[], filter: FactFilter = {}): Promise<AdDayFact[]> {
  const parts = await Promise.all(mergeRanges(ranges).map(r => loadAdDayFacts(storeId, r, filter)))
  return parts.flat()
}

export const inRange = (date: string, r: DateRange) => date >= r.from && date <= r.to

/** What the catalog knows about a campaign. */
export interface CampaignInfo {
  campaignId: string
  name: string
  /** fb_campaigns.status ('ACTIVE' / 'PAUSED'); null when the campaign row is missing. */
  status: string | null
  objective: string | null
  accountId: string | null
}

export async function loadCampaignInfo(campaignIds: string[]): Promise<Map<string, CampaignInfo>> {
  const ids = [...new Set(campaignIds)].filter(Boolean)
  const out = new Map<string, CampaignInfo>()
  if (!ids.length) return out
  const rows = await query<{ campaign_id: string; name: string | null; status: string | null; objective: string | null; account_id: string | null }>(
    `SELECT a.campaign_id, COALESCE(MAX(c.name), MAX(a.campaign_name)) AS name,
            MAX(c.status) AS status, MAX(c.objective) AS objective, MAX(c.account_id) AS account_id
       FROM fb_ads a
       ${CAMPAIGN_FOR_AD}
      WHERE a.campaign_id = ANY($1::text[])
      GROUP BY a.campaign_id`,
    [ids],
  )
  for (const r of rows) {
    out.set(r.campaign_id, {
      campaignId: r.campaign_id, name: r.name || `Campanha ${r.campaign_id}`,
      status: r.status, objective: r.objective, accountId: r.account_id,
    })
  }
  return out
}

// ─── Descriptions ─────────────────────────────────────────────────────────────

/** What the catalog knows about an ad, its ad set and its campaign. */
export interface AdInfo {
  adId: string
  /** False when fb_ads has no row for this ad yet. */
  known: boolean
  name: string
  status: string | null
  adsetId: string | null
  adsetName: string | null
  /** fb_adsets.status, null when the ad set is not on record. */
  adsetStatus: string | null
  campaignId: string | null
  campaignName: string | null
  /** fb_campaigns.status: ACTIVE or PAUSED as configured in Ads Manager. */
  campaignStatus: string | null
  campaignObjective: string | null
  campaignAccountId: string | null
  /** Null when there is none or its signed CDN link has expired (metaCdn). */
  thumbnailUrl: string | null
  creativeUrl: string | null
  /** True when the ad had a picture link on record and every one of them has
   *  expired: the screen says "o link do Meta expirou" instead of a blank box. */
  previewExpired?: boolean
  landingUrl: string | null
  /** When the ad was created in Meta (ISO), null when unknown. */
  createdTime: string | null
}

interface InfoRow {
  ad_id: string; name: string | null; status: string | null
  adset_id: string | null; adset_name: string | null; adset_status: string | null
  campaign_id: string | null; campaign_name: string | null; campaign_status: string | null
  objective: string | null; account_id: string | null
  thumbnail_url: string | null; creative_url: string | null; landing_url: string | null
  created_time: string | null
}

/**
 * What the catalog knows about each ad. Picture links whose signed expiry has
 * passed are dropped here, once for every screen (Campanhas, the creative
 * page, the phone): the browser would only get a 403 for them.
 */
export async function loadAdInfo(adIds: string[], now: Date = new Date()): Promise<Map<string, AdInfo>> {
  const ids = [...new Set(adIds)].filter(Boolean)
  const out = new Map<string, AdInfo>()
  if (!ids.length) return out
  const rows = await query<InfoRow>(
    `SELECT a.ad_id, a.name, a.status, a.adset_id,
            COALESCE(s.name, a.adset_name) AS adset_name, s.status AS adset_status,
            a.campaign_id, COALESCE(c.name, a.campaign_name) AS campaign_name,
            c.status AS campaign_status, c.objective, c.account_id,
            a.thumbnail_url, a.creative_url, a.landing_url, a.created_time::text AS created_time
       FROM fb_ads a
       LEFT JOIN LATERAL (
         SELECT s.name, s.status FROM fb_adsets s
          WHERE s.adset_id = a.adset_id
          ORDER BY (s.tenant_id = a.tenant_id) DESC NULLS LAST, s.synced_at DESC NULLS LAST
          LIMIT 1) s ON true
       ${CAMPAIGN_FOR_AD}
      WHERE a.ad_id = ANY($1::text[])`,
    [ids],
  )
  for (const r of rows) {
    out.set(r.ad_id, {
      adId: r.ad_id, known: true, name: r.name || orphanAdName(r.ad_id), status: r.status,
      adsetId: r.adset_id, adsetName: r.adset_name, adsetStatus: r.adset_status, campaignId: r.campaign_id, campaignName: r.campaign_name,
      campaignStatus: r.campaign_status, campaignObjective: r.objective, campaignAccountId: r.account_id,
      ...livePictures(r.thumbnail_url, r.creative_url, now),
      landingUrl: r.landing_url,
      createdTime: r.created_time,
    })
  }
  for (const id of ids) {
    if (!out.has(id)) {
      out.set(id, {
        adId: id, known: false, name: orphanAdName(id), status: null, adsetId: null, adsetName: null, adsetStatus: null,
        campaignId: null, campaignName: null, campaignStatus: null, campaignObjective: null,
        campaignAccountId: null, thumbnailUrl: null, creativeUrl: null, landingUrl: null,
        createdTime: null,
      })
    }
  }
  return out
}

// ─── Journeys: where a campaign's sales landed ────────────────────────────────

/**
 * A campaign's journey orders are "elsewhere" when at least this many of our
 * own tracked orders came from it and most of them landed in another store.
 * Below that, a stray click from a shopper who also bought elsewhere would be
 * enough to move a campaign out of its own store.
 */
export const JOURNEY_MIN_ORDERS = 5

/** Orders our own journey data ties to each campaign, per store, all time. */
export async function loadCampaignJourneyStores(
  campaignIds: string[],
): Promise<Map<string, Map<string, number>>> {
  const ids = [...new Set(campaignIds)].filter(Boolean)
  const out = new Map<string, Map<string, number>>()
  if (!ids.length) return out
  const rows = await query<{ campaign_id: string; tenant_id: string; orders: number }>(
    `SELECT campaign_id, tenant_id, COUNT(DISTINCT order_id)::int AS orders
       FROM order_touchpoints
      WHERE campaign_id = ANY($1::text[])
      GROUP BY 1, 2`,
    [ids],
  )
  for (const r of rows) {
    const m = out.get(r.campaign_id) ?? new Map<string, number>()
    m.set(r.tenant_id, num(r.orders))
    out.set(r.campaign_id, m)
  }
  return out
}

/**
 * Orders of this store whose FIRST tracked touch was each campaign, touched on
 * a date of the window (store timezone), refunded/voided orders left out.
 * A cross-check of Meta's purchase count, never a replacement for it: our
 * journey data sees roughly 57–65% of a store's orders.
 */
export async function loadFirstTouchOrders(storeId: string, range: DateRange): Promise<Map<string, number>> {
  const rows = await query<{ campaign_id: string; orders: number }>(
    `SELECT p.campaign_id, COUNT(DISTINCT p.order_id)::int AS orders
       FROM order_touchpoints p
       JOIN tenants t ON t.id = p.tenant_id
       JOIN shopify_orders o ON o.order_id = p.order_id AND o.tenant_id = p.tenant_id
      WHERE p.tenant_id = $1 AND p.seq = 1 AND p.campaign_id IS NOT NULL
        AND (p.occurred_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
        AND o.financial_status NOT IN ('refunded', 'voided')
      GROUP BY 1`,
    [storeId, range.from, range.to],
  )
  return new Map(rows.map(r => [r.campaign_id, num(r.orders)]))
}

/** A campaign whose ads are billed under another store but whose tracked
 *  orders land here: CAMP HALLOW's ads live in EPOCH's old account. */
export interface CampaignBilledElsewhere {
  campaignId: string
  name: string
  /** The store whose books carry the spend. */
  billedStoreId: string
  accountId: string | null
  /** The campaign's whole spend in the window (every ad of it), which is more
   *  than Atribuição's "gasto desses anúncios": that one sums only the ads
   *  credited with an order here in the window. */
  spend: number
  purchaseValue: number
  purchases: number
  /** Journey orders of this campaign that landed in this store / in all
   *  stores, ALL TIME. This decides that the campaign sells here (the list's
   *  membership rule); it is not a count for the page's window. */
  journeyOrdersHere: number
  journeyOrdersTotal: number
  /** The same counts for orders placed inside the window (each store's own
   *  calendar dates, refunded/voided orders out, as the engine counts them):
   *  what a table that shows the window's spend must show next to it. */
  windowOrdersHere: number
  windowOrdersTotal: number
}

/**
 * Campaigns billed in another store's metrics whose tracked orders mostly
 * (and at least JOURNEY_MIN_ORDERS of them) land in this store. Their spend is
 * NOT in this store's books — the engine charges it to the store that holds
 * the metrics — so this list is information, never a cost line.
 *
 * Membership is judged on all-time journeys (a campaign does not change hands
 * because one week was quiet); the order counts shown with the window's spend
 * are the window's. Showing the all-time count there read as "338 de 338"
 * against a store with 103 orders in the window.
 */
export async function loadCampaignsBilledElsewhere(storeId: string, range: DateRange): Promise<CampaignBilledElsewhere[]> {
  const rows = await query<{
    campaign_id: string; name: string | null; tenant_id: string; account_id: string | null
    spend: number; pv: number; pc: number; here: number; total: number; w_here: number; w_total: number
  }>(
    `WITH j AS (
       SELECT campaign_id, tenant_id, COUNT(DISTINCT order_id) AS orders
         FROM order_touchpoints
        WHERE campaign_id IS NOT NULL
        GROUP BY 1, 2
     ), share AS (
       SELECT campaign_id,
              COALESCE(SUM(orders) FILTER (WHERE tenant_id = $1), 0) AS here,
              SUM(orders) AS total
         FROM j GROUP BY 1
     ), member AS (
       SELECT * FROM share WHERE here >= ${JOURNEY_MIN_ORDERS} AND here * 2 > total
     ), win AS (
       -- Orders placed in the window, each on its own store's calendar.
       SELECT p.campaign_id,
              COUNT(DISTINCT p.order_id) FILTER (WHERE p.tenant_id = $1) AS here,
              COUNT(DISTINCT (p.tenant_id, p.order_id)) AS total
         FROM order_touchpoints p
         JOIN tenants t ON t.id = p.tenant_id
         JOIN shopify_orders o ON o.order_id = p.order_id AND o.tenant_id = p.tenant_id
        WHERE p.campaign_id IN (SELECT campaign_id FROM member)
          AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
          AND ${KEPT_ORDER_SQL}
        GROUP BY 1
     )
     SELECT a.campaign_id, COALESCE(c.name, a.campaign_name) AS name, m.tenant_id,
            COALESCE(c.account_id, m.fb_ad_account_id) AS account_id,
            SUM(COALESCE(m.spend, 0))::float8 AS spend,
            SUM(${purchaseValueSql('m.purchase_value')})::float8 AS pv,
            SUM(${purchasesSql('m.purchase_value', 'm.purchases')})::float8 AS pc,
            MAX(s.here)::float8 AS here, MAX(s.total)::float8 AS total,
            COALESCE(MAX(w.here), 0)::float8 AS w_here, COALESCE(MAX(w.total), 0)::float8 AS w_total
       FROM fb_ad_daily_metrics m
       ${AD_FOR_METRIC}
       ${CAMPAIGN_FOR_AD}
       JOIN member s ON s.campaign_id = a.campaign_id
       LEFT JOIN win w ON w.campaign_id = a.campaign_id
      WHERE m.tenant_id <> $1 AND m.date BETWEEN $2::date AND $3::date
      GROUP BY 1, 2, 3, 4
     HAVING SUM(COALESCE(m.spend, 0)) > 0
      ORDER BY spend DESC`,
    [storeId, range.from, range.to],
  )
  return rows.map(r => ({
    campaignId: r.campaign_id, name: r.name || r.campaign_id, billedStoreId: r.tenant_id,
    accountId: r.account_id, spend: num(r.spend), purchaseValue: num(r.pv), purchases: num(r.pc),
    journeyOrdersHere: num(r.here), journeyOrdersTotal: num(r.total),
    windowOrdersHere: num(r.w_here), windowOrdersTotal: num(r.w_total),
  }))
}

/** Why a campaign is not judged with this store's margin. */
export interface SharedAccountFlag {
  accountId: string | null
  /** The sentence to show, Portuguese. */
  note: string
  /** The store most of the campaign's tracked orders landed in, when another
   *  one the viewer may see (in storeNames); null otherwise. */
  journeyStoreId: string | null
  journeyOrdersHere: number
  journeyOrdersTotal: number
}

/**
 * Is this campaign's money someone else's? Two cases, both decided by where
 * our own journey data puts the campaign's orders:
 *
 *  - it ran in a known shared account and this store holds no majority of its
 *    tracked orders (CAMP HALLOW's "Freddie" campaigns in EPOCH's old account;
 *    EVEREST/BUBBO campaigns there have no orders in any Opero store);
 *  - in any account, at least JOURNEY_MIN_ORDERS tracked orders and most of
 *    them in another store (an account that changed hands mid-season).
 *
 * A campaign in a shared account whose orders do land here is judged normally:
 * EPOCH's own campaigns in those accounts are EPOCH's.
 */
export function sharedAccountFlag(
  storeId: string,
  accountId: string | null,
  journeys: ReadonlyMap<string, number> | undefined,
  storeNames: ReadonlyMap<string, string> = new Map(),
): SharedAccountFlag | null {
  let total = 0, topId: string | null = null, topOrders = 0
  for (const [tenant, orders] of journeys ?? []) {
    total += orders
    if (tenant !== storeId && orders > topOrders) { topId = tenant; topOrders = orders }
  }
  const here = journeys?.get(storeId) ?? 0
  const mostlyHere = here > 0 && here * 2 > total
  const shared = isSharedAccount(accountId)
  if (shared ? mostlyHere : (total < JOURNEY_MIN_ORDERS || mostlyHere)) return null

  const other = topId ? (storeNames.get(topId) ?? 'outra loja') : null
  const pctOther = topId && total > 0 ? Math.round((topOrders / total) * 100) : 0
  const where = shared && accountId ? `Rodou na ${SHARED_AD_ACCOUNTS[accountId]}` : 'As vendas rastreadas desta campanha caem em outra loja'
  // The counts are all time (the membership rule), shown next to a windowed
  // table: say so, as BilledElsewhere does, or 338 reads as October's orders.
  const evidence = other
    ? `${pctOther}% dos ${formatCount(total)} pedidos rastreados dela, desde sempre, caíram em ${other}`
    : 'nenhum pedido rastreado dela caiu em uma loja do Opero'
  return {
    accountId,
    note: `${where}: ${evidence}. Não é julgada com a margem desta loja.`,
    // Only a store the viewer may see is named by id: this goes to the browser.
    journeyStoreId: topId && storeNames.has(topId) ? topId : null,
    journeyOrdersHere: here,
    journeyOrdersTotal: total,
  }
}

// ─── The store's margin, from the engine ──────────────────────────────────────

/** What a campaign or an ad is priced against: the engine's numbers for the
 *  same store and the same dates. */
export interface StoreMargin {
  range: DateRange
  configured: boolean
  /** Store contribution ÷ store revenue: the share of a sale left after
   *  product, supplier fees, packaging, shipping, Shopify/payment fees and
   *  per-order extras. Shop Campaigns and fixed costs are not in it. May be
   *  ≤ 0. Null without cost settings or without revenue. */
  contributionRate: number | null
  /** The engine's breakEvenRoas (revenue ÷ contribution); null when not
   *  configured or when contribution ≤ 0 (no ROAS breaks even). */
  breakEvenRoas: number | null
  revenue: number
  orders: number
  /** The engine's Meta spend and purchase value for the window (phantoms
   *  removed): what campaign and ad totals must add up to. */
  metaSpend: number
  metaPurchaseValue: number
  /** The window includes the store's current, still-running day. */
  partial: boolean
}

export async function loadStoreMargin(storeId: string, range: DateRange, now?: Date): Promise<StoreMargin> {
  const p = await computeStorePnL(storeId, range, {}, now)
  if (!p) {
    return { range, configured: false, contributionRate: null, breakEvenRoas: null, revenue: 0, orders: 0, metaSpend: 0, metaPurchaseValue: 0, partial: false }
  }
  const t = p.totals
  return {
    range,
    configured: p.configured,
    contributionRate: p.configured && t.revenue > 0 ? t.contribution / t.revenue : null,
    breakEvenRoas: p.configured ? t.breakEvenRoas : null,
    revenue: t.revenue,
    orders: t.orders,
    metaSpend: t.metaSpend,
    metaPurchaseValue: t.metaPurchaseValue,
    partial: p.partial,
  }
}

/** Spend the screens show against the spend the books carry. */
export interface SpendReconciliation {
  /** Meta spend the engine charges the store for the window. */
  engineMetaSpend: number
  /** Sum of the rows on screen. */
  listedSpend: number
  /** listedSpend − engineMetaSpend; 0 unless something is wrong. */
  gap: number
  /** Spend of ads the sync has not described yet (kept, in its own row). */
  unsyncedSpend: number
  /** Ad-days whose purchase value was dropped as a phantom, and how much. */
  phantomAdDays: number
  phantomValueDropped: number
}

export function reconcile(facts: AdDayFact[], engineMetaSpend: number): SpendReconciliation {
  let listed = 0, unsynced = 0, phantomDays = 0, phantom = 0
  for (const f of facts) {
    listed += f.spend
    if (!f.campaignId) unsynced += f.spend
    if (f.phantomValue > 0) { phantomDays += 1; phantom += f.phantomValue }
  }
  return {
    engineMetaSpend: round2(engineMetaSpend), listedSpend: round2(listed), gap: round2(listed - engineMetaSpend),
    unsyncedSpend: round2(unsynced), phantomAdDays: phantomDays, phantomValueDropped: round2(phantom),
  }
}

// ─── Breakdowns ───────────────────────────────────────────────────────────────

export type BreakdownType = 'country' | 'device' | 'placement' | 'age_gender'

export const BREAKDOWN_TYPES: readonly BreakdownType[] = ['country', 'device', 'placement', 'age_gender']

export interface BreakdownRow {
  label: string
  spend: number
  /** Phantom ad-days removed, as everywhere else. */
  purchaseValue: number
  purchases: number
  impressions: number
  clicks: number
  roas: number | null
  ctr: number | null
  cpc: number | null
}

export interface BreakdownResult {
  type: BreakdownType
  range: DateRange
  rows: BreakdownRow[]
  /** Spend covered by the breakdown against the store's Meta spend. Meta's
   *  breakdown pulls are separate requests and some days are missing (MOKOO
   *  had 18 of 31 spend-days in Oct–Nov), so the table is a sample unless this
   *  is close to 1. */
  coveredSpend: number
  totalSpend: number
  /** Days with spend that have no breakdown rows of this type. */
  missingDays: string[]
  /** CLAUDE.md: Meta's split by country captured 17%–140% of real orders per
   *  country at EPOCH. Never a basis for a geography decision on its own. */
  caveat: string | null
}

/**
 * Meta's own split of spend and purchases by country, device, placement or
 * age/gender. Corrected version of queries.getBreakdownByType/getCountrySpend:
 * phantom purchases removed, no row limit that hides spend, and the coverage
 * stated so a partial table is not read as the whole store.
 */
export async function getMetaBreakdown(
  storeId: string, range: DateRange, type: BreakdownType,
): Promise<BreakdownResult> {
  const [rows, days] = await Promise.all([
    query<{ label: string | null; spend: number; pv: number; pc: number; impressions: number; clicks: number }>(
      `SELECT breakdown_value AS label,
              COALESCE(SUM(spend), 0)::float8 AS spend,
              COALESCE(SUM(${purchaseValueSql()}), 0)::float8 AS pv,
              COALESCE(SUM(${purchasesSql()}), 0)::float8 AS pc,
              COALESCE(SUM(impressions), 0)::float8 AS impressions,
              COALESCE(SUM(clicks), 0)::float8 AS clicks
         FROM fb_ad_breakdowns
        WHERE tenant_id = $1 AND breakdown_type = $4 AND date BETWEEN $2::date AND $3::date
        GROUP BY breakdown_value`,
      [storeId, range.from, range.to, type],
    ),
    query<{ d: string; spend: number; covered: boolean }>(
      `SELECT m.d, m.spend, EXISTS (
                SELECT 1 FROM fb_ad_breakdowns b
                 WHERE b.tenant_id = $1 AND b.breakdown_type = $4 AND b.date = m.d::date) AS covered
         FROM (SELECT date::text AS d, SUM(spend)::float8 AS spend
                 FROM fb_ad_daily_metrics
                WHERE tenant_id = $1 AND date BETWEEN $2::date AND $3::date
                GROUP BY 1 HAVING SUM(spend) > 0) m
        ORDER BY m.d`,
      [storeId, range.from, range.to, type],
    ),
  ])
  const out: BreakdownRow[] = rows.map(r => {
    const spend = num(r.spend), pv = num(r.pv), impressions = num(r.impressions), clicks = num(r.clicks)
    return {
      label: r.label || '??', spend, purchaseValue: pv, purchases: num(r.pc), impressions, clicks,
      roas: spend > 0 ? pv / spend : null,
      ctr: impressions > 0 ? (clicks / impressions) * 100 : null,
      cpc: clicks > 0 ? spend / clicks : null,
    }
  }).sort((a, b) => b.spend - a.spend)
  return {
    type, range, rows: out,
    coveredSpend: out.reduce((s, r) => s + r.spend, 0),
    totalSpend: days.reduce((s, d) => s + num(d.spend), 0),
    missingDays: days.filter(d => !d.covered).map(d => d.d),
    caveat: type === 'country'
      ? 'A divisão por país é a atribuição do Meta: medida na EPOCH, ela captou de 17% a 140% dos pedidos reais conforme o país. Para decidir geografia, compare com os pedidos da Shopify.'
      : null,
  }
}

// ─── Small helpers ────────────────────────────────────────────────────────────

export function num(v: unknown): number {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

export const round2 = (n: number) => Math.round(n * 100) / 100
