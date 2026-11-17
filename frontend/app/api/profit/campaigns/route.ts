import { accessErrorResponse } from '@/lib/access'
import { getCampaignReport } from '@/lib/data/campaigns'
import { badRequestResponse, readCampaignRequest, scaleThresholds } from '../../campaigns/request'

export const dynamic = 'force-dynamic'

/**
 * GET /api/profit/campaigns — DEPRECATED, transitional.
 *
 * This route used to compute a second per-campaign profit ("Lucro Real Est.")
 * by fuzzy-matching campaign names to product titles, handing each matched
 * campaign the Shopify revenue of that product in the countries it reached,
 * and rescaling the result to the store's net profit. That heuristic matched
 * "CATÁLOGO" to a cat plush, left the biggest campaign unmatched and, when the
 * store lost money, multiplied every row by a negative factor. It is gone (the
 * owner agreed).
 *
 * What remains keeps the response shape components/CampaignProfitTable.tsx
 * reads, filled from the same report as /api/campaigns/analysis:
 *   fb_profit = estimated profit (Meta purchase value × contribution margin −
 *               spend); the "real" columns are empty (attribution_reliable is
 *               false on every row). Phantom purchases are dropped and spend of
 *               unsynced ads is kept, so the rows add up to the store's spend.
 * The UI phase replaces that table with the campaign report table; then this
 * route can be deleted.
 */
export async function GET(req: Request) {
  try {
    const r = await readCampaignRequest(req, '30d')
    const report = await getCampaignReport(r.store, r.range, {
      thresholds: await scaleThresholds(),
      storeNames: r.storeNames,
    })
    const campaigns = report.campaigns.map(c => ({
      campaign_id: c.campaignId ?? `unsynced:${c.accountId ?? ''}`,
      campaign_name: c.name,
      matched_product: null,
      spend: c.spend,
      fb_revenue: c.purchaseValue,
      purchases: c.purchases,
      roas: c.roas !== null ? Math.round(c.roas * 100) / 100 : 0,
      fb_profit: c.estimatedProfit ?? 0,
      fb_margin: c.margin !== null ? Math.round(c.margin * 10) / 10 : 0,
      attributed_revenue: 0,
      real_profit: 0,
      real_margin: 0,
      configured: c.estimatedProfit !== null,
      attribution_reliable: false,
    })).sort((a, b) => b.spend - a.spend)
    return Response.json({
      campaigns,
      // Legacy name: the share of revenue that is NOT contribution, in %.
      nonFbCostRate: report.contributionRate !== null ? Math.round((1 - report.contributionRate) * 1000) / 10 : 0,
      configured: report.configured && report.contributionRate !== null,
      hasBreakdownData: false,
      totalNetProfit: null,
      range: report.range,
      breakEvenRoas: report.breakEvenRoas,
      formula: report.formula,
      deprecated: 'Use /api/campaigns/analysis',
    })
  } catch (err) {
    return badRequestResponse(err) ?? accessErrorResponse(err)
  }
}
