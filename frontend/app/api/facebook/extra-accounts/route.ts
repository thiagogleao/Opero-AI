import { NextResponse, type NextRequest } from 'next/server'
import { errorResponse, readJson, storeFromBody, storeParam, targetStore, viewerOrThrow } from '@/lib/integrations/http'
import { listExtraAccountsLegacy, listStoreAdAccounts } from '@/lib/integrations/adAccounts'
import { linkAdAccount } from '@/lib/integrations/fbConnect'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/facebook/extra-accounts?store=<id>
 *   → { storeId, accounts: ExtraFbAccount[], adAccounts: StoreAdAccount[] }
 *
 * `adAccounts` is the full list for Settings: main, extra and "historical"
 * (no longer linked, history still in the books), with 30-day spend.
 * `accounts` is the old extras-only shape the current Settings reads.
 */
export async function GET(req: NextRequest) {
  try {
    const viewer = await viewerOrThrow()
    const store = await targetStore(viewer, storeParam(new URL(req.url)))
    const [accounts, adAccounts] = await Promise.all([listExtraAccountsLegacy(store.id), listStoreAdAccounts(store.id)])
    return NextResponse.json({ storeId: store.id, accounts, adAccounts })
  } catch (err) {
    return errorResponse(err)
  }
}

/**
 * POST /api/facebook/extra-accounts  { storeId, fb_ad_account_id, fb_access_token, nickname? }
 *   → { ok: true, account: StoreAdAccount, backfillFrom, warning }
 *
 * Links an extra account with a typed token (typically a system-user token,
 * which never expires). Same rules as POST /api/facebook/accounts, role "extra".
 */
export async function POST(req: NextRequest) {
  try {
    const viewer = await viewerOrThrow()
    const body = await readJson(req)
    const store = await targetStore(viewer, storeFromBody(body))
    const linked = await linkAdAccount(viewer, store, {
      adAccountId: body.fb_ad_account_id,
      role: 'extra',
      pastedToken: body.fb_access_token ?? body.token,
      nickname: body.nickname,
      confirmReplacePermanent: body.confirmReplacePermanent,
    }, undefined)
    return NextResponse.json({ ok: true, account: linked.account, backfillFrom: linked.backfillFrom, warning: linked.warning })
  } catch (err) {
    return errorResponse(err)
  }
}
