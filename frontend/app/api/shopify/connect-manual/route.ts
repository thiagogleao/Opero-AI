import { NextResponse } from 'next/server'
import { requireStore } from '@/lib/access'
import { errorResponse, readJson, storeFromBody, viewerOrThrow } from '@/lib/integrations/http'
import { connectFromRequest } from '@/lib/integrations/shopifyConnect'
import { storeSummary } from '@/lib/integrations/stores'
import { refuseArchivedShopifyTarget } from '../../_lib/archivedStore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/shopify/connect-manual  { domain, accessToken, storeId? }
 *   → { ok: true, storeId, store: StoreSummary }
 *
 * Kept for the current /settings/chaves screen: a pasted shpat_ token for one
 * of the viewer's stores. Same rules as POST /api/shopify/connect (which new
 * screens should use). It no longer creates stores — use connect with
 * mode "add" — and no longer switches the active store. An archived store is
 * refused (409 store_archived: consultation only).
 */
export async function POST(req: Request) {
  try {
    const viewer = await viewerOrThrow()
    const body = await readJson(req)
    await refuseArchivedShopifyTarget(viewer, storeFromBody(body), body.domain ?? body.shop)
    const { storeId } = await connectFromRequest(viewer, {
      storeId: storeFromBody(body),
      shop: body.domain ?? body.shop,
      mode: 'reconnect',
      accessToken: body.accessToken,
    })
    const store = await storeSummary(await requireStore(viewer, storeId))
    return NextResponse.json({ ok: true, storeId, store })
  } catch (err) {
    return errorResponse(err)
  }
}
