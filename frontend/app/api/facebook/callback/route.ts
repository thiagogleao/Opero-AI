import { NextResponse, type NextRequest } from 'next/server'
import { getViewer, requireStore } from '@/lib/access'
import { attachAdAccount } from '@/lib/integrations/adAccounts'
import { storeCredentials } from '@/lib/integrations/credentials'
import { exchangeCodeForLongToken, facebookApp, listAdAccounts } from '@/lib/integrations/facebook'
import { appOrigin, errorResponse, flowCookie, HttpError } from '@/lib/integrations/http'
import { LEGACY_OAUTH_COOKIES, NONCE_COOKIE, readOAuthState, returnState, viewerKey } from '@/lib/integrations/oauthState'
import { FB_PENDING_COOKIE, FB_PENDING_TTL_SECONDS, sealPending } from '@/lib/integrations/pending'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/facebook/callback — Facebook's redirect after the dialog.
 *
 * 1. The state must be ours (signature, expiry, nonce cookie of this browser),
 *    started by this same viewer, for a store this viewer may see (else 404).
 * 2. code → long-lived token, then the ad accounts it can read.
 * 3. The token waits in a sealed cookie for the person to choose an account.
 *    When the token reads exactly one live account, linking it breaks no rule
 *    and it would not replace the store's current main account with another,
 *    it is linked right away.
 *
 * Exits: `<return>?fb_connected=true&loja=<id>` on success, the picker
 * (/facebook/accounts or /facebook/extra-accounts, `?loja=<id>`) to choose,
 * or `<return>?fb_error=<code>&loja=<id>` — `loja` being the site's store key,
 * so the banner shows on that store's screen. Every exit clears the flow
 * cookies, so a cancelled flow can never steer the next one. A store archived
 * while the dialog was open is refused (store_archived: consultation only)
 * before the code is exchanged.
 */
export async function GET(req: NextRequest) {
  const origin = appOrigin(req)
  const sp = new URL(req.url).searchParams
  const check = readOAuthState(sp.get('state'), req.cookies.get(NONCE_COOKIE.facebook)?.value, 'facebook')
  const st = check.ok ? check.state : null
  const returnTo = st?.returnTo ?? '/settings'

  const finish = (res: NextResponse, pending?: string) => {
    res.cookies.delete(NONCE_COOKIE.facebook)
    for (const c of LEGACY_OAUTH_COOKIES) res.cookies.delete(c)
    if (pending) res.cookies.set(FB_PENDING_COOKIE, pending, flowCookie(FB_PENDING_TTL_SECONDS))
    else res.cookies.delete(FB_PENDING_COOKIE)
    return res
  }
  const to = (path: string, params: Record<string, string>) => {
    const u = new URL(path, origin)
    for (const [k, v] of Object.entries(params)) u.searchParams.set(k, v)
    return NextResponse.redirect(u)
  }
  const fail = (code: string) => finish(to(returnTo, st?.storeId ? { fb_error: code, loja: st.storeId } : { fb_error: code }))

  try {
    if (!st || !st.storeId) return fail('invalid_state')
    const viewer = await getViewer()
    if (!viewer) return finish(NextResponse.redirect(new URL('/sign-in', origin)))
    if (viewerKey(viewer) !== st.viewer) return finish(NextResponse.json({ error: 'Loja não encontrada', code: 'not_found' }, { status: 404 }))
    const store = await requireStore(viewer, st.storeId)
    if (store.archived) return fail('store_archived')

    if (sp.get('error') || !sp.get('code')) return fail('access_denied')
    const app = facebookApp()
    if (!app) return fail('not_configured')

    const exchanged = await exchangeCodeForLongToken(app, sp.get('code')!, `${origin}/api/facebook/callback`)
    if (!exchanged.ok) return fail(exchanged.reason)
    const listed = await listAdAccounts(exchanged.token)
    const accounts = listed.ok ? listed.accounts : []
    const mode = st.mode === 'extra' ? 'extra' : 'main'

    // Link without asking only when nothing changes but the token: a live
    // account, and for "main" either the store has none yet or it is the same
    // one. Switching a store's main account silently would splice two
    // accounts' histories with no effective date, so that goes to the picker.
    const currentMain = mode === 'main' ? (await storeCredentials(store.id))?.fbAdAccountId ?? null : null
    const only = accounts.length === 1 ? accounts[0] : null
    if (only && only.account_status === 1 && (mode === 'extra' || !currentMain || currentMain === only.id)) {
      try {
        await attachAdAccount(viewer, store, { adAccountId: only.id, role: mode, token: exchanged.token })
        // 'true', the value the current Settings screen tests for.
        return finish(to(returnTo, { fb_connected: 'true', loja: store.id }))
      } catch (err) {
        // A rule stopped the automatic link (already linked elsewhere, would
        // replace a permanent token…): let the picker explain it.
        if (!(err instanceof HttpError)) throw err
      }
    }

    const pending = sealPending({ viewer: st.viewer, storeId: store.id, mode, token: exchanged.token })
    const picker = mode === 'extra' ? '/facebook/extra-accounts' : '/facebook/accounts'
    // The picker keeps the period the flow started on, so its way back does too.
    const keep = returnState(returnTo)
    return finish(to(picker, accounts.length === 0 ? { ...keep, loja: store.id, manual: 'true' } : { ...keep, loja: store.id }), pending)
  } catch (err) {
    const res = errorResponse(err)
    if (res.status === 404 || res.status === 401) return finish(NextResponse.json(await res.json(), { status: res.status }))
    return fail('save_failed')
  }
}
