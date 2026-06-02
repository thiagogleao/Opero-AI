import { query } from './db'

export interface Tenant {
  id: string          // Store ID (= Clerk userId for primary store, UUID for additional)
  user_id: string     // Clerk user ID (owner of this store)
  email: string | null
  shopify_domain: string | null
  shopify_access_token: string | null
  fb_ad_account_id: string | null
  fb_access_token: string | null
  onboarded: boolean
  timezone: string | null
  created_at: string
}

/** Get a single store/tenant by its store ID. */
export async function getTenant(storeId: string): Promise<Tenant | null> {
  const rows = await query<Tenant>(
    `SELECT * FROM tenants WHERE id = $1`,
    [storeId]
  )
  return rows[0] ?? null
}

/** Get all stores belonging to a Clerk user. */
export async function getTenantsByUserId(userId: string): Promise<Tenant[]> {
  const rows = await query<Tenant>(
    `SELECT * FROM tenants
     WHERE user_id = $1 OR (user_id IS NULL AND id = $1)
     ORDER BY created_at ASC`,
    [userId]
  )
  return rows
}

/** Upsert a store/tenant. For new stores, user_id defaults to id (primary store). */
export async function upsertTenant(
  storeId: string,
  data: {
    user_id?: string
    email?: string
    shopify_domain?: string
    shopify_access_token?: string
    fb_ad_account_id?: string
    fb_access_token?: string
    onboarded?: boolean
    timezone?: string
  }
): Promise<Tenant> {
  const rows = await query<Tenant>(`
    INSERT INTO tenants (id, user_id, email, shopify_domain, shopify_access_token, fb_ad_account_id, fb_access_token, onboarded, timezone)
    VALUES ($1, COALESCE($2, $1), $3, $4, $5, $6, $7, $8, COALESCE($9, 'UTC'))
    ON CONFLICT (id) DO UPDATE SET
      email                 = COALESCE($3, tenants.email),
      shopify_domain        = COALESCE($4, tenants.shopify_domain),
      shopify_access_token  = COALESCE($5, tenants.shopify_access_token),
      fb_ad_account_id      = COALESCE($6, tenants.fb_ad_account_id),
      fb_access_token       = COALESCE($7, tenants.fb_access_token),
      onboarded             = COALESCE($8, tenants.onboarded),
      timezone              = COALESCE($9, tenants.timezone, 'UTC'),
      updated_at            = NOW()
    RETURNING *
  `, [
    storeId,
    data.user_id ?? null,
    data.email ?? null,
    data.shopify_domain ?? null,
    data.shopify_access_token ?? null,
    data.fb_ad_account_id ?? null,
    data.fb_access_token ?? null,
    data.onboarded ?? null,
    data.timezone ?? null,
  ])
  return rows[0]
}

/** Create a brand-new store for a user (used in add-store OAuth flow). */
export async function createStoreForUser(
  userId: string,
  storeId: string,
  data: {
    email?: string
    shopify_domain: string
    shopify_access_token: string
  }
): Promise<Tenant> {
  const rows = await query<Tenant>(`
    INSERT INTO tenants (id, user_id, email, shopify_domain, shopify_access_token, onboarded, timezone)
    VALUES ($1, $2, $3, $4, $5, false, 'UTC')
    ON CONFLICT (id) DO UPDATE SET
      shopify_access_token = $5,
      updated_at = NOW()
    RETURNING *
  `, [storeId, userId, data.email ?? null, data.shopify_domain, data.shopify_access_token])
  return rows[0]
}

/** Update shopify token on whichever store owns this domain for this user. */
export async function updateShopifyTokenByDomain(
  shopDomain: string,
  token: string,
  userId?: string
): Promise<number> {
  const sql = userId
    ? `UPDATE tenants SET shopify_access_token = $1, shopify_domain = $2, updated_at = NOW()
       WHERE shopify_domain = $2 AND (user_id = $3 OR (user_id IS NULL AND id = $3))
       RETURNING id`
    : `UPDATE tenants SET shopify_access_token = $1, shopify_domain = $2, updated_at = NOW()
       WHERE shopify_domain = $2
       RETURNING id`
  const params = userId ? [token, shopDomain, userId] : [token, shopDomain]
  const rows = await query<Tenant>(sql, params)
  return rows.length
}

/** Claim all rows with no tenant_id (existing data from before multi-tenancy) */
export async function claimLegacyData(tenantId: string): Promise<void> {
  const tables = [
    'shopify_orders', 'shopify_order_items', 'shopify_daily_metrics',
    'shopify_abandoned_checkouts', 'shopify_country_metrics',
    'shopify_products', 'fb_ad_daily_metrics', 'fb_ads',
    'fb_ad_breakdowns', 'sync_runs', 'profit_settings',
  ]
  for (const table of tables) {
    await query(`UPDATE ${table} SET tenant_id = $1 WHERE tenant_id IS NULL`, [tenantId])
  }
}
