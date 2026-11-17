import { getViewer, requireStore, resolveStore, accessErrorResponse, AccessError } from '@/lib/access'
import { getProductReport, type ProductReport, type ProductRow } from '@/lib/data/products'
import { isModel } from '@/lib/attributionModels'
import { isIsoDate, isPeriod, resolveRange, type Period } from '@/lib/engine/dates'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Products of one store for a period, every number from the profit engine.
 *
 * GET ?store=<id>&period=30d            (preset, resolved in the store's timezone)
 * GET ?store=<id>&period=custom&from=YYYY-MM-DD&to=YYYY-MM-DD
 *     [&model=first|last|linear]        (journey credit rule for the attributed-spend column)
 * Legacy: ?dateFrom=&dateTo= is read as a custom period, and without `store`
 * the page's active store is used — that is what ProductProfitTable sends.
 *
 * Response: ProductReport (lib/data/products.ts) plus `period`, and on each
 * product the snake_case fields the current ProductProfitTable reads. Those
 * are derived from the engine numbers and go away with the UI rewrite.
 */

/** @deprecated Fields read by the current ProductProfitTable. */
interface LegacyFields {
  product_id: string
  image_url: string | null
  /** All variable costs of the product (engine), not COGS alone. */
  cogs: number
  allocated_fb_spend: number
  /** contribution − journey-attributed Meta spend. */
  estimated_profit: number
  margin: number
  configured: boolean
}

function legacy(p: ProductRow, configured: boolean): ProductRow & LegacyFields {
  const r2 = (v: number) => Math.round(v * 100) / 100
  const profit = p.contributionAfterAttributedSpend
  return {
    ...p,
    product_id: p.productId ?? '',
    image_url: p.imageUrl,
    cogs: r2(p.variableCosts),
    allocated_fb_spend: r2(p.attributedSpend),
    estimated_profit: r2(profit),
    margin: p.revenue > 0 ? Math.round((profit / p.revenue) * 1000) / 10 : 0,
    configured,
  }
}

export async function GET(req: Request) {
  try {
    const viewer = await getViewer()
    if (!viewer) throw new AccessError(401)
    const sp = new URL(req.url).searchParams

    const storeParam = sp.get('store')
    const store = storeParam
      ? await requireStore(viewer, storeParam)
      : (await resolveStore(viewer, null)).store
    if (!store) throw new AccessError(404)

    const legacyFrom = sp.get('dateFrom'), legacyTo = sp.get('dateTo')
    const from = sp.get('from') ?? legacyFrom
    const to = sp.get('to') ?? legacyTo
    const rawPeriod = sp.get('period') ?? (from || to ? 'custom' : '30d')
    if (!isPeriod(rawPeriod)) return Response.json({ error: 'Período inválido' }, { status: 400 })
    const period: Period = rawPeriod
    if (period === 'custom' && !(isIsoDate(from) && isIsoDate(to))) {
      return Response.json({ error: 'Informe as datas como AAAA-MM-DD' }, { status: 400 })
    }
    const range = resolveRange(period, store.timezone, from, to)
    const rawModel = sp.get('model')
    const model = isModel(rawModel) ? rawModel : 'first'

    const report = await getProductReport(store, range, { model })
    if (!report) throw new AccessError(404)
    const body: ProductReport & { period: Period; storeName: string; totalFbSpend: number } = {
      ...report,
      period,
      storeName: store.name,
      products: report.products.map(p => legacy(p, report.configured)),
      // Legacy: the table's footer reads it.
      totalFbSpend: report.totals.metaSpend,
    }
    return Response.json(body)
  } catch (err) {
    return accessErrorResponse(err)
  }
}
