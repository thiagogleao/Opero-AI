import { NextRequest } from 'next/server'
import { auth } from '@clerk/nextjs/server'
import { query } from '@/lib/db'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProfitConfig {
  shopify: {
    transaction_fee_pct: number
    payment_processing_pct: number
    payment_processing_fixed: number
  }
  cogs: {
    default_cost_usd: number
    packaging_cost_usd: number
    // Discount applied to the TOTAL cost (product+pkg+shipping) of each unit beyond the 1st
    additional_unit_discount_usd: number
    volume_discounts: {
      min_units: number
      discount_type: 'pct' | 'abs'
      discount_value: number
    }[]
    products: { product_id: string; name: string; cost_usd: number }[]
  }
  shipping: {
    default_rate_usd: number
    rates: { country_code: string; name: string; cost_usd: number }[]
  }
  extra_costs: { name: string; amount_usd: number; frequency: 'monthly' | 'per_order' | 'annual' }[]
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getShippingCost(countryCode: string | null, cfg: ProfitConfig): number {
  if (!countryCode) return cfg.shipping.default_rate_usd
  return cfg.shipping.rates.find(r => r.country_code === countryCode)?.cost_usd
    ?? cfg.shipping.default_rate_usd
}

// Returns total COGS for this order (after volume discount)
function calcCogs(units: number, cfg: ProfitConfig): number {
  const discounts = cfg.cogs.volume_discounts ?? []
  const match = [...discounts]
    .filter(d => units >= d.min_units)
    .sort((a, b) => b.min_units - a.min_units)[0]

  const baseUnit = cfg.cogs.default_cost_usd
  if (!match) return baseUnit * units

  // Support both new (discount_type/discount_value) and old (discount_pct) format
  const type = match.discount_type ?? 'pct'
  const val  = match.discount_value ?? (match as { discount_pct?: number }).discount_pct ?? 0

  if (type === 'abs') {
    return Math.max(0, baseUnit - val) * units
  } else {
    return baseUnit * (1 - val / 100) * units
  }
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
    product_id: string | null
    product_units: string
  }>(`
    SELECT o.order_id, o.total_price::text, o.country_code,
           oi.product_id,
           COALESCE(oi.quantity, 1)::text AS product_units
    FROM shopify_orders o
    JOIN tenants t ON t.id = o.tenant_id
    LEFT JOIN shopify_order_items oi ON o.order_id = oi.order_id
    WHERE o.tenant_id = $1
      AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
      AND o.financial_status NOT IN ('refunded', 'voided')
  `, [tenantId, dateFrom, dateTo])

  // Group rows into orders
  const orderMap = new Map<string, { total_price: string; country_code: string | null; items: { product_id: string | null; units: number }[] }>()
  for (const row of rows) {
    if (!orderMap.has(row.order_id)) {
      orderMap.set(row.order_id, { total_price: row.total_price, country_code: row.country_code, items: [] })
    }
    orderMap.get(row.order_id)!.items.push({ product_id: row.product_id, units: Number(row.product_units) })
  }
  const orders = Array.from(orderMap.values())

  // Build per-product COGS lookup
  const productCogs = new Map<string, number>()
  for (const p of (cfg.cogs.products ?? [])) {
    if (p.product_id && p.cost_usd > 0) productCogs.set(p.product_id, p.cost_usd)
  }
  const hasProductCogs = productCogs.size > 0

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
  const addlUnitDiscount = cfg.cogs.additional_unit_discount_usd ?? 0
  let totalRevenue = 0
  let totalShopifyFees = 0
  let totalPaymentFees = 0
  let totalCogs = 0
  let totalShipping = 0
  let totalPackaging = 0
  let totalPerOrderExtras = 0
  let totalAdditionalUnitSavings = 0

  for (const order of orders) {
    const revenue = Number(order.total_price)
    const totalUnits = order.items.reduce((s, i) => s + i.units, 0)

    totalRevenue       += revenue
    totalShopifyFees   += revenue * (cfg.shopify.transaction_fee_pct / 100)
    totalPaymentFees   += revenue * (cfg.shopify.payment_processing_pct / 100)
                        + cfg.shopify.payment_processing_fixed
    if (hasProductCogs) {
      for (const item of order.items) {
        const perUnitCost = item.product_id && productCogs.has(item.product_id)
          ? productCogs.get(item.product_id)!
          : cfg.cogs.default_cost_usd
        totalCogs += perUnitCost * item.units
      }
    } else {
      totalCogs += calcCogs(totalUnits, cfg)
    }
    totalPackaging     += cfg.cogs.packaging_cost_usd
    totalShipping      += getShippingCost(order.country_code, cfg)
    totalPerOrderExtras += perOrderExtras
    if (totalUnits > 1 && addlUnitDiscount > 0) {
      totalAdditionalUnitSavings += (totalUnits - 1) * addlUnitDiscount
    }
  }

  const orderCount      = orders.length
  const totalExtraCosts = totalPerOrderExtras + proratedExtras
  // nonFbCosts is gross costs before the additional-unit saving
  const nonFbCosts      = totalShopifyFees + totalPaymentFees + totalCogs + totalPackaging + totalShipping + totalExtraCosts - totalAdditionalUnitSavings
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

  const dailyData = dailyRevRows.map(r => {
    const rev = Number(r.revenue)
    const fb  = fbByDate[r.date] ?? 0
    const allocatedNonFb = totalRevenue > 0 ? (rev / totalRevenue) * nonFbCosts : 0
    const profit = rev - allocatedNonFb - fb
    return {
      date:    r.date,
      revenue: Math.round(rev * 100) / 100,
      costs:   Math.round((allocatedNonFb + fb) * 100) / 100,
      profit:  Math.round(profit * 100) / 100,
    }
  })

  return {
    days, dateFrom, dateTo, orderCount,
    totalRevenue, totalShopifyFees, totalPaymentFees,
    totalCogs, totalPackaging, totalShipping,
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
  const rows = await query<{ value: ProfitConfig }>(
    `SELECT settings AS value FROM profit_settings WHERE tenant_id = $1`,
    [userId]
  )
  const config = rows[0]?.value ?? null
  return Response.json({ config })
}

export async function POST(req: NextRequest) {
  const { userId } = await auth()
  if (!userId) return Response.json({ error: 'Unauthorized' }, { status: 401 })

  const body = await req.json()

  if (body.action === 'save') {
    await query(
      `INSERT INTO profit_settings (tenant_id, settings)
       VALUES ($1, $2)
       ON CONFLICT (tenant_id) DO UPDATE SET settings = $2`,
      [userId, JSON.stringify(body.config)]
    )
    return Response.json({ ok: true })
  }

  if (body.action === 'calculate') {
    const result = await calculateProfit(body.dateFrom, body.dateTo, body.config, userId)
    return Response.json(result)
  }

  return Response.json({ error: 'unknown action' }, { status: 400 })
}
