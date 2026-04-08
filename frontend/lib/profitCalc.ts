import { query } from './db'

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

export interface ProfitSummary {
  configured: boolean
  orderCount: number
  totalRevenue: number
  totalCosts: number
  netProfit: number
  margin: number
  avgProfitPerOrder: number
  breakEvenRoas: number
  fbSpend: number
  totalCogs: number
  totalShipping: number
  totalFees: number
  totalExtraCosts: number
  totalAdditionalUnitSavings: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getShippingCost(countryCode: string | null, cfg: ProfitConfig): number {
  if (!countryCode) return cfg.shipping.default_rate_usd
  return cfg.shipping.rates.find(r => r.country_code === countryCode)?.cost_usd
    ?? cfg.shipping.default_rate_usd
}

function calcCogs(units: number, cfg: ProfitConfig): number {
  const discounts = cfg.cogs.volume_discounts ?? []
  const match = [...discounts]
    .filter(d => units >= d.min_units)
    .sort((a, b) => b.min_units - a.min_units)[0]

  const baseUnit = cfg.cogs.default_cost_usd
  if (!match) return baseUnit * units

  const type = match.discount_type ?? 'pct'
  const val  = match.discount_value ?? (match as { discount_pct?: number }).discount_pct ?? 0

  return type === 'abs'
    ? Math.max(0, baseUnit - val) * units
    : baseUnit * (1 - val / 100) * units
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getProfitSummary(
  tenantId: string,
  dateFrom: string,
  dateTo: string
): Promise<ProfitSummary> {
  // Load saved config
  const rows = await query<{ value: ProfitConfig }>(
    `SELECT value FROM profit_settings WHERE key = 'config' AND tenant_id = $1`,
    [tenantId]
  )
  const cfg = rows[0]?.value

  if (!cfg || Object.keys(cfg).length === 0) {
    return {
      configured: false, orderCount: 0, totalRevenue: 0, totalCosts: 0,
      netProfit: 0, margin: 0, avgProfitPerOrder: 0, breakEvenRoas: 0,
      fbSpend: 0, totalCogs: 0, totalShipping: 0, totalFees: 0,
      totalExtraCosts: 0, totalAdditionalUnitSavings: 0,
    }
  }

  const days = Math.round(
    (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000
  ) + 1

  // Build per-product COGS lookup from config
  const productCogs = new Map<string, number>()
  for (const p of (cfg.cogs.products ?? [])) {
    if (p.product_id && p.cost_usd > 0) productCogs.set(p.product_id, p.cost_usd)
  }
  const hasProductCogs = productCogs.size > 0

  const orders = await query<{
    order_id: string; total_price: string; country_code: string | null
    total_units: string; product_id: string | null; product_units: string
  }>(`
    SELECT o.order_id::text, o.total_price::text, o.country_code,
           COALESCE(SUM(oi.quantity), 1)::text AS total_units,
           oi.product_id,
           COALESCE(oi.quantity, 1)::text AS product_units
    FROM shopify_orders o
    LEFT JOIN shopify_order_items oi ON o.order_id = oi.order_id
    WHERE o.tenant_id = $1
      AND o.created_at::date BETWEEN $2::date AND $3::date
      AND o.financial_status NOT IN ('refunded', 'voided')
    GROUP BY o.order_id, o.total_price, o.country_code, oi.product_id, oi.quantity
  `, [tenantId, dateFrom, dateTo])

  // Group by order_id so we can compute per-order totals
  const orderMap = new Map<string, { total_price: string; country_code: string | null; items: { product_id: string | null; units: number }[] }>()
  for (const row of orders) {
    if (!orderMap.has(row.order_id)) {
      orderMap.set(row.order_id, { total_price: row.total_price, country_code: row.country_code, items: [] })
    }
    orderMap.get(row.order_id)!.items.push({ product_id: row.product_id, units: Number(row.product_units) })
  }
  const groupedOrders = Array.from(orderMap.values())

  const [fbRow] = await query<{ spend: string }>(`
    SELECT COALESCE(SUM(spend), 0)::text AS spend
    FROM fb_ad_daily_metrics
    WHERE tenant_id = $1
      AND date BETWEEN $2::date AND $3::date
  `, [tenantId, dateFrom, dateTo])
  const fbSpend = Number(fbRow.spend)

  const perOrderExtras = (cfg.extra_costs ?? [])
    .filter(e => e.frequency === 'per_order').reduce((s, e) => s + e.amount_usd, 0)
  const monthlyExtras = (cfg.extra_costs ?? [])
    .filter(e => e.frequency === 'monthly').reduce((s, e) => s + e.amount_usd, 0)
  const annualExtras = (cfg.extra_costs ?? [])
    .filter(e => e.frequency === 'annual').reduce((s, e) => s + e.amount_usd, 0)
  const proratedExtras = monthlyExtras * (days / 30) + annualExtras * (days / 365)

  const addlDiscount = cfg.cogs.additional_unit_discount_usd ?? 0
  let totalRevenue = 0, totalShopifyFees = 0, totalPaymentFees = 0
  let totalCogs = 0, totalShipping = 0, totalPackaging = 0
  let totalPerOrderExtras = 0, totalAdditionalUnitSavings = 0

  for (const order of groupedOrders) {
    const revenue = Number(order.total_price)
    const totalUnits = order.items.reduce((s, i) => s + i.units, 0)
    totalRevenue       += revenue
    totalShopifyFees   += revenue * (cfg.shopify.transaction_fee_pct / 100)
    totalPaymentFees   += revenue * (cfg.shopify.payment_processing_pct / 100) + cfg.shopify.payment_processing_fixed
    // Per-product COGS if configured, otherwise fall back to default volume-discount calc
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
    if (totalUnits > 1 && addlDiscount > 0)
      totalAdditionalUnitSavings += (totalUnits - 1) * addlDiscount
  }

  const totalFees      = totalShopifyFees + totalPaymentFees
  const totalExtraCosts = totalPerOrderExtras + proratedExtras
  const totalCosts     = totalFees + totalCogs + totalPackaging + totalShipping + totalExtraCosts + fbSpend - totalAdditionalUnitSavings
  const netProfit      = totalRevenue - totalCosts
  const margin         = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0
  const orderCount     = orders.length

  return {
    configured: true,
    orderCount, totalRevenue, totalCosts, netProfit, margin,
    avgProfitPerOrder: orderCount > 0 ? netProfit / orderCount : 0,
    breakEvenRoas: fbSpend > 0 ? totalCosts / fbSpend : 0,
    fbSpend, totalCogs: totalCogs + totalPackaging, totalShipping,
    totalFees, totalExtraCosts, totalAdditionalUnitSavings,
  }
}

export interface CountryProfit {
  country_code: string
  revenue: number
  orders: number
  fbSpend: number
  netProfit: number
  margin: number
  roas: number
  configured: boolean
}

export async function getCountryProfit(
  tenantId: string,
  dateFrom: string,
  dateTo: string
): Promise<CountryProfit[]> {
  const rows = await query<{ value: ProfitConfig }>(
    `SELECT value FROM profit_settings WHERE key = 'config' AND tenant_id = $1`,
    [tenantId]
  )
  const cfg = rows[0]?.value

  // Shopify revenue + orders + avg units per order per country
  // Uses CTE to pre-aggregate items per order, avoiding SUM(total_price) duplication
  // when orders have multiple line items (each line item row would double-count revenue otherwise)
  const shopifyRows = await query<{
    country_code: string; revenue: string; orders: string; avg_units: string
  }>(`
    WITH order_items_agg AS (
      SELECT order_id, COALESCE(SUM(quantity), 1) AS total_quantity
      FROM shopify_order_items
      WHERE tenant_id = $1
      GROUP BY order_id
    )
    SELECT
      COALESCE(o.country_code, 'XX')             AS country_code,
      ROUND(SUM(o.total_price::numeric), 2)::text AS revenue,
      COUNT(o.order_id)::text                     AS orders,
      ROUND(
        COALESCE(SUM(oia.total_quantity)::numeric / NULLIF(COUNT(o.order_id), 0), 1)
      , 2)::text                                  AS avg_units
    FROM shopify_orders o
    LEFT JOIN order_items_agg oia ON o.order_id = oia.order_id
    WHERE o.tenant_id = $1
      AND o.created_at::date BETWEEN $2::date AND $3::date
      AND o.financial_status NOT IN ('refunded', 'voided')
    GROUP BY o.country_code
    ORDER BY SUM(o.total_price::numeric) DESC
    LIMIT 12
  `, [tenantId, dateFrom, dateTo])

  // True total FB spend from daily metrics (authoritative)
  const [fbTotalRow] = await query<{ spend: string }>(`
    SELECT COALESCE(SUM(spend), 0)::text AS spend
    FROM fb_ad_daily_metrics
    WHERE tenant_id = $1
      AND date BETWEEN $2::date AND $3::date
  `, [tenantId, dateFrom, dateTo])
  const totalFbSpend = Number(fbTotalRow.spend)

  // Total revenue across shown countries (for proportional FB allocation)
  const totalShownRevenue = shopifyRows.reduce((s, r) => s + Number(r.revenue), 0)

  const days = Math.round(
    (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000
  ) + 1

  const perOrderExtras = !cfg ? 0 :
    (cfg.extra_costs ?? []).filter(e => e.frequency === 'per_order').reduce((s, e) => s + e.amount_usd, 0)
  const monthlyExtras = !cfg ? 0 :
    (cfg.extra_costs ?? []).filter(e => e.frequency === 'monthly').reduce((s, e) => s + e.amount_usd, 0)
  const annualExtras = !cfg ? 0 :
    (cfg.extra_costs ?? []).filter(e => e.frequency === 'annual').reduce((s, e) => s + e.amount_usd, 0)
  const proratedFixedExtras = monthlyExtras * (days / 30) + annualExtras * (days / 365)

  // Total orders across shown countries — used to allocate fixed costs proportionally
  const totalShownOrders = shopifyRows.reduce((s, r) => s + Number(r.orders), 0)

  return shopifyRows.map(row => {
    const country  = row.country_code
    const revenue  = Number(row.revenue)
    const orders   = Number(row.orders)
    const avgUnits = Math.max(1, Math.round(Number(row.avg_units)))

    // Allocate FB spend proportionally by revenue share so country profits sum to ≈ store total
    const fbSpend = totalShownRevenue > 0 ? totalFbSpend * (revenue / totalShownRevenue) : 0
    const roas    = fbSpend > 0 ? revenue / fbSpend : 0

    if (!cfg || Object.keys(cfg).length === 0) {
      return { country_code: country, revenue, orders, fbSpend, netProfit: revenue - fbSpend, margin: 0, roas, configured: false }
    }

    const fees     = revenue * ((cfg.shopify.transaction_fee_pct + cfg.shopify.payment_processing_pct) / 100)
                   + orders * cfg.shopify.payment_processing_fixed
    // Apply COGS per average order size (not aggregate) to avoid triggering volume discounts incorrectly
    const cogsPerOrder = calcCogs(avgUnits, cfg) + cfg.cogs.packaging_cost_usd
    const cogs     = cogsPerOrder * orders
    const shipping = orders * getShippingCost(country, cfg)
    // Per-order extras + prorated fixed costs allocated by order share
    const fixedShare = totalShownOrders > 0 ? proratedFixedExtras * (orders / totalShownOrders) : 0
    const extras   = orders * perOrderExtras + fixedShare
    const totalCosts = fees + cogs + shipping + extras + fbSpend
    const netProfit  = revenue - totalCosts
    const margin     = revenue > 0 ? (netProfit / revenue) * 100 : 0

    return {
      country_code: country, revenue, orders, fbSpend,
      netProfit, margin, roas,
      configured: true,
    }
  })
}
