import { NextResponse, type NextRequest } from 'next/server'
import { getViewer } from '@/lib/access'
import { facebookApp, facebookDialogUrl } from '@/lib/integrations/facebook'
import { appOrigin, errorResponse, flowCookie, storeParam, targetStore } from '@/lib/integrations/http'
import {
  createOAuthState, LEGACY_OAUTH_COOKIES, NONCE_COOKIE, OAUTH_TTL_SECONDS, safeReturnTo, viewerKey,
} from '@/lib/integrations/oauthState'
import { FB_PENDING_COOKIE } from '@/lib/integrations/pending'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/facebook/auth?store=<id>&mode=main|extra[&return=/settings]
 *   (`return` may carry the page's periodo/de/ate/parte; see safeReturnTo)
 *
 * Starts the Facebook OAuth for one store. The target store, the mode and the
 * viewer travel in a signed, expiring state (lib/integrations/oauthState), not
 * in cookies the browser can edit. Without `store` the active store is used
 * (the current settings links do not send it). `mode=add_extra` is accepted
 * as an alias of `extra`.
 *
 * Refusals (archived store: consultation only; app not configured) come back
 * as `<return>?fb_error=<code>&loja=<id>`. 404 when the store is not the
 * viewer's; not signed in → /sign-in.
 */
export async function GET(req: NextRequest) {
  const origin = appOrigin(req)
  const url = new URL(req.url)
  const returnTo = safeReturnTo(url.searchParams.get('return'), '/settings')
  try {
    const viewer = await getViewer()
    if (!viewer) return NextResponse.redirect(new URL('/sign-in', origin))
    const store = await targetStore(viewer, storeParam(url))

    const back = (code: string) => {
      const u = new URL(returnTo, origin)
      u.searchParams.set('fb_error', code)
      // The site's store key, so the banner shows on this store's screen.
      u.searchParams.set('loja', store.id)
      return NextResponse.redirect(u)
    }
    if (store.archived) return back('store_archived')
    const app = facebookApp()
    if (!app) return back('not_configured')

    const rawMode = url.searchParams.get('mode')
    const mode = rawMode === 'extra' || rawMode === 'add_extra' ? 'extra' : 'main'
    const { state, nonce } = createOAuthState({
      provider: 'facebook', viewer: viewerKey(viewer), storeId: store.id, mode, returnTo,
    })

    const res = NextResponse.redirect(facebookDialogUrl(app, `${origin}/api/facebook/callback`, state))
    res.cookies.set(NONCE_COOKIE.facebook, nonce, flowCookie(OAUTH_TTL_SECONDS))
    for (const c of [...LEGACY_OAUTH_COOKIES, FB_PENDING_COOKIE]) res.cookies.delete(c)
    return res
  } catch (err) {
    return errorResponse(err)
  }
}
