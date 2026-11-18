/**
 * Server loaders for "Todas as lojas" beyond the portfolio itself
 * (lib/views/portfolio buildPortfolio gives the totals, the per-store rows on
 * each store's own calendar and the comparison):
 *
 *   loadRowExtras     per store: the sparkline days, freshness per source
 *                     (lib/sync/status — the same reading as the top bar),
 *                     shared ad-account pairs and the selling currency
 *   loadArchived      archived stores' whole history, only when the section
 *                     is opened
 *
 * Callers pass stores already resolved by lib/access (getPageContext); nothing
 * here decides who may see what.
 */

import 'server-only'
import { query } from '@/lib/db'
import { computePnL, type PnL } from '@/lib/engine/pnl'
import { shiftDate, todayInTz, type DateRange } from '@/lib/engine/dates'
import { getSharedAdAccounts } from '@/lib/attribution'
import type { SharedAdAccount } from '@/lib/attributionModels'
import { getFreshness, type StoreFreshness } from '@/lib/sync/status'
import { listStores, type StoreRef, type Viewer } from '@/lib/access'
import { trailRange } from './model'

/** How far back a shared ad-account pair is looked for. The pairing is a
 *  property of the stores, not of the week: CAMP HALLOW's ads ran on EPOCH's
 *  account even in a week it sold nothing. */
export const SHARED_LOOKBACK_DAYS = 90
/** Fewer cross-store orders than this in the lookback are stray clicks (a
 *  shopper who saw one store's ad and bought in the other), not a store
 *  selling on another's account: Dumpling 8jcp3a → hzsjyp had 4 in 90 days,
 *  EPOCH → CAMP HALLOW 446. */
export const SHARED_MIN_ORDERS = 20

export interface TrailPoint { date: string; profit: number; revenue: number; adSpend: number }

export interface RowExtras {
  trailRange: DateRange
  trail: Map<string, TrailPoint[]>
  freshness: Map<string, StoreFreshness>
  shared: SharedAdAccount[]
  /** The pairs counted inside the window; null when that read failed. */
  sharedNow: SharedAdAccount[] | null
  currencies: Map<string, string>
}

/**
 * Pairs of the view's stores where one sells on ads billed to the other
 * (EPOCH → CAMP HALLOW), over the last 90 days on the anchor clock, from our
 * own journey data. Loaded with the portfolio: the verdict area names the pair
 * so the profit of either store is never read alone. A failure returns [].
 */
export async function loadSharedPairs(stores: readonly StoreRef[], anchorTz: string, now: Date): Promise<SharedAdAccount[]> {
  if (stores.length < 2) return []
  const today = todayInTz(anchorTz, now)
  const lookback = { from: shiftDate(today, -(SHARED_LOOKBACK_DAYS - 1)), to: today }
  const names = new Map(stores.map(s => [s.id, s.name]))
  try {
    const pairs = await getSharedAdAccounts(stores.map(s => s.id), lookback, names)
    return pairs.filter(x => x.orders >= SHARED_MIN_ORDERS)
  } catch (err) {
    console.error('[overview] shared accounts', err)
    return []
  }
}

/**
 * The same pairs counted inside the page's window (any number of orders): the
 * 90-day pairing says the two stores' books CAN be mixed, this says whether
 * the window on screen IS (CAMP HALLOW stopped selling on 30 out; a November
 * week of EPOCH is not inflated by it). Null when the read fails, so callers
 * fall back to the cautious 90-day wording.
 */
export async function loadSharedInWindow(stores: readonly StoreRef[], range: DateRange): Promise<SharedAdAccount[] | null> {
  if (stores.length < 2) return []
  try {
    return await getSharedAdAccounts(stores.map(s => s.id), range, new Map(stores.map(s => [s.id, s.name])))
  } catch (err) {
    console.error('[overview] shared accounts in window', err)
    return null
  }
}

async function loadCurrencies(ids: string[]): Promise<Map<string, string>> {
  const rows = await query<{ tenant_id: string; currency: string }>(
    `SELECT DISTINCT ON (tenant_id) tenant_id, currency
       FROM shopify_orders
      WHERE tenant_id = ANY($1::text[]) AND currency IS NOT NULL
      ORDER BY tenant_id, created_at DESC`, [ids])
  return new Map(rows.filter(r => r.currency && r.currency.toUpperCase() !== 'USD').map(r => [r.tenant_id, r.currency.toUpperCase()]))
}

/**
 * Everything the store rows add to the portfolio. Each part decorates the
 * numbers and falls back on its own: a failure here never blanks the table.
 */
export async function loadRowExtras(
  stores: readonly StoreRef[], range: DateRange, now: Date, shared: SharedAdAccount[], sharedNow: SharedAdAccount[] | null,
): Promise<RowExtras> {
  const ids = stores.map(s => s.id)
  const tr = trailRange(range)
  const [pnl, fresh, currencies] = await Promise.all([
    computePnL(ids, tr, {}, now).catch(err => { console.error('[overview] trail', err); return null }),
    getFreshness(ids, now).catch(err => { console.error('[overview] freshness', err); return [] as StoreFreshness[] }),
    loadCurrencies(ids).catch(err => { console.error('[overview] currencies', err); return new Map<string, string>() }),
  ])
  const trail = new Map<string, TrailPoint[]>()
  for (const id of ids) {
    const p = pnl?.get(id)
    if (p) trail.set(id, p.daily.map(d => ({ date: d.date, profit: d.operatingProfit, revenue: d.revenue, adSpend: d.adSpend })))
  }
  return {
    trailRange: tr, trail,
    freshness: new Map(fresh.map(f => [f.storeId, f])),
    shared, sharedNow, currencies,
  }
}

// ─── Archived stores ─────────────────────────────────────────────────────────

export interface ArchivedStore {
  store: StoreRef
  archivedAt: string | null
  /** First and last order dates on the store's own calendar; null without orders. */
  span: DateRange | null
  totals: PnL | null
  configured: boolean
}

/**
 * The viewer's archived stores with their whole selling history, priced by the
 * engine over the span of their orders. Only called when the section is open.
 */
export async function loadArchived(viewer: Viewer, now: Date): Promise<ArchivedStore[]> {
  const archived = (await listStores(viewer, { includeArchived: true })).filter(s => s.archived)
  if (!archived.length) return []
  // The span covers orders AND ad spend: spend on days without a sale is part
  // of the history too.
  const facts = await query<{ id: string; archived_at: Date | null; first_d: string | null; last_d: string | null }>(
    `SELECT t.id, t.archived_at,
            LEAST(o.first_d, m.first_d)::text AS first_d,
            GREATEST(o.last_d, m.last_d)::text AS last_d
       FROM tenants t
       LEFT JOIN LATERAL (
         SELECT MIN((x.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date) AS first_d,
                MAX((x.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date) AS last_d
           FROM shopify_orders x WHERE x.tenant_id = t.id) o ON true
       LEFT JOIN LATERAL (
         SELECT MIN(f.date) AS first_d, MAX(f.date) AS last_d
           FROM fb_ad_daily_metrics f WHERE f.tenant_id = t.id) m ON true
      WHERE t.id = ANY($1::text[])`, [archived.map(s => s.id)])
  const byId = new Map(facts.map(f => [f.id, f]))
  return Promise.all(archived.map(async store => {
    const f = byId.get(store.id)
    const span = f?.first_d && f.last_d ? { from: f.first_d, to: f.last_d } : null
    const p = span ? (await computePnL([store.id], span, {}, now)).get(store.id) ?? null : null
    return {
      store,
      archivedAt: f?.archived_at ? new Date(f.archived_at).toISOString() : null,
      span,
      totals: p?.totals ?? null,
      configured: p?.configured ?? false,
    }
  }))
}
