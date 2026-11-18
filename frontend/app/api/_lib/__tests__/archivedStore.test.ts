/**
 * Archived stores are for consultation only (owner decision), against the
 * production database in READ-ONLY mode — the same pattern as
 * lib/integrations/__tests__/partnerIsolation.test.ts.
 *
 * lib/access getViewer() is mocked as the Clerk account that owns the real
 * archived store (Squishy World) and as the owner. Every config write route —
 * costs, tenant, ad accounts (link, pause, rename, unlink), Shopify reconnect,
 * both OAuth starts and callbacks — must refuse it with store_archived:
 *  - before anything is sent to Shopify or Meta (fetch is mocked and counted);
 *  - before any write statement reaches the database (the session is
 *    read-only, so a statement that got there would be logged as refused).
 * Reads of the same store keep working, and restoring it (the one write left)
 * still reaches the database.
 *
 * The real archived store has no extra ad account, so the pause/rename/unlink
 * routes are exercised on a store of the same account that has one, marked
 * archived by the access mock (ctl.forceArchived).
 *
 * Skipped when ../.env has no DATABASE_URL. Nothing here calls Shopify or Meta.
 */
import { afterAll, beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreRef, Viewer } from '@/lib/access'

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
  process.env.OAUTH_STATE_SECRET = 'archived-test-secret-'.padEnd(48, 'x')
  process.env.FACEBOOK_APP_ID = '1000000000'
  process.env.FACEBOOK_APP_SECRET = 'fake-fb-app-secret'
  process.env.SHOPIFY_CLIENT_ID = 'fake-shopify-client-id'
  process.env.SHOPIFY_CLIENT_SECRET = 'fake-shopify-client-secret'
  delete process.env.NEXT_PUBLIC_APP_URL
  delete process.env.CLERK_SECRET_KEY
  return { hasDb: !!url }
})

const ctl = vi.hoisted(() => ({
  viewer: null as Viewer | null,
  /** Store ids the access layer reports as archived on top of the real ones. */
  forceArchived: new Set<string>(),
  calls: [] as string[],
}))

vi.mock('@/lib/access', async (orig) => {
  const m = await orig<typeof import('@/lib/access')>()
  const mark = (s: StoreRef): StoreRef => (ctl.forceArchived.has(s.id) ? { ...s, archived: true } : s)
  return {
    ...m,
    getViewer: async () => ctl.viewer,
    listStores: async (v: Viewer, o: { includeArchived?: boolean } = {}) => {
      const all = (await m.listStores(v, { includeArchived: true })).map(mark)
      return o.includeArchived ? all : all.filter(s => !s.archived)
    },
    requireStore: async (v: Viewer, id: string | null | undefined) => mark(await m.requireStore(v, id)),
    resolveStore: async (v: Viewer, id: string | null | undefined) => {
      const r = await m.resolveStore(v, id)
      return { store: r.store ? mark(r.store) : null, stores: r.stores.map(mark).filter(s => !s.archived) }
    },
  }
})
vi.mock('next/headers', () => ({
  cookies: async () => ({ get: () => undefined }),
  headers: async () => new Headers(),
}))
vi.mock('@clerk/nextjs/server', () => ({ auth: async () => ({ userId: null }) }))

// Every external call is counted and answered as if it would have succeeded:
// a route that got this far would have no reason to stop.
const realFetch = globalThis.fetch
globalThis.fetch = (async (input: RequestInfo | URL) => {
  const url = input instanceof Request ? input.url : String(input)
  ctl.calls.push(url)
  if (url.includes('graph.facebook.com')) {
    if (url.includes('/oauth/access_token')) return Response.json({ access_token: 'EAAtestLongLivedUserToken' })
    if (url.includes('/me/adaccounts')) return Response.json({ data: [{ id: 'act_999999999999', name: 'Teste', account_status: 1 }] })
    if (url.includes('debug_token')) return Response.json({ data: { is_valid: true, expires_at: 0, type: 'SYSTEM_USER' } })
    return Response.json({ id: 'act_999999999999', name: 'Teste', account_status: 1 })
  }
  if (url.endsWith('/admin/oauth/access_token')) return Response.json({ access_token: 'shpat_minted_in_test', expires_in: 86399, scope: 'read_orders' })
  if (url.endsWith('/shop.json')) return Response.json({ shop: { name: 'Loja teste', currency: 'USD', iana_timezone: 'America/Sao_Paulo', myshopify_domain: 'x.myshopify.com' } })
  return new Response('{}', { status: 503 })
}) as typeof fetch
afterAll(() => { globalThis.fetch = realFetch })

const { NextRequest } = await import('next/server')

interface StoreRow { id: string; user_id: string; shopify_domain: string; archived: boolean; shop_name: string }
interface ExtraRow { id: number; tenant_id: string }

async function loadFixtures() {
  const { query } = await import('@/lib/db')
  const stores = await query<StoreRow>(
    `SELECT id, user_id, shopify_domain, archived_at IS NOT NULL AS archived, shop_name
       FROM tenants WHERE shopify_domain IS NOT NULL ORDER BY created_at`)
  const extras = await query<ExtraRow>(`SELECT id, tenant_id FROM tenant_fb_accounts ORDER BY id`)
  return { stores, extras }
}

const fx = env.hasDb ? await loadFixtures() : null

const routes = env.hasDb ? {
  profit: await import('@/app/api/profit/route'),
  tenant: await import('@/app/api/tenant/route'),
  storeById: await import('@/app/api/stores/[id]/route'),
  fbAuth: await import('@/app/api/facebook/auth/route'),
  fbCallback: await import('@/app/api/facebook/callback/route'),
  fbAccounts: await import('@/app/api/facebook/accounts/route'),
  fbExtra: await import('@/app/api/facebook/extra-accounts/route'),
  fbExtraById: await import('@/app/api/facebook/extra-accounts/[id]/route'),
  fbPending: await import('@/app/api/facebook/extra-accounts/pending/route'),
  shAuth: await import('@/app/api/shopify/auth/route'),
  shCallback: await import('@/app/api/shopify/callback/route'),
  shConnect: await import('@/app/api/shopify/connect/route'),
  shManual: await import('@/app/api/shopify/connect-manual/route'),
} : null

const { createOAuthState, viewerKey } = await import('@/lib/integrations/oauthState')
const { sealPending } = await import('@/lib/integrations/pending')

type Handler = (req: InstanceType<typeof NextRequest>, ctx: { params: Promise<Record<string, string>> }) => Promise<Response>
type Mod = Partial<Record<'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', unknown>>
interface Res { status: number; location: string | null; json: Record<string, unknown> | null }

async function call(
  mod: Mod, method: 'GET' | 'POST' | 'PUT' | 'PATCH' | 'DELETE', path: string,
  opts: { body?: unknown; cookies?: Record<string, string>; params?: Record<string, string> } = {},
): Promise<Res> {
  const headers = new Headers()
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
  return { status: res.status, location: res.headers.get('location'), json }
}

const errorSpy = vi.spyOn(console, 'error').mockImplementation(() => {})
const readOnlyRefused = () => errorSpy.mock.calls.some(args => args.some(a => /read-only transaction/i.test(String(a))))

beforeEach(() => {
  ctl.calls.length = 0
  ctl.forceArchived.clear()
  errorSpy.mockClear()
})

/** A JSON refusal: 409 store_archived with the Portuguese sentence. */
function expectJsonRefusal(r: Res, label: string) {
  expect(r.status, label).toBe(409)
  expect(r.json?.code, label).toBe('store_archived')
  expect(String(r.json?.error), label).toMatch(/está arquivada e fica só para consulta/)
}

/** An OAuth refusal: back to the site with the code and the site's store key. */
function expectRedirectRefusal(r: Res, param: 'shopify_error' | 'fb_error', storeId: string, label: string) {
  expect(r.status, label).toBe(307)
  const u = new URL(r.location!)
  expect(u.origin, label).toBe('http://localhost:3000')
  expect(u.searchParams.get(param), label).toBe('store_archived')
  expect(u.searchParams.get('loja'), label).toBe(storeId)
  expect(u.searchParams.has('store'), label).toBe(false)
}

describe.skipIf(!env.hasDb)('archived stores are consultation only (production, read-only)', () => {
  const archived = () => fx!.stores.find(s => s.archived)!
  const accountOf = () => ({ kind: 'partner', userId: archived().user_id }) as Viewer

  it('finds the real archived store and its account', () => {
    expect(archived()).toBeTruthy()
    expect(archived().shop_name).toBe('Squishy World')
  })

  describe.each(['partner', 'owner'] as const)('as the %s', (who) => {
    beforeEach(() => { ctl.viewer = who === 'owner' ? { kind: 'owner' } : accountOf() })

    it('refuses every config write before Meta, Shopify or a write statement', async () => {
      const r = routes!
      const S = archived()
      const me = viewerKey(ctl.viewer!)
      const version = (await call(r.profit, 'GET', `/api/profit?store=${S.id}`)).json!.version as string
      const pending = sealPending({ viewer: me, storeId: S.id, mode: 'extra', token: 'EAAfakeTokenForTest' })
      const json: [string, () => Promise<Res>][] = [
        ['PUT profit', () => call(r.profit, 'PUT', '/api/profit', { body: { storeId: S.id, baseVersion: version, config: { cogs: { default_cost_usd: 1 } } } })],
        ['POST tenant onboarded', () => call(r.tenant, 'POST', '/api/tenant', { body: { storeId: S.id, onboarded: true } })],
        ['POST tenant main account', () => call(r.tenant, 'POST', '/api/tenant', { body: { storeId: S.id, fb_ad_account_id: 'act_999999999999', fb_access_token: 'EAAfake' } })],
        ['POST facebook/accounts', () => call(r.fbAccounts, 'POST', '/api/facebook/accounts', { body: { storeId: S.id, fb_ad_account_id: 'act_999999999999', role: 'extra', token: 'EAAfake' } })],
        ['POST facebook/accounts (pending login)', () => call(r.fbAccounts, 'POST', '/api/facebook/accounts', { body: { fb_ad_account_id: 'act_999999999999' }, cookies: { fb_pending: pending } })],
        ['POST facebook/extra-accounts', () => call(r.fbExtra, 'POST', '/api/facebook/extra-accounts', { body: { storeId: S.id, fb_ad_account_id: 'act_999999999999', fb_access_token: 'EAAfake' } })],
        ['POST pending', () => call(r.fbPending, 'POST', '/api/facebook/extra-accounts/pending', { body: { fb_ad_account_id: 'act_999999999999' }, cookies: { fb_pending: pending } })],
        ['POST shopify/connect by id (Dev Dashboard pair)', () => call(r.shConnect, 'POST', '/api/shopify/connect', { body: { storeId: S.id, clientId: 'cid', clientSecret: 'shpss_fake' } })],
        ['POST shopify/connect by id (token)', () => call(r.shConnect, 'POST', '/api/shopify/connect', { body: { storeId: S.id, accessToken: 'shpat_fake' } })],
        ['POST shopify/connect reconnect by domain', () => call(r.shConnect, 'POST', '/api/shopify/connect', { body: { shop: S.shopify_domain, mode: 'reconnect', accessToken: 'shpat_fake' } })],
        ['POST shopify/connect-manual', () => call(r.shManual, 'POST', '/api/shopify/connect-manual', { body: { domain: S.shopify_domain, accessToken: 'shpat_fake' } })],
      ]
      // "Adding" a store needs an account: the owner's device has none here
      // (account_required comes first), so this one is the partner's.
      if (who === 'partner') {
        json.push(['POST shopify/connect add by domain', () => call(r.shConnect, 'POST', '/api/shopify/connect', { body: { shop: S.shopify_domain, mode: 'add', accessToken: 'shpat_fake' } })])
      }
      for (const [label, run] of json) {
        ctl.calls.length = 0
        errorSpy.mockClear()
        const res = await run()
        expectJsonRefusal(res, label)
        expect(ctl.calls, `${label}: external calls`).toEqual([])
        expect(readOnlyRefused(), `${label}: reached a write statement`).toBe(false)
      }

      const fbState = createOAuthState({ provider: 'facebook', viewer: me, storeId: S.id, mode: 'main', returnTo: '/settings' })
      const shState = createOAuthState({ provider: 'shopify', viewer: me, storeId: S.id, mode: 'reconnect', returnTo: '/settings', shop: S.shopify_domain })
      const redirects: [string, 'shopify_error' | 'fb_error', () => Promise<Res>][] = [
        ['GET shopify/auth by id', 'shopify_error', () => call(r.shAuth, 'GET', `/api/shopify/auth?store=${S.id}&mode=reconnect`)],
        ['GET shopify/auth by domain', 'shopify_error', () => call(r.shAuth, 'GET', `/api/shopify/auth?shop=${S.shopify_domain}&reconnect=1`)],
        ['GET shopify/callback', 'shopify_error', () => call(r.shCallback, 'GET', `/api/shopify/callback?state=${shState.state}&code=abc&shop=${S.shopify_domain}&hmac=${'0'.repeat(64)}`, { cookies: { shopify_oauth_nonce: shState.nonce } })],
        ['GET facebook/auth', 'fb_error', () => call(r.fbAuth, 'GET', `/api/facebook/auth?store=${S.id}&mode=main`)],
        ['GET facebook/callback', 'fb_error', () => call(r.fbCallback, 'GET', `/api/facebook/callback?state=${fbState.state}&code=abc`, { cookies: { fb_oauth_nonce: fbState.nonce } })],
      ]
      for (const [label, param, run] of redirects) {
        ctl.calls.length = 0
        errorSpy.mockClear()
        const res = await run()
        expectRedirectRefusal(res, param, S.id, label)
        expect(ctl.calls, `${label}: external calls`).toEqual([])
        expect(readOnlyRefused(), `${label}: reached a write statement`).toBe(false)
      }
    })

    it('still reads it: costs (saved and previewed), summary, ad accounts', async () => {
      const r = routes!
      const S = archived()
      const cfg = await call(r.profit, 'GET', `/api/profit?store=${S.id}`)
      expect(cfg.status).toBe(200)
      expect((cfg.json!.store as { archived: boolean }).archived).toBe(true)
      const preview = await call(r.profit, 'POST', '/api/profit', { body: { storeId: S.id, period: '30d' } })
      expect(preview.status).toBe(200)
      expect(preview.json!.source).toBe('saved')
      for (const [label, res] of [
        ['GET tenant', await call(r.tenant, 'GET', `/api/tenant?store=${S.id}`)],
        ['GET stores/:id', await call(r.storeById, 'GET', `/api/stores/${S.id}`, { params: { id: S.id } })],
        ['GET extra-accounts', await call(r.fbExtra, 'GET', `/api/facebook/extra-accounts?store=${S.id}`)],
      ] as const) {
        expect(res.status, label).toBe(200)
      }
      expect(ctl.calls).toEqual([])
    })

    it('restoring it is not blocked: the request reaches the UPDATE (refused only by the read-only session)', async () => {
      const S = archived()
      const res = await call(routes!.storeById, 'PATCH', `/api/stores/${S.id}`, { params: { id: S.id }, body: { archived: false } })
      expect(res.status).toBe(500)
      expect(readOnlyRefused()).toBe(true)
    })
  })

  describe('pause, rename and unlink of an archived store\'s ad account', () => {
    // A store of the same account that has an extra account, reported archived.
    const target = () => {
      const S = archived()
      const mine = new Set(fx!.stores.filter(s => s.user_id === S.user_id && !s.archived).map(s => s.id))
      return fx!.extras.find(e => mine.has(e.tenant_id)) ?? null
    }

    it('are refused before the UPDATE/DELETE', async () => {
      const x = target()
      expect(x, 'an active store of the account with an extra ad account').toBeTruthy()
      ctl.viewer = accountOf()
      ctl.forceArchived.add(x!.tenant_id)
      const r = routes!
      for (const [label, run] of [
        ['PATCH pause', () => call(r.fbExtraById, 'PATCH', `/api/facebook/extra-accounts/${x!.id}`, { params: { id: String(x!.id) }, body: { is_active: false } })],
        ['PATCH rename', () => call(r.fbExtraById, 'PATCH', `/api/facebook/extra-accounts/${x!.id}`, { params: { id: String(x!.id) }, body: { nickname: 'teste' } })],
        ['DELETE unlink', () => call(r.fbExtraById, 'DELETE', `/api/facebook/extra-accounts/${x!.id}`, { params: { id: String(x!.id) } })],
      ] as const) {
        errorSpy.mockClear()
        const res = await run()
        expectJsonRefusal(res, label)
        expect(readOnlyRefused(), `${label}: reached a write statement`).toBe(false)
      }
    })

    it('the same store, active, still reaches the database (the rule is only for archived stores)', async () => {
      const x = target()!
      ctl.viewer = accountOf()
      const res = await call(routes!.fbExtraById, 'PATCH', `/api/facebook/extra-accounts/${x.id}`, { params: { id: String(x.id) }, body: { is_active: false } })
      expect(res.status).toBe(500)
      expect(readOnlyRefused()).toBe(true)
      errorSpy.mockClear()
      const S = fx!.stores.find(s => s.id === x.tenant_id)!
      const version = (await call(routes!.profit, 'GET', `/api/profit?store=${S.id}`)).json!.version as string
      const cfg = (await call(routes!.profit, 'GET', `/api/profit?store=${S.id}`)).json!.config as { cogs: { default_cost_usd: number } }
      const put = await call(routes!.profit, 'PUT', '/api/profit', {
        body: { storeId: S.id, baseVersion: version, config: { cogs: { default_cost_usd: cfg.cogs.default_cost_usd + 0.37 } } },
      })
      expect(put.status).toBe(500)
      expect(readOnlyRefused()).toBe(true)
    })
  })
})

afterAll(async () => {
  if (env.hasDb) {
    const { pool } = await import('@/lib/db')
    await pool.end()
  }
})
