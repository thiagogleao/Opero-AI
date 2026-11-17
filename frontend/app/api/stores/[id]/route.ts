import { requireStore } from '@/lib/access'
import { errorResponse, HttpError, readJson, viewerOrThrow } from '@/lib/integrations/http'
import { setArchived, storeSummary } from '@/lib/integrations/stores'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/** GET /api/stores/:id → { store: StoreSummary }. 404 unless the viewer may see it. */
export async function GET(_req: Request, { params }: Ctx) {
  try {
    const viewer = await viewerOrThrow()
    const store = await requireStore(viewer, (await params).id)
    return Response.json({ store: await storeSummary(store) })
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * PATCH /api/stores/:id  { archived: boolean } → { store: StoreSummary }
 *
 * Archive or restore a store. Only the owner or the partner whose account the
 * store belongs to (requireStore). Archiving keeps history and credentials;
 * the store leaves "Todas", the pickers and the sync.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const viewer = await viewerOrThrow()
    const store = await requireStore(viewer, (await params).id)
    const body = await readJson(req)
    if (typeof body.archived !== 'boolean') throw new HttpError(400, 'invalid_body', 'Envie { archived: true | false }')
    await setArchived(store.id, body.archived)
    return Response.json({ store: await storeSummary({ ...store, archived: body.archived }) })
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * DELETE /api/stores/:id → { ok: true, archived: true, store }
 *
 * Kept for the current "Remover" button: it archives (never a hard delete,
 * which either failed on the tables that reference the store or destroyed a
 * new store with its credentials). Restore with PATCH { archived: false }.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const viewer = await viewerOrThrow()
    const store = await requireStore(viewer, (await params).id)
    await setArchived(store.id, true)
    return Response.json({ ok: true, archived: true, store: await storeSummary({ ...store, archived: true }) })
  } catch (err) {
    return errorResponse(err)
  }
}
