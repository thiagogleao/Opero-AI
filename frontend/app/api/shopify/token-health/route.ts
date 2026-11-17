import { listStores } from '@/lib/access'
import { errorResponse, viewerOrThrow } from '@/lib/integrations/http'
import { shopifyHealth } from '@/lib/integrations/health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/shopify/token-health[?archived=1]
 *   → { stores: StoreShopifyHealth[], checkedAt }
 *
 * Asks Shopify, for each of the viewer's stores, whether its stored token
 * works and which required scopes it lacks, and adds the store's connection
 * type (Dev Dashboard stores: the 24h token's expiry) and the collector's last
 * Shopify sync. `fingerprint` is a short hash to tell two tokens apart — the
 * token itself (or a masked piece of it) is never sent.
 */
export async function GET(req: Request) {
  try {
    const viewer = await viewerOrThrow()
    const includeArchived = new URL(req.url).searchParams.get('archived') === '1'
    const stores = await shopifyHealth(await listStores(viewer, { includeArchived }))
    stores.sort((a, b) => a.name.localeCompare(b.name))
    return Response.json({ stores, checkedAt: new Date().toISOString() })
  } catch (err) {
    return errorResponse(err)
  }
}
