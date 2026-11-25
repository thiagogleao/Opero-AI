/**
 * The store facts the period rules need (lib/period ViewerStores), read once
 * per request for the viewer's stores: the archive instant, the first kept
 * order and the first activity (order, ad spend, refund or chargeback), each
 * on the store's own calendar. Server only.
 *
 * A failed read never blanks a page and never invents a fact: the archive
 * instant comes from its own small read (tenants.archived_at), and first
 * dates that could not be read are UNKNOWN — taken as before every window
 * (MIN_DATE), so every window reads as a normal window with its comparison.
 * They never turn into null, which means "never sold" ("ainda não vendeu",
 * no comparison), and an archived store is never dated at the epoch.
 */

import { query } from '../db'
import { KEPT_ORDER_SQL } from '../engine/pnl'
import { isIsoDate } from '../engine/dates'
import { listStores, type StoreRef, type Viewer } from '../access'
import { viewerStores } from '../period/viewer'
import { MIN_DATE } from '../period/value'
import type { ViewerStores } from '../period/types'

interface FactRow {
  id: string
  archived_at: string | null
  first_order: string | null
  first_activity: string | null
}

/** One query for all ids: archive instant and first dates in the store's zone. */
async function loadFacts(ids: readonly string[]): Promise<Map<string, FactRow>> {
  if (!ids.length) return new Map()
  const rows = await query<FactRow>(
    `WITH t AS (
       SELECT id, archived_at, COALESCE(timezone, 'UTC') AS tz FROM tenants WHERE id = ANY($1::text[])
     ),
     fo AS (
       SELECT o.tenant_id, MIN(o.created_at) AS at FROM shopify_orders o
        WHERE o.tenant_id = ANY($1::text[]) AND ${KEPT_ORDER_SQL} GROUP BY o.tenant_id
     ),
     fm AS (
       SELECT tenant_id, MIN(date) AS d FROM fb_ad_daily_metrics
        WHERE tenant_id = ANY($1::text[]) AND spend > 0 GROUP BY tenant_id
     ),
     fa AS (
       SELECT tenant_id, MIN(event_date) AS d FROM order_adjustments
        WHERE tenant_id = ANY($1::text[]) GROUP BY tenant_id
     )
     SELECT t.id,
            to_char(t.archived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS archived_at,
            (fo.at AT TIME ZONE t.tz)::date::text AS first_order,
            LEAST((fo.at AT TIME ZONE t.tz)::date, fm.d, fa.d)::text AS first_activity
       FROM t
       LEFT JOIN fo ON fo.tenant_id = t.id
       LEFT JOIN fm ON fm.tenant_id = t.id
       LEFT JOIN fa ON fa.tenant_id = t.id`,
    [[...ids]],
  )
  return new Map(rows.map(r => [r.id, r]))
}

/** The archive instants alone: a read too small to fail with the facts'
 *  joins, so an archived store keeps its real archive day when they fail. */
async function loadArchivedAt(ids: readonly string[]): Promise<Map<string, string | null>> {
  if (!ids.length) return new Map()
  const rows = await query<{ id: string; archived_at: string | null }>(
    `SELECT id, to_char(archived_at AT TIME ZONE 'UTC', 'YYYY-MM-DD"T"HH24:MI:SS.MS"Z"') AS archived_at
       FROM tenants WHERE id = ANY($1::text[])`, [[...ids]])
  return new Map(rows.map(r => [r.id, r.archived_at]))
}

/** First Shopify-ads spend: its own table may be absent on older databases. */
async function loadShopSpendStart(ids: readonly string[]): Promise<Map<string, string>> {
  if (!ids.length) return new Map()
  try {
    const rows = await query<{ tenant_id: string; d: string | null }>(
      `SELECT tenant_id, MIN(date)::text AS d FROM shop_campaign_daily
        WHERE tenant_id = ANY($1::text[]) AND spend > 0 GROUP BY tenant_id`, [[...ids]])
    return new Map(rows.filter(r => isIsoDate(r.d)).map(r => [r.tenant_id, r.d as string]))
  } catch {
    return new Map()
  }
}

/** ViewerStores for a list of stores (archived ones included). */
export async function viewerStoresOf(stores: readonly (Pick<StoreRef, 'id' | 'name' | 'timezone'> & { archived: boolean })[]): Promise<ViewerStores> {
  const ids = stores.map(s => s.id)
  let facts: Map<string, FactRow> | null = null
  let shop = new Map<string, string>()
  let archivedAt = new Map<string, string | null>()
  try {
    ;[facts, shop] = await Promise.all([loadFacts(ids), loadShopSpendStart(ids)])
  } catch (err) {
    console.error('[periodFacts]', err)
    facts = null
    archivedAt = await loadArchivedAt(ids).catch(e => { console.error('[periodFacts] archived_at', e); return new Map<string, string | null>() })
  }
  return viewerStores(stores.map(s => {
    if (!facts) {
      // Unknown, not "never sold": before every window (see the header).
      return {
        id: s.id, name: s.name, timezone: s.timezone, archived: s.archived,
        archivedAt: archivedAt.get(s.id) ?? null,
        firstOrderDate: MIN_DATE,
        firstActivityDate: MIN_DATE,
      }
    }
    const f = facts.get(s.id)
    const firstOrder = isIsoDate(f?.first_order) ? f!.first_order : null
    const acts = [f?.first_activity, shop.get(s.id)].filter((d): d is string => isIsoDate(d))
    return {
      id: s.id, name: s.name, timezone: s.timezone, archived: s.archived,
      archivedAt: f?.archived_at ?? null,
      firstOrderDate: firstOrder,
      firstActivityDate: acts.length ? acts.sort()[0] : firstOrder,
    }
  }))
}

/** ViewerStores of everything the viewer may see. */
export async function loadViewerStores(viewer: Viewer): Promise<{ viewerStores: ViewerStores; all: StoreRef[] }> {
  const all = await listStores(viewer, { includeArchived: true })
  return { viewerStores: await viewerStoresOf(all), all }
}
