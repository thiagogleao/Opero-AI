import { query } from './db'

// ─── Types ────────────────────────────────────────────────────────────────────

/** A supplier price list that takes over on `effective_from` and stays in force
 *  until a later one starts. Prices are quoted per *order*, keyed by unit
 *  count — not per unit — because consolidated shipping is what makes the
 *  marginal unit cheap, and that curve is not a flat discount per extra item.
 *  Orders before the earliest tier keep using default_cost_usd and the
 *  additional-unit discount, so history is never rewritten. */
export interface CogsPriceTier {
  /** YYYY-MM-DD, inclusive. Compared against the order date in store time. */
  effective_from: string
  label?: string
  /** Unit count → total cost of an order with exactly that many units. */
  order_prices: Record<string, number>
  /** Cost of each unit past the largest listed step. */
  extra_unit_usd: number
}

/** The supplier quotes a different unit price per destination because the
 *  freight is baked into it — the DSers "Shipping Cost" column is $0 on every
 *  order. A country missing here falls back to the product's base price. */
export interface CountryPriceList {
  product_id: string
  name?: string
  /** ISO-3166 alpha-2 → unit price in USD. */
  prices: Record<string, number>
}

/** A flat charge the supplier adds per *order* for a destination — the EU's
 *  $3.50 handling fee. Per order, not per unit: a six-box order to Italy pays
 *  it once. */
export interface SupplierOrderFee {
  country_code: string
  name?: string
  amount_usd: number
  /** YYYY-MM-DD the supplier started charging it. Orders before this date are
   *  left alone rather than having the fee applied retroactively. */
  effective_from?: string
}

export interface ProfitConfig {
  shopify: {
    transaction_fee_pct: number
    payment_processing_pct: number
    payment_processing_fixed: number
  }
  cogs: {
    default_cost_usd: number
    /** Charged once per order. */
    packaging_cost_usd: number
    /** Charged on each unit of the products listed in
     *  packaging_per_unit_products. Boxes, cards and inserts are bought in bulk
     *  and spread over the units they go out with, so they scale with units and
     *  not with orders. */
    packaging_per_unit_usd?: number
    /** Which products ship in that packaging. Absent or empty means every one
     *  of them does. */
    packaging_per_unit_products?: string[]
    additional_unit_discount_usd: number
    volume_discounts: {
      min_units: number
      discount_type: 'pct' | 'abs'
      discount_value: number
    }[]
    products: { product_id: string; name: string; cost_usd: number }[]
    price_tiers?: CogsPriceTier[]
    country_prices?: CountryPriceList[]
    order_fees?: SupplierOrderFee[]
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
  /** Per-order destination charges (the EU handling fee). Included in
   *  totalCogs; broken out so it can be named rather than buried. */
  totalSupplierOrderFees: number
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function getShippingCost(countryCode: string | null, cfg: ProfitConfig): number {
  if (!countryCode) return cfg.shipping.default_rate_usd
  return cfg.shipping.rates.find(r => r.country_code === countryCode)?.cost_usd
    ?? cfg.shipping.default_rate_usd
}

/** The tier in force on `orderDate`, or null when the order predates every
 *  tier. Dates are plain YYYY-MM-DD strings, so string comparison is date
 *  comparison. */
export function tierForDate(cfg: ProfitConfig, orderDate: string): CogsPriceTier | null {
  let best: CogsPriceTier | null = null
  for (const t of cfg.cogs.price_tiers ?? []) {
    if (!t?.effective_from || orderDate < t.effective_from) continue
    if (!best || t.effective_from > best.effective_from) best = t
  }
  return best
}

/** Total supplier cost of one order under a tier. Unlisted counts above the
 *  largest step extend at extra_unit_usd; below the smallest step we fall back
 *  to it rather than inventing a cheaper price. */
export function tierOrderCost(units: number, tier: CogsPriceTier): number {
  const steps = Object.keys(tier.order_prices)
    .map(Number)
    .filter(n => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b)
  if (steps.length === 0) return 0

  const exact = tier.order_prices[String(units)]
  if (exact !== undefined) return exact

  const top = steps[steps.length - 1]
  if (units > top) {
    return tier.order_prices[String(top)] + (units - top) * (tier.extra_unit_usd ?? 0)
  }
  // Between listed steps, or below the smallest one: charge the next step up,
  // which is what the supplier's rate card does.
  const next = steps.find(s => s > units) ?? steps[0]
  return tier.order_prices[String(next)]
}

/** Everything the per-order cost needs, resolved once instead of per order. */
export interface CogsLookups {
  byId: Map<string, number>
  byTitle: Map<string, number>
  /** product_id → country code → unit price. */
  byCountry: Map<string, Record<string, number>>
  hasProductCogs: boolean
  /** null when the per-unit packaging applies to everything. */
  packagingProducts: Set<string> | null
}

export function buildCogsLookups(cfg: ProfitConfig): CogsLookups {
  const byId = new Map<string, number>()
  const byTitle = new Map<string, number>()
  for (const p of cfg.cogs.products ?? []) {
    if (p.product_id && p.cost_usd > 0) byId.set(p.product_id, p.cost_usd)
    // Title is the fallback for orders whose product was archived or replaced
    // and whose id no longer matches anything in the catalogue.
    if (p.name && p.cost_usd > 0) byTitle.set(p.name, p.cost_usd)
  }
  const byCountry = new Map<string, Record<string, number>>()
  for (const c of cfg.cogs.country_prices ?? []) {
    if (c.product_id && c.prices) byCountry.set(c.product_id, c.prices)
  }
  const only = cfg.cogs.packaging_per_unit_products
  return {
    byId, byTitle, byCountry, hasProductCogs: byId.size > 0,
    packagingProducts: only && only.length > 0 ? new Set(only) : null,
  }
}

/** What one unit costs landed, for this product going to this country. The
 *  country price wins where we have one; otherwise the product's base price,
 *  which in practice is what the supplier charges to the US. */
export function unitCost(
  item: { product_id: string | null; product_title: string | null },
  countryCode: string | null,
  l: CogsLookups,
  cfg: ProfitConfig,
): number {
  if (item.product_id && countryCode) {
    const price = l.byCountry.get(item.product_id)?.[countryCode]
    if (price !== undefined && price > 0) return price
  }
  if (item.product_id && l.byId.has(item.product_id)) return l.byId.get(item.product_id)!
  if (item.product_title && l.byTitle.has(item.product_title)) return l.byTitle.get(item.product_title)!
  return cfg.cogs.default_cost_usd
}

/** The destination's flat per-order charge, or 0. A fee that only started on a
 *  date does not apply to orders placed before it. */
export function supplierOrderFee(
  countryCode: string | null,
  orderDate: string,
  cfg: ProfitConfig,
): number {
  if (!countryCode) return 0
  const fee = (cfg.cogs.order_fees ?? []).find(f => f.country_code === countryCode)
  if (!fee) return 0
  if (fee.effective_from && orderDate < fee.effective_from) return 0
  return fee.amount_usd ?? 0
}

export interface OrderSupplierCost {
  /** Unit prices summed across the order's items. */
  cogs: number
  /** Packaging, per order plus per unit. */
  packaging: number
  /** The destination's flat charge, counted once for the order. */
  orderFee: number
  /** What the extra-unit discount takes off, 0 under a rate card. */
  saving: number
}

/** The supplier's own arithmetic for one order:
 *    table price x quantity + the country's flat fee - $3 per extra unit.
 *  A price tier in force on the order's date is the supplier's whole rate card
 *  and replaces all three, so it is handled first and alone. */
export function orderSupplierCost(
  order: {
    country_code: string | null
    order_date: string
    items: { product_id: string | null; product_title: string | null; units: number }[]
  },
  l: CogsLookups,
  cfg: ProfitConfig,
): OrderSupplierCost {
  const units = order.items.reduce((s, i) => s + i.units, 0)
  // Only the products that actually ship in our own box carry its cost; a
  // t-shirt or a giant plush goes out in neither box nor card.
  const packagedUnits = l.packagingProducts === null ? units
    : order.items.reduce((s, i) =>
        s + (i.product_id && l.packagingProducts!.has(i.product_id) ? i.units : 0), 0)
  const packaging = (cfg.cogs.packaging_cost_usd ?? 0)
                  + (cfg.cogs.packaging_per_unit_usd ?? 0) * packagedUnits
  const tier = tierForDate(cfg, order.order_date)
  if (tier) return { cogs: tierOrderCost(units, tier), packaging, orderFee: 0, saving: 0 }

  const cogs = l.hasProductCogs || l.byCountry.size > 0
    ? order.items.reduce((s, i) => s + unitCost(i, order.country_code, l, cfg) * i.units, 0)
    : calcCogs(units, cfg)

  const addl = cfg.cogs.additional_unit_discount_usd ?? 0
  return {
    cogs,
    packaging,
    orderFee: supplierOrderFee(order.country_code, order.order_date, cfg),
    saving: units > 1 && addl > 0 ? (units - 1) * addl : 0,
  }
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

// ─── Extra account helpers ────────────────────────────────────────────────────

// Cached per process: once the column exists it always will; if not, we skip filtering.
let _fbAccountColExists: boolean | null = null
async function hasFbAccountColumn(): Promise<boolean> {
  if (_fbAccountColExists !== null) return _fbAccountColExists
  try {
    const rows = await query<{ exists: boolean }>(`
      SELECT EXISTS (
        SELECT 1 FROM information_schema.columns
        WHERE table_name = 'fb_ad_daily_metrics' AND column_name = 'fb_ad_account_id'
      ) AS exists
    `)
    _fbAccountColExists = rows[0]?.exists ?? false
  } catch {
    _fbAccountColExists = false
  }
  return _fbAccountColExists
}

async function getInactiveExtraAccountIds(tenantId: string): Promise<string[]> {
  try {
    const rows = await query<{ fb_ad_account_id: string }>(
      `SELECT fb_ad_account_id FROM tenant_fb_accounts WHERE tenant_id = $1 AND is_active = false`,
      [tenantId]
    )
    return rows.map(r => r.fb_ad_account_id)
  } catch {
    return [] // table doesn't exist yet — safe default
  }
}

// ─── Main export ──────────────────────────────────────────────────────────────

export async function getProfitSummary(
  tenantId: string,
  dateFrom: string,
  dateTo: string
): Promise<ProfitSummary> {
  // Load saved config
  const rows = await query<{ value: ProfitConfig }>(
    `SELECT settings AS value FROM profit_settings WHERE tenant_id = $1`,
    [tenantId]
  )
  const cfg = rows[0]?.value

  if (!cfg || Object.keys(cfg).length === 0) {
    return {
      configured: false, orderCount: 0, totalRevenue: 0, totalCosts: 0,
      netProfit: 0, margin: 0, avgProfitPerOrder: 0, breakEvenRoas: 0,
      fbSpend: 0, totalCogs: 0, totalShipping: 0, totalFees: 0,
      totalExtraCosts: 0, totalAdditionalUnitSavings: 0, totalSupplierOrderFees: 0,
    }
  }

  const days = Math.round(
    (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000
  ) + 1

  const lookups = buildCogsLookups(cfg)

  const orders = await query<{
    order_id: string; total_price: string; country_code: string | null; order_date: string
    total_units: string; product_id: string | null; product_title: string | null; product_units: string
  }>(`
    SELECT o.order_id, o.total_price::text, o.country_code,
           (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date::text AS order_date,
           COALESCE(SUM(oi.quantity), 1)::text AS total_units,
           oi.product_id,
           oi.product_title,
           COALESCE(oi.quantity, 1)::text AS product_units
    FROM shopify_orders o
    JOIN tenants t ON t.id = o.tenant_id
    LEFT JOIN shopify_order_items oi ON oi.order_id = o.order_id AND (oi.tenant_id IS NULL OR oi.tenant_id = o.tenant_id)
    WHERE o.tenant_id = $1
      AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
      AND o.financial_status NOT IN ('refunded', 'voided')
    -- oi.id keeps two identical lines of the same product apart. Without it the
    -- GROUP BY collapses them into one and the order silently loses a unit.
    GROUP BY o.order_id, o.total_price, o.country_code, order_date, oi.id, oi.product_id, oi.product_title, oi.quantity
  `, [tenantId, dateFrom, dateTo])

  // Group by order_id so we can compute per-order totals
  const orderMap = new Map<string, { total_price: string; country_code: string | null; order_date: string; items: { product_id: string | null; product_title: string | null; units: number }[] }>()
  for (const row of orders) {
    if (!orderMap.has(row.order_id)) {
      orderMap.set(row.order_id, { total_price: row.total_price, country_code: row.country_code, order_date: row.order_date, items: [] })
    }
    orderMap.get(row.order_id)!.items.push({ product_id: row.product_id, product_title: row.product_title, units: Number(row.product_units) })
  }
  const groupedOrders = Array.from(orderMap.values())

  const colExists = await hasFbAccountColumn()
  const inactiveIds = colExists ? await getInactiveExtraAccountIds(tenantId) : []
  const [fbRow] = await query<{ spend: string }>(
    `SELECT COALESCE(SUM(spend), 0)::text AS spend
     FROM fb_ad_daily_metrics
     WHERE tenant_id = $1
       AND date BETWEEN $2::date AND $3::date
       ${colExists ? 'AND (fb_ad_account_id IS NULL OR fb_ad_account_id != ALL($4::text[]))' : ''}`,
    colExists ? [tenantId, dateFrom, dateTo, inactiveIds] : [tenantId, dateFrom, dateTo]
  )
  const fbSpend = Number(fbRow.spend)

  const perOrderExtras = (cfg.extra_costs ?? [])
    .filter(e => e.frequency === 'per_order').reduce((s, e) => s + e.amount_usd, 0)
  const monthlyExtras = (cfg.extra_costs ?? [])
    .filter(e => e.frequency === 'monthly').reduce((s, e) => s + e.amount_usd, 0)
  const annualExtras = (cfg.extra_costs ?? [])
    .filter(e => e.frequency === 'annual').reduce((s, e) => s + e.amount_usd, 0)
  const proratedExtras = monthlyExtras * (days / 30) + annualExtras * (days / 365)

  let totalRevenue = 0, totalShopifyFees = 0, totalPaymentFees = 0
  let totalCogs = 0, totalShipping = 0, totalPackaging = 0
  let totalPerOrderExtras = 0, totalAdditionalUnitSavings = 0, totalOrderFees = 0

  for (const order of groupedOrders) {
    const revenue = Number(order.total_price)
    totalRevenue       += revenue
    totalShopifyFees   += revenue * (cfg.shopify.transaction_fee_pct / 100)
    totalPaymentFees   += revenue * (cfg.shopify.payment_processing_pct / 100) + cfg.shopify.payment_processing_fixed
    const supplier = orderSupplierCost(order, lookups, cfg)
    totalCogs          += supplier.cogs
    totalOrderFees     += supplier.orderFee
    totalAdditionalUnitSavings += supplier.saving
    totalPackaging     += supplier.packaging
    totalShipping      += getShippingCost(order.country_code, cfg)
    totalPerOrderExtras += perOrderExtras
  }

  const totalFees      = totalShopifyFees + totalPaymentFees
  const totalExtraCosts = totalPerOrderExtras + proratedExtras
  const totalCosts     = totalFees + totalCogs + totalOrderFees + totalPackaging + totalShipping + totalExtraCosts + fbSpend - totalAdditionalUnitSavings
  const netProfit      = totalRevenue - totalCosts
  const margin         = totalRevenue > 0 ? (netProfit / totalRevenue) * 100 : 0
  const orderCount     = groupedOrders.length

  return {
    configured: true,
    orderCount, totalRevenue, totalCosts, netProfit, margin,
    avgProfitPerOrder: orderCount > 0 ? netProfit / orderCount : 0,
    breakEvenRoas: fbSpend > 0 ? totalCosts / fbSpend : 0,
    fbSpend, totalCogs: totalCogs + totalOrderFees + totalPackaging, totalShipping,
    totalFees, totalExtraCosts, totalAdditionalUnitSavings,
    totalSupplierOrderFees: totalOrderFees,
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

export interface DailyProfitPoint {
  date: string
  revenue: number
  profit: number
  fbSpend: number
  margin: number | null
}

export async function getDailyProfitData(
  tenantId: string,
  dateFrom: string,
  dateTo: string
): Promise<{ configured: boolean; dailyData: DailyProfitPoint[] }> {
  const summary = await getProfitSummary(tenantId, dateFrom, dateTo)
  if (!summary.configured || summary.totalRevenue === 0) {
    return { configured: summary.configured, dailyData: [] }
  }

  // Kept as the fallback for days whose orders we cannot price individually.
  const nonFbCostRatio = (summary.totalCosts - summary.fbSpend) / summary.totalRevenue

  const cfgRows = await query<{ value: ProfitConfig }>(
    `SELECT settings AS value FROM profit_settings WHERE tenant_id = $1`,
    [tenantId]
  )
  const cfg = cfgRows[0]?.value
  if (!cfg) return { configured: false, dailyData: [] }

  const windowDays = Math.max(1, Math.round(
    (new Date(dateTo).getTime() - new Date(dateFrom).getTime()) / 86400000
  ) + 1)
  const monthlyExtras = (cfg.extra_costs ?? [])
    .filter(e => e.frequency === 'monthly').reduce((s, e) => s + e.amount_usd, 0)
  const annualExtras = (cfg.extra_costs ?? [])
    .filter(e => e.frequency === 'annual').reduce((s, e) => s + e.amount_usd, 0)
  const fixedPerDay = (monthlyExtras * (windowDays / 30) + annualExtras * (windowDays / 365)) / windowDays

  const colExists = await hasFbAccountColumn()
  const inactiveIds = colExists ? await getInactiveExtraAccountIds(tenantId) : []
  const dailyRows = await query<{ date: string; revenue: string; spend: string }>(
    `SELECT
      dates.d::text AS date,
      ROUND(COALESCE(s.total_revenue, 0)::numeric, 2)::text AS revenue,
      ROUND(COALESCE(f.spend, 0)::numeric, 2)::text AS spend
    FROM generate_series($2::date, $3::date, '1 day') AS dates(d)
    LEFT JOIN (
      SELECT
        (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date AS date,
        SUM(o.total_price::numeric) AS total_revenue
      FROM shopify_orders o
      JOIN tenants t ON t.id = o.tenant_id
      WHERE o.tenant_id = $1
        AND o.financial_status NOT IN ('refunded', 'voided')
      GROUP BY 1
    ) s ON s.date = dates.d
    LEFT JOIN (
      SELECT date, SUM(spend) AS spend
      FROM fb_ad_daily_metrics
      WHERE tenant_id = $1
        ${colExists ? 'AND (fb_ad_account_id IS NULL OR fb_ad_account_id != ALL($4::text[]))' : ''}
      GROUP BY date
    ) f ON f.date = dates.d
    ORDER BY dates.d`,
    colExists ? [tenantId, dateFrom, dateTo, inactiveIds] : [tenantId, dateFrom, dateTo]
  )

  // Real per-day COGS. Spreading the period's average cost ratio over every day
  // assumes each day has the same product mix and the same supplier prices,
  // and neither holds: a day full of 12-unit orders is cheaper per dollar than
  // a day of singles, and a rate card that changes mid-window makes the average
  // wrong on both sides of the change. Pricing each day's own orders is the
  // only way the chart agrees with the same day viewed on its own.
  const dayCosts = await perDayOrderCosts(tenantId, dateFrom, dateTo, cfg)

  const dailyData: DailyProfitPoint[] = dailyRows
    .filter(r => Number(r.revenue) > 0 || Number(r.spend) > 0)
    .map(r => {
      const rev = Number(r.revenue)
      const fb = Number(r.spend)
      // dailyRows dates come from generate_series and carry a time part
      // ("2026-09-17 00:00:00+00"); the cost map is keyed by plain date.
      const own = dayCosts.get(r.date.slice(0, 10))
      // Fixed monthly/annual costs still have to be spread — they belong to no
      // single day — but everything driven by orders is now that day's own.
      const nonFb = own !== undefined ? own + fixedPerDay : rev * nonFbCostRatio
      const profit = rev - nonFb - fb
      const margin = rev > 0 ? Math.round((profit / rev) * 1000) / 10 : null
      return {
        date: r.date,
        revenue: Math.round(rev * 100) / 100,
        profit: Math.round(profit * 100) / 100,
        fbSpend: Math.round(fb * 100) / 100,
        margin,
      }
    })

  return { configured: true, dailyData }
}

/** Order-driven costs — fees, COGS, packaging, shipping, per-order extras —
 *  totalled for each day in the window, priced with the rate card in force on
 *  that day. Days with no orders are simply absent from the map. */
async function perDayOrderCosts(
  tenantId: string,
  dateFrom: string,
  dateTo: string,
  cfg: ProfitConfig
): Promise<Map<string, number>> {
  const rows = await query<{
    order_id: string; total_price: string; country_code: string | null; order_date: string
    product_id: string | null; product_title: string | null; product_units: string
  }>(`
    SELECT o.order_id, o.total_price::text, o.country_code,
           (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date::text AS order_date,
           oi.product_id, oi.product_title,
           COALESCE(oi.quantity, 1)::text AS product_units
    FROM shopify_orders o
    JOIN tenants t ON t.id = o.tenant_id
    LEFT JOIN shopify_order_items oi ON oi.order_id = o.order_id AND (oi.tenant_id IS NULL OR oi.tenant_id = o.tenant_id)
    WHERE o.tenant_id = $1
      AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
      AND o.financial_status NOT IN ('refunded', 'voided')
  `, [tenantId, dateFrom, dateTo])

  const productCogs = new Map<string, number>()
  const titleCogs = new Map<string, number>()
  for (const p of (cfg.cogs.products ?? [])) {
    if (p.product_id && p.cost_usd > 0) productCogs.set(p.product_id, p.cost_usd)
    if (p.name && p.cost_usd > 0) titleCogs.set(p.name, p.cost_usd)
  }
  const hasProductCogs = productCogs.size > 0

  const perOrderExtras = (cfg.extra_costs ?? [])
    .filter(e => e.frequency === 'per_order').reduce((s, e) => s + e.amount_usd, 0)
  const addlDiscount = cfg.cogs.additional_unit_discount_usd ?? 0

  type Ord = { total_price: string; country_code: string | null; order_date: string; items: { product_id: string | null; product_title: string | null; units: number }[] }
  const orderMap = new Map<string, Ord>()
  for (const row of rows) {
    if (!orderMap.has(row.order_id)) {
      orderMap.set(row.order_id, { total_price: row.total_price, country_code: row.country_code, order_date: row.order_date, items: [] })
    }
    orderMap.get(row.order_id)!.items.push({ product_id: row.product_id, product_title: row.product_title, units: Number(row.product_units) })
  }

  const byDay = new Map<string, number>()
  for (const order of orderMap.values()) {
    const revenue = Number(order.total_price)
    const units = order.items.reduce((s, i) => s + i.units, 0)

    let cost = revenue * (cfg.shopify.transaction_fee_pct / 100)
             + revenue * (cfg.shopify.payment_processing_pct / 100)
             + cfg.shopify.payment_processing_fixed
             + cfg.cogs.packaging_cost_usd
             + getShippingCost(order.country_code, cfg)
             + perOrderExtras

    const tier = tierForDate(cfg, order.order_date)
    if (tier) {
      cost += tierOrderCost(units, tier)
    } else if (hasProductCogs) {
      for (const item of order.items) {
        const perUnit = item.product_id && productCogs.has(item.product_id)
          ? productCogs.get(item.product_id)!
          : item.product_title && titleCogs.has(item.product_title)
            ? titleCogs.get(item.product_title)!
            : cfg.cogs.default_cost_usd
        cost += perUnit * item.units
      }
      if (units > 1 && addlDiscount > 0) cost -= (units - 1) * addlDiscount
    } else {
      cost += calcCogs(units, cfg)
      if (units > 1 && addlDiscount > 0) cost -= (units - 1) * addlDiscount
    }

    byDay.set(order.order_date, (byDay.get(order.order_date) ?? 0) + cost)
  }
  return byDay
}

export async function getCountryProfit(
  tenantId: string,
  dateFrom: string,
  dateTo: string
): Promise<CountryProfit[]> {
  const rows = await query<{ value: ProfitConfig }>(
    `SELECT settings AS value FROM profit_settings WHERE tenant_id = $1`,
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
    JOIN tenants t ON t.id = o.tenant_id
    LEFT JOIN order_items_agg oia ON o.order_id = oia.order_id
    WHERE o.tenant_id = $1
      AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
      AND o.financial_status NOT IN ('refunded', 'voided')
    GROUP BY o.country_code
    ORDER BY SUM(o.total_price::numeric) DESC
    LIMIT 12
  `, [tenantId, dateFrom, dateTo])

  // True total FB spend from daily metrics (authoritative)
  const colExists = await hasFbAccountColumn()
  const inactiveIds = colExists ? await getInactiveExtraAccountIds(tenantId) : []
  const [fbTotalRow] = await query<{ spend: string }>(
    `SELECT COALESCE(SUM(spend), 0)::text AS spend
     FROM fb_ad_daily_metrics
     WHERE tenant_id = $1
       AND date BETWEEN $2::date AND $3::date
       ${colExists ? 'AND (fb_ad_account_id IS NULL OR fb_ad_account_id != ALL($4::text[]))' : ''}`,
    colExists ? [tenantId, dateFrom, dateTo, inactiveIds] : [tenantId, dateFrom, dateTo]
  )
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
    // This breakdown works from each country's average order, not from single
    // orders, so it can only pick one tier: the one in force at the end of the
    // window. Across a period that straddles a price change it lands between
    // the two, which is the same approximation avgUnits already makes.
    const periodTier = tierForDate(cfg, dateTo)
    const cogsPerOrder = (periodTier ? tierOrderCost(Math.max(1, Math.round(avgUnits)), periodTier) : calcCogs(avgUnits, cfg))
      + cfg.cogs.packaging_cost_usd
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
