import { NextResponse, type NextRequest } from 'next/server'
import { requireStore } from '@/lib/access'
import { errorResponse, HttpError, readJson, viewerOrThrow } from '@/lib/integrations/http'
import { linkAdAccount, pickerFor } from '@/lib/integrations/fbConnect'
import { viewerKey } from '@/lib/integrations/oauthState'
import { FB_PENDING_COOKIE, readPending } from '@/lib/integrations/pending'
import { refuseIfArchived } from '../../../_lib/archivedStore'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * The picker after a Facebook login, for the current /facebook/extra-accounts
 * screen (which sends no store id). Store and mode come from the sealed
 * pending cookie, which is bound to this viewer, and the store is re-checked
 * with requireStore. New screens call /api/facebook/accounts?store=<id>.
 *
 * GET  → FacebookPicker (400 no_pending when no login is waiting)
 * POST { fb_ad_account_id, nickname?, confirmReplacePermanent? }
 *      → { ok: true, account: StoreAdAccount, backfillFrom, warning }
 */
async function pendingStore(req: NextRequest) {
  const viewer = await viewerOrThrow()
  const raw = req.cookies.get(FB_PENDING_COOKIE)?.value
  const pending = readPending(raw, viewerKey(viewer))
  if (!pending) throw new HttpError(400, 'no_pending', 'Nenhum login do Facebook aguardando. Conecte de novo.')
  return { viewer, raw, pending, store: await requireStore(viewer, pending.storeId) }
}

export async function GET(req: NextRequest) {
  try {
    const { viewer, raw, store } = await pendingStore(req)
    return NextResponse.json(await pickerFor(viewer, store, raw))
  } catch (err) {
    return errorResponse(err)
  }
}

export async function POST(req: NextRequest) {
  try {
    const { viewer, raw, pending, store } = await pendingStore(req)
    refuseIfArchived(store)
    const body = await readJson(req)
    const linked = await linkAdAccount(viewer, store, {
      adAccountId: body.fb_ad_account_id,
      role: pending.mode,
      nickname: body.nickname,
      confirmReplacePermanent: body.confirmReplacePermanent,
    }, raw)
    const res = NextResponse.json({ ok: true, account: linked.account, backfillFrom: linked.backfillFrom, warning: linked.warning })
    res.cookies.delete(FB_PENDING_COOKIE)
    return res
  } catch (err) {
    return errorResponse(err)
  }
}
