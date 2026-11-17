import { getViewer, requireStore, resolveStore, accessErrorResponse, AccessError } from '@/lib/access'
import { decodeJourneyCursor, getJourneyPage } from '@/lib/attribution'
import { isJourneyFilter } from '@/lib/attributionModels'
import { isIsoDate } from '@/lib/engine/dates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * A page of orders and their paths, for the reader on the attribution screen.
 *
 * GET ?store=<id>&from=YYYY-MM-DD&to=YYYY-MM-DD[&filter=all|paid|unattributed|multi]
 *     [&search=<order number digits>][&limit=1..100][&cursor=<nextCursor>]
 *
 * `store` is checked against the viewer (lib/access); without it the page's
 * active store is used, which is what the current client sends. Pages are
 * keyset-paged: pass the previous response's `nextCursor`. `offset` is still
 * read for the current client and ignored once a cursor is given.
 *
 * Errors are JSON `{ error }` with 400 (bad dates), 401 or 404 — never a body
 * the client could mistake for a page.
 */
export async function GET(req: Request) {
  try {
    const viewer = await getViewer()
    if (!viewer) throw new AccessError(401)

    const sp = new URL(req.url).searchParams
    const from = sp.get('from')
    const to = sp.get('to')
    if (!isIsoDate(from) || !isIsoDate(to) || from > to) {
      return Response.json({ error: 'Informe from e to como AAAA-MM-DD, com from <= to' }, { status: 400 })
    }

    const cursor = sp.get('cursor')
    if (cursor && !decodeJourneyCursor(cursor)) {
      return Response.json({ error: 'Cursor inválido' }, { status: 400 })
    }

    const storeParam = sp.get('store')
    const store = storeParam
      ? await requireStore(viewer, storeParam)
      : (await resolveStore(viewer, null)).store
    if (!store) throw new AccessError(404)

    const filter = sp.get('filter')
    const page = await getJourneyPage(store.id, from, to, {
      limit: Number(sp.get('limit')) || 30,
      cursor,
      offset: Number(sp.get('offset')) || 0,
      search: sp.get('search') ?? '',
      filter: isJourneyFilter(filter) ? filter : 'all',
    })
    return Response.json({ storeId: store.id, ...page })
  } catch (err) {
    return accessErrorResponse(err)
  }
}
