import { accessErrorResponse, requireStore, requireViewer, resolveStore } from '@/lib/access'
import { getFreshness, jobSnapshot, legacyStatus } from '@/lib/sync/status'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/sync-status?storeIds=a,b   (or ?storeId=a; default: current store)
 *
 *   stores  StoreFreshness[]  per store: last order, and per source (Shopify,
 *                             Meta insights, Meta structure) last success,
 *                             last attempt, status, short reason, busy,
 *                             staleness; per ad account the same plus
 *                             Meta's account status
 *   jobs    JobSnapshot[]     jobs running or waiting in this server
 *   shopify / facebook / lastSync   the old single-store shape, for the first
 *                             store (RefreshButton / AutoSync); lastSync is
 *                             now when every source has finished, not the
 *                             first one
 */
export async function GET(req: Request) {
  try {
    const viewer = await requireViewer()
    const url = new URL(req.url)
    const raw = url.searchParams.get('storeIds') ?? url.searchParams.get('storeId')
    let ids: string[]
    if (raw) {
      const refs = await Promise.all([...new Set(raw.split(',').map(s => s.trim()).filter(Boolean))]
        .map(id => requireStore(viewer, id)))
      ids = refs.map(r => r.id)
    } else {
      const { store } = await resolveStore(viewer, null)
      ids = store ? [store.id] : []
    }
    if (!ids.length) return Response.json({ stores: [], jobs: [], shopify: null, facebook: null, lastSync: null })
    const [stores, legacy] = await Promise.all([getFreshness(ids), legacyStatus(ids[0])])
    return Response.json({ stores, jobs: jobSnapshot(ids), ...legacy })
  } catch (err) {
    return accessErrorResponse(err)
  }
}
