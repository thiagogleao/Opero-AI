import { query } from '../db'
import { laneBusy, redactText, snapshot, type JobSnapshot } from './jobs'
import { staleness, type Lane, type Staleness } from './plan'
import { collectable, lastOrders, loadTargets, normalizeAccount, runHistory, type RunSummary, type SyncTarget } from './runs'
import { tableColumns } from './schema'

/**
 * How fresh each store's data is, per source and per ad account — what the
 * "Pedidos atualizados às HH:MM · Meta às HH:MM" labels and the refresh panel
 * read. Hibikura stopped importing orders for ~38 h and nothing on screen
 * changed; every store now reports its own last success and last order.
 */

export interface LaneFreshness {
  /** When the last successful run finished (ISO). */
  lastSuccessAt: string | null
  /** When the last run of any outcome started (ISO). */
  lastAttemptAt: string | null
  lastStatus: 'running' | 'success' | 'partial' | 'error' | null
  /** Short Portuguese reason of the last failure (or warning on a success). */
  lastMessage: string | null
  /** A job for this lane is running or waiting in this server. */
  busy: boolean
  staleness: Staleness
}

export interface AccountFreshness {
  accountId: string
  primary: boolean
  enabled: boolean
  /** Meta account_status (1 = active); a non-1 account is not collected. */
  status: number | null
  collected: boolean
  collectFrom: string | null
  lastSuccessAt: string | null
  lastStatus: LaneFreshness['lastStatus']
  lastMessage: string | null
}

export interface StoreFreshness {
  storeId: string
  /** Newest order in the database (ISO). */
  lastOrderAt: string | null
  shopify: LaneFreshness | null
  /** null when the store has no ad account to collect. */
  facebook: LaneFreshness | null
  /** Campaign structure and breakdowns. */
  structure: LaneFreshness | null
  accounts: AccountFreshness[]
}

interface LatestRun {
  tenant_id: string; source: string; account_id: string | null; status: string
  started_at: Date; finished_at: Date | null; error_message: string | null; records_collected: number | null
}

/** The newest run per store, source and account (uses the v2 status index). */
async function latestRuns(ids: string[]): Promise<LatestRun[]> {
  if (!ids.length) return []
  const hasAccount = (await tableColumns('sync_runs')).has('account_id')
  const acc = hasAccount ? 'account_id' : 'NULL::text'
  return query<LatestRun>(
    `SELECT DISTINCT ON (tenant_id, source, ${acc})
            tenant_id, source, ${acc} AS account_id, status, started_at, finished_at, error_message, records_collected
       FROM sync_runs
      WHERE tenant_id = ANY($1::text[])
        AND source IN ('shopify', 'facebook', 'facebook_structure')
        AND started_at > now() - interval '30 days'
      ORDER BY tenant_id, source, ${acc}, started_at DESC`,
    [ids],
  )
}

const iso = (d: Date | null | undefined) => (d ? new Date(d).toISOString() : null)
/** Rows written before the collector redacted its errors can still hold a
 *  token inside a URL: never send one to a browser. */
const safe = (m: string | null | undefined) => (m ? redactText(m).slice(0, 300) : null)
const asStatus = (s: string | null | undefined): LaneFreshness['lastStatus'] =>
  s === 'running' || s === 'success' || s === 'partial' || s === 'error' ? s : null

/**
 * The newest runs that describe a lane's state now. Meta runs written before
 * runs carried an account fold into one untagged group whose newest row stays
 * frozen for 30 days after the migration; once tagged runs exist that group
 * is history. A paused, dead or removed account's last run is not the store's
 * state either (Dumpling's dead main account failed on every cycle).
 */
function currentRuns(latest: LatestRun[], target: SyncTarget, source: Lane): LatestRun[] {
  const runs = latest.filter(r => r.tenant_id === target.id && r.source === source)
  if (source === 'shopify') return runs
  const tagged = runs.filter(r => r.account_id)
  if (!tagged.length) return runs
  const live = new Set(target.accounts.filter(collectable).map(a => a.accountId))
  return tagged.filter(r => live.has(normalizeAccount(r.account_id!)))
}

function lane(
  target: SyncTarget, source: Lane, latest: LatestRun[], history: RunSummary[], now: Date,
): LaneFreshness {
  const tenantId = target.id
  const runs = currentRuns(latest, target, source)
  const newest = runs.sort((a, b) => +new Date(b.started_at) - +new Date(a.started_at))[0]
  // Across accounts: the lane is running if any account runs, failing if the
  // newest settled run of any account failed.
  const status: LaneFreshness['lastStatus'] = runs.some(r => r.status === 'running') ? 'running'
    : runs.some(r => r.status === 'error') ? 'error'
    : runs.some(r => r.status === 'partial') ? 'partial'
    : asStatus(newest?.status)
  const failing = runs.find(r => r.status === 'error' || r.status === 'partial')
  const success = history
    .filter(h => h.tenantId === tenantId && h.source === source && h.lastSuccessFinishedAt)
    .map(h => h.lastSuccessFinishedAt as Date)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null
  return {
    lastSuccessAt: iso(success),
    lastAttemptAt: iso(newest?.started_at),
    lastStatus: status,
    lastMessage: safe((failing ?? newest)?.error_message),
    busy: laneBusy(tenantId, source),
    staleness: staleness(source, success, now),
  }
}

export async function getFreshness(storeIds: string[], now: Date = new Date()): Promise<StoreFreshness[]> {
  if (!storeIds.length) return []
  const [targets, latest, history, orders] = await Promise.all([
    loadTargets(storeIds), latestRuns(storeIds), runHistory(storeIds), lastOrders(storeIds),
  ])
  return targets.map(t => {
    const accounts: AccountFreshness[] = t.accounts.map(a => {
      const runs = latest.filter(r => r.tenant_id === t.id && r.source === 'facebook' && r.account_id && normalizeAccount(r.account_id) === a.accountId)
      const ok = history.filter(h => h.tenantId === t.id && h.source === 'facebook' && h.accountId && normalizeAccount(h.accountId) === a.accountId && h.lastSuccessFinishedAt)
        .map(h => h.lastSuccessFinishedAt as Date).sort((x, y) => y.getTime() - x.getTime())[0] ?? null
      return {
        accountId: a.accountId, primary: a.primary, enabled: a.enabled, status: a.status,
        collected: collectable(a), collectFrom: a.collectFrom,
        lastSuccessAt: iso(ok), lastStatus: asStatus(runs[0]?.status), lastMessage: safe(runs[0]?.error_message),
      }
    })
    const hasMeta = t.accounts.some(collectable)
    return {
      storeId: t.id,
      lastOrderAt: iso(orders.get(t.id)),
      shopify: t.hasShopify ? lane(t, 'shopify', latest, history, now) : null,
      facebook: hasMeta ? lane(t, 'facebook', latest, history, now) : null,
      structure: hasMeta ? lane(t, 'facebook_structure', latest, history, now) : null,
      accounts,
    }
  })
}

// ─── Legacy shape (RefreshButton / AutoSync until the UI phase) ───────────────

export interface LegacySourceStatus {
  status: string
  startedAt: string | null
  finishedAt: string | null
  recordsCollected: number
  errorMessage: string | null
  estimatedDurationSeconds: number | null
}

/** The newest run per source for one store, the shape /api/sync-status had.
 *  Facebook folds every account's newest run into one. */
export async function legacyStatus(storeId: string): Promise<{
  shopify: LegacySourceStatus | null; facebook: LegacySourceStatus | null; lastSync: string | null
}> {
  const [latest, [target]] = await Promise.all([latestRuns([storeId]), loadTargets([storeId])])
  const durations = await query<{ source: string; secs: number }>(
    `SELECT DISTINCT ON (source) source, GREATEST(EXTRACT(EPOCH FROM (finished_at - started_at))::int, 1) AS secs
       FROM sync_runs
      WHERE tenant_id = $1 AND status = 'success' AND finished_at IS NOT NULL
        AND source IN ('shopify', 'facebook') AND started_at > now() - interval '7 days'
      ORDER BY source, finished_at DESC`, [storeId])
  const fold = (source: 'shopify' | 'facebook'): LegacySourceStatus | null => {
    const runs = target ? currentRuns(latest, target, source) : latest.filter(r => r.source === source)
    if (!runs.length) return null
    const status = runs.some(r => r.status === 'running') ? 'running' : runs.some(r => r.status === 'error') ? 'error' : 'success'
    const started = runs.map(r => +new Date(r.started_at)).sort((a, b) => b - a)[0]
    const finished = runs.filter(r => r.finished_at).map(r => +new Date(r.finished_at!)).sort((a, b) => b - a)[0]
    return {
      status,
      startedAt: started ? new Date(started).toISOString() : null,
      finishedAt: status === 'running' || !finished ? null : new Date(finished).toISOString(),
      recordsCollected: runs.reduce((s, r) => s + Number(r.records_collected ?? 0), 0),
      errorMessage: safe(runs.find(r => r.status === 'error')?.error_message),
      estimatedDurationSeconds: durations.find(d => d.source === source)?.secs ?? null,
    }
  }
  const shopify = fold('shopify')
  const facebook = fold('facebook')
  // "Last sync" = when every source this store has last succeeded: the older
  // of the two. The old value took the newer one, so the page re-rendered as
  // soon as Shopify finished, before Meta spend had landed.
  const done = [shopify, facebook].filter((s): s is LegacySourceStatus => !!s)
  const lastSync = done.length && done.every(s => s.status !== 'running' && s.finishedAt)
    ? done.map(s => s.finishedAt as string).sort()[0]
    : null
  return { shopify, facebook, lastSync }
}

export type { JobSnapshot }
export { snapshot as jobSnapshot }
