import crypto from 'node:crypto'

/**
 * Everything the app says to Shopify's Admin API outside the collectors.
 *
 * One API version for every call this frontend makes. 2024-01 (the old pin)
 * is past Shopify's 12-month support window, and Shopify silently serves the
 * oldest supported version instead, so fields could change under us. 2026-10
 * is the current stable release and the one the Python collector already uses
 * for GraphQL; bump both together.
 */
export const SHOPIFY_API_VERSION = '2026-10'

/** Scopes the Partners app asks for. Unchanged on purpose: the owner's theme
 *  and catalogue scripts in the repo root write through the stored tokens, so
 *  narrowing this would break them on the next reconnect. */
export const SHOPIFY_SCOPES = [
  'read_orders', 'write_orders', 'read_analytics',
  'read_draft_orders', 'write_draft_orders',
  'read_products', 'write_products',
  'read_customers', 'write_customers',
  'read_checkouts', 'write_checkouts',
  'read_inventory', 'write_inventory',
  'read_locations', 'write_locations',
  'read_content', 'write_content',
  'read_online_store_pages', 'write_online_store_pages',
  'read_themes', 'write_themes', 'write_theme_code',
  'read_price_rules', 'write_price_rules',
  'read_discounts', 'write_discounts',
  'read_fulfillments', 'write_fulfillments',
  'read_returns', 'write_returns',
  'read_shipping', 'write_shipping',
  'read_reports', 'write_reports',
  'read_marketing_events', 'write_marketing_events',
  'read_files', 'write_files',
  'read_metaobjects', 'write_metaobjects',
  'read_script_tags', 'write_script_tags',
  'read_translations', 'write_translations',
  // Chargebacks: a token's scopes are fixed when granted, so this only helps
  // stores that connect after it was added.
  'read_shopify_payments_disputes',
].join(',')

/** Scopes Opero needs, and what breaks without each one. */
export const REQUIRED_SCOPES: { handle: string; why: string }[] = [
  { handle: 'read_orders', why: 'pedidos e receita' },
  { handle: 'read_products', why: 'catálogo e custo por produto' },
  { handle: 'read_shopify_payments_disputes', why: 'chargebacks' },
]

const SHOP_RE = /^[a-z0-9][a-z0-9-]{0,62}\.myshopify\.com$/

/**
 * The canonical `<handle>.myshopify.com` for what a person typed, or null.
 * Accepts the bare handle, the full domain, or an admin URL. Anything that is
 * not a myshopify.com host is refused: these domains end up in redirects and
 * in server-side requests, so a free-form host would be an open redirect and
 * a request forger.
 */
export function normalizeShopDomain(input: string | null | undefined): string | null {
  if (!input) return null
  let s = input.trim().toLowerCase()
  s = s.replace(/^https?:\/\//, '')
  s = s.split(/[/?#]/)[0]
  if (s.startsWith('admin.shopify.com')) return null
  if (!s.includes('.')) s = `${s}.myshopify.com`
  return SHOP_RE.test(s) ? s : null
}

export function adminApiUrl(domain: string, path: string): string {
  return `https://${domain}/admin/api/${SHOPIFY_API_VERSION}${path.startsWith('/') ? path : `/${path}`}`
}

/**
 * Shopify signs its OAuth callback with the app's client secret: every query
 * parameter except `hmac`, sorted, joined as key=value&…, HMAC-SHA256 in hex.
 * Always verified, always with the server's own secret, constant-time.
 */
export function verifyShopifyHmac(params: URLSearchParams, secret: string): boolean {
  const hmac = params.get('hmac')
  if (!hmac || !/^[0-9a-f]{64}$/i.test(hmac) || !secret) return false
  const pairs: [string, string][] = []
  for (const [k, v] of params.entries()) if (k !== 'hmac' && k !== 'signature') pairs.push([k, v])
  pairs.sort(([a], [b]) => (a < b ? -1 : a > b ? 1 : 0))
  const message = pairs.map(([k, v]) => `${k}=${v}`).join('&')
  const digest = crypto.createHmac('sha256', secret).update(message).digest()
  const given = Buffer.from(hmac.toLowerCase(), 'hex')
  return given.length === digest.length && crypto.timingSafeEqual(given, digest)
}

export interface PartnersAppConfig { clientId: string; clientSecret: string }

/** The Partners app the OAuth flow uses. Null when not configured. */
export function partnersApp(): PartnersAppConfig | null {
  const clientId = process.env.SHOPIFY_CLIENT_ID
  const clientSecret = process.env.SHOPIFY_CLIENT_SECRET
  return clientId && clientSecret ? { clientId, clientSecret } : null
}

const TIMEOUT_MS = 15_000

export type TokenResult =
  | { ok: true; token: string; scope: string; expiresAt: string | null }
  | { ok: false; status: number | null; reason: string }

/** Authorization-code exchange for the Partners app (the OAuth callback). */
export async function exchangeAuthCode(domain: string, code: string, app: PartnersAppConfig): Promise<TokenResult> {
  try {
    const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Accept: 'application/json' },
      body: JSON.stringify({ client_id: app.clientId, client_secret: app.clientSecret, code }),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    const body = await res.json().catch(() => ({})) as { access_token?: string; scope?: string }
    if (!res.ok || !body.access_token) return { ok: false, status: res.status, reason: 'a Shopify recusou a troca do código' }
    return { ok: true, token: body.access_token, scope: body.scope ?? '', expiresAt: null }
  } catch {
    return { ok: false, status: null, reason: 'não consegui falar com a Shopify' }
  }
}

/**
 * Dev Dashboard apps (Shopify's only way to create an app since 2026) have no
 * token to copy: one is minted from client id + secret and lasts 24h. This is
 * the same call the collector makes in app/collectors/shopify_auth.py, which
 * re-mints from the stored credentials before each expiry.
 */
export async function mintClientCredentialsToken(
  domain: string, clientId: string, clientSecret: string,
): Promise<TokenResult> {
  try {
    const res = await fetch(`https://${domain}/admin/oauth/access_token`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded', Accept: 'application/json' },
      body: new URLSearchParams({ grant_type: 'client_credentials', client_id: clientId, client_secret: clientSecret }).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    const body = await res.json().catch(() => ({})) as {
      access_token?: string; scope?: string; expires_in?: number; error?: string; error_description?: string
    }
    if (!res.ok || !body.access_token) {
      const why = String(body.error_description || body.error || '').toLowerCase()
      let reason = 'a Shopify recusou o Client ID e o Secret'
      if (why.includes('not installed') || why.includes('app_not_installed')) {
        reason = 'o app não está instalado nesta loja (Dev Dashboard > app > Installs > Install app)'
      } else if (why.includes('shop_not_permitted')) {
        reason = 'o app e a loja estão em organizações diferentes da Shopify'
      }
      return { ok: false, status: res.status, reason }
    }
    const seconds = Number(body.expires_in) || 86_399
    return {
      ok: true, token: body.access_token, scope: body.scope ?? '',
      expiresAt: new Date(Date.now() + seconds * 1000).toISOString(),
    }
  } catch {
    return { ok: false, status: null, reason: 'não consegui falar com a Shopify' }
  }
}

export interface ShopInfo { name: string | null; currency: string | null; timezone: string | null }

export type ShopCheck =
  | { ok: true; info: ShopInfo }
  | { ok: false; status: number | null }

/** Reads shop.json with a token: proves the token works for this exact shop
 *  and returns the name, currency and IANA timezone Shopify reports. */
export async function fetchShopInfo(domain: string, token: string): Promise<ShopCheck> {
  try {
    const res = await fetch(adminApiUrl(domain, '/shop.json'), {
      headers: { 'X-Shopify-Access-Token': token, Accept: 'application/json' },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    if (!res.ok) return { ok: false, status: res.status }
    const body = await res.json() as { shop?: { name?: string; currency?: string; iana_timezone?: string; myshopify_domain?: string } }
    // A token for a different shop must not be saved under this domain.
    if (body.shop?.myshopify_domain && body.shop.myshopify_domain.toLowerCase() !== domain) return { ok: false, status: 403 }
    return {
      ok: true,
      info: {
        name: body.shop?.name ?? null,
        currency: body.shop?.currency ?? null,
        timezone: body.shop?.iana_timezone ?? null,
      },
    }
  } catch {
    return { ok: false, status: null }
  }
}

/** Scopes granted to a token, or null when Shopify would not say. */
export async function readGrantedScopes(domain: string, token: string): Promise<string[] | null> {
  try {
    const res = await fetch(`https://${domain}/admin/oauth/access_scopes.json`, {
      headers: { 'X-Shopify-Access-Token': token },
      signal: AbortSignal.timeout(10_000),
      cache: 'no-store',
    })
    if (!res.ok) return null
    const json = await res.json() as { access_scopes?: { handle: string }[] }
    return (json.access_scopes ?? []).map(s => s.handle)
  } catch {
    return null
  }
}
