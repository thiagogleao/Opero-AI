/**
 * Partner isolation, against the production database in READ-ONLY mode.
 *
 * lib/access getViewer() is mocked as each real Clerk account (ids read from
 * the tenants table) and as the owner. For every store of ANOTHER account,
 * every route of the auth/integrations area must answer 404 — before touching
 * Shopify or Meta — and no response may carry a credential: neither a token
 * field nor any stored token/secret value (checked by value, never printed).
 *
 * Write paths on the viewer's own stores are exercised too: the session is
 * read-only at the server, so a correct statement reaches the database and is
 * refused with "read-only transaction" — which proves the SQL is valid against
 * the real schema without changing a row.
 *
 * Skipped when ../.env has no DATABASE_URL. Network is mocked: nothing here
 * calls Shopify or Meta.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'

// Remote database, many sequential round trips per test.
vi.setConfig({ testTimeout: 240_000, hookTimeout: 120_000 })

const env = await vi.hoisted(async () => {
  const fs = await import('node:fs')
  const path = await import('node:path')
  let url: string | null = null
  try {
    const text = fs.readFileSync(path.resolve(process.cwd(), '..', '.env'), 'utf8')
    const m = text.match(/^DATABASE_URL=(.*)$/m)
    url = m ? m[1].trim().replace(/^["']|["']$/g, '') : null
  } catch { /* no .env */ }
  if (url) process.env.DATABASE_URL = url
  process.env.DATABASE_READ_ONLY = '1'
  process.env.OAUTH_STATE_SECRET = 'isolation-test-secret-'.padEnd(48, 'x')
  process.env.MOBILE_ACCESS_TOKEN = 'isolation-mobile-token-'.padEnd(48, 'y')
  process.env.FACEBOOK_APP_ID = '1000000000'
  process.env.FACEBOOK_APP_SECRET = 'fake-fb-app-secret'
  process.env.SHOPIFY_CLIENT_ID = 'fake-shopify-client-id'
  process.env.SHOPIFY_CLIENT_SECRET = 'fake-shopify-client-secret'
  delete process.env.NEXT_PUBLIC_APP_URL
  delete process.env.CLERK_SECRET_KEY
  return { hasDb: !!url }
})

type V = { kind: 'owner' } | { kind: 'partner'; userId: string } | null
const ctl = vi.hoisted(() => ({
  viewer: null as V,
  clerkUserId: null as string | null,
  graphOk: false,
  shopOk: false,
  mintOk: false,
  /** Ad accounts the Facebook login "sees"; null = the code exchange fails. */
  fbAccounts: null as { id: string; name: string; account_status: number }[] | null,
  calls: [] as string[],
}))

vi.mock('@/lib/access', async (orig) => {
  const m = await orig<typeof import('@/lib/access')>()
  return { ...m, getViewer: async () => ctl.viewer }
})
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: ctl.clerkUserId }) }))

const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL, init?: RequestInit) => {
  const url = input instanceof Request ? input.url : String(input)
  ctl.calls.push(url)
  const act = /^https:\/\/graph\.facebook\.com\/v20\.0\/(act_\d+)\?fields=/.exec(url)
  if (ctl.graphOk && act) return Response.json({ id: act[1], name: 'Conta teste', account_status: 1 })
  const shop = /^https:\/\/([a-z0-9-]+\.myshopify\.com)\/admin\/api\/[\d-]+\/shop\.json$/.exec(url)
  if (ctl.shopOk && shop) {
    return Response.json({ shop: { name: 'Loja teste', currency: 'USD', iana_timezone: 'America/Sao_Paulo', myshopify_domain: shop[1] } })
  }
  if (ctl.mintOk && /\/admin\/oauth\/access_token$/.test(url) && init?.method === 'POST') {
    return Response.json({ access_token: 'shpat_minted_in_test', expires_in: 86399, scope: 'read_orders' })
  }
  if (ctl.fbAccounts && url === 'https://graph.facebook.com/v20.0/oauth/access_token' && init?.method === 'POST') {
    return Response.json({ access_token: 'EAAtestLongLivedUserToken' })
  }
  if (ctl.fbAccounts && url.startsWith('https://graph.facebook.com/v20.0/me/adaccounts')) {
    return Response.json({ data: ctl.fbAccounts })
  }
  return new Response('{}', { status: 503 })
}) as typeof fetch
afterAll(() => { globalThis.fetch = realFetch })

const { NextRequest } = await import('next/server')

interface StoreRow { id: string; user_id: string; shopify_domain: string; archived: boolean; shop_name: string; dev: boolean }
interface ExtraRow { id: number; tenant_id: string; fb_ad_account_id: string }

async function loadFixtures() {
  const { query } = await import('@/lib/db')
  const stores = await query<StoreRow>(
    `SELECT id, user_id, shopify_domain, archived_at IS NOT NULL AS archived, shop_name,
            (shopify_client_id IS NOT NULL AND shopify_client_secret IS NOT NULL) AS dev
       FROM tenants WHERE shopify_domain IS NOT NULL ORDER BY created_at`)
  const extras = await query<ExtraRow>(`SELECT id, tenant_id, fb_ad_account_id FROM tenant_fb_accounts ORDER BY id`)
  const accounts = [...new Set(stores.map(s => s.user_id).filter(Boolean))].sort()
  // Every stored credential value, kept in memory only to be searched for.
  const creds = await query<{ v: string | null }>(
    `SELECT unnest(ARRAY[shopify_access_token, fb_access_token, shopify_client_secret, shopify_client_id, facebook_app_secret]) AS v FROM tenants
     UNION ALL SELECT fb_access_token FROM tenant_fb_accounts`)
  const secrets = creds.map(c => c.v).filter((v): v is string => !!v && v.length >= 8)
  return { stores, extras, accounts, secrets }
}

const fx = env.hasDb ? await loadFixtures() : null

const routes = env.hasDb ? {
  tenant: await import('@/app/api/tenant/route'),
  stores: await import('@/app/api/stores/route'),
  storeById: await import('@/app/api/stores/[id]/route'),
  activeStore: await import('@/app/api/active-store/route'),
  fbAuth: await import('@/app/api/facebook/auth/route'),
  fbCallback: await import('@/app/api/facebook/callback/route'),
  fbAccounts: await import('@/app/api/facebook/accounts/route'),
  fbExtra: await import('@/app/api/facebook/extra-accounts/route'),
  fbExtraById: await import('@/app/api/facebook/extra-accounts/[id]/route'),
  fbPending: await import('@/app/api/facebook/extra-accounts/pending/route'),
  fbHealth: await import('@/app/api/facebook/health/route'),
  shAuth: await import('@/app/api/shopify/auth/route'),
  shCallback: await import('@/app/api/shopify/callback/route'),
  shConnect: await import('@/app/api/shopify/connect/route'),
  shManual: await import('@/app/api/shopify/connect-manual/route'),
  shHealth: await import('@/app/api/shopify/token-health/route'),
  unlock: await import('@/app/api/mobile/unlock/route'),
} : null

const { createOAuthState, viewerKey } = await import('@/lib/integrations/oauthState')
const { sealPending } = await import('@/lib/integrations/pending')

type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
type Mod = Partial<Record<'GET' | 'POST' | 'PATCH' | 'DELETE', unknown>>

interface Res { status: number; text: string; location: string | null; setCookie: string; json: Record<string, unknown> | null }

async function call(
  mod: Mod, method: 'GET' | 'POST' | 'PATCH' | 'DELETE', path: string,
  opts: { body?: unknown; cookies?: Record<string, string>; params?: Record<string, string>; headers?: Record<string, string> } = {},
): Promise<Res> {
  const headers = new Headers(opts.headers)
  if (opts.body !== undefined) headers.set('content-type', 'application/json')
  if (opts.cookies) headers.set('cookie', Object.entries(opts.cookies).map(([k, v]) => `${k}=${v}`).join('; '))
  const req = new NextRequest(`http://localhost:3000${path}`, {
    method, headers, body: opts.body === undefined ? undefined : JSON.stringify(opts.body),
  })
  const handler = mod[method] as Handler | undefined
  if (!handler) throw new Error(`${method} ${path}: no handler`)
  const res = await handler(req, { params: Promise.resolve(opts.params ?? {}) })
  const text = await res.text()
  let json: Record<string, unknown> | null = null
  try { json = JSON.parse(text) } catch { /* not JSON */ }
  return { status: res.status, text, location: res.headers.get('location'), setCookie: res.headers.get('set-cookie') ?? '', json }
}

const FORBIDDEN_KEYS = new Set([
  'shopify_access_token', 'fb_access_token', 'shopify_client_secret', 'shopify_client_id',
  'facebook_app_secret', 'client_secret', 'clientSecret', 'access_token', 'accessToken', 'token', 'masked',
])

function tokenKeys(v: unknown, path = ''): string[] {
  if (Array.isArray(v)) return v.flatMap((x, i) => tokenKeys(x, `${path}[${i}]`))
  if (!v || typeof v !== 'object') return []
  return Object.entries(v as Record<string, unknown>).flatMap(([k, x]) => {
    const here = `${path}.${k}`
    const bad = FORBIDDEN_KEYS.has(k) ||
      (typeof x === 'string' && /(token|secret)/i.test(k) && !/expires?at$/i.test(k))
    return [...(bad ? [here] : []), ...tokenKeys(x, here)]
  })
}

/** No credential value anywhere in the response (body, cookies, redirect). */
function assertNoLeak(r: Res, label: string) {
  const hay = `${r.text}\n${r.setCookie}\n${r.location ?? ''}`
  const leaked = fx!.secrets.filter(s => hay.includes(s)).length
  // A count, never the value.
  expect(leaked, `${label}: response contains ${leaked} stored credential(s)`).toBe(0)
  if (r.json) expect(tokenKeys(r.json), `${label}: token fields`).toEqual([])
}

const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
beforeEach(() => {
  ctl.calls.length = 0
  ctl.graphOk = false
  ctl.shopOk = false
  ctl.mintOk = false
  ctl.fbAccounts = null
  ctl.clerkUserId = null
  errorSpy.mockClear()
})

const readOnlyRefused = () =>
  errorSpy.mock.calls.some(args => args.some(a => /read-only transaction/i.test(String(a))))

describe.skipIf(!env.hasDb)('partner isolation (production, read-only)', () => {
  it('reads the three real Clerk accounts from tenants', () => {
    expect(fx!.accounts).toHaveLength(3)
    expect(fx!.accounts).toContain('user_3CVoVQYfnj1Ljnm3tf0iHP40fxX')
    expect(fx!.accounts.some(a => a.startsWith('user_3EuX'))).toBe(true)
    expect(fx!.accounts.some(a => a.startsWith('user_3Imfj'))).toBe(true)
    expect(fx!.secrets.length).toBeGreaterThan(5)
  })

  describe.each(fx?.accounts ?? [])('as partner %s', (userId) => {
    const own = () => fx!.stores.filter(s => s.user_id === userId)
    const foreign = () => fx!.stores.filter(s => s.user_id !== userId)
    beforeEach(() => { ctl.viewer = { kind: 'partner', userId } })

    it('answers 404 for every store of another account, without calling Shopify or Meta', async () => {
      const r = routes!
      const me = viewerKey({ kind: 'partner', userId })
      const failures: string[] = []
      for (const F of foreign()) {
        const fbState = createOAuthState({ provider: 'facebook', viewer: me, storeId: F.id, mode: 'main', returnTo: '/settings' })
        const fbStateOther = createOAuthState({ provider: 'facebook', viewer: `partner:${F.user_id}`, storeId: F.id, mode: 'main', returnTo: '/settings' })
        const shState = createOAuthState({ provider: 'shopify', viewer: me, storeId: F.id, mode: 'reconnect', returnTo: '/settings', shop: F.shopify_domain })
        const pending = sealPending({ viewer: me, storeId: F.id, mode: 'extra', token: 'EAAfakeTokenForTest' })
        const cases: [string, () => Promise<Res>][] = [
          ['GET tenant', () => call(r.tenant, 'GET', `/api/tenant?store=${F.id}`)],
          ['POST tenant onboarded', () => call(r.tenant, 'POST', '/api/tenant', { body: { storeId: F.id, onboarded: true } })],
          ['POST tenant fb account', () => call(r.tenant, 'POST', '/api/tenant', { body: { storeId: F.id, fb_ad_account_id: 'act_123456789' } })],
          ['GET stores/:id', () => call(r.storeById, 'GET', `/api/stores/${F.id}`, { params: { id: F.id } })],
          ['PATCH stores/:id', () => call(r.storeById, 'PATCH', `/api/stores/${F.id}`, { params: { id: F.id }, body: { archived: true } })],
          ['DELETE stores/:id', () => call(r.storeById, 'DELETE', `/api/stores/${F.id}`, { params: { id: F.id } })],
          ['POST active-store', () => call(r.activeStore, 'POST', '/api/active-store', { body: { storeId: F.id } })],
          ['GET facebook/auth', () => call(r.fbAuth, 'GET', `/api/facebook/auth?store=${F.id}&mode=extra`)],
          ['GET facebook/callback (my state, their store)', () => call(r.fbCallback, 'GET', `/api/facebook/callback?state=${fbState.state}&code=abc`, { cookies: { fb_oauth_nonce: fbState.nonce } })],
          ['GET facebook/callback (their state)', () => call(r.fbCallback, 'GET', `/api/facebook/callback?state=${fbStateOther.state}&code=abc`, { cookies: { fb_oauth_nonce: fbStateOther.nonce } })],
          ['GET facebook/accounts', () => call(r.fbAccounts, 'GET', `/api/facebook/accounts?store=${F.id}`, { cookies: { fb_pending: pending } })],
          ['POST facebook/accounts', () => call(r.fbAccounts, 'POST', '/api/facebook/accounts', { body: { storeId: F.id, fb_ad_account_id: 'act_123456789', role: 'extra' }, cookies: { fb_pending: pending } })],
          ['GET facebook/accounts (no id, pending for their store)', () => call(r.fbAccounts, 'GET', '/api/facebook/accounts', { cookies: { fb_pending: pending } })],
          ['POST tenant (no id, pending for their store)', () => call(r.tenant, 'POST', '/api/tenant', { body: { fb_ad_account_id: 'act_123456789' }, cookies: { fb_pending: pending } })],
          ['GET facebook/extra-accounts', () => call(r.fbExtra, 'GET', `/api/facebook/extra-accounts?store=${F.id}`)],
          ['POST facebook/extra-accounts', () => call(r.fbExtra, 'POST', '/api/facebook/extra-accounts', { body: { storeId: F.id, fb_ad_account_id: 'act_123456789', fb_access_token: 'EAAfake' } })],
          ['GET pending (sealed for their store)', () => call(r.fbPending, 'GET', '/api/facebook/extra-accounts/pending', { cookies: { fb_pending: pending } })],
          ['POST pending (sealed for their store)', () => call(r.fbPending, 'POST', '/api/facebook/extra-accounts/pending', { cookies: { fb_pending: pending }, body: { fb_ad_account_id: 'act_123456789' } })],
          ['GET facebook/health', () => call(r.fbHealth, 'GET', `/api/facebook/health?store=${F.id}`)],
          ['GET shopify/auth by store', () => call(r.shAuth, 'GET', `/api/shopify/auth?store=${F.id}&mode=reconnect`)],
          ['GET shopify/auth by domain', () => call(r.shAuth, 'GET', `/api/shopify/auth?shop=${F.shopify_domain}&reconnect=1`)],
          ['GET shopify/callback (my state, their store)', () => call(r.shCallback, 'GET', `/api/shopify/callback?state=${shState.state}&code=abc&shop=${F.shopify_domain}&hmac=${'0'.repeat(64)}`, { cookies: { shopify_oauth_nonce: shState.nonce } })],
          ['POST shopify/connect by store', () => call(r.shConnect, 'POST', '/api/shopify/connect', { body: { storeId: F.id, accessToken: 'shpat_fake' } })],
          ['POST shopify/connect reconnect by domain', () => call(r.shConnect, 'POST', '/api/shopify/connect', { body: { shop: F.shopify_domain, mode: 'reconnect', clientId: 'cid', clientSecret: 'shpss_fake' } })],
          ['POST shopify/connect-manual', () => call(r.shManual, 'POST', '/api/shopify/connect-manual', { body: { domain: F.shopify_domain, accessToken: 'shpat_fake' } })],
        ]
        for (const x of fx!.extras.filter(e => e.tenant_id === F.id)) {
          cases.push(
            [`PATCH extra ${x.id}`, () => call(r.fbExtraById, 'PATCH', `/api/facebook/extra-accounts/${x.id}`, { params: { id: String(x.id) }, body: { is_active: false } })],
            [`DELETE extra ${x.id}`, () => call(r.fbExtraById, 'DELETE', `/api/facebook/extra-accounts/${x.id}`, { params: { id: String(x.id) } })],
          )
        }
        for (const [label, run] of cases) {
          ctl.calls.length = 0
          const res = await run()
          const name = `${label} → ${F.shop_name} (${F.id.slice(0, 8)})`
          if (res.status !== 404) failures.push(`${name}: HTTP ${res.status} ${res.location ?? ''}`)
          if (ctl.calls.length) failures.push(`${name}: called ${ctl.calls.length} external URL(s)`)
          assertNoLeak(res, name)
        }
      }
      expect(failures).toEqual([])
    })

    it('lists only its own stores, with no credential in any response', async () => {
      const r = routes!
      const list = await call(r.stores, 'GET', '/api/stores')
      expect(list.status).toBe(200)
      assertNoLeak(list, 'GET stores')
      const ids = (list.json!.stores as { id: string }[]).map(s => s.id).sort()
      expect(ids).toEqual(own().filter(s => !s.archived).map(s => s.id).sort())

      const all = await call(r.stores, 'GET', '/api/stores?archived=1')
      expect((all.json!.stores as { id: string }[]).map(s => s.id).sort()).toEqual(own().map(s => s.id).sort())
      assertNoLeak(all, 'GET stores?archived=1')

      const health = await call(r.shHealth, 'GET', '/api/shopify/token-health?archived=1')
      expect(health.status).toBe(200)
      expect((health.json!.stores as { id: string }[]).map(s => s.id).sort()).toEqual(own().map(s => s.id).sort())
      assertNoLeak(health, 'GET token-health')

      for (const S of own()) {
        for (const [label, res] of [
          ['GET tenant', await call(r.tenant, 'GET', `/api/tenant?store=${S.id}`)],
          ['GET stores/:id', await call(r.storeById, 'GET', `/api/stores/${S.id}`, { params: { id: S.id } })],
          ['GET extra-accounts', await call(r.fbExtra, 'GET', `/api/facebook/extra-accounts?store=${S.id}`)],
          ['GET facebook/health', await call(r.fbHealth, 'GET', `/api/facebook/health?store=${S.id}`)],
        ] as const) {
          expect(res.status, `${label} ${S.shop_name}`).toBe(200)
          assertNoLeak(res, `${label} ${S.shop_name}`)
        }
      }
    })

    it('reaches the database with valid SQL on its own store (refused only because the session is read-only)', async () => {
      const r = routes!
      const S = own().find(s => !s.archived)!
      for (const [label, run] of [
        ['archive', () => call(r.storeById, 'PATCH', `/api/stores/${S.id}`, { params: { id: S.id }, body: { archived: true } })],
        ['onboarded', () => call(r.tenant, 'POST', '/api/tenant', { body: { storeId: S.id, onboarded: true } })],
      ] as const) {
        errorSpy.mockClear()
        const res = await run()
        expect(res.status, label).toBe(500)
        expect(readOnlyRefused(), `${label} should be refused by the read-only session`).toBe(true)
      }
      for (const x of fx!.extras.filter(e => own().some(s => s.id === e.tenant_id))) {
        errorSpy.mockClear()
        const res = await call(r.fbExtraById, 'PATCH', `/api/facebook/extra-accounts/${x.id}`, { params: { id: String(x.id) }, body: { is_active: false } })
        expect(res.status).toBe(500)
        expect(readOnlyRefused()).toBe(true)
        errorSpy.mockClear()
        const del = await call(r.fbExtraById, 'DELETE', `/api/facebook/extra-accounts/${x.id}`, { params: { id: String(x.id) } })
        expect(del.status).toBe(500)
        expect(readOnlyRefused()).toBe(true)
      }
    })

    it('refuses a Shopify store registered in another account, without naming it', async () => {
      const F = foreign().find(s => !s.archived)!
      ctl.shopOk = true
      const res = await call(routes!.shConnect, 'POST', '/api/shopify/connect', { body: { shop: F.shopify_domain, mode: 'add', accessToken: 'shpat_fake' } })
      expect(res.status).toBe(409)
      expect(res.json!.code).toBe('already_registered')
      expect(res.text).not.toContain(F.id)
      expect(res.text).not.toContain(F.shop_name)
      assertNoLeak(res, 'connect add foreign domain')
    })
  })

  describe('rules on linking ad accounts and Shopify credentials', () => {
    const THIAGO = 'user_3CVoVQYfnj1Ljnm3tf0iHP40fxX'
    const mokoo = () => fx!.stores.find(s => s.id === THIAGO)!
    const epochExtra = () => fx!.extras.find(e => e.fb_ad_account_id === 'act_1040512874708609')!

    it('an ad account already linked to another account\'s store cannot be linked, and that store is not named', async () => {
      ctl.viewer = { kind: 'partner', userId: THIAGO }
      ctl.graphOk = true
      const res = await call(routes!.fbAccounts, 'POST', '/api/facebook/accounts', {
        body: { storeId: mokoo().id, fb_ad_account_id: epochExtra().fb_ad_account_id, role: 'extra' },
      })
      expect(res.status).toBe(409)
      expect(res.json!.code).toBe('attached_elsewhere')
      expect(res.text).not.toMatch(/EPOCH/)
      assertNoLeak(res, 'attach foreign account')
    })

    it('the owner sees which store holds it', async () => {
      ctl.viewer = { kind: 'owner' }
      ctl.graphOk = true
      const res = await call(routes!.fbAccounts, 'POST', '/api/facebook/accounts', {
        body: { storeId: mokoo().id, fb_ad_account_id: epochExtra().fb_ad_account_id, role: 'main' },
      })
      expect(res.status).toBe(409)
      expect(res.json!.code).toBe('attached_elsewhere')
      expect(res.text).toMatch(/EPOCH/)
    })

    it('a store\'s main account cannot also be its extra', async () => {
      ctl.viewer = { kind: 'partner', userId: THIAGO }
      ctl.graphOk = true
      const res = await call(routes!.fbAccounts, 'POST', '/api/facebook/accounts', {
        body: { storeId: mokoo().id, fb_ad_account_id: 'act_2271277803257414', role: 'extra' },
      })
      expect(res.status).toBe(409)
      expect(res.json!.code).toBe('already_main')
    })

    it('a free account goes through every check and reaches the UPDATE', async () => {
      ctl.viewer = { kind: 'partner', userId: THIAGO }
      ctl.graphOk = true
      const res = await call(routes!.tenant, 'POST', '/api/tenant', { body: { storeId: mokoo().id, fb_ad_account_id: 'act_999999999999' } })
      expect(res.status).toBe(500)
      expect(readOnlyRefused()).toBe(true)
    })

    it('the timezone is read-only and Shopify credentials are not accepted by /api/tenant', async () => {
      ctl.viewer = { kind: 'partner', userId: THIAGO }
      const tz = await call(routes!.tenant, 'POST', '/api/tenant', { body: { storeId: mokoo().id, timezone: 'UTC' } })
      expect(tz.status).toBe(400)
      const sh = await call(routes!.tenant, 'POST', '/api/tenant', { body: { storeId: mokoo().id, shopify_access_token: 'x' } })
      expect(sh.status).toBe(400)
      // A Facebook token with no account id is refused, not dropped with a 200.
      const tokenOnly = await call(routes!.tenant, 'POST', '/api/tenant', { body: { storeId: mokoo().id, fb_access_token: 'EAAfake', onboarded: true } })
      expect(tokenOnly.status).toBe(400)
      expect(tokenOnly.json!.code).toBe('missing_account')
    })

    it('a Dev Dashboard store keeps its client credentials: a pasted token is refused', async () => {
      ctl.viewer = { kind: 'partner', userId: THIAGO }
      ctl.shopOk = true
      const dev = fx!.stores.find(s => s.user_id === THIAGO && s.dev)!
      const res = await call(routes!.shConnect, 'POST', '/api/shopify/connect', { body: { storeId: dev.id, accessToken: 'shpat_fake' } })
      expect(res.status).toBe(409)
      expect(res.json!.code).toBe('dev_dashboard_store')
      const oauth = await call(routes!.shAuth, 'GET', `/api/shopify/auth?store=${dev.id}&mode=reconnect`)
      expect(oauth.location).toContain('shopify_error=dev_dashboard_store')
    })

    it('a Dev Dashboard reconnect mints a token and reaches the UPDATE that keeps the pair', async () => {
      ctl.viewer = { kind: 'partner', userId: THIAGO }
      ctl.shopOk = true
      ctl.mintOk = true
      const dev = fx!.stores.find(s => s.user_id === THIAGO && s.dev)!
      const res = await call(routes!.shConnect, 'POST', '/api/shopify/connect', { body: { storeId: dev.id, clientId: 'cid', clientSecret: 'shpss_fake' } })
      expect(res.status).toBe(500)
      expect(readOnlyRefused()).toBe(true)
      expect(ctl.calls.some(u => u.endsWith('/admin/oauth/access_token'))).toBe(true)
    })

    it('a new shop reaches the INSERT; the client secret never goes in a URL', async () => {
      ctl.viewer = { kind: 'partner', userId: THIAGO }
      ctl.shopOk = true
      const res = await call(routes!.shConnect, 'POST', '/api/shopify/connect', { body: { shop: 'isolation-test-shop', mode: 'add', accessToken: 'shpat_fake' } })
      expect(res.status).toBe(500)
      expect(readOnlyRefused()).toBe(true)
      const inUrl = await call(routes!.shAuth, 'GET', '/api/shopify/auth?shop=isolation-test-shop&clientId=a&clientSecret=shpss_b')
      expect(inUrl.status).toBe(400)
    })

    it('the owner\'s device must also be signed in to an account to add a store', async () => {
      ctl.viewer = { kind: 'owner' }
      ctl.shopOk = true
      const res = await call(routes!.shConnect, 'POST', '/api/shopify/connect', { body: { shop: 'isolation-test-shop', mode: 'add', accessToken: 'shpat_fake' } })
      expect(res.status).toBe(400)
      expect(res.json!.code).toBe('account_required')
    })

    it('credentials for another shop are refused before anything is sent to Shopify', async () => {
      ctl.viewer = { kind: 'partner', userId: THIAGO }
      ctl.shopOk = true
      ctl.mintOk = true
      const other = fx!.stores.find(s => s.user_id === THIAGO && s.id !== mokoo().id)!
      const res = await call(routes!.shConnect, 'POST', '/api/shopify/connect', {
        body: { storeId: mokoo().id, shop: other.shopify_domain, clientId: 'cid', clientSecret: 'shpss_fake' },
      })
      expect(res.status).toBe(409)
      expect(res.json!.code).toBe('domain_mismatch')
      expect(ctl.calls).toEqual([])
    })

    it('"adding" an archived store of the account is refused, not silently refreshed', async () => {
      ctl.viewer = { kind: 'partner', userId: THIAGO }
      ctl.shopOk = true
      const archived = fx!.stores.find(s => s.user_id === THIAGO && s.archived)!
      const res = await call(routes!.shConnect, 'POST', '/api/shopify/connect', {
        body: { shop: archived.shopify_domain, mode: 'add', accessToken: 'shpat_fake' },
      })
      expect(res.status).toBe(409)
      expect(res.json!.code).toBe('store_archived')
      ctl.calls.length = 0
      const oauth = await call(routes!.shAuth, 'GET', `/api/shopify/auth?shop=${archived.shopify_domain}&mode=add&return=/onboarding`)
      expect(oauth.location).toContain('shopify_error=store_archived')
      expect(oauth.location).toContain('error=store_archived')
      expect(ctl.calls).toEqual([])
    })

    it('rejects a shop that is not *.myshopify.com', async () => {
      ctl.viewer = { kind: 'partner', userId: THIAGO }
      const res = await call(routes!.shAuth, 'GET', '/api/shopify/auth?shop=evil.example&mode=add')
      expect(res.location).toContain('shopify_error=invalid_shop')
      expect(ctl.calls).toEqual([])
    })
  })

  describe('OAuth flows on the viewer\'s own store', () => {
    const THIAGO = 'user_3CVoVQYfnj1Ljnm3tf0iHP40fxX'
    beforeEach(() => { ctl.viewer = { kind: 'partner', userId: THIAGO } })

    it('Facebook: signed state carries the store; failures go back honestly and clear the flow cookies', async () => {
      const store = fx!.stores.find(s => s.id === THIAGO)!
      const start = await call(routes!.fbAuth, 'GET', `/api/facebook/auth?store=${store.id}&mode=add_extra`)
      expect(start.status).toBe(307)
      const dialog = new URL(start.location!)
      expect(dialog.host).toBe('www.facebook.com')
      expect(dialog.searchParams.get('scope')).toBe('ads_read')
      expect(start.setCookie).toContain('fb_oauth_nonce=')
      const nonce = /fb_oauth_nonce=([^;]+)/.exec(start.setCookie)![1]
      const state = dialog.searchParams.get('state')!

      const cancelled = await call(routes!.fbCallback, 'GET', `/api/facebook/callback?state=${state}&error=access_denied`, { cookies: { fb_oauth_nonce: nonce } })
      expect(cancelled.location).toContain('fb_error=access_denied')
      expect(cancelled.setCookie).toMatch(/fb_oauth_mode=;/)

      const failed = await call(routes!.fbCallback, 'GET', `/api/facebook/callback?state=${state}&code=abc`, { cookies: { fb_oauth_nonce: nonce } })
      expect(failed.location).toContain('fb_error=token_exchange_failed')
      expect(failed.location).not.toContain('fb_connected')

      const noNonce = await call(routes!.fbCallback, 'GET', `/api/facebook/callback?state=${state}&code=abc`)
      expect(noNonce.location).toContain('fb_error=invalid_state')
    })

    it('Facebook: a single visible account never silently replaces the store\'s main account', async () => {
      const store = fx!.stores.find(s => s.id === THIAGO)!   // MOKOO, main act_2271277803257414
      const begin = async () => {
        const start = await call(routes!.fbAuth, 'GET', `/api/facebook/auth?store=${store.id}&mode=main`)
        const state = new URL(start.location!).searchParams.get('state')!
        const nonce = /fb_oauth_nonce=([^;]+)/.exec(start.setCookie)![1]
        return call(routes!.fbCallback, 'GET', `/api/facebook/callback?state=${state}&code=abc`, { cookies: { fb_oauth_nonce: nonce } })
      }

      // A different account: goes to the picker with the login waiting, nothing linked.
      ctl.fbAccounts = [{ id: 'act_999999999999', name: 'Outra', account_status: 1 }]
      const other = await begin()
      expect(new URL(other.location!).pathname).toBe('/facebook/accounts')
      expect(other.location).not.toContain('fb_connected')
      expect(other.setCookie).toContain('fb_pending=')
      assertNoLeak(other, 'callback, other account')

      // The same account (a token refresh): linked right away — here it reaches
      // the UPDATE, which the read-only session refuses, and that is reported.
      ctl.graphOk = true
      ctl.fbAccounts = [{ id: 'act_2271277803257414', name: 'MOKOO', account_status: 1 }]
      errorSpy.mockClear()
      const same = await begin()
      expect(same.location).toContain('fb_error=save_failed')
      expect(same.location).not.toContain('fb_connected')
      expect(readOnlyRefused()).toBe(true)
    })

    it('Shopify: HMAC is always checked and a failed exchange is never reported as success', async () => {
      const crypto = await import('node:crypto')
      const store = fx!.stores.find(s => s.id === THIAGO)!
      const start = await call(routes!.shAuth, 'GET', `/api/shopify/auth?shop=${store.shopify_domain}&reconnect=1`)
      const authorize = new URL(start.location!)
      expect(authorize.host).toBe(store.shopify_domain)
      expect(authorize.toString()).not.toContain('fake-shopify-client-secret')
      const nonce = /shopify_oauth_nonce=([^;]+)/.exec(start.setCookie)![1]
      const state = authorize.searchParams.get('state')!

      const params = new URLSearchParams({ code: 'abc', shop: store.shopify_domain, state, timestamp: '1700000000' })
      const bad = await call(routes!.shCallback, 'GET', `/api/shopify/callback?${params}&hmac=${'0'.repeat(64)}`, { cookies: { shopify_oauth_nonce: nonce } })
      expect(bad.location).toContain('shopify_error=invalid_hmac')

      const msg = [...params.entries()].sort(([a], [b]) => (a < b ? -1 : 1)).map(([k, v]) => `${k}=${v}`).join('&')
      params.set('hmac', crypto.createHmac('sha256', 'fake-shopify-client-secret').update(msg).digest('hex'))
      const exch = await call(routes!.shCallback, 'GET', `/api/shopify/callback?${params}`, { cookies: { shopify_oauth_nonce: nonce } })
      expect(exch.location).toContain('/settings?shopify_error=token_exchange_failed')
      expect(exch.location).not.toContain('shopify_connected')
    })
  })

  describe('without a viewer', () => {
    beforeEach(() => { ctl.viewer = null })
    it('every JSON route answers 401; OAuth starts go to sign-in', async () => {
      const r = routes!
      const id = fx!.stores[0].id
      for (const res of [
        await call(r.tenant, 'GET', '/api/tenant'),
        await call(r.stores, 'GET', '/api/stores'),
        await call(r.storeById, 'DELETE', `/api/stores/${id}`, { params: { id } }),
        await call(r.activeStore, 'POST', '/api/active-store', { body: { storeId: id } }),
        await call(r.fbAccounts, 'GET', '/api/facebook/accounts'),
        await call(r.fbExtra, 'GET', '/api/facebook/extra-accounts'),
        await call(r.fbExtraById, 'DELETE', '/api/facebook/extra-accounts/1', { params: { id: '1' } }),
        await call(r.fbPending, 'GET', '/api/facebook/extra-accounts/pending'),
        await call(r.fbHealth, 'GET', '/api/facebook/health'),
        await call(r.shConnect, 'POST', '/api/shopify/connect', { body: { shop: 'x', accessToken: 'shpat_x' } }),
        await call(r.shManual, 'POST', '/api/shopify/connect-manual', { body: { domain: 'x', accessToken: 'shpat_x' } }),
        await call(r.shHealth, 'GET', '/api/shopify/token-health'),
      ]) {
        expect(res.status).toBe(401)
        assertNoLeak(res, 'no viewer')
      }
      for (const res of [
        await call(r.fbAuth, 'GET', `/api/facebook/auth?store=${id}`),
        await call(r.shAuth, 'GET', `/api/shopify/auth?store=${id}&mode=reconnect`),
      ]) {
        expect(res.status).toBe(307)
        expect(new URL(res.location!).pathname).toBe('/sign-in')
      }
    })
  })

  describe('as the owner', () => {
    beforeEach(() => { ctl.viewer = { kind: 'owner' } })
    it('sees every active store and still no credential', async () => {
      const list = await call(routes!.stores, 'GET', '/api/stores')
      expect((list.json!.stores as unknown[]).length).toBe(fx!.stores.filter(s => !s.archived).length)
      assertNoLeak(list, 'owner GET stores')
      const health = await call(routes!.shHealth, 'GET', '/api/shopify/token-health')
      assertNoLeak(health, 'owner token-health')
      for (const s of fx!.stores) {
        const t = await call(routes!.tenant, 'GET', `/api/tenant?store=${s.id}`)
        expect(t.status).toBe(200)
        assertNoLeak(t, `owner GET tenant ${s.shop_name}`)
      }
    })
  })

  describe('unlock link', () => {
    const k = process.env.MOBILE_ACCESS_TOKEN!
    it('to=desktop lands on /, anything else on /m', async () => {
      const desk = await call(routes!.unlock, 'GET', `/api/mobile/unlock?k=${k}&to=desktop`, { headers: { 'x-forwarded-for': '198.51.100.1' } })
      expect(desk.status).toBe(307)
      expect(new URL(desk.location!).pathname).toBe('/')
      const evil = await call(routes!.unlock, 'GET', `/api/mobile/unlock?k=${k}&to=${encodeURIComponent('https://evil.example')}`, { headers: { 'x-forwarded-for': '198.51.100.2' } })
      expect(new URL(evil.location!).toString()).toBe('http://localhost:3000/m')
    })

    it('rate limits by the right-most forwarded address, so a spoofed left part does not reset it', async () => {
      const statuses: number[] = []
      for (let i = 0; i < 11; i++) {
        const res = await call(routes!.unlock, 'GET', '/api/mobile/unlock?k=wrong', { headers: { 'x-forwarded-for': `10.0.0.${i}, 203.0.113.77` } })
        statuses.push(res.status)
      }
      expect(statuses.slice(0, 10).every(s => s === 404)).toBe(true)
      expect(statuses[10]).toBe(429)
    })
  })
})

afterAll(async () => {
  if (env.hasDb) {
    const { pool } = await import('@/lib/db')
    await pool.end()
  }
})
