import { NextRequest } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { query } from '@/lib/db'
import { getActiveTenantId } from '@/lib/activeStore'
import { getProfitSummary, type ProfitConfig } from '@/lib/profitCalc'

export async function GET(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = await getActiveTenantId(userId)

  const { searchParams } = new URL(req.url)
  const dateFrom = searchParams.get('dateFrom') ?? ''
  const dateTo   = searchParams.get('dateTo')   ?? ''
  if (!dateFrom || !dateTo) return Response.json({ error: 'dateFrom and dateTo required' }, { status: 400 })

  // Full profit summary to know if configured and get total FB spend
  const summary = await getProfitSummary(tenantId, dateFrom, dateTo)

  // Load config for per-product COGS overrides
  const cfgRows = await query<{ value: ProfitConfig }>(
    `SELECT settings AS value FROM profit_settings WHERE tenant_id = $1`,
    [tenantId]
  )
  const cfg = cfgRows[0]?.value

  const productCogsMap = new Map<string, number>()
  for (const p of (cfg?.cogs?.products ?? [])) {
    if (p.product_id && p.cost_usd > 0) productCogsMap.set(p.product_id, p.cost_usd)
  }
  const defaultCogs     = cfg?.cogs?.default_cost_usd ?? 0
  const packagingCost   = cfg?.cogs?.packaging_cost_usd ?? 0
  const defaultShipping = cfg?.shipping?.default_rate_usd ?? 0
  const txFeePct        = ((cfg?.shopify?.transaction_fee_pct ?? 0) + (cfg?.shopify?.payment_processing_pct ?? 0)) / 100
  const paymentFixed    = cfg?.shopify?.payment_processing_fixed ?? 0

  // Product-level Shopify metrics
  const products = await query<{
    product_id: string | null; title: string
    units: string; orders: string; revenue: string; image_url: string | null
  }>(`
    SELECT
      oi.product_id,
      COALESCE(p.title, oi.product_title, oi.title, 'Produto sem nome') AS title,
      SUM(oi.quantity)::text                               AS units,
      COUNT(DISTINCT o.order_id)::text                    AS orders,
      ROUND(SUM(oi.quantity * oi.price)::numeric, 2)::text AS revenue,
      p.image_url
    FROM shopify_order_items oi
    JOIN shopify_orders o ON oi.order_id = o.order_id AND (oi.tenant_id IS NULL OR oi.tenant_id = o.tenant_id)
    JOIN tenants t ON t.id = o.tenant_id
    LEFT JOIN shopify_products p ON oi.product_id = p.product_id AND p.tenant_id = o.tenant_id
    WHERE o.tenant_id = $1
      AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
      AND o.financial_status NOT IN ('refunded','voided')
    GROUP BY oi.product_id, p.title, oi.product_title, oi.title, p.image_url
    ORDER BY SUM(oi.quantity * oi.price) DESC
    LIMIT 30
  `, [tenantId, dateFrom, dateTo])

  const totalProductRevenue = products.reduce((s, p) => s + Number(p.revenue), 0)

  const result = products.map(p => {
    const revenue  = Number(p.revenue)
    const units    = Number(p.units)
    const orders   = Number(p.orders)
    const pid      = p.product_id ?? ''

    // Allocate FB spend proportionally by Shopify revenue share
    const allocFbSpend = totalProductRevenue > 0
      ? summary.fbSpend * (revenue / totalProductRevenue)
      : 0

    if (!summary.configured) {
      const profit = revenue - allocFbSpend
      return {
        product_id: pid, title: p.title, image_url: p.image_url,
        units, orders, revenue,
        cogs: 0, allocated_fb_spend: Math.round(allocFbSpend * 100) / 100,
        estimated_profit: Math.round(profit * 100) / 100,
        margin: revenue > 0 ? Math.round((profit / revenue) * 1000) / 10 : 0,
        configured: false,
      }
    }

    // Per-product COGS or default, plus packaging per order
    const cogsPerUnit = productCogsMap.get(pid) ?? defaultCogs
    const totalCogs   = cogsPerUnit * units + packagingCost * orders
    const fees        = revenue * txFeePct + orders * paymentFixed
    const shipping    = orders * defaultShipping
    const profit      = revenue - totalCogs - allocFbSpend - fees - shipping
    const margin      = revenue > 0 ? (profit / revenue) * 100 : 0

    return {
      product_id: pid, title: p.title, image_url: p.image_url,
      units, orders, revenue,
      cogs: Math.round(totalCogs * 100) / 100,
      allocated_fb_spend: Math.round(allocFbSpend * 100) / 100,
      estimated_profit:   Math.round(profit * 100) / 100,
      margin:             Math.round(margin * 10) / 10,
      configured: true,
    }
  }).sort((a, b) => b.estimated_profit - a.estimated_profit)

  return Response.json({ products: result, configured: summary.configured, totalFbSpend: summary.fbSpend })
}
