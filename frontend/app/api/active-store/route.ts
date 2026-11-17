import { NextResponse } from 'next/server'
import { ACTIVE_STORE_COOKIE, requireStore } from '@/lib/access'
import { errorResponse, HttpError, readJson, storeFromBody, viewerOrThrow } from '@/lib/integrations/http'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * POST /api/active-store  { storeId } → { ok: true, storeId }
 *
 * Remembers which store this browser shows by default. The cookie is only a
 * preference: every read re-checks it with lib/access, so a forged value just
 * falls back to the viewer's first store. Archived stores cannot be picked.
 */
export async function POST(req: Request) {
  try {
    const viewer = await viewerOrThrow()
    const id = storeFromBody(await readJson(req))
    if (!id) throw new HttpError(400, 'missing_store', 'Informe storeId')
    const store = await requireStore(viewer, id)
    if (store.archived) throw new HttpError(409, 'store_archived', 'Esta loja está arquivada')
    const res = NextResponse.json({ ok: true, storeId: store.id })
    res.cookies.set(ACTIVE_STORE_COOKIE, store.id, {
      httpOnly: true, sameSite: 'lax', path: '/', maxAge: 60 * 60 * 24 * 365,
      secure: process.env.NODE_ENV === 'production',
    })
    return res
  } catch (err) {
    return errorResponse(err)
  }
}
