import { accessErrorResponse } from '@/lib/access'
import { getCampaignReport, type CampaignAnalysisResponse } from '@/lib/data/campaigns'
import { badRequestResponse, readCampaignRequest, scaleThresholds } from '../request'

export const dynamic = 'force-dynamic'

/**
 * GET /api/campaigns/analysis?store=<id>&period=7d|…|custom&from&to
 *
 * Every campaign of the store with spend or sales in the window: Meta money
 * (phantoms dropped, unsynced ads kept), estimated profit at the engine's
 * contribution margin, and the one action (Escalar / Manter / Cortar /
 * Observar) judged on the last 7 closed days. Response:
 * CampaignAnalysisResponse (lib/data/campaigns.ts). Default window: the last
 * 7 closed days.
 */
export async function GET(req: Request) {
  try {
    const r = await readCampaignRequest(req)
    const report = await getCampaignReport(r.store, r.range, {
      thresholds: await scaleThresholds(),
      storeNames: r.storeNames,
    })
    const body: CampaignAnalysisResponse = { ...report, storeName: r.store.name, period: r.period }
    return Response.json(body)
  } catch (err) {
    return badRequestResponse(err) ?? accessErrorResponse(err)
  }
}
