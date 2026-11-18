import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, readJson, storeFromBody, storeParam, viewerOrThrow } from '@/lib/integrations/http'
import { linkAdAccount, pickerFor, storeForFacebook } from '@/lib/integrations/fbConnect'
import { FB_PENDING_COOKIE } from '@/lib/integrations/pending'
import { refuseIfArchived } from '../../_lib/archivedStore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/facebook/accounts?store=<id> → FacebookPicker
 *
 * The ad accounts that can be linked to this store, read with the token of the
 * Facebook login just completed for it (source "pending"), or else with the
 * store's own token (source "store") — never another store's. Each says
 * whether it is already linked here or to another store. 400 `no_token` when
 * the store has no Facebook access at all. Without `store`: the store of the
 * Facebook login waiting in this browser, else the active store.
 */
export async function GET(req: NextRequest) {
  try {
    const viewer = await viewerOrThrow()
    const pending = req.cookies.get(FB_PENDING_COOKIE)?.value
    const store = await storeForFacebook(viewer, storeParam(new URL(req.url)), pending)
    return NextResponse.json(await pickerFor(viewer, store, pending))
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * POST /api/facebook/accounts
 *   { storeId, fb_ad_account_id, role?: 'main'|'extra', token?, nickname?, confirmReplacePermanent? }
 *   → { ok: true, account: StoreAdAccount, backfillFrom, warning }
 *
 * Links an ad account to the store. Token used: `token` if typed (validated
 * with Meta), else the pending Facebook login for this store, else a token the
 * store already has that can read the account. role defaults to the pending
 * login's mode, else "main".
 *
 * Errors (JSON { error, code }): 400 invalid_account | no_token, 404 store,
 * 409 attached_elsewhere | already_main | already_extra | store_archived |
 * replaces_permanent_token (with expiresAt; resend with
 * confirmReplacePermanent: true), 422 no_access | invalid_token.
 */
export async function POST(req: NextRequest) {
  try {
    const viewer = await viewerOrThrow()
    const body = await readJson(req)
    const pending = req.cookies.get(FB_PENDING_COOKIE)?.value
    const store = await storeForFacebook(viewer, storeFromBody(body), pending)
    // Consultation only: refused before Meta is asked about the account.
    refuseIfArchived(store)
    const role = body.role === 'extra' ? 'extra' : body.role === 'main' ? 'main' : null
    const linked = await linkAdAccount(viewer, store, {
      adAccountId: body.fb_ad_account_id ?? body.adAccountId,
      role,
      pastedToken: body.token ?? body.fb_access_token,
      nickname: body.nickname,
      confirmReplacePermanent: body.confirmReplacePermanent,
    }, pending)
    const res = NextResponse.json({ ok: true, account: linked.account, backfillFrom: linked.backfillFrom, warning: linked.warning })
    if (linked.usedPending) res.cookies.delete(FB_PENDING_COOKIE)
    return res
  } catch (err) {
    return errorResponse(err)
  }
}
