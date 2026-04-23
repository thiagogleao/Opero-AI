import { query } from './db'

export interface Tenant {
  id: string          // Clerk user_id
  email: string | null
  shopify_domain: string | null
  shopify_access_token: string | null
  fb_ad_account_id: string | null
  fb_access_token: string | null
  onboarded: boolean
  created_at: string
}

export async function getTenant(clerkUserId: string): Promise<Tenant | null> {
  const rows = await query<Tenant>(
    `SELECT * FROM tenants WHERE id = $1`,
    [clerkUserId]
  )
  return rows[0] ?? null
}

export async function upsertTenant(
  clerkUserId: string,
  data: {
    email?: string
    shopify_domain?: string
    shopify_access_token?: string
    fb_ad_account_id?: string
    fb_access_token?: string
    onboarded?: boolean
  }
): Promise<Tenant> {
  const rows = await query<Tenant>(`
    INSERT INTO tenants (id, email, shopify_domain, shopify_access_token, fb_ad_account_id, fb_access_token, onboarded)
    VALUES ($1, $2, $3, $4, $5, $6, $7)
    ON CONFLICT (id) DO UPDATE SET
      email                 = COALESCE($2, tenants.email),
      shopify_domain        = COALESCE($3, tenants.shopify_domain),
      shopify_access_token  = COALESCE($4, tenants.shopify_access_token),
      fb_ad_account_id      = COALESCE($5, tenants.fb_ad_account_id),
      fb_access_token       = COALESCE($6, tenants.fb_access_token),
      onboarded             = COALESCE($7, tenants.onboarded),
      updated_at            = NOW()
    RETURNING *
  `, [
    clerkUserId,
    data.email ?? null,
    data.shopify_domain ?? null,
    data.shopify_access_token ?? null,
    data.fb_ad_account_id ?? null,
    data.fb_access_token ?? null,
    data.onboarded ?? null,
  ])
  return rows[0]
}

/** Update shopify token on whichever tenant row owns this domain. Returns rows updated. */
export async function updateShopifyTokenByDomain(
  shopDomain: string,
  token: string
): Promise<number> {
  const rows = await query<Tenant>(
    `UPDATE tenants SET shopify_access_token = $1, shopify_domain = $2, updated_at = NOW()
     WHERE shopify_domain = $2
     RETURNING id`,
    [token, shopDomain]
  )
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
