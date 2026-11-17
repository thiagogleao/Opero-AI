/**
 * "Atualizar" on the phone: which collectors to start, for which stores.
 *
 * Only the stores on screen are refreshed (the owner's decision), archived
 * stores never are, and a store/source whose sync started in the last two
 * minutes — by the scheduler, another tap or another device — is not started
 * again: collect_recent.py would exit on its lock anyway, and each spawn is a
 * Python process on the same container as the web server.
 */

import { query } from '../db'
import { safeTz, shiftDate, todayInTz } from '../engine/dates'
import type { StoreRef } from '../access'

export type RefreshSource = 'shopify' | 'facebook'

export const REFRESH_DEBOUNCE_MS = 2 * 60_000
export const REFRESH_STAGGER_MS = 4_000

export interface RefreshTarget {
  id: string
  name: string
  timezone: string
  /** Has an ad account to collect (primary or an active extra one). */
  hasAds: boolean
}

export interface PlannedLaunch {
  storeId: string
  name: string
  source: RefreshSource
  dateFrom: string
  dateTo: string
  mode: 'quick' | null
  /** Started this long after the request, so stores do not hit Shopify and
   *  Meta at the same instant. */
  delayMs: number
}

export interface SkippedLaunch {
  storeId: string
  name: string
  source: RefreshSource
  reason: 'recente' | 'sem_conta_de_anuncio'
  /** When a new refresh of this store/source will be accepted. */
  retryInSeconds: number | null
}

export interface RefreshPlan {
  launch: PlannedLaunch[]
  skipped: SkippedLaunch[]
}

/**
 * Decide what to start. Pure.
 * @param lastStarts newest known start per `${storeId}:${source}` (ms epoch),
 *                   from sync_runs and from this process's own launches.
 */
export function planRefresh(
  targets: readonly RefreshTarget[], lastStarts: ReadonlyMap<string, number>, now: Date,
  staggerMs = REFRESH_STAGGER_MS,
): RefreshPlan {
  const launch: PlannedLaunch[] = []
  const skipped: SkippedLaunch[] = []
  let slot = 0
  for (const t of targets) {
    const today = todayInTz(safeTz(t.timezone), now)
    // Two days back: today is open, and yesterday's late orders and ad spend
    // are often incomplete at the previous sync (same window as the scheduler).
    const dateFrom = shiftDate(today, -2)
    let launchedHere = false
    for (const source of ['shopify', 'facebook'] as const) {
      if (source === 'facebook' && !t.hasAds) {
        skipped.push({ storeId: t.id, name: t.name, source, reason: 'sem_conta_de_anuncio', retryInSeconds: null })
        continue
      }
      const last = lastStarts.get(`${t.id}:${source}`)
      const age = last === undefined ? Infinity : now.getTime() - last
      if (age < REFRESH_DEBOUNCE_MS) {
        skipped.push({
          storeId: t.id, name: t.name, source, reason: 'recente',
          retryInSeconds: Math.ceil((REFRESH_DEBOUNCE_MS - age) / 1000),
        })
        continue
      }
      launch.push({
        storeId: t.id, name: t.name, source, dateFrom, dateTo: today,
        mode: source === 'facebook' ? 'quick' : null, delayMs: slot * staggerMs,
      })
      launchedHere = true
    }
    if (launchedHere) slot++
  }
  return { launch, skipped }
}

/** Stores with an ad account to collect. */
export async function storesWithAds(ids: string[]): Promise<Set<string>> {
  if (!ids.length) return new Set()
  const rows = await query<{ id: string }>(
    `SELECT t.id FROM tenants t
      WHERE t.id = ANY($1::text[])
        AND (t.fb_ad_account_id IS NOT NULL
             OR EXISTS (SELECT 1 FROM tenant_fb_accounts a WHERE a.tenant_id = t.id AND a.is_active))`,
    [ids])
  return new Set(rows.map(r => r.id))
}

/** Newest start per store/source within the debounce window. */
export async function recentStarts(ids: string[]): Promise<Map<string, number>> {
  const out = new Map<string, number>()
  if (!ids.length) return out
  const rows = await query<{ tenant_id: string; source: string; started: Date }>(
    `SELECT tenant_id, source, MAX(started_at) AS started
       FROM sync_runs
      WHERE tenant_id = ANY($1::text[]) AND source IN ('shopify', 'facebook')
        AND started_at > now() - ($2::int * interval '1 millisecond')
      GROUP BY 1, 2`,
    [ids, REFRESH_DEBOUNCE_MS])
  for (const r of rows) out.set(`${r.tenant_id}:${r.source}`, new Date(r.started).getTime())
  return out
}

export interface RunStatus {
  storeId: string
  name: string
  source: RefreshSource
  /** 'running' | 'success' | 'error', or null when no run started since. */
  status: string | null
  startedAt: string | null
  finishedAt: string | null
}

/** Newest run per store/source started at or after `since`: lets the phone
 *  stop "sincronizando…" when the syncs actually finish, not on a timer. */
export async function runsSince(stores: readonly StoreRef[], since: Date): Promise<RunStatus[]> {
  const ids = stores.map(s => s.id)
  if (!ids.length) return []
  const rows = await query<{ tenant_id: string; source: string; status: string; started_at: Date; finished_at: Date | null }>(
    `SELECT DISTINCT ON (tenant_id, source) tenant_id, source, status, started_at, finished_at
       FROM sync_runs
      WHERE tenant_id = ANY($1::text[]) AND source IN ('shopify', 'facebook') AND started_at >= $2
      ORDER BY tenant_id, source, started_at DESC`,
    [ids, since])
  const by = new Map(rows.map(r => [`${r.tenant_id}:${r.source}`, r]))
  return stores.flatMap(s => (['shopify', 'facebook'] as const).map(source => {
    const r = by.get(`${s.id}:${source}`)
    return {
      storeId: s.id, name: s.name, source,
      status: r?.status ?? null,
      startedAt: r ? new Date(r.started_at).toISOString() : null,
      finishedAt: r?.finished_at ? new Date(r.finished_at).toISOString() : null,
    }
  }))
}

// ─── API shapes (POST/GET /api/mobile/refresh) ────────────────────────────────

export interface RefreshResponse {
  requestedAt: string
  /** The stores this refresh is about. */
  stores: { id: string; name: string }[]
  launched: { storeId: string; name: string; source: RefreshSource; startsInSeconds: number }[]
  skipped: SkippedLaunch[]
}

export interface RefreshStatusResponse {
  since: string
  runs: RunStatus[]
  /** Every store/source that started since `since` has finished. */
  done: boolean
}
