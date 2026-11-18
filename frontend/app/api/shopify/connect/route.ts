import { NextResponse } from 'next/server'
import { ACTIVE_STORE_COOKIE, requireStore } from '@/lib/access'
import { errorResponse, readJson, storeFromBody, viewerOrThrow } from '@/lib/integrations/http'
import { connectFromRequest } from '@/lib/integrations/shopifyConnect'
import { storeSummary } from '@/lib/integrations/stores'
import { refuseArchivedShopifyTarget } from '../../_lib/archivedStore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/shopify/connect
 *   { storeId?, shop?, mode?: 'reconnect'|'add', clientId, clientSecret }   Dev Dashboard app
 *   { storeId?, shop?, mode?: 'reconnect'|'add', accessToken }              legacy shpat_ token
 *   → { ok: true, created: boolean, store: StoreSummary }
 *
 * With storeId: reconnects that store (404 unless it is the viewer's; `shop`
 * defaults to its domain and must match it). Without: adds a store to the
 * viewer's account, or reconnects the viewer's store that has this domain.
 *
 * Errors (JSON { error, code }): 400 invalid_shop | missing_credentials |
 * secret_not_token | account_required, 404 not_found, 409 already_registered |
 * domain_mismatch | dev_dashboard_store | store_archived (an archived store of
 * the account, by id or domain, in either mode: consultation only) | save_failed, 422 credentials_rejected |
 * token_rejected | shop_unreachable.
 *
 * The active store only changes when a new store was created.
 */
export async function POST(req: Request) {
  try {
    const viewer = await viewerOrThrow()
    const body = await readJson(req)
    // An archived store is for consultation only: refused before the
    // credentials are minted or tested against Shopify.
    await refuseArchivedShopifyTarget(viewer, storeFromBody(body), body.shop ?? body.domain)
    const { storeId, created } = await connectFromRequest(viewer, {
      storeId: storeFromBody(body),
      shop: body.shop ?? body.domain,
      mode: body.mode,
      accessToken: body.accessToken,
      clientId: body.clientId,
      clientSecret: body.clientSecret,
    })
    const store = await storeSummary(await requireStore(viewer, storeId))
    const res = NextResponse.json({ ok: true, created, store })
    if (created) {
      res.cookies.set(ACTIVE_STORE_COOKIE, storeId, {
        httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
        secure: process.env.NODE_ENV === 'production',
      })
    }
    return res
  } catch (err) {
    return errorResponse(err)
  }
}
