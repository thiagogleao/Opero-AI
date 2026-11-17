import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, HttpError, readJson, storeFromBody, storeParam, targetStore, viewerOrThrow } from '@/lib/integrations/http'
import { linkAdAccount, storeForFacebook } from '@/lib/integrations/fbConnect'
import { FB_PENDING_COOKIE } from '@/lib/integrations/pending'
import { setOnboarded, storeSummary } from '@/lib/integrations/stores'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/tenant[?store=<id>] → { tenant: StoreSummary }
 *
 * One store's summary: the given one (404 unless the viewer may see it) or the
 * active store. It used to return the whole tenants row — Shopify and Facebook
 * tokens and the Dev Dashboard client secret — to the browser.
 */
export async function GET(req: NextRequest) {
  try {
    const viewer = await viewerOrThrow()
    const store = await targetStore(viewer, storeParam(new URL(req.url)))
    return NextResponse.json({ tenant: await storeSummary(store) })
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * POST /api/tenant  { storeId?, fb_ad_account_id?, fb_access_token?, onboarded? }
 *   → { tenant: StoreSummary, backfillFrom?, warning? }
 *
 * Kept for the current onboarding/settings screens. New screens use
 * POST /api/facebook/accounts. Send storeId: without it the active store is
 * used, which is whatever was picked last in this browser.
 *  - fb_ad_account_id: sets the store's main ad account (same rules as
 *    POST /api/facebook/accounts with role "main"; fb_access_token, if given,
 *    is a pasted token validated against that account; a token without an
 *    account id is a 400 missing_account).
 *  - onboarded: boolean.
 * Shopify credentials are not accepted here (POST /api/shopify/connect), and
 * the timezone is not editable: it comes from Shopify and the collector
 * rewrites it on every sync.
 */
export async function POST(req: NextRequest) {
  try {
    const viewer = await viewerOrThrow()
    const body = await readJson(req)
    const pending = req.cookies.get(FB_PENDING_COOKIE)?.value
    // Linking an ad account right after a Facebook login targets that login's
    // store when no id is sent (the current picker screen sends none).
    const store = body.fb_ad_account_id
      ? await storeForFacebook(viewer, storeFromBody(body), pending)
      : await targetStore(viewer, storeFromBody(body))

    if ('timezone' in body) {
      throw new HttpError(400, 'timezone_read_only', `O fuso vem da Shopify (${store.timezone}) e não pode ser alterado aqui.`)
    }
    for (const k of ['shopify_domain', 'shopify_access_token', 'facebook_app_id', 'facebook_app_secret']) {
      if (k in body) throw new HttpError(400, 'unsupported_field', `Campo não aceito aqui: ${k}. Para a Shopify use POST /api/shopify/connect.`)
    }

    const hasAccount = body.fb_ad_account_id !== undefined && body.fb_ad_account_id !== null && body.fb_ad_account_id !== ''
    if (!hasAccount && typeof body.fb_access_token === 'string' && body.fb_access_token.trim()) {
      // A token alone has nowhere to go (it belongs to an ad account); dropping
      // it and answering 200 would tell the person it was saved.
      throw new HttpError(400, 'missing_account', 'Informe o ID da conta de anúncios junto com o token do Facebook.')
    }

    let extra: Record<string, unknown> = {}
    let clearPending = false
    if (hasAccount) {
      const linked = await linkAdAccount(viewer, store, {
        adAccountId: body.fb_ad_account_id,
        role: 'main',
        pastedToken: body.fb_access_token,
        confirmReplacePermanent: body.confirmReplacePermanent,
      }, pending)
      extra = { backfillFrom: linked.backfillFrom, warning: linked.warning }
      clearPending = linked.usedPending
    }
    if (typeof body.onboarded === 'boolean') await setOnboarded(store.id, body.onboarded)

    const res = NextResponse.json({ tenant: await storeSummary(store), ...extra })
    if (clearPending) res.cookies.delete(FB_PENDING_COOKIE)
    return res
  } catch (err) {
    return errorResponse(err)
  }
}
