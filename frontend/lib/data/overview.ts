/**
 * The account overview: several stores, one window, every number from ONE
 * computePnL call.
 *
 * The old overview ran five queries per store one after another, computed the
 * profit summary twice, drew a daily chart without Shop Campaigns (so its bars
 * summed to $25.6k under a $14.8k headline), resolved "hoje" in whichever
 * store was active (a Brazilian store read zero for half the day when the
 * Tokyo one was picked) and showed one "última sync" — the newest — which hid a
 * store whose sync had stopped. Here:
 *  - the window is resolved once, on the anchor clock (the store's own for one
 *    store, Brasília for several), and every store is measured on those same
 *    calendar dates in its OWN timezone (owner's rule). A store whose day is
 *    already over (Hibikura from noon in Brazil) is flagged, not zeroed;
 *  - totals are the sum of the store rows and the daily series is the same
 *    orders by date, so they cannot disagree;
 *  - freshness is per store and per source, with the same staleness rules and
 *    badges as the phone (lib/views/portfolio.ts);
 *  - stores of the viewer that share an ad account (CAMP HALLOW selling on ads
 *    billed to EPOCH) are named, so neither store is read alone.
 *
 * Callers pass stores already checked by lib/access; this module never decides
 * who may see what.
 */

import { query } from '../db'
import { computePnL, sumPnL, type PnL, type StorePnL } from '../engine/pnl'
import {
  anchorTz, eachDay, formatRange, isIsoDate, resolveRange, safeTz, todayInTz,
  type DateRange, type Period,
} from '../engine/dates'
import { getSharedAdAccounts } from '../attribution'
import { SHARED_ACCOUNT_NOTE, type SharedAdAccount } from '../attributionModels'
import type { StoreRef } from '../access'
import {
  badgesFor, dayStateOf, storeFreshness,
  type DayState, type PortfolioDay, type StoreAdjustments, type StoreBadge, type StoreFreshness, type SyncRow,
} from '../views/portfolio'

// ─── Types (the contract the overview screen builds on) ───────────────────────

export type OverviewStoreInput = Pick<StoreRef, 'id' | 'name' | 'timezone'>

export interface OverviewStoreRow {
  id: string
  name: string
  timezone: string
  /** The store's own today. */
  storeToday: string
  /** running | closed (the date is over in the store's timezone) |
   *  not_started | complete. */
  dayState: DayState
  /** False: no cost settings, costs are zero and "lucro" is revenue − ads. */
  configured: boolean
  /** The window includes the store's current day. */
  partial: boolean
  minutesCovered: number
  /** Engine P&L of the store (see lib/engine/pnl.ts for every definition):
   *  operatingProfit is "lucro", adSpend = metaSpend + shopSpend, roas is store
   *  revenue ÷ Meta spend, breakEvenRoas = revenue ÷ contribution. */
  totals: PnL
  freshness: StoreFreshness
  /** Ready-made Portuguese chips: sem_custos, dia_encerrado, sync_atrasado… */
  badges: StoreBadge[]
  /** No chargeback has ever been read for this store: its token may not read
   *  disputes, so a zero here is not proof there were none. */
  blindToChargebacks: boolean
  /** Refunds that arrived in the window for orders the engine already dropped
   *  as fully refunded (USD) — not subtracted again. */
  refundsAlreadyDropped: number
  /** Pairs with another store of this overview where one sells on ads billed
   *  to the other. */
  sharedAdAccounts: SharedAdAccount[]
}

export interface OverviewFreshness {
  generatedAt: string
  /** Oldest "last success" across the stores' sources: how old the least
   *  fresh number on screen can be. */
  oldestSuccessAt: string | null
  newestSuccessAt: string | null
  staleStores: { storeId: string; name: string; failing: boolean; sources: ('shopify' | 'facebook')[] }[]
}

export interface AccountOverviewView {
  generatedAt: string
  /** Null when the caller passed explicit dates. */
  period: Period | null
  range: DateRange
  rangeLabel: string
  anchorTimezone: string
  anchorToday: string
  storeIds: string[]
  /** Sum of the store rows. */
  totals: PnL
  configured: boolean
  unconfiguredStoreIds: string[]
  /** Most operating profit first. */
  stores: OverviewStoreRow[]
  /** Every date of the window, summed over the stores; sums to `totals`. */
  daily: PortfolioDay[]
  /** Stores where refunds or chargebacks arrived in the window, biggest first. */
  adjustmentsByStore: StoreAdjustments[]
  sharedAdAccounts: SharedAdAccount[]
  /** Said on screen whenever sharedAdAccounts is not empty. */
  sharedAccountNote: string | null
  freshness: OverviewFreshness
  /** Asked for but unknown to the engine (deleted stores). */
  missingStoreIds: string[]
}

// ─── Pure assembly (exported for the tests) ───────────────────────────────────

export interface OverviewInputs {
  stores: readonly OverviewStoreInput[]
  period: Period | null
  range: DateRange
  anchorTimezone: string
  now: Date
  pnl: Map<string, StorePnL>
  syncRows: SyncRow[]
  liveCovered: Set<string>
  chargebackSeen: Set<string>
  refundsDropped: Map<string, number>
  shared: SharedAdAccount[]
}

function dayPoint(date: string, p: PnL): PortfolioDay {
  return {
    date, revenue: p.revenue, orders: p.orders, contribution: p.contribution,
    metaSpend: p.metaSpend, shopSpend: p.shopSpend, adSpend: p.adSpend, fixedCosts: p.fixedCosts,
    operatingProfit: p.operatingProfit, adjustments: p.adjustments, cashResult: p.cashResult,
    margin: p.margin, roas: p.roas,
  }
}

export function assembleOverview(i: OverviewInputs): AccountOverviewView {
  const anchorToday = todayInTz(i.anchorTimezone, i.now)
  const rows: OverviewStoreRow[] = []
  const missing: string[] = []

  for (const s of i.stores) {
    const p = i.pnl.get(s.id)
    if (!p) { missing.push(s.id); continue }
    const tz = safeTz(p.store.timezone || s.timezone)
    const storeToday = todayInTz(tz, i.now)
    const dayState = dayStateOf(i.range, storeToday, anchorToday)
    const freshness = storeFreshness(s.id, i.syncRows, i.liveCovered.has(s.id), i.now)
    const row: OverviewStoreRow = {
      id: s.id, name: s.name, timezone: tz, storeToday, dayState,
      configured: p.configured, partial: p.partial, minutesCovered: p.minutesCovered,
      totals: p.totals, freshness, badges: [],
      blindToChargebacks: !i.chargebackSeen.has(s.id),
      refundsAlreadyDropped: i.refundsDropped.get(s.id) ?? 0,
      sharedAdAccounts: i.shared.filter(x => x.adStoreId === s.id || x.salesStoreId === s.id),
    }
    // An archived store (the "arquivadas" view) is not synced any more: its
    // age is expected and must not be flagged as late.
    row.badges = badgesFor({ ...row, archived: p.store.archived }, i.range)
    rows.push(row)
  }
  rows.sort((a, b) => b.totals.operatingProfit - a.totals.operatingProfit)

  const daily = eachDay(i.range.from, i.range.to).map(date =>
    dayPoint(date, sumPnL(rows.map(r => i.pnl.get(r.id)!.daily.find(d => d.date === date)).filter(<T>(x: T | undefined): x is T => !!x))))

  const successes = rows
    .flatMap(r => [r.freshness.orders.lastSuccessAt, r.freshness.ads?.lastSuccessAt ?? null])
    .filter((x): x is string => !!x)
    .sort()
  const generatedAt = i.now.toISOString()

  return {
    generatedAt,
    period: i.period,
    range: i.range,
    rangeLabel: formatRange(i.range, anchorToday),
    anchorTimezone: i.anchorTimezone,
    anchorToday,
    storeIds: rows.map(r => r.id),
    totals: sumPnL(rows.map(r => r.totals)),
    configured: rows.every(r => r.configured),
    unconfiguredStoreIds: rows.filter(r => !r.configured).map(r => r.id),
    stores: rows,
    daily,
    adjustmentsByStore: rows
      .filter(r => r.totals.adjustments > 0)
      .map(r => ({
        storeId: r.id, name: r.name,
        refunds: r.totals.refunds, refundGross: r.totals.refundGross, refundCount: r.totals.refundCount,
        chargebacks: r.totals.chargebacks, chargebackFees: r.totals.chargebackFees,
        chargebackCount: r.totals.chargebackCount, adjustments: r.totals.adjustments,
      }))
      .sort((a, b) => b.adjustments - a.adjustments),
    sharedAdAccounts: i.shared,
    sharedAccountNote: i.shared.length ? SHARED_ACCOUNT_NOTE : null,
    freshness: {
      generatedAt,
      oldestSuccessAt: successes[0] ?? null,
      newestSuccessAt: successes[successes.length - 1] ?? null,
      staleStores: rows.filter(r => r.freshness.stale && !i.pnl.get(r.id)!.store.archived).map(r => ({
        storeId: r.id, name: r.name, failing: r.freshness.failing,
        sources: [r.freshness.orders, r.freshness.ads]
          .filter((x): x is NonNullable<typeof x> => !!x && x.stale)
          .map(x => x.source),
      })),
    },
    missingStoreIds: missing,
  }
}

// ─── Loading ──────────────────────────────────────────────────────────────────

/** Newest run per store and source over the last week. */
async function loadSyncRows(ids: string[]): Promise<SyncRow[]> {
  return query<SyncRow>(
    `SELECT tenant_id, source,
            MAX(finished_at) FILTER (WHERE status = 'success') AS last_success,
            MAX(started_at) AS last_started,
            (ARRAY_AGG(status ORDER BY started_at DESC))[1] AS last_status
       FROM sync_runs
      WHERE tenant_id = ANY($1::text[])
        AND source IN ('shopify', 'facebook')
        AND started_at > now() - interval '7 days'
      GROUP BY 1, 2`, [ids])
}

/** Stores whose order webhook delivered something in the last 30 days. */
async function loadLiveCovered(ids: string[]): Promise<Set<string>> {
  const rows = await query<{ tenant_id: string }>(
    `SELECT DISTINCT tenant_id FROM live_orders
      WHERE tenant_id = ANY($1::text[]) AND received_at > now() - interval '30 days'`, [ids])
  return new Set(rows.map(r => r.tenant_id))
}

/**
 * Per store: has any chargeback ever been read, and how much of the window's
 * refunds belong to orders the engine already dropped (the engine's own rule:
 * the order is known and fully refunded; yen converted with the order's rate,
 * an unconvertible amount left out).
 */
async function loadAdjustmentFacts(ids: string[], range: DateRange): Promise<{ seen: Set<string>; dropped: Map<string, number> }> {
  const [seen, dropped] = await Promise.all([
    query<{ tenant_id: string }>(
      `SELECT DISTINCT tenant_id FROM order_adjustments WHERE kind = 'chargeback' AND tenant_id = ANY($1::text[])`, [ids]),
    query<{ tenant_id: string; usd: number }>(
      `SELECT a.tenant_id,
              SUM(CASE WHEN a.currency IS NULL OR a.currency = 'USD' THEN a.amount
                       WHEN o.fx_rate IS NOT NULL AND o.currency = a.currency THEN a.amount * o.fx_rate
                       ELSE 0 END)::float8 AS usd
         FROM order_adjustments a
         JOIN shopify_orders o ON o.order_id = a.order_id AND o.tenant_id = a.tenant_id
        WHERE a.kind = 'refund' AND o.financial_status = 'refunded'
          AND a.tenant_id = ANY($1::text[]) AND a.event_date BETWEEN $2::date AND $3::date
        GROUP BY 1`, [ids, range.from, range.to]),
  ])
  return { seen: new Set(seen.map(r => r.tenant_id)), dropped: new Map(dropped.map(r => [r.tenant_id, Number(r.usd) || 0])) }
}

/** The overview for explicit dates (each store reads them on its own calendar). */
export async function accountOverviewForRange(
  stores: readonly OverviewStoreInput[], range: DateRange,
  opts: { period?: Period | null; now?: Date } = {},
): Promise<AccountOverviewView> {
  if (!isIsoDate(range.from) || !isIsoDate(range.to) || range.from > range.to) {
    throw new RangeError(`invalid range ${range.from}..${range.to}`)
  }
  const now = opts.now ?? new Date()
  const unique = [...new Map(stores.map(s => [s.id, s])).values()]
  const ids = unique.map(s => s.id)
  const anchor = anchorTz(unique.map(s => s.timezone))
  const names = new Map(unique.map(s => [s.id, s.name]))

  // Freshness, chargeback and shared-account facts decorate the numbers; a
  // failure there must not blank the overview, so each falls back on its own.
  const [pnl, syncRows, liveCovered, adj, shared] = ids.length
    ? await Promise.all([
        computePnL(ids, range, {}, now),
        loadSyncRows(ids).catch(err => { console.error('[overview] sync runs', err); return [] as SyncRow[] }),
        loadLiveCovered(ids).catch(err => { console.error('[overview] live orders', err); return new Set<string>(ids) }),
        loadAdjustmentFacts(ids, range).catch(err => {
          console.error('[overview] adjustments', err)
          return { seen: new Set<string>(ids), dropped: new Map<string, number>() }
        }),
        getSharedAdAccounts(ids, range, names).catch(err => { console.error('[overview] shared accounts', err); return [] as SharedAdAccount[] }),
      ])
    : [new Map<string, StorePnL>(), [] as SyncRow[], new Set<string>(), { seen: new Set<string>(), dropped: new Map<string, number>() }, [] as SharedAdAccount[]] as const

  return assembleOverview({
    stores: unique, period: opts.period ?? null, range, anchorTimezone: anchor, now,
    pnl, syncRows, liveCovered, chargebackSeen: adj.seen, refundsDropped: adj.dropped, shared,
  })
}

/**
 * The overview for a period preset, resolved on the server on the anchor
 * clock. "custom" needs two valid dates (RangeError otherwise).
 */
export async function buildAccountOverview(
  stores: readonly OverviewStoreInput[], period: Period,
  from?: string | null, to?: string | null, now: Date = new Date(),
): Promise<AccountOverviewView> {
  if (period === 'custom' && !(isIsoDate(from) && isIsoDate(to))) {
    throw new RangeError('Escolha a data inicial e a final')
  }
  const anchor = anchorTz(stores.map(s => s.timezone))
  return accountOverviewForRange(stores, resolveRange(period, anchor, from, to, now), { period, now })
}
