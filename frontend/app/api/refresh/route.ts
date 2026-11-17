import { accessErrorResponse, requireViewer } from '@/lib/access'
import { requestRefresh, RefreshInputError, SyncDisabledError, type RefreshRequest, type RefreshSource } from '@/lib/sync/refresh'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/refresh — start a sync for the viewer's stores.
 *
 * Body (all optional):
 *   storeIds   string[]   stores to refresh (default: the current store)
 *   storeId    string     same, one store
 *   sources    ('shopify'|'facebook'|'structure')[]   default shopify+facebook
 *   dateFrom / dateTo     YYYY-MM-DD, store-local: a backfill of that period
 *   account    string     Meta only: just this ad account
 *
 * Answers RefreshResponse (lib/sync/refresh.ts): one entry per store and
 * source saying whether a job started, joined one already waiting, was
 * already running, had just finished ("fresh") or had nothing to collect.
 */
export async function POST(req: Request) {
  try {
    const viewer = await requireViewer()
    const body = (await req.json().catch(() => ({}))) as Record<string, unknown>
    const ids = Array.isArray(body.storeIds) ? body.storeIds.filter((x): x is string => typeof x === 'string')
      : typeof body.storeId === 'string' ? [body.storeId] : undefined
    const input: RefreshRequest = {
      storeIds: ids,
      sources: Array.isArray(body.sources) ? body.sources.filter((x): x is RefreshSource => typeof x === 'string') : undefined,
      dateFrom: typeof body.dateFrom === 'string' ? body.dateFrom : undefined,
      dateTo: typeof body.dateTo === 'string' ? body.dateTo : undefined,
      account: typeof body.account === 'string' ? body.account : undefined,
    }
    return Response.json(await requestRefresh(viewer, input))
  } catch (err) {
    if (err instanceof RefreshInputError) {
      return Response.json({ started: false, error: err.message }, { status: err instanceof SyncDisabledError ? 503 : 400 })
    }
    return accessErrorResponse(err)
  }
}
