import { query } from '../db'
import { tableColumns } from './schema'
import type { Lane, PassHistory } from './plan'

/**
 * sync_runs and the stores the scheduler collects — the database side of the
 * sync, kept apart from the pure planning in plan.ts.
 */

// ─── Targets ──────────────────────────────────────────────────────────────────

export interface AdAccountTarget {
  accountId: string
  primary: boolean
  /** Linked and switched on (extra accounts can be paused). */
  enabled: boolean
  /** Meta's account_status as last seen (1 = active), null when never read. */
  status: number | null
  /** First day this account's data belongs to the store (YYYY-MM-DD). */
  collectFrom: string | null
}

export interface SyncTarget {
  id: string
  name: string
  timezone: string
  hasShopify: boolean
  accounts: AdAccountTarget[]
}

export const normalizeAccount = (raw: string) => {
  const n = raw.replace(/^act[_=:]?/, '').replace(/^[_=:\s]+/, '').trim()
  return n ? `act_${n}` : raw
}

/** Collected = switched on and not known dead (account_status 1 or unread). */
export const collectable = (a: AdAccountTarget) => a.enabled && (a.status === null || a.status === 1)

/**
 * Active (not archived) stores with what can be collected for each. Pass ids
 * to restrict; archived stores are never returned — they keep their history
 * and are not synced.
 */
export async function loadTargets(ids?: string[]): Promise<SyncTarget[]> {
  const [tenantCols, extraCols] = await Promise.all([tableColumns('tenants'), tableColumns('tenant_fb_accounts')])
  const cut = tenantCols.has('fb_collect_from') ? `t.fb_collect_from::text` : `NULL::text`
  const extraCut = extraCols.has('collect_from') ? `collect_from::text` : `NULL::text`
  const stores = await query<{
    id: string; name: string; timezone: string; has_shopify: boolean
    fb_ad_account_id: string | null; has_fb_token: boolean; fb_collect_from: string | null
  }>(
    `SELECT t.id, COALESCE(t.shop_name, t.shopify_domain, t.id) AS name, COALESCE(t.timezone, 'UTC') AS timezone,
            (t.shopify_domain IS NOT NULL AND (t.shopify_access_token IS NOT NULL
              OR (t.shopify_client_id IS NOT NULL AND t.shopify_client_secret IS NOT NULL))) AS has_shopify,
            t.fb_ad_account_id, (t.fb_access_token IS NOT NULL) AS has_fb_token, ${cut} AS fb_collect_from
       FROM tenants t
      WHERE t.archived_at IS NULL AND t.shopify_domain IS NOT NULL
        ${ids ? 'AND t.id = ANY($1::text[])' : ''}
      ORDER BY t.created_at`,
    ids ? [ids] : [],
  )
  if (!stores.length) return []
  const storeIds = stores.map(s => s.id)
  const [extras, statuses] = await Promise.all([
    query<{ tenant_id: string; fb_ad_account_id: string; is_active: boolean; collect_from: string | null }>(
      `SELECT tenant_id, fb_ad_account_id, is_active, ${extraCut} AS collect_from
         FROM tenant_fb_accounts WHERE tenant_id = ANY($1::text[]) ORDER BY id`, [storeIds]),
    query<{ account_id: string; account_status: number | null }>(
      `SELECT account_id, account_status FROM fb_ad_accounts`),
  ])
  const status = new Map(statuses.map(s => [normalizeAccount(s.account_id), s.account_status]))
  return stores.map(s => {
    const accounts: AdAccountTarget[] = []
    if (s.fb_ad_account_id) {
      const id = normalizeAccount(s.fb_ad_account_id)
      accounts.push({ accountId: id, primary: true, enabled: s.has_fb_token, status: status.get(id) ?? null, collectFrom: s.fb_collect_from })
    }
    for (const e of extras) {
      if (e.tenant_id !== s.id) continue
      const id = normalizeAccount(e.fb_ad_account_id)
      if (accounts.some(a => a.accountId === id)) continue
      accounts.push({ accountId: id, primary: false, enabled: e.is_active, status: status.get(id) ?? null, collectFrom: e.collect_from })
    }
    return { id: s.id, name: s.name, timezone: s.timezone, hasShopify: s.has_shopify, accounts }
  })
}

// ─── Run history ──────────────────────────────────────────────────────────────

export interface RunSummary {
  tenantId: string
  source: string
  mode: string | null
  accountId: string | null
  lastSuccessAt: Date | null
  lastSuccessFinishedAt: Date | null
  lastAttemptAt: Date | null
  /** Earliest date_from (YYYY-MM-DD) of a successful run: how far back this
   *  store/source/account has been collected. */
  earliestSuccessFrom: string | null
}

async function v2Columns(): Promise<{ mode: boolean; account: boolean }> {
  const cols = await tableColumns('sync_runs')
  return { mode: cols.has('mode'), account: cols.has('account_id') }
}

/** Last success and last attempt per store, source, mode and account. */
export async function runHistory(tenantIds: string[]): Promise<RunSummary[]> {
  if (!tenantIds.length) return []
  const v2 = await v2Columns()
  const mode = v2.mode ? 'mode' : 'NULL::text'
  const account = v2.account ? 'account_id' : 'NULL::text'
  const rows = await query<{
    tenant_id: string; source: string; mode: string | null; account_id: string | null
    last_success: Date | null; last_success_finished: Date | null; last_attempt: Date | null
    earliest_from: string | null
  }>(
    `SELECT tenant_id, source, ${mode} AS mode, ${account} AS account_id,
            MAX(started_at)  FILTER (WHERE status IN ('success', 'partial')) AS last_success,
            MAX(finished_at) FILTER (WHERE status IN ('success', 'partial')) AS last_success_finished,
            MAX(started_at) AS last_attempt,
            MIN(date_from)   FILTER (WHERE status IN ('success', 'partial')) AS earliest_from
       FROM sync_runs
      WHERE tenant_id = ANY($1::text[])
      GROUP BY 1, 2, 3, 4`,
    [tenantIds],
  )
  return rows.map(r => ({
    tenantId: r.tenant_id, source: r.source, mode: r.mode,
    accountId: r.account_id ? normalizeAccount(r.account_id) : null,
    lastSuccessAt: r.last_success ? new Date(r.last_success) : null,
    lastSuccessFinishedAt: r.last_success_finished ? new Date(r.last_success_finished) : null,
    lastAttemptAt: r.last_attempt ? new Date(r.last_attempt) : null,
    earliestSuccessFrom: r.earliest_from ?? null,
  }))
}

/** sync_runs carries mode and account_id (the v2 migration ran). Planning that
 *  tells passes or accounts apart needs both; without them it would see every
 *  re-pull as never done and relaunch it every cycle. */
export async function runsHaveV2Columns(): Promise<boolean> {
  const v2 = await v2Columns()
  return v2.mode && v2.account
}

const latest = (ds: (Date | null)[]): Date | null =>
  ds.filter((d): d is Date => !!d).sort((a, b) => b.getTime() - a.getTime())[0] ?? null

/** History of one lane of one store, optionally only some modes. */
export function laneHistory(rows: RunSummary[], tenantId: string, lane: Lane, modes?: string[]): PassHistory {
  const mine = rows.filter(r => r.tenantId === tenantId && r.source === lane && (!modes || modes.includes(r.mode ?? '')))
  return { success: latest(mine.map(r => r.lastSuccessAt)), attempt: latest(mine.map(r => r.lastAttemptAt)) }
}

/** How far back an ad account has been collected for a store, and when its
 *  last backfill was attempted (to space out retries of a failing one). */
export function accountCollection(rows: RunSummary[], tenantId: string, accountId: string): {
  earliestCollectedFrom: string | null; lastBackfillAttempt: Date | null
} {
  const mine = rows.filter(r => r.tenantId === tenantId && r.source === 'facebook' && r.accountId === accountId)
  const froms = mine.map(r => r.earliestSuccessFrom).filter((d): d is string => !!d).sort()
  return {
    earliestCollectedFrom: froms[0] ?? null,
    lastBackfillAttempt: latest(mine.filter(r => r.mode === 'backfill').map(r => r.lastAttemptAt)),
  }
}

export interface AccountRows {
  /** First day of the store's Meta rows tagged with each account. */
  firstDay: Map<string, string>
  /** The store holds Meta rows with no account tag (collected before rows carried one). */
  untagged: boolean
  /** Accounts with an ad that also appears in the store's untagged rows. */
  continuing: Set<string>
}

/** What a store's Meta rows say about each ad account (see accountNeedsBackfill). */
export async function accountRows(tenantIds: string[]): Promise<Map<string, AccountRows>> {
  const out = new Map<string, AccountRows>()
  if (!tenantIds.length) return out
  const get = (t: string): AccountRows => {
    let r = out.get(t)
    if (!r) out.set(t, r = { firstDay: new Map(), untagged: false, continuing: new Set() })
    return r
  }
  const [days, continuing] = await Promise.all([
    query<{ tenant_id: string; tag: string | null; first_day: string }>(
      `SELECT tenant_id, fb_ad_account_id AS tag, MIN(date)::text AS first_day
         FROM fb_ad_daily_metrics WHERE tenant_id = ANY($1::text[]) GROUP BY 1, 2`,
      [tenantIds]),
    query<{ tenant_id: string; tag: string }>(
      `SELECT DISTINCT t.tenant_id, t.fb_ad_account_id AS tag
         FROM fb_ad_daily_metrics t
        WHERE t.tenant_id = ANY($1::text[]) AND t.fb_ad_account_id IS NOT NULL
          AND EXISTS (SELECT 1 FROM fb_ad_daily_metrics u
                       WHERE u.tenant_id = t.tenant_id AND u.ad_id = t.ad_id AND u.fb_ad_account_id IS NULL)`,
      [tenantIds]),
  ])
  for (const r of days) {
    const a = get(r.tenant_id)
    if (!r.tag) { a.untagged = true; continue }
    const id = normalizeAccount(r.tag)
    const prev = a.firstDay.get(id)
    if (!prev || r.first_day < prev) a.firstDay.set(id, r.first_day)
  }
  for (const r of continuing) get(r.tenant_id).continuing.add(normalizeAccount(r.tag))
  return out
}

/** Newest order per store (the "last order" a dark store shows). */
export async function lastOrders(tenantIds: string[]): Promise<Map<string, Date>> {
  if (!tenantIds.length) return new Map()
  const rows = await query<{ tenant_id: string; last: Date | null }>(
    `SELECT tenant_id, MAX(created_at) AS last FROM shopify_orders WHERE tenant_id = ANY($1::text[]) GROUP BY 1`,
    [tenantIds],
  )
  return new Map(rows.filter(r => r.last).map(r => [r.tenant_id, new Date(r.last!)]))
}

// ─── Housekeeping ─────────────────────────────────────────────────────────────

/** Runs this process is not running and that started over 15 minutes ago
 *  are closed as interrupted (a killed process, a redeploy). `activeLanes`
 *  are "tenant:source" keys of jobs alive in this process. */
export async function closeStaleRuns(activeLanes: string[]): Promise<number> {
  const rows = await query<{ id: number }>(
    `UPDATE sync_runs
        SET status = 'error', finished_at = now(),
            error_message = COALESCE(error_message || ' · ', '') ||
              'interrompido: o processo não terminou (servidor reiniciado ou tempo esgotado)'
      WHERE status = 'running'
        AND started_at < now() - interval '15 minutes'
        AND NOT ((tenant_id || ':' || source) = ANY($1::text[]))
      RETURNING id`,
    [activeLanes],
  )
  return rows.length
}

/** Keep 30 days, plus the newest success of every store/source/account. */
export async function pruneRuns(): Promise<number> {
  const v2 = await v2Columns()
  const acc = v2.account ? `COALESCE(account_id, '')` : `''`
  const rows = await query<{ id: number }>(
    `DELETE FROM sync_runs r
      WHERE r.started_at < now() - interval '30 days'
        AND r.id NOT IN (
          SELECT DISTINCT ON (tenant_id, source, ${acc}) id
            FROM sync_runs WHERE status = 'success'
           ORDER BY tenant_id, source, ${acc}, started_at DESC)
      RETURNING r.id`,
  )
  return rows.length
}

/** A finished run for a pass that runs inside Node (refunds/disputes). */
export async function recordRun(r: {
  tenantId: string; source: string; status: 'success' | 'error'; message?: string | null
  mode?: string; records?: number; startedAt: Date
}): Promise<void> {
  const v2 = await v2Columns()
  const cols = ['tenant_id', 'source', 'status', 'started_at', 'finished_at', 'records_collected', 'error_message']
  const vals: unknown[] = [r.tenantId, r.source, r.status, r.startedAt, new Date(), r.records ?? 0, r.message ? r.message.slice(0, 600) : null]
  if (v2.mode) { cols.push('mode'); vals.push(r.mode ?? null) }
  await query(
    `INSERT INTO sync_runs (${cols.join(', ')}) VALUES (${vals.map((_, i) => `$${i + 1}`).join(', ')})`,
    vals,
  )
}
