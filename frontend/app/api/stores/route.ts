import { listStores } from '@/lib/access'
import { errorResponse, viewerOrThrow } from '@/lib/integrations/http'
import { loadStoreSummaries } from '@/lib/integrations/stores'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/stores[?archived=1]
 *
 * The viewer's stores (a partner: their account's; the owner: all), oldest
 * first, as StoreSummary — presence and health flags, never a credential.
 * Archived stores only with ?archived=1 (the "arquivadas" view).
 *
 * There is no POST: stores are created by connecting Shopify
 * (GET /api/shopify/auth?mode=add or POST /api/shopify/connect).
 */
export async function GET(req: Request) {
  try {
    const viewer = await viewerOrThrow()
    const includeArchived = new URL(req.url).searchParams.get('archived') === '1'
    const refs = await listStores(viewer, { includeArchived })
    return Response.json({ stores: await loadStoreSummaries(refs) })
  } catch (err) {
    return errorResponse(err)
  }
}
