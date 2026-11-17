import { query } from '../db'
import { isoSql } from './sql'

/**
 * The only place the integration code reads stored credentials.
 *
 * Values returned here are for server-side calls to Shopify and Meta. They are
 * never put in a response, a log line or a URL; routes report presence and
 * health instead (see types.ts).
 */

export interface StoreCredentials {
  id: string
  shopifyDomain: string | null
  shopifyToken: string | null
  /** Dev Dashboard store: the token is re-minted from client id + secret. */
  devDashboard: boolean
  shopifyTokenExpiresAt: string | null
  fbToken: string | null
  fbAdAccountId: string | null
}

export async function storeCredentials(storeId: string): Promise<StoreCredentials | null> {
  const rows = await query<{
    id: string; shopify_domain: string | null; shopify_access_token: string | null; dev: boolean
    expires: string | null; fb_access_token: string | null; fb_ad_account_id: string | null
  }>(
    `SELECT id, shopify_domain, NULLIF(shopify_access_token, '') AS shopify_access_token,
            (shopify_client_id IS NOT NULL AND shopify_client_secret IS NOT NULL) AS dev,
            ${isoSql('shopify_token_expires_at')} AS expires,
            NULLIF(fb_access_token, '') AS fb_access_token, fb_ad_account_id
       FROM tenants WHERE id = $1`,
    [storeId],
  )
  const r = rows[0]
  if (!r) return null
  return {
    id: r.id,
    shopifyDomain: r.shopify_domain,
    shopifyToken: r.shopify_access_token,
    devDashboard: r.dev,
    shopifyTokenExpiresAt: r.expires,
    fbToken: r.fb_access_token,
    fbAdAccountId: r.fb_ad_account_id,
  }
}

export interface ExtraAccountCredential { id: number; adAccountId: string; token: string; active: boolean }

export async function extraAccountCredentials(storeId: string): Promise<ExtraAccountCredential[]> {
  const rows = await query<{ id: number; fb_ad_account_id: string; fb_access_token: string; is_active: boolean }>(
    `SELECT id, fb_ad_account_id, fb_access_token, is_active
       FROM tenant_fb_accounts WHERE tenant_id = $1 ORDER BY created_at, id`,
    [storeId],
  )
  return rows.map(r => ({ id: r.id, adAccountId: r.fb_ad_account_id, token: r.fb_access_token, active: r.is_active }))
}
