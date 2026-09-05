import { query } from '@/lib/db'
import { getCountryProfit } from '@/lib/profitCalc'
import { getProductMetrics, getCustomerSplit } from '@/lib/queries'
import { mobileAuthOk, unauthorized } from '@/lib/mobileAuth'
import { resolveRange, REFERENCE_TZ, type Period } from '@/lib/mobileRange'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/**
 * Detail sections for the mobile dashboard, fetched only when a tab is opened.
 *
 * Kept out of /api/mobile because each section costs a query per store, and the
 * headline numbers should not wait on a tab the user may never open.
 */
export async function GET(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()

  const { searchParams } = new URL(req.url)
  const section = searchParams.get('section') ?? 'products'
  const period  = (searchParams.get('period') ?? 'today') as Period
  const storeId = searchParams.get('store')
  const { from, to } = resolveRange(
    period, REFERENCE_TZ, searchParams.get('from'), searchParams.get('to')
  )

  const tenants = await query<{ id: string }>(
    storeId && storeId !== 'all'
      ? `SELECT id FROM tenants WHERE id = $1 AND shopify_access_token IS NOT NULL`
      : `SELECT id FROM tenants WHERE shopify_access_token IS NOT NULL ORDER BY created_at`,
    storeId && storeId !== 'all' ? [storeId] : []
  )
  const ids = tenants.map(t => t.id)

  // A single store's failure yields an empty contribution rather than a 500.
  const gather = async <T>(fn: (id: string) => Promise<T[]>): Promise<T[]> => {
    const parts = await Promise.all(ids.map(id =>
      fn(id).catch(err => { console.error('[mobile/detail]', section, id, err); return [] as T[] })
    ))
    return parts.flat()
  }

  if (section === 'products') {
    const rows = await gather(id => getProductMetrics(id, from, to))
    // Merge the same product across clone stores — they sell the same catalog.
    const merged = new Map<string, { title: string; units: number; orders: number; revenue: number }>()
    for (const r of rows as { title: string; units: number; orders: number; revenue: number }[]) {
      const key = r.title ?? 'Sem título'
      const cur = merged.get(key) ?? { title: key, units: 0, orders: 0, revenue: 0 }
      cur.units   += Number(r.units ?? 0)
      cur.orders  += Number(r.orders ?? 0)
      cur.revenue += Number(r.revenue ?? 0)
      merged.set(key, cur)
    }
    const products = [...merged.values()]
      .map(p => ({ ...p, aov: p.orders > 0 ? p.revenue / p.orders : 0 }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 40)
    return Response.json({ section, from, to, products })
  }

  if (section === 'countries') {
    const rows = await gather(id => getCountryProfit(id, from, to))
    const merged = new Map<string, {
      country_code: string; revenue: number; orders: number; fbSpend: number; netProfit: number
    }>()
    for (const r of rows) {
      const key = r.country_code || '??'
      const cur = merged.get(key) ?? { country_code: key, revenue: 0, orders: 0, fbSpend: 0, netProfit: 0 }
      cur.revenue   += Number(r.revenue ?? 0)
      cur.orders    += Number(r.orders ?? 0)
      cur.fbSpend   += Number(r.fbSpend ?? 0)
      cur.netProfit += Number(r.netProfit ?? 0)
      merged.set(key, cur)
    }
    const countries = [...merged.values()]
      // Recompute ratios from summed totals, never average per-store ratios.
      .map(c => ({
        ...c,
        margin: c.revenue > 0 ? (c.netProfit / c.revenue) * 100 : 0,
        roas:   c.fbSpend > 0 ? c.revenue / c.fbSpend : null,
      }))
      .sort((a, b) => b.revenue - a.revenue)
      .slice(0, 40)
    return Response.json({ section, from, to, countries })
  }

  if (section === 'customers') {
    const rows = await gather(id => getCustomerSplit(id, from, to))
    const totals = rows.reduce((a, r) => ({
      newCustomers:       a.newCustomers       + Number(r.new_customers ?? 0),
      returningCustomers: a.returningCustomers + Number(r.returning_customers ?? 0),
      newRevenue:         a.newRevenue         + Number(r.new_revenue ?? 0),
      returningRevenue:   a.returningRevenue   + Number(r.returning_revenue ?? 0),
    }), { newCustomers: 0, returningCustomers: 0, newRevenue: 0, returningRevenue: 0 })
    return Response.json({ section, from, to, customers: totals })
  }

  return Response.json({ error: 'Unknown section' }, { status: 400 })
}
