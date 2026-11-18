import { query } from '../db'
import type { StoreRef } from '../access'
import { extraAccountCredentials, storeCredentials } from './credentials'
import { inspectToken, readAdAccount } from './facebook'
import { fingerprint } from './keys'
import { fetchShopInfo, readGrantedScopes, REQUIRED_SCOPES } from './shopify'
import type { AdAccountHealth, StoreFacebookHealth, StoreShopifyHealth, SyncStatus } from './types'
import { isoSql } from './sql'
import { accountRuns, summarizeRuns, type SyncRun, type SyncSource } from './syncErrors'

export { sanitizeError } from './syncErrors'

/**
 * Health = does it work, not "is a value stored". The old badges showed ✓ for
 * a store whose main ad account failed every sync (Dumpling fe707ab8) and for
 * EPOCH's deactivated main account. Here each answer combines a live check with
 * what the collector last recorded in sync_runs.
 */

/** The last 7 days of runs of one source, per store, newest first. */
async function loadRuns(storeIds: string[], source: SyncSource): Promise<Map<string, SyncRun[]>> {
  const out = new Map<string, SyncRun[]>()
  if (storeIds.length === 0) return out
  // account_id arrives with the v2 migration; to_jsonb reads it when the
  // column exists and gives null before, so this query works on both schemas.
  const rows = await query<SyncRun & { tenant_id: string }>(
    `SELECT r.tenant_id, r.status, ${isoSql('r.started_at')} AS at, r.error_message,
            to_jsonb(r)->>'account_id' AS account_id
       FROM sync_runs r
      WHERE r.tenant_id = ANY($1::text[]) AND r.source = $2 AND r.started_at > now() - interval '7 days'
      ORDER BY r.started_at DESC`,
    [storeIds, source],
  )
  for (const { tenant_id, ...run } of rows) {
    const list = out.get(tenant_id)
    if (list) list.push(run)
    else out.set(tenant_id, [run])
  }
  return out
}

/** Latest status, last success and 24 h errors (in words, and whether a later
 *  success settled them) of one source for some stores. */
export async function syncStatus(storeIds: string[], source: SyncSource): Promise<Map<string, SyncStatus>> {
  const runs = await loadRuns(storeIds, source)
  const out = new Map<string, SyncStatus>()
  for (const [id, list] of runs) {
    const sum = summarizeRuns(list, source)
    if (sum) out.set(id, sum)
  }
  return out
}

export async function shopifyHealth(stores: StoreRef[]): Promise<StoreShopifyHealth[]> {
  const syncs = await syncStatus(stores.map(s => s.id), 'shopify')
  return Promise.all(stores.map(async (s): Promise<StoreShopifyHealth> => {
    const c = await storeCredentials(s.id)
    const base = {
      id: s.id, name: s.name, domain: s.domain, archived: s.archived,
      connection: c?.devDashboard ? 'dev_dashboard' as const : c?.shopifyToken ? 'token' as const : 'none' as const,
      fingerprint: c?.shopifyToken ? fingerprint(c.shopifyToken) : null,
      tokenExpiresAt: c?.devDashboard ? c.shopifyTokenExpiresAt : null,
      lastSync: syncs.get(s.id) ?? null,
    }
    if (!c?.shopifyDomain || !c.shopifyToken) {
      return { ...base, status: 'missing', httpStatus: null, missingScopes: [], scopeCount: 0 }
    }
    const [shop, scopes] = await Promise.all([
      fetchShopInfo(c.shopifyDomain, c.shopifyToken),
      readGrantedScopes(c.shopifyDomain, c.shopifyToken),
    ])
    const expired = c.devDashboard && !!c.shopifyTokenExpiresAt && Date.parse(c.shopifyTokenExpiresAt) < Date.now()
    const status = shop.ok ? 'ok'
      : shop.status === null ? 'unreachable'
      : shop.status === 401 ? (expired ? 'expired' : 'invalid')
      : 'error'
    return {
      ...base, status, httpStatus: shop.ok ? 200 : shop.status,
      missingScopes: scopes ? REQUIRED_SCOPES.filter(r => !scopes.includes(r.handle)) : [],
      scopeCount: scopes?.length ?? 0,
    }
  }))
}

export async function facebookHealth(store: StoreRef): Promise<StoreFacebookHealth> {
  const [c, extras, runsByStore] = await Promise.all([
    storeCredentials(store.id), extraAccountCredentials(store.id), loadRuns([store.id], 'facebook'),
  ])
  const runs = runsByStore.get(store.id) ?? []
  const slots: { adAccountId: string; role: 'main' | 'extra'; token: string | null; syncing: boolean }[] = []
  if (c?.fbAdAccountId) slots.push({ adAccountId: c.fbAdAccountId, role: 'main', token: c.fbToken, syncing: !!c.fbToken })
  for (const e of extras) slots.push({ adAccountId: e.adAccountId, role: 'extra', token: e.token || null, syncing: e.active })
  // The collector runs once per collected account: with a single one, every
  // run of the store is that account's.
  const collected = slots.filter(s => s.syncing).length

  const accounts = await Promise.all(slots.map(async (slot): Promise<AdAccountHealth> => {
    const [graph, tokenInfo] = slot.token
      ? await Promise.all([readAdAccount(slot.token, slot.adAccountId), inspectToken(slot.token)])
      : [null, null]
    const own = summarizeRuns(accountRuns(runs, slot.adAccountId, slot.syncing ? collected : 0), 'facebook')
    return {
      adAccountId: slot.adAccountId,
      role: slot.role,
      syncing: slot.syncing,
      name: graph?.name ?? null,
      accountStatus: graph?.account_status ?? null,
      readable: !!graph,
      tokenInfo,
      errors24h: own?.errors24h ?? 0,
      lastError: own?.lastError ?? null,
      lastErrorText: own?.lastErrorText ?? null,
      lastErrorAt: own?.lastErrorAt ?? null,
      errorsResolved: own?.errorsResolved ?? false,
    }
  }))

  const lastSync = summarizeRuns(runs, 'facebook')
  if (lastSync && lastSync.errors24h > 0 && collected > 1) {
    // Several accounts share the store's runs: the latest success may be
    // another account's. Settled only when each account's own runs say so,
    // which needs sync_runs.account_id (v2 migration).
    lastSync.errorsResolved = lastSync.errorsResolved && runs.some(r => r.account_id)
      && accounts.every(a => a.errors24h === 0 || a.errorsResolved)
  }
  return { storeId: store.id, storeName: store.name, checkedAt: new Date().toISOString(), lastSync, accounts }
}
