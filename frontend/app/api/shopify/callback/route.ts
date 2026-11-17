import { NextResponse, type NextRequest } from 'next/server'
import { ACTIVE_STORE_COOKIE, getViewer, requireStore } from '@/lib/access'
import { appOrigin, errorResponse, HttpError } from '@/lib/integrations/http'
import { LEGACY_OAUTH_COOKIES, NONCE_COOKIE, readOAuthState, viewerKey } from '@/lib/integrations/oauthState'
import { exchangeAuthCode, fetchShopInfo, normalizeShopDomain, partnersApp, verifyShopifyHmac } from '@/lib/integrations/shopify'
import { connectShopify } from '@/lib/integrations/stores'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/shopify/callback — Shopify's redirect after the merchant approves.
 *
 * In order, any failure stops the flow before anything is written:
 *  1. our signed state, unexpired, matching this browser's nonce cookie;
 *  2. the same viewer who started it (else 404), signed in;
 *  3. `shop` is a myshopify.com domain and the one the flow was started for;
 *  4. Shopify's HMAC, always with the server's own client secret, in constant
 *     time (a client-supplied secret used to be accepted from a cookie);
 *  5. the code exchange, then shop.json with the new token;
 *  6. connectShopify(): reconnect touches only the viewer's own store with this
 *     domain; add refuses a domain registered in another account.
 *
 * Success → `<return>?shopify_connected=true&store=<id>`; failure →
 * `<return>?shopify_error=<code>` (on /onboarding also `error=<code>`) — back where the flow started, never a
 * success banner after a failed save. The active store changes only in the
 * "add" flow (a new store, or the account's existing store with that domain):
 * the onboarding screen continues with the Facebook step on the active store.
 */
export async function GET(req: NextRequest) {
  const origin = appOrigin(req)
  const sp = new URL(req.url).searchParams
  const check = readOAuthState(sp.get('state'), req.cookies.get(NONCE_COOKIE.shopify)?.value, 'shopify')
  const st = check.ok ? check.state : null
  const returnTo = st?.returnTo ?? '/settings'

  const finish = (res: NextResponse) => {
    res.cookies.delete(NONCE_COOKIE.shopify)
    for (const c of LEGACY_OAUTH_COOKIES) res.cookies.delete(c)
    return res
  }
  const fail = (code: string) => {
    const u = new URL(returnTo, origin)
    u.searchParams.set('shopify_error', code)
    if (st?.storeId) u.searchParams.set('store', st.storeId)
    if (returnTo === '/onboarding') {
      if (st?.mode === 'add') u.searchParams.set('addStore', 'true')
      // The current onboarding screen reads `error`; without it a failed
      // connect would land back on the form with no message at all.
      u.searchParams.set('error', code)
    }
    return finish(NextResponse.redirect(u))
  }

  try {
    if (!st || !st.shop) return fail('invalid_state')
    const viewer = await getViewer()
    if (!viewer) return finish(NextResponse.redirect(new URL('/sign-in', origin)))
    if (viewerKey(viewer) !== st.viewer) return finish(NextResponse.json({ error: 'Loja não encontrada', code: 'not_found' }, { status: 404 }))
    if (st.storeId) await requireStore(viewer, st.storeId)

    const shop = normalizeShopDomain(sp.get('shop'))
    if (!shop || shop !== st.shop) return fail('invalid_shop')

    const app = partnersApp()
    if (!app) return fail('not_configured')
    if (!verifyShopifyHmac(sp, app.clientSecret)) {
      // Never transient: Shopify signs with the secret of the app whose
      // client_id started the flow. Log which pair — never the secret.
      console.error(`[shopify/callback] HMAC inválido para ${shop} (client_id=${app.clientId}). Confira o par no painel do app.`)
      return fail('invalid_hmac')
    }

    const code = sp.get('code')
    if (!code) return fail('access_denied')
    const exchanged = await exchangeAuthCode(shop, code, app)
    if (!exchanged.ok) return fail('token_exchange_failed')
    const shopCheck = await fetchShopInfo(shop, exchanged.token)
    if (!shopCheck.ok) return fail('shop_unreachable')

    const { storeId, created } = await connectShopify(viewer, {
      storeId: st.storeId,
      domain: shop,
      mode: st.mode === 'reconnect' ? 'reconnect' : 'add',
      credential: { kind: 'token', token: exchanged.token },
      info: shopCheck.info,
    })

    const u = new URL(returnTo, origin)
    // 'true', the value the current onboarding and settings screens test for.
    u.searchParams.set('shopify_connected', 'true')
    u.searchParams.set('store', storeId)
    if (returnTo === '/onboarding') {
      // What the current onboarding screen reads to continue with Facebook.
      if (st.mode === 'add') u.searchParams.set('addStore', 'true')
      if (st.startDate) u.searchParams.set('storeStartDate', st.startDate)
    }
    const res = finish(NextResponse.redirect(u))
    // The current onboarding screen sends no store id to its Facebook step, so
    // the store just connected must be the active one — also when "add" found
    // the shop already in the account (created = false), or the Facebook
    // account would be linked to whatever store was active before.
    if (created || st.mode === 'add') {
      res.cookies.set(ACTIVE_STORE_COOKIE, storeId, {
        httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
        secure: process.env.NODE_ENV === 'production',
      })
    }
    return res
  } catch (err) {
    if (err instanceof HttpError) return fail(err.code)
    const res = errorResponse(err)
    if (res.status === 404 || res.status === 401) return finish(NextResponse.json(await res.json(), { status: res.status }))
    return fail('save_failed')
  }
}
