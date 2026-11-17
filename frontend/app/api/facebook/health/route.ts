import { errorResponse, storeParam, targetStore, viewerOrThrow } from '@/lib/integrations/http'
import { facebookHealth } from '@/lib/integrations/health'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * GET /api/facebook/health?store=<id> → StoreFacebookHealth
 *
 * For each linked ad account: can its token read it right now, the token's
 * type and expiry (system-user tokens never expire; a Facebook login produces
 * a 60-day user token that nothing renews), the account's status at Meta, and
 * the collector's errors in the last 24h that name it. Makes live calls to
 * Meta: call it when the screen opens, not on a timer.
 */
export async function GET(req: Request) {
  try {
    const viewer = await viewerOrThrow()
    const store = await targetStore(viewer, storeParam(new URL(req.url)))
    return Response.json(await facebookHealth(store))
  } catch (err) {
    return errorResponse(err)
  }
}
