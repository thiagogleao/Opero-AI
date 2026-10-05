import { NextRequest } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { query } from '@/lib/db'
import { getActiveTenantId } from '@/lib/activeStore'
import { buildCogsLookups, orderSupplierCost, type ProfitConfig } from '@/lib/profitCalc'

export type { ProfitConfig }

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getShippingCost(countryCode: string | null, cfg: ProfitConfig): number {
  if (!countryCode) return cfg.shipping.default_rate_usd
  return cfg.shipping.rates.find(r => r.country_code === countryCode)?.cost_usd
    ?? cfg.shipping.default_rate_usd
}

// ─── Calculation ──────────────────────────────────────────────────────────────

async function calculateProfit(dateFrom: string, dateTo: string, cfg: ProfitConfig, tenantId: string) {
  const days = Math.round(
    (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000
  ) + 1

  // 1. Orders with per-product line items (timezone-aware)
  const rows = await query<{
    order_id: string
    total_price: string
    country_code: string | null
    order_date: string
    product_id: string | null
    product_title: string | null
    product_units: string
  }>(`
    SELECT o.order_id, o.total_price::text, o.country_code,
           (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date::text AS order_date,
           oi.product_id,
           oi.product_title,
           COALESCE(oi.quantity, 1)::text AS product_units
    FROM shopify_orders o
    JOIN tenants t ON t.id = o.tenant_id
    LEFT JOIN shopify_order_items oi ON oi.order_id = o.order_id AND (oi.tenant_id IS NULL OR oi.tenant_id = o.tenant_id)
    WHERE o.tenant_id = $1
      AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
      AND o.financial_status NOT IN ('refunded', 'voided')
  `, [tenantId, dateFrom, dateTo])

  // Group rows into orders
  const orderMap = new Map<string, { total_price: string; country_code: string | null; order_date: string; items: { product_id: string | null; product_title: string | null; units: number }[] }>()
  for (const row of rows) {
    if (!orderMap.has(row.order_id)) {
      orderMap.set(row.order_id, { total_price: row.total_price, country_code: row.country_code, order_date: row.order_date, items: [] })
    }
    orderMap.get(row.order_id)!.items.push({ product_id: row.product_id, product_title: row.product_title, units: Number(row.product_units) })
  }
  const orders = Array.from(orderMap.values())

  const lookups = buildCogsLookups(cfg)

  // 2. FB spend
  const [fbRow] = await query<{ spend: string }>(`
    SELECT COALESCE(SUM(spend), 0)::text AS spend
    FROM fb_ad_daily_metrics
    WHERE tenant_id = $1
      AND date BETWEEN $2::date AND $3::date
  `, [tenantId, dateFrom, dateTo])
  const fbSpend = Number(fbRow.spend)

  // 3. Extra costs
  const perOrderExtras = (cfg.extra_costs ?? [])
    .filter(e => e.frequency === 'per_order')
    .reduce((s, e) => s + e.amount_usd, 0)
  const monthlyExtras = (cfg.extra_costs ?? [])
    .filter(e => e.frequency === 'monthly')
    .reduce((s, e) => s + e.amount_usd, 0)
  const annualExtras = (cfg.extra_costs ?? [])
    .filter(e => e.frequency === 'annual')
    .reduce((s, e) => s + e.amount_usd, 0)
  const proratedExtras = monthlyExtras * (days / 30) + annualExtras * (days / 365)

  // 4. Aggregate
  let totalRevenue = 0
  let totalShopifyFees = 0
  let totalPaymentFees = 0
  let totalCogs = 0
  let totalShipping = 0
  let totalPackaging = 0
  let totalPerOrderExtras = 0
  let totalAdditionalUnitSavings = 0
  let totalOrderFees = 0
  // Order-driven costs totalled per day, so the chart can price each day from
  // its own orders instead of smearing the period average across all of them.
  const costByDay = new Map<string, number>()

  for (const order of orders) {
    const revenue = Number(order.total_price)
    const shopifyFee = revenue * (cfg.shopify.transaction_fee_pct / 100)
    const paymentFee = revenue * (cfg.shopify.payment_processing_pct / 100)
                     + cfg.shopify.payment_processing_fixed

    totalRevenue       += revenue
    totalShopifyFees   += shopifyFee
    totalPaymentFees   += paymentFee
    const { cogs: orderCogs, orderFee, saving } = orderSupplierCost(order, lookups, cfg)
    const shipping = getShippingCost(order.country_code, cfg)

    totalCogs          += orderCogs
    totalOrderFees     += orderFee
    totalPackaging     += cfg.cogs.packaging_cost_usd
    totalShipping      += shipping
    totalPerOrderExtras += perOrderExtras
    totalAdditionalUnitSavings += saving

    const orderCost = shopifyFee + paymentFee + orderCogs + orderFee
                    + cfg.cogs.packaging_cost_usd + shipping + perOrderExtras - saving
    costByDay.set(order.order_date, (costByDay.get(order.order_date) ?? 0) + orderCost)
  }

  const orderCount      = orders.length
  const totalExtraCosts = totalPerOrderExtras + proratedExtras
  // nonFbCosts is gross costs before the additional-unit saving
  const nonFbCosts      = totalShopifyFees + totalPaymentFees + totalCogs + totalOrderFees + totalPackaging + totalShipping + totalExtraCosts - totalAdditionalUnitSavings
  const netProfit       = totalRevenue - nonFbCosts - fbSpend
  const margin          = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0

  // 5. Daily breakdown
  const dailyRevRows = await query<{ date: string; revenue: string }>(`
    SELECT date::text, COALESCE(SUM(total_revenue), 0)::text AS revenue
    FROM shopify_daily_metrics
    WHERE tenant_id = $1
      AND date BETWEEN $2::date AND $3::date
    GROUP BY date ORDER BY date
  `, [tenantId, dateFrom, dateTo])

  const dailyFbRows = await query<{ date: string; spend: string }>(`
    SELECT date::text, COALESCE(SUM(spend), 0)::text AS spend
    FROM fb_ad_daily_metrics
    WHERE tenant_id = $1
      AND date BETWEEN $2::date AND $3::date
    GROUP BY date ORDER BY date
  `, [tenantId, dateFrom, dateTo])

  const fbByDate: Record<string, number> = {}
  for (const r of dailyFbRows) fbByDate[r.date] = Number(r.spend)

  // Monthly and annual costs belong to no single day, so they stay spread.
  // Everything an order drives is charged to the day that order landed on.
  const fixedPerDay = proratedExtras / days

  const dailyData = dailyRevRows.map(r => {
    const rev = Number(r.revenue)
    const fb  = fbByDate[r.date] ?? 0
    const own = costByDay.get(r.date.slice(0, 10))
    const nonFb = own !== undefined
      ? own + fixedPerDay
      : (totalRevenue > 0 ? (rev / totalRevenue) * nonFbCosts : 0)
    const profit = rev - nonFb - fb
    return {
      date:    r.date,
      revenue: Math.round(rev * 100) / 100,
      costs:   Math.round((nonFb + fb) * 100) / 100,
      profit:  Math.round(profit * 100) / 100,
    }
  })

  return {
    days, dateFrom, dateTo, orderCount,
    totalRevenue, totalShopifyFees, totalPaymentFees,
    totalCogs, totalOrderFees, totalPackaging, totalShipping,
    fbSpend, totalExtraCosts, totalAdditionalUnitSavings, netProfit, margin,
    avgRevenuePerOrder: orderCount > 0 ? totalRevenue / orderCount : 0,
    avgProfitPerOrder:  orderCount > 0 ? netProfit / orderCount : 0,
    breakEvenRoas: fbSpend > 0 ? (totalRevenue - netProfit) / fbSpend : 0,
    dailyData,
  }
}

// ─── Route handlers ───────────────────────────────────────────────────────────

export async function GET() {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = await getActiveTenantId(userId)
  const rows = await query<{ value: ProfitConfig }>(
    `SELECT settings AS value FROM profit_settings WHERE tenant_id = $1`,
    [tenantId]
  )
  const config = rows[0]?.value ?? null
  return Response.json({ config })
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })
  const tenantId = await getActiveTenantId(userId)

  const body = await req.json()

  if (body.action === 'save') {
    await query(
      `INSERT INTO profit_settings (tenant_id, settings)
       VALUES ($1, $2)
       ON CONFLICT (tenant_id) DO UPDATE SET settings = $2`,
      [tenantId, JSON.stringify(body.config)]
    )
    return Response.json({ ok: true })
  }

  if (body.action === 'calculate') {
    const result = await calculateProfit(body.dateFrom, body.dateTo, body.config, tenantId)
    return Response.json(result)
  }

  return Response.json({ error: 'unknown action' }, { status: 400 })
}
