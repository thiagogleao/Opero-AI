import { accessErrorResponse } from '@/lib/access'
import { getAdsetReport, type CampaignDetailResponse } from '@/lib/data/campaigns'
import { getCreativesReport } from '@/lib/data/creatives'
import { loadStoreMargin } from '@/lib/data/meta'
import { badRequestResponse, readCampaignRequest } from '../request'

export const dynamic = 'force-dynamic'

/**
 * GET /api/campaigns/<campaignId>?store=<id>&period=…&from&to
 *
 * The ad sets and the ads of one campaign of the store, for the expanded row
 * of the campaign table. 404 when the store holds no spend of that campaign in
 * the window. Response: CampaignDetailResponse (lib/data/campaigns.ts).
 */
export async function GET(req: Request, { params }: { params: Promise<{ id: string }> }) {
  try {
    const { id } = await params
    const r = await readCampaignRequest(req)
    const margin = await loadStoreMargin(r.store.id, r.range)
    const [adsets, ads] = await Promise.all([
      getAdsetReport(r.store, id, r.range, { storeNames: r.storeNames, margin }),
      getCreativesReport(r.store, r.range, { storeNames: r.storeNames, margin, campaignId: id }),
    ])
    if (!adsets) return Response.json({ error: 'Campanha sem gasto nesta loja no período' }, { status: 404 })
    const body: CampaignDetailResponse = { ...adsets, ads: ads.creatives, notes: ads.notes }
    return Response.json(body)
  } catch (err) {
    return badRequestResponse(err) ?? accessErrorResponse(err)
  }
}
