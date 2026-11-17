/**
 * The Meta (Facebook) Graph calls the connect flows make. Read-only: the app
 * only reads ad accounts and insights, so the OAuth dialog asks for ads_read
 * alone (it used to also ask for ads_management and business_management).
 *
 * Tokens go in the Authorization header and client secrets in POST bodies,
 * never in a URL that could end up in a log.
 */

export const GRAPH_VERSION = 'v20.0'
const GRAPH = `https://graph.facebook.com/${GRAPH_VERSION}`
export const FB_SCOPES = 'ads_read'
const TIMEOUT_MS = 15_000

export interface FacebookAppConfig { appId: string; appSecret: string }

export function facebookApp(): FacebookAppConfig | null {
  const appId = process.env.FACEBOOK_APP_ID
  const appSecret = process.env.FACEBOOK_APP_SECRET
  return appId && appSecret ? { appId, appSecret } : null
}

/** 'act_123…' for '123…' or 'act_123…'; null for anything else. */
export function normalizeAdAccountId(raw: unknown): string | null {
  if (typeof raw !== 'string') return null
  const digits = raw.trim().replace(/^act_/i, '')
  return /^\d{5,25}$/.test(digits) ? `act_${digits}` : null
}

export function facebookDialogUrl(app: FacebookAppConfig, redirectUri: string, state: string): string {
  const u = new URL(`https://www.facebook.com/${GRAPH_VERSION}/dialog/oauth`)
  u.searchParams.set('client_id', app.appId)
  u.searchParams.set('redirect_uri', redirectUri)
  u.searchParams.set('scope', FB_SCOPES)
  u.searchParams.set('state', state)
  u.searchParams.set('response_type', 'code')
  return u.toString()
}

async function graphPost(path: string, form: Record<string, string>): Promise<{ ok: boolean; body: Record<string, unknown> }> {
  try {
    const res = await fetch(`${GRAPH}${path}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: new URLSearchParams(form).toString(),
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    return { ok: res.ok, body: await res.json().catch(() => ({})) as Record<string, unknown> }
  } catch {
    return { ok: false, body: {} }
  }
}

async function graphGet(url: string, token: string): Promise<{ ok: boolean; status: number | null; body: Record<string, unknown> }> {
  try {
    const res = await fetch(url, {
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(TIMEOUT_MS),
      cache: 'no-store',
    })
    return { ok: res.ok, status: res.status, body: await res.json().catch(() => ({})) as Record<string, unknown> }
  } catch {
    return { ok: false, status: null, body: {} }
  }
}

export type LongTokenResult = { ok: true; token: string } | { ok: false; reason: 'token_exchange_failed' | 'long_token_failed' }

/** code → short-lived user token → long-lived (~60 day) user token. */
export async function exchangeCodeForLongToken(
  app: FacebookAppConfig, code: string, redirectUri: string,
): Promise<LongTokenResult> {
  const short = await graphPost('/oauth/access_token', {
    client_id: app.appId, client_secret: app.appSecret, redirect_uri: redirectUri, code,
  })
  const shortToken = typeof short.body.access_token === 'string' ? short.body.access_token : null
  if (!short.ok || !shortToken) return { ok: false, reason: 'token_exchange_failed' }
  const long = await graphPost('/oauth/access_token', {
    grant_type: 'fb_exchange_token', client_id: app.appId, client_secret: app.appSecret, fb_exchange_token: shortToken,
  })
  const longToken = typeof long.body.access_token === 'string' ? long.body.access_token : null
  if (!long.ok || !longToken) return { ok: false, reason: 'long_token_failed' }
  return { ok: true, token: longToken }
}

export interface GraphAdAccount { id: string; name: string; account_status: number }

/** Every ad account the token can read (paged; capped at 500). */
export async function listAdAccounts(token: string): Promise<{ ok: true; accounts: GraphAdAccount[] } | { ok: false }> {
  const accounts: GraphAdAccount[] = []
  let url: string | null = `${GRAPH}/me/adaccounts?fields=id,name,account_status&limit=100`
  for (let page = 0; url && page < 5; page++) {
    const r = await graphGet(url, token)
    if (!r.ok) return page === 0 ? { ok: false } : { ok: true, accounts }
    const data = Array.isArray(r.body.data) ? r.body.data as GraphAdAccount[] : []
    for (const a of data) {
      if (typeof a?.id === 'string') accounts.push({ id: a.id, name: String(a.name ?? a.id), account_status: Number(a.account_status) })
    }
    const paging = r.body.paging as { next?: string } | undefined
    // Only follow Graph's own next-page links.
    url = paging?.next && paging.next.startsWith('https://graph.facebook.com/') ? paging.next : null
  }
  return { ok: true, accounts }
}

/** The account as this token sees it, or null when the token cannot read it. */
export async function readAdAccount(token: string, adAccountId: string): Promise<GraphAdAccount | null> {
  const r = await graphGet(`${GRAPH}/${adAccountId}?fields=id,name,account_status`, token)
  if (!r.ok || typeof r.body.id !== 'string') return null
  return { id: r.body.id, name: String(r.body.name ?? r.body.id), account_status: Number(r.body.account_status) }
}

export interface TokenInfo {
  valid: boolean
  /** Meta's token type: 'SYSTEM_USER' tokens never expire; 'USER' ones do. */
  type: string | null
  /** ISO time it stops working, or null when it never expires / unknown. */
  expiresAt: string | null
  neverExpires: boolean
}

/** debug_token, authenticated as the app. Null when the app is not configured
 *  or Meta does not answer: "unknown" is never reported as healthy. */
export async function inspectToken(token: string): Promise<TokenInfo | null> {
  const app = facebookApp()
  if (!app) return null
  const r = await graphGet(
    `${GRAPH}/debug_token?input_token=${encodeURIComponent(token)}`,
    `${app.appId}|${app.appSecret}`,
  )
  const d = r.body.data as { is_valid?: boolean; type?: string; expires_at?: number } | undefined
  if (!r.ok || !d) return null
  const exp = Number(d.expires_at ?? 0)
  return {
    valid: d.is_valid === true,
    type: d.type ?? null,
    expiresAt: exp > 0 ? new Date(exp * 1000).toISOString() : null,
    neverExpires: d.is_valid === true && exp === 0,
  }
}
