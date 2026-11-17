import { errorResponse, HttpError, readJson, viewerOrThrow } from '@/lib/integrations/http'
import { ownedExtraAccount, removeExtraAccount, updateExtraAccount } from '@/lib/integrations/adAccounts'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

type Ctx = { params: Promise<{ id: string }> }

/**
 * PATCH /api/facebook/extra-accounts/:id  { is_active?, nickname? } → { account: ExtraFbAccount }
 *
 * is_active=false pauses COLLECTION only: the account's past spend stays in the
 * store's profit for every period (it used to vanish from all of them).
 * The row's own store is checked against the viewer — not the active store.
 */
export async function PATCH(req: Request, { params }: Ctx) {
  try {
    const viewer = await viewerOrThrow()
    const { id, store } = await ownedExtraAccount(viewer, (await params).id)
    const body = await readJson(req)
    if (body.is_active !== undefined && typeof body.is_active !== 'boolean') {
      throw new HttpError(400, 'invalid_body', 'is_active deve ser true ou false')
    }
    if (body.nickname !== undefined && body.nickname !== null && typeof body.nickname !== 'string') {
      throw new HttpError(400, 'invalid_body', 'nickname deve ser texto')
    }
    const account = await updateExtraAccount(store.id, id, {
      isActive: body.is_active as boolean | undefined,
      nickname: body.nickname as string | null | undefined,
    })
    return Response.json({ account })
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * DELETE /api/facebook/extra-accounts/:id → { ok: true, adAccountId, historyKept: true }
 *
 * Unlinks the account: collection stops, its past spend stays in the store and
 * it is listed as "historical" in GET /api/facebook/extra-accounts.
 */
export async function DELETE(_req: Request, { params }: Ctx) {
  try {
    const viewer = await viewerOrThrow()
    const { id, store } = await ownedExtraAccount(viewer, (await params).id)
    const { adAccountId } = await removeExtraAccount(store.id, id)
    return Response.json({ ok: true, adAccountId, historyKept: true })
  } catch (err) {
    return errorResponse(err)
  }
}
