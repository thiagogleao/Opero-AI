import { query } from '@/lib/db'
import { getProfitSummary } from '@/lib/profitCalc'
import { mobileAuthOk, unauthorized } from '@/lib/mobileAuth'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

/** YYYY-MM-DD for "today" in a given IANA timezone. */
function todayInTz(tz: string): string {
  return new Date().toLocaleDateString('en-CA', { timeZone: tz })
}

/** Shift a YYYY-MM-DD date string by N days (UTC-safe, no DST drift). */
function shiftDate(date: string, days: number): string {
  const [y, m, d] = date.split('-').map(Number)
  return new Date(Date.UTC(y, m - 1, d + days)).toISOString().slice(0, 10)
}

type Period = 'today' | '7d' | '30d'

function rangeFor(period: Period, tz: string): { from: string; to: string } {
  const today = todayInTz(tz)
  if (period === 'today') return { from: today, to: today }
  return { from: shiftDate(today, period === '7d' ? -6 : -29), to: today }
}

export async function GET(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()

  const { searchParams } = new URL(req.url)
  const period = (searchParams.get('period') ?? 'today') as Period

  const tenants = await query<{
    id: string; shopify_domain: string | null; shop_name: string | null; timezone: string | null
  }>(
    `SELECT id, shopify_domain, shop_name, COALESCE(timezone, 'UTC') AS timezone
     FROM tenants
     WHERE shopify_access_token IS NOT NULL
     ORDER BY created_at`
  )

  // Each store is measured against its own business day, so a store in Asia
  // isn't reported as "yesterday" while one in Brazil is still on today.
  const stores = await Promise.all(tenants.map(async t => {
    const tz = t.timezone ?? 'UTC'
    const { from, to } = rangeFor(period, tz)
    try {
      const s = await getProfitSummary(t.id, from, to)
      return {
        id: t.id,
        name: t.shop_name ?? t.shopify_domain?.replace('.myshopify.com', '') ?? 'Loja',
        domain: t.shopify_domain,
        timezone: tz,
        revenue: s.totalRevenue,
        profit: s.netProfit,
        orders: s.orderCount,
        adSpend: s.fbSpend,
        margin: s.margin,
        error: false,
      }
    } catch (err) {
      console.error('[mobile] stats failed for', t.id, err)
      return {
        id: t.id,
        name: t.shop_name ?? t.shopify_domain?.replace('.myshopify.com', '') ?? 'Loja',
        domain: t.shopify_domain, timezone: tz,
        revenue: 0, profit: 0, orders: 0, adSpend: 0, margin: 0,
        error: true,
      }
    }
  }))

  // Clone stores legitimately share a Shopify name ("Dumpling Squishy" runs on
  // two domains), which would render as two identical rows. Append the handle
  // only to the ones that actually collide, so unique names stay clean.
  const nameCount = new Map<string, number>()
  for (const s of stores) nameCount.set(s.name, (nameCount.get(s.name) ?? 0) + 1)
  for (const s of stores) {
    if ((nameCount.get(s.name) ?? 0) > 1 && s.domain) {
      s.name = `${s.name} (${s.domain.replace('.myshopify.com', '')})`
    }
  }

  // Live order feed — most recent first, across every store.
  const recent = await query<{
    order_id: string; order_number: string | null; total_price: string; currency: string
    country_code: string | null; line_items: unknown; received_at: string
    shop_name: string | null; shopify_domain: string | null
  }>(
    `SELECT lo.order_id, lo.order_number, lo.total_price::text, lo.currency,
            lo.country_code, lo.line_items, lo.received_at::text,
            t.shop_name, t.shopify_domain
     FROM live_orders lo
     JOIN tenants t ON t.id = lo.tenant_id
     ORDER BY lo.received_at DESC
     LIMIT 30`
  )

  const totals = stores.reduce(
    (a, s) => ({
      revenue: a.revenue + s.revenue,
      profit:  a.profit  + s.profit,
      orders:  a.orders  + s.orders,
      adSpend: a.adSpend + s.adSpend,
    }),
    { revenue: 0, profit: 0, orders: 0, adSpend: 0 }
  )

  return Response.json({
    period,
    totals,
    stores,
    recentOrders: recent.map(r => ({
      orderId: r.order_id,
      orderNumber: r.order_number,
      total: Number(r.total_price),
      currency: r.currency,
      country: r.country_code,
      items: r.line_items,
      receivedAt: r.received_at,
      store: r.shop_name ?? r.shopify_domain?.replace('.myshopify.com', '') ?? 'Loja',
    })),
  })
}
