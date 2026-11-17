import { randomUUID } from 'node:crypto'
import type { PoolClient } from 'pg'
import { pool, query } from '../db'
import { AccessError, listStores, requireStore, type StoreRef, type Viewer } from '../access'
import { accountForNewStore, HttpError } from './http'
import type { ShopInfo } from './shopify'
import type { StoreSummary } from './types'
import { isoSql } from './sql'

/**
 * Stores: what the UI may know about them, archiving, and the one write path
 * for Shopify credentials.
 *
 * Before this there were five ways to write a Shopify token (OAuth callback,
 * connect-manual, POST /api/stores, POST /api/tenant, upsertTenant), each with
 * its own idea of whose store it was writing — one updated by domain across
 * every account and, when nothing matched, overwrote the account's primary
 * store with a different shop. connectShopify() is now the only one.
 */

export async function withTransaction<T>(fn: (c: PoolClient) => Promise<T>): Promise<T> {
  const c = await pool.connect()
  try {
    await c.query('BEGIN')
    const out = await fn(c)
    await c.query('COMMIT')
    return out
  } catch (err) {
    await c.query('ROLLBACK').catch(() => {})
    throw err
  } finally {
    c.release()
  }
}

interface SummaryRow {
  id: string
  currency: string | null
  onboarded: boolean | null
  created_at: string
  archived_at: string | null
  has_shopify_token: boolean
  dev_dashboard: boolean
  token_expires_at: string | null
  has_fb_token: boolean
  fb_ad_account_id: string | null
  extra_accounts: number
  extra_active: number
}

/** Presence flags only: the query never selects a credential. */
export async function loadStoreSummaries(refs: StoreRef[]): Promise<StoreSummary[]> {
  if (refs.length === 0) return []
  const rows = await query<SummaryRow>(
    `SELECT t.id, t.shopify_currency AS currency, t.onboarded, ${isoSql('t.created_at')} AS created_at,
            ${isoSql('t.archived_at')} AS archived_at,
            (COALESCE(t.shopify_access_token, '') <> '') AS has_shopify_token,
            (t.shopify_client_id IS NOT NULL AND t.shopify_client_secret IS NOT NULL) AS dev_dashboard,
            ${isoSql('t.shopify_token_expires_at')} AS token_expires_at,
            (COALESCE(t.fb_access_token, '') <> '') AS has_fb_token,
            t.fb_ad_account_id,
            (SELECT count(*) FROM tenant_fb_accounts a WHERE a.tenant_id = t.id)::int AS extra_accounts,
            (SELECT count(*) FROM tenant_fb_accounts a WHERE a.tenant_id = t.id AND a.is_active)::int AS extra_active
       FROM tenants t
      WHERE t.id = ANY($1::text[])`,
    [refs.map(r => r.id)],
  )
  const byId = new Map(rows.map(r => [r.id, r]))
  return refs.flatMap(ref => {
    const r = byId.get(ref.id)
    if (!r) return []
    const connection = r.dev_dashboard ? 'dev_dashboard' : r.has_shopify_token ? 'token' : 'none'
    return [{
      id: ref.id,
      name: ref.name,
      shopName: ref.shopName,
      domain: ref.domain,
      timezone: ref.timezone,
      currency: r.currency,
      archived: ref.archived,
      archivedAt: r.archived_at,
      onboarded: r.onboarded !== false,
      createdAt: r.created_at,
      shopify: {
        connected: r.has_shopify_token || r.dev_dashboard,
        connection,
        tokenExpiresAt: r.dev_dashboard ? r.token_expires_at : null,
      },
      facebook: {
        connected: r.has_fb_token,
        mainAdAccountId: r.fb_ad_account_id,
        extraAccounts: r.extra_accounts,
        activeExtraAccounts: r.extra_active,
      },
    } satisfies StoreSummary]
  })
}

export async function storeSummary(ref: StoreRef): Promise<StoreSummary> {
  const [s] = await loadStoreSummaries([ref])
  if (!s) throw new AccessError(404)
  return s
}

/**
 * Archive instead of delete. A hard DELETE either failed on the 21 tables that
 * reference tenants (and the UI hid the store anyway) or, on a store with no
 * data yet, destroyed it with its credentials. Archived stores keep history and
 * credentials, drop out of "Todas", the pickers and the sync, and can come back.
 */
export async function setArchived(storeId: string, archived: boolean): Promise<void> {
  await query(
    archived
      ? `UPDATE tenants SET archived_at = COALESCE(archived_at, now()), updated_at = now() WHERE id = $1`
      : `UPDATE tenants SET archived_at = NULL, updated_at = now() WHERE id = $1`,
    [storeId],
  )
}

export async function setOnboarded(storeId: string, onboarded: boolean): Promise<void> {
  await query(`UPDATE tenants SET onboarded = $2, updated_at = now() WHERE id = $1`, [storeId, onboarded])
}

/** The store registered for this domain in ANY account (archived included). */
export async function findStoreByDomain(
  domain: string, client?: PoolClient,
): Promise<{ id: string; userId: string | null } | null> {
  const sql = `SELECT id, user_id FROM tenants WHERE lower(shopify_domain) = $1 ORDER BY created_at LIMIT 1`
  const rows = client
    ? (await client.query<{ id: string; user_id: string | null }>(sql, [domain])).rows
    : await query<{ id: string; user_id: string | null }>(sql, [domain])
  return rows[0] ? { id: rows[0].id, userId: rows[0].user_id } : null
}

export type ShopifyCredential =
  /** A permanent Admin API token: Partners-app OAuth or a pasted shpat_. */
  | { kind: 'token'; token: string }
  /** A Dev Dashboard app: the pair is kept so the 24h token can be re-minted. */
  | { kind: 'client_credentials'; clientId: string; clientSecret: string; token: string; expiresAt: string }

export interface ConnectShopifyInput {
  /** The store being reconnected. null → find by domain (reconnect) or create (add). */
  storeId: string | null
  /** Already normalized by normalizeShopDomain(). */
  domain: string
  mode: 'reconnect' | 'add'
  credential: ShopifyCredential
  info: ShopInfo
}

export interface ConnectShopifyResult { storeId: string; created: boolean }

/**
 * Save Shopify credentials for a store the viewer may see, or create a store in
 * the viewer's account. Rules:
 *  - a reconnect only ever updates the viewer's store, and only when the
 *    authorized shop is that store's own domain;
 *  - a domain already registered in another account is refused (one Shopify
 *    store, one tenant: two tenants would steal each other's orders on every
 *    sync, since orders are keyed by order_id alone);
 *  - a Dev Dashboard store keeps its client id + secret: a one-off token cannot
 *    replace them, because the collector would re-mint over it from the old
 *    pair within a day;
 *  - every failure throws (404/409) — nothing reports success after a failed save.
 */
export async function connectShopify(viewer: Viewer, input: ConnectShopifyInput): Promise<ConnectShopifyResult> {
  const { domain, credential, info } = input
  let target: StoreRef | null = null

  if (input.storeId) {
    target = await requireStore(viewer, input.storeId)
  } else {
    const visible = await listStores(viewer, { includeArchived: true })
    target = visible.find(s => s.domain?.toLowerCase() === domain) ?? null
    if (!target && input.mode === 'reconnect') throw new AccessError(404)
    if (!target) {
      const existing = await findStoreByDomain(domain)
      if (existing) {
        throw new HttpError(409, 'already_registered',
          'Esta loja da Shopify já está cadastrada em outra conta do Opero. Peça ao dono para compartilhá-la.')
      }
    }
  }

  if (target) {
    if (input.mode === 'add' && target.archived) {
      // "Adding" an archived store would quietly refresh a store that stays out
      // of every list, and the onboarding that follows would act on another one.
      throw new HttpError(409, 'store_archived',
        'Esta loja já está cadastrada nesta conta, mas arquivada. Restaure-a em Configurações → Lojas.')
    }
    if (target.domain?.toLowerCase() !== domain) {
      throw new HttpError(409, 'domain_mismatch',
        `A autorização é da loja ${domain}, mas a loja escolhida é ${target.domain ?? 'sem domínio'}.`)
    }
    const [row] = await query<{ dev: boolean }>(
      `SELECT (shopify_client_id IS NOT NULL AND shopify_client_secret IS NOT NULL) AS dev FROM tenants WHERE id = $1`,
      [target.id],
    )
    if (row?.dev && credential.kind === 'token') {
      throw new HttpError(409, 'dev_dashboard_store',
        'Esta loja usa um app do Dev Dashboard: a chave é renovada a cada 24h a partir do Client ID e do Secret. ' +
        'Para corrigir, informe o Client ID e o Secret atuais do app.')
    }
    const updated = credential.kind === 'token'
      ? await query<{ id: string }>(
          `UPDATE tenants
              SET shopify_access_token = $2,
                  shop_name = COALESCE($3, shop_name),
                  shopify_currency = COALESCE($4, shopify_currency),
                  timezone = COALESCE($5, timezone),
                  updated_at = now()
            WHERE id = $1 AND lower(shopify_domain) = $6 AND shopify_client_id IS NULL
            RETURNING id`,
          [target.id, credential.token, info.name, info.currency, info.timezone, domain])
      : await query<{ id: string }>(
          `UPDATE tenants
              SET shopify_access_token = $2,
                  shopify_client_id = $3,
                  shopify_client_secret = $4,
                  shopify_token_expires_at = $5::timestamptz,
                  shop_name = COALESCE($6, shop_name),
                  shopify_currency = COALESCE($7, shopify_currency),
                  timezone = COALESCE($8, timezone),
                  updated_at = now()
            WHERE id = $1 AND lower(shopify_domain) = $9
            RETURNING id`,
          [target.id, credential.token, credential.clientId, credential.clientSecret, credential.expiresAt,
           info.name, info.currency, info.timezone, domain])
    if (updated.length !== 1) throw new HttpError(409, 'save_failed', 'A loja mudou durante a conexão. Tente de novo.')
    return { storeId: target.id, created: false }
  }

  // A new store in the viewer's account. It starts onboarded: Shopify is the
  // only required connection, and an unfinished Facebook step used to lock the
  // whole account in /onboarding.
  const userId = await accountForNewStore(viewer)
  const storeId = randomUUID()
  await withTransaction(async c => {
    // Serialize concurrent connects of the same shop, then re-check: there is
    // no unique index on shopify_domain to do it for us.
    await c.query(`SELECT pg_advisory_xact_lock(hashtext($1))`, [`shopify:${domain}`])
    if (await findStoreByDomain(domain, c)) {
      throw new HttpError(409, 'already_registered', 'Esta loja da Shopify acabou de ser cadastrada. Atualize a página.')
    }
    const dev = credential.kind === 'client_credentials'
    await c.query(
      `INSERT INTO tenants (id, user_id, shopify_domain, shopify_access_token,
                            shopify_client_id, shopify_client_secret, shopify_token_expires_at,
                            shop_name, shopify_currency, timezone, onboarded)
       VALUES ($1, $2, $3, $4, $5, $6, $7::timestamptz, $8, $9, COALESCE($10, 'UTC'), true)`,
      [storeId, userId, domain, credential.token,
       dev ? credential.clientId : null, dev ? credential.clientSecret : null, dev ? credential.expiresAt : null,
       info.name, info.currency, info.timezone],
    )
  })
  return { storeId, created: true }
}
