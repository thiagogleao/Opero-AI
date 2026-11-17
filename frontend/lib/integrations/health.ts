import { query } from '../db'
import type { StoreRef } from '../access'
import { extraAccountCredentials, storeCredentials } from './credentials'
import { inspectToken, readAdAccount } from './facebook'
import { fingerprint } from './keys'
import { fetchShopInfo, readGrantedScopes, REQUIRED_SCOPES } from './shopify'
import type { AdAccountHealth, StoreFacebookHealth, StoreShopifyHealth, SyncStatus } from './types'
import { isoSql } from './sql'

/**
 * Health = does it work, not "is a value stored". The old badges showed ✓ for
 * a store whose main ad account failed every sync (Dumpling fe707ab8) and for
 * EPOCH's deactivated main account. Here each answer combines a live check with
 * what the collector last recorded in sync_runs.
 */

/** Strip anything credential-shaped and keep the first useful line. */
export function sanitizeError(msg: string | null | undefined): string | null {
  if (!msg) return null
  const m = /Message:\s*(.+)/.exec(msg)
  let s = (m ? m[1] : msg).trim().split('\n')[0]
  s = s
    .replace(/EA[A-Za-z0-9]{20,}/g, '[token]')
    .replace(/shp(at|ca|pa|ss|ua)_[A-Za-z0-9]+/g, '[token]')
    .replace(/access_token=[^&\s'"]+/gi, 'access_token=[token]')
    .replace(/client_secret=[^&\s'"]+/gi, 'client_secret=[secret]')
  return s.slice(0, 200) || null
}

interface RunRow { tenant_id: string; status: string; at: string; error_message: string | null }

/** Latest status, last success and 24h errors of one source for some stores. */
export async function syncStatus(storeIds: string[], source: 'shopify' | 'facebook'): Promise<Map<string, SyncStatus & { errorTexts: string[] }>> {
  const out = new Map<string, SyncStatus & { errorTexts: string[] }>()
  if (storeIds.length === 0) return out
  const rows = await query<RunRow>(
    `SELECT tenant_id, status, ${isoSql('started_at')} AS at, error_message
       FROM sync_runs
      WHERE tenant_id = ANY($1::text[]) AND source = $2 AND started_at > now() - interval '7 days'
      ORDER BY started_at DESC`,
    [storeIds, source],
  )
  const dayAgo = Date.now() - 86_400_000
  for (const r of rows) {
    let s = out.get(r.tenant_id)
    if (!s) {
      s = { status: r.status, at: r.at, lastSuccessAt: null, errors24h: 0, lastError: null, errorTexts: [] }
      out.set(r.tenant_id, s)
    }
    if (r.status === 'success' && !s.lastSuccessAt) s.lastSuccessAt = r.at
    if (r.status === 'error' && Date.parse(r.at) > dayAgo) {
      s.errors24h++
      if (!s.lastError) s.lastError = sanitizeError(r.error_message)
      if (r.error_message) s.errorTexts.push(r.error_message)
    }
  }
  return out
}

const publicSync = (s: (SyncStatus & { errorTexts: string[] }) | undefined): SyncStatus | null =>
  s ? { status: s.status, at: s.at, lastSuccessAt: s.lastSuccessAt, errors24h: s.errors24h, lastError: s.lastError } : null

export async function shopifyHealth(stores: StoreRef[]): Promise<StoreShopifyHealth[]> {
  const syncs = await syncStatus(stores.map(s => s.id), 'shopify')
  return Promise.all(stores.map(async (s): Promise<StoreShopifyHealth> => {
    const c = await storeCredentials(s.id)
    const base = {
      id: s.id, name: s.name, domain: s.domain, archived: s.archived,
      connection: c?.devDashboard ? 'dev_dashboard' as const : c?.shopifyToken ? 'token' as const : 'none' as const,
      fingerprint: c?.shopifyToken ? fingerprint(c.shopifyToken) : null,
      tokenExpiresAt: c?.devDashboard ? c.shopifyTokenExpiresAt : null,
      lastSync: publicSync(syncs.get(s.id)),
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
  const [c, extras, syncs] = await Promise.all([
    storeCredentials(store.id), extraAccountCredentials(store.id), syncStatus([store.id], 'facebook'),
  ])
  const sync = syncs.get(store.id)
  const slots: { adAccountId: string; role: 'main' | 'extra'; token: string | null; syncing: boolean }[] = []
  if (c?.fbAdAccountId) slots.push({ adAccountId: c.fbAdAccountId, role: 'main', token: c.fbToken, syncing: !!c.fbToken })
  for (const e of extras) slots.push({ adAccountId: e.adAccountId, role: 'extra', token: e.token || null, syncing: e.active })

  const accounts = await Promise.all(slots.map(async (slot): Promise<AdAccountHealth> => {
    const [graph, tokenInfo] = slot.token
      ? await Promise.all([readAdAccount(slot.token, slot.adAccountId), inspectToken(slot.token)])
      : [null, null]
    const mine = (sync?.errorTexts ?? []).filter(t => t.includes(slot.adAccountId))
    return {
      adAccountId: slot.adAccountId,
      role: slot.role,
      syncing: slot.syncing,
      name: graph?.name ?? null,
      accountStatus: graph?.account_status ?? null,
      readable: !!graph,
      tokenInfo,
      errors24h: mine.length,
      lastError: sanitizeError(mine[0]),
    }
  }))
  return { storeId: store.id, storeName: store.name, checkedAt: new Date().toISOString(), lastSync: publicSync(sync), accounts }
}
