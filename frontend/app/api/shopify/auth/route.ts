import { NextResponse, type NextRequest } from 'next/server'
import { getViewer, listStores, requireStore } from '@/lib/access'
import { storeCredentials } from '@/lib/integrations/credentials'
import { accountForNewStore, appOrigin, errorResponse, flowCookie, HttpError, storeParam } from '@/lib/integrations/http'
import {
  createOAuthState, LEGACY_OAUTH_COOKIES, NONCE_COOKIE, OAUTH_TTL_SECONDS, returnPathname, safeReturnTo, viewerKey,
} from '@/lib/integrations/oauthState'
import { normalizeShopDomain, partnersApp, SHOPIFY_SCOPES } from '@/lib/integrations/shopify'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/shopify/auth?shop=<handle or domain>&mode=reconnect|add&store=<id>
 *                      [&return=/settings|/settings/chaves|/onboarding][&storeStartDate=YYYY-MM-DD]
 *   (`return` may carry the page's periodo/de/ate/parte; see safeReturnTo)
 *
 * Starts the Partners-app OAuth (the app in SHOPIFY_CLIENT_ID/SECRET).
 *  - reconnect: `store` (or, for the current links, the viewer's store with
 *    this domain) must be the viewer's — else 404 — and `shop` must be its
 *    domain. Dev Dashboard stores cannot use this: they connect with Client
 *    ID + Secret through POST /api/shopify/connect.
 *  - add: a new store in the viewer's account (or the viewer's existing store
 *    with that domain). Whether the domain belongs to another account is
 *    checked in the callback, once Shopify has proven the person administers it.
 * `reconnect=1` / `addStore=1` are accepted for the current links.
 *
 * Client ID and Secret are never accepted in the URL (it ends up in browser
 * history and access logs): 400. `shop` must be a *.myshopify.com domain.
 * Errors come back as `<return>?shopify_error=<code>` (a reconnect also with
 * `loja=<id>`); an archived store is refused with store_archived in both modes.
 */
export async function GET(req: NextRequest) {
  const origin = appOrigin(req)
  const sp = new URL(req.url).searchParams
  const mode = sp.get('mode') === 'reconnect' || sp.get('reconnect') === '1' ? 'reconnect' : 'add'
  const returnTo = safeReturnTo(sp.get('return'), mode === 'reconnect' ? '/settings' : '/onboarding')
  // `loja` (the site's store key) names the store the failure is about, so the
  // banner shows on that store's screen, not on whatever store was open last.
  let storeId: string | null = null
  const back = (code: string) => {
    const u = new URL(returnTo, origin)
    u.searchParams.set('shopify_error', code)
    if (storeId && mode === 'reconnect') u.searchParams.set('loja', storeId)
    // What the current onboarding screen reads to show the failure.
    if (returnPathname(returnTo) === '/onboarding') u.searchParams.set('error', code)
    return NextResponse.redirect(u)
  }

  try {
    if (sp.has('clientSecret') || sp.has('clientId')) {
      throw new HttpError(400, 'secret_in_url',
        'Não envie Client ID/Secret pela URL. Use POST /api/shopify/connect com { shop, clientId, clientSecret }.')
    }
    const viewer = await getViewer()
    if (!viewer) return NextResponse.redirect(new URL('/sign-in', origin))

    let shop = normalizeShopDomain(sp.get('shop'))
    const explicitStore = storeParam(new URL(req.url))

    if (mode === 'reconnect') {
      if (explicitStore) {
        const store = await requireStore(viewer, explicitStore)
        storeId = store.id
        // An archived store is for consultation only.
        if (store.archived) return back('store_archived')
        // The store's own domain when the link does not repeat it.
        if (!sp.get('shop')) shop = normalizeShopDomain(store.domain)
      } else {
        if (!shop) return back('invalid_shop')
        const mine = (await listStores(viewer, { includeArchived: true })).find(s => s.domain?.toLowerCase() === shop)
        if (!mine) return errorResponse(new HttpError(404, 'not_found', 'Loja não encontrada'))
        storeId = mine.id
        if (mine.archived) return back('store_archived')
      }
    } else {
      if (!shop) return back('invalid_shop')
      const mine = (await listStores(viewer, { includeArchived: true })).find(s => s.domain?.toLowerCase() === shop)
      if (mine?.archived) return back('store_archived')
      if (mine) storeId = mine.id
      else await accountForNewStore(viewer)
    }

    if (storeId) {
      const creds = await storeCredentials(storeId)
      if (!shop || creds?.shopifyDomain?.toLowerCase() !== shop) return back('domain_mismatch')
      if (creds.devDashboard) return back('dev_dashboard_store')
    }
    if (!shop) return back('invalid_shop')

    const app = partnersApp()
    if (!app) return back('not_configured')

    const startDate = sp.get('storeStartDate')
    const { state, nonce } = createOAuthState({
      provider: 'shopify', viewer: viewerKey(viewer), storeId, mode, returnTo, shop,
      ...(startDate && /^\d{4}-\d{2}-\d{2}$/.test(startDate) ? { startDate } : {}),
    })

    const authUrl = new URL(`https://${shop}/admin/oauth/authorize`)
    authUrl.searchParams.set('client_id', app.clientId)
    authUrl.searchParams.set('scope', SHOPIFY_SCOPES)
    authUrl.searchParams.set('redirect_uri', `${origin}/api/shopify/callback`)
    authUrl.searchParams.set('state', state)

    const res = NextResponse.redirect(authUrl)
    res.cookies.set(NONCE_COOKIE.shopify, nonce, flowCookie(OAUTH_TTL_SECONDS))
    for (const c of LEGACY_OAUTH_COOKIES) res.cookies.delete(c)
    return res
  } catch (err) {
    if (err instanceof HttpError && err.code === 'account_required') return back('account_required')
    return errorResponse(err)
  }
}
