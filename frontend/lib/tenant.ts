import { query } from './db'

/**
 * Raw tenant rows, for server code that needs credentials.
 *
 * A Tenant carries access tokens and, for Dev Dashboard stores, the client
 * secret that mints new tokens. Never return one from a route or pass it to a
 * client component: routes use lib/access (StoreRef) and
 * lib/integrations/stores (StoreSummary, presence flags only).
 *
 * Writes live in lib/integrations: connectShopify() for Shopify credentials,
 * attachAdAccount() for Facebook, setArchived() for archiving. The old
 * upsertTenant / createStoreForUser / updateShopifyTokenByDomain (one of which
 * updated by domain across every account) and claimLegacyData are gone.
 */

export interface Tenant {
  id: string          // Store ID (= Clerk userId for the oldest stores, UUID for the rest)
  user_id: string     // Clerk user ID (the account this store belongs to)
  email: string | null
  shopify_domain: string | null
  shop_name: string | null
  shopify_access_token: string | null
  fb_ad_account_id: string | null
  fb_access_token: string | null
  facebook_app_id: string | null
  facebook_app_secret: string | null
  onboarded: boolean
  timezone: string | null
  created_at: string
  /** Shopify Dev Dashboard app credentials. Since 2026 a store created this way
   *  has no permanent token: the 24h one is minted from these by the collector,
   *  which writes it back to shopify_access_token. Null on legacy stores. */
  shopify_client_id: string | null
  shopify_client_secret: string | null
  shopify_token_expires_at: string | null
  /** Set when the store is out of circulation. History and credentials stay. */
  archived_at: string | null
}

/** The only store fields the UI needs. */
export interface StoreOption {
  id: string
  shop_name: string | null
  shopify_domain: string | null
}

export function toStoreOptions(tenants: Tenant[]): StoreOption[] {
  return tenants.map(t => ({ id: t.id, shop_name: t.shop_name, shopify_domain: t.shopify_domain }))
}

/** @deprecated Server-only credential read. Prefer lib/access requireStore()
 *  for the store and lib/integrations/credentials for its credentials. */
export async function getTenant(storeId: string): Promise<Tenant | null> {
  const rows = await query<Tenant>(`SELECT * FROM tenants WHERE id = $1`, [storeId])
  return rows[0] ?? null
}

/** @deprecated Use lib/access listStores(viewer). All non-archived stores of a
 *  Clerk account, oldest first. */
export async function getTenantsByUserId(userId: string): Promise<Tenant[]> {
  return query<Tenant>(
    `SELECT * FROM tenants
     WHERE (user_id = $1 OR (user_id IS NULL AND id = $1))
       AND archived_at IS NULL
     ORDER BY created_at ASC`,
    [userId],
  )
}
