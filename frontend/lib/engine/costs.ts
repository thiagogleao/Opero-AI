/**
 * What one order costs to fulfil — the supplier's own arithmetic.
 *
 * Pure functions only: no database, no clock. Everything here is driven by a
 * store's ProfitConfig and one order at a time, so it can be unit-tested and
 * reused by every view without drifting. The aggregation lives in pnl.ts.
 */

// ─── Configuration types ──────────────────────────────────────────────────────

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
  /** The products this rate card is quoted for. Absent or empty means every
   *  product in the order, which is what a one-product store wants. Once a
   *  store sells something the supplier of this card does not make, the card
   *  has to say so, or its unit curve prices that product too. Each listed
   *  product is counted once, under the first card that claims it. */
  product_ids?: string[]
  /** Unit count → total cost of an order with exactly that many units. */
  order_prices: Record<string, number>
  /** Cost of each unit past the largest listed step. */
  extra_unit_usd: number
}

/** The supplier quotes a different unit price per destination because the
 *  freight is baked into it. A country missing here falls back to the
 *  product's base price. */
export interface CountryPriceList {
  product_id: string
  name?: string
  /** ISO-3166 alpha-2 → unit price in USD. */
  prices: Record<string, number>
}

/** A flat charge the supplier adds per *order* for a destination (the EU's
 *  handling fee). A six-box order to Italy pays it once. */
export interface SupplierOrderFee {
  country_code: string
  name?: string
  amount_usd: number
  /** YYYY-MM-DD the supplier started charging it. Earlier orders are left
   *  alone rather than having the fee applied retroactively. */
  effective_from?: string
}

export interface ExtraCost {
  name: string
  amount_usd: number
  frequency: 'monthly' | 'per_order' | 'annual'
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
    /** Charged on each unit of the products in packaging_per_unit_products. */
    packaging_per_unit_usd?: number
    /** Which products ship in that packaging. Absent or empty means all. */
    packaging_per_unit_products?: string[]
    /** Taken off per unit after the first, outside a whole-order rate card. */
    additional_unit_discount_usd: number
    volume_discounts: {
      min_units: number
      discount_type: 'pct' | 'abs'
      discount_value: number
    }[]
    /** cost_usd 0 means "not priced yet" and falls back to default_cost_usd.
     *  A product that genuinely costs nothing goes in zero_cost_products. */
    products: { product_id: string; name: string; cost_usd: number }[]
    zero_cost_products?: string[]
    price_tiers?: CogsPriceTier[]
    country_prices?: CountryPriceList[]
    order_fees?: SupplierOrderFee[]
  }
  shipping: {
    default_rate_usd: number
    rates: { country_code: string; name: string; cost_usd: number }[]
  }
  extra_costs: ExtraCost[]
}

export interface CostItem {
  product_id: string | null
  product_title: string | null
  units: number
}

export interface CostOrder {
  country_code: string | null
  /** YYYY-MM-DD in the store's timezone. */
  order_date: string
  items: CostItem[]
}

/** True when a stored config is usable. An empty JSON object is "not set up". */
export function isConfigured(cfg: ProfitConfig | null | undefined): cfg is ProfitConfig {
  return !!cfg && typeof cfg === 'object' && Object.keys(cfg).length > 0
    && !!cfg.shopify && !!cfg.cogs && !!cfg.shipping
}

const num = (v: unknown): number => {
  const n = Number(v)
  return Number.isFinite(n) ? n : 0
}

// ─── Rate cards ───────────────────────────────────────────────────────────────

/** A card with at least one positive price. An empty card is a draft being
 *  filled in; applying it would price every order from its date at $0. */
function hasPrices(t: CogsPriceTier): boolean {
  return Object.values(t.order_prices ?? {}).some(v => num(v) > 0)
}

/** The whole-order card in force on `orderDate`, or null. */
export function tierForDate(cfg: ProfitConfig, orderDate: string): CogsPriceTier | null {
  return tiersForDate(cfg, orderDate).find(t => !(t.product_ids ?? []).length) ?? null
}

/** The cards in force on `orderDate`, one per set of products quoted. Two cards
 *  for the same products are a price change and the later one wins; two cards
 *  for different products are two suppliers and both apply. */
export function tiersForDate(cfg: ProfitConfig, orderDate: string): CogsPriceTier[] {
  const byScope = new Map<string, CogsPriceTier>()
  for (const t of cfg.cogs.price_tiers ?? []) {
    if (!t?.effective_from || orderDate < t.effective_from || !hasPrices(t)) continue
    const scope = [...(t.product_ids ?? [])].sort().join(',')
    const current = byScope.get(scope)
    if (!current || t.effective_from > current.effective_from) byScope.set(scope, t)
  }
  return [...byScope.values()]
}

/** Total supplier cost of `units` under a card. Counts above the largest step
 *  extend at extra_unit_usd; between or below steps the next step up is
 *  charged, which is what the supplier's card does. */
export function tierOrderCost(units: number, tier: CogsPriceTier): number {
  const steps = Object.keys(tier.order_prices ?? {})
    .map(Number)
    .filter(n => Number.isFinite(n) && n > 0)
    .sort((a, b) => a - b)
  if (steps.length === 0 || units <= 0) return 0

  const exact = tier.order_prices[String(units)]
  if (exact !== undefined) return num(exact)

  const top = steps[steps.length - 1]
  if (units > top) {
    return num(tier.order_prices[String(top)]) + (units - top) * num(tier.extra_unit_usd)
  }
  const next = steps.find(s => s > units) ?? steps[0]
  return num(tier.order_prices[String(next)])
}

// ─── Per-item prices ──────────────────────────────────────────────────────────

/** Everything the per-order cost needs, resolved once instead of per order. */
export interface CogsLookups {
  byId: Map<string, number>
  byTitle: Map<string, number>
  /** product_id → country code → unit price. */
  byCountry: Map<string, Record<string, number>>
  hasProductCogs: boolean
  /** null when the per-unit packaging applies to everything. */
  packagingProducts: Set<string> | null
  /** Products declared to cost nothing, as opposed to not yet priced. */
  zeroCost: Set<string>
}

export function buildCogsLookups(cfg: ProfitConfig): CogsLookups {
  const byId = new Map<string, number>()
  const byTitle = new Map<string, number>()
  for (const p of cfg.cogs.products ?? []) {
    const cost = num(p.cost_usd)
    if (p.product_id && cost > 0) byId.set(String(p.product_id), cost)
    // Title is the fallback for orders whose product was archived or replaced.
    if (p.name && cost > 0) byTitle.set(p.name, cost)
  }
  const byCountry = new Map<string, Record<string, number>>()
  for (const c of cfg.cogs.country_prices ?? []) {
    if (c.product_id && c.prices) byCountry.set(String(c.product_id), c.prices)
  }
  const only = cfg.cogs.packaging_per_unit_products
  const zeroCost = new Set((cfg.cogs.zero_cost_products ?? []).map(String))
  return {
    byId, byTitle, byCountry,
    // Declaring a product free is pricing it.
    hasProductCogs: byId.size > 0 || zeroCost.size > 0,
    packagingProducts: only && only.length > 0 ? new Set(only.map(String)) : null,
    zeroCost,
  }
}

/** Landed cost of one unit of this product going to this country. */
export function unitCost(
  item: { product_id: string | null; product_title: string | null },
  countryCode: string | null,
  l: CogsLookups,
  cfg: ProfitConfig,
): number {
  if (item.product_id && l.zeroCost.has(item.product_id)) return 0
  if (item.product_id && countryCode) {
    const price = num(l.byCountry.get(item.product_id)?.[countryCode])
    if (price > 0) return price
  }
  if (item.product_id && l.byId.has(item.product_id)) return l.byId.get(item.product_id)!
  if (item.product_title && l.byTitle.has(item.product_title)) return l.byTitle.get(item.product_title)!
  return num(cfg.cogs.default_cost_usd)
}

/** The destination's flat per-order charge, or 0. */
export function supplierOrderFee(countryCode: string | null, orderDate: string, cfg: ProfitConfig): number {
  if (!countryCode) return 0
  const fee = (cfg.cogs.order_fees ?? []).find(f => f.country_code === countryCode)
  if (!fee) return 0
  if (fee.effective_from && orderDate < fee.effective_from) return 0
  return num(fee.amount_usd)
}

export function shippingCost(countryCode: string | null, cfg: ProfitConfig): number {
  if (!countryCode) return num(cfg.shipping?.default_rate_usd)
  const rate = (cfg.shipping?.rates ?? []).find(r => r.country_code === countryCode)
  return rate ? num(rate.cost_usd) : num(cfg.shipping?.default_rate_usd)
}

/** Volume-discounted default cost, for stores with no per-product prices. */
function defaultCogs(units: number, cfg: ProfitConfig): number {
  const match = [...(cfg.cogs.volume_discounts ?? [])]
    .filter(d => units >= d.min_units)
    .sort((a, b) => b.min_units - a.min_units)[0]
  const base = num(cfg.cogs.default_cost_usd)
  if (!match) return base * units
  const val = num(match.discount_value ?? (match as { discount_pct?: number }).discount_pct)
  return (match.discount_type ?? 'pct') === 'abs'
    ? Math.max(0, base - val) * units
    : base * (1 - val / 100) * units
}

// ─── One order ────────────────────────────────────────────────────────────────

export interface OrderSupplierCost {
  /** Unit prices (or rate-card prices) summed across the order's items. */
  cogs: number
  /** Packaging, per order plus per unit. */
  packaging: number
  /** The destination's flat charge, once per order. */
  orderFee: number
  /** What the extra-unit discount takes off; 0 under a whole-order card. */
  saving: number
  /** Supplier cost attributed to each item, same order as `items`, summing to
   *  cogs + orderFee + packaging − saving. Used to cost products. */
  perItem: number[]
}

/** The supplier's arithmetic for one order:
 *    price x quantity + the country's flat fee − the extra-unit discount.
 *  A whole-order rate card replaces all three. A card naming products prices
 *  only those off its own unit curve; the rest is priced item by item. */
export function orderSupplierCost(order: CostOrder, l: CogsLookups, cfg: ProfitConfig): OrderSupplierCost {
  const items = order.items.map(i => ({ ...i, units: Math.max(0, num(i.units)) }))
  const units = items.reduce((s, i) => s + i.units, 0)
  const packagedUnits = l.packagingProducts === null ? units
    : items.reduce((s, i) => s + (i.product_id && l.packagingProducts!.has(i.product_id) ? i.units : 0), 0)
  const packaging = num(cfg.cogs.packaging_cost_usd) + num(cfg.cogs.packaging_per_unit_usd) * packagedUnits
  const addl = num(cfg.cogs.additional_unit_discount_usd)
  const itemCogs = new Array<number>(items.length).fill(0)

  const inForce = tiersForDate(cfg, order.order_date)
  const wholeOrder = inForce.find(t => !(t.product_ids ?? []).length)

  let orderFee = 0
  let saving = 0

  if (wholeOrder) {
    // The card prices the whole order; spread it over units for item costing.
    const total = tierOrderCost(units, wholeOrder)
    items.forEach((it, k) => { itemCogs[k] = units > 0 ? total * (it.units / units) : 0 })
  } else {
    const scoped = inForce.filter(t => (t.product_ids ?? []).length)
    const claimed = new Set<number>()
    for (const t of scoped) {
      const ids = new Set((t.product_ids ?? []).map(String))
      const mine = items.map((it, k) => ({ it, k }))
        .filter(({ it, k }) => !claimed.has(k) && it.product_id && ids.has(it.product_id))
      const tierUnits = mine.reduce((s, { it }) => s + it.units, 0)
      if (tierUnits <= 0) continue
      const total = tierOrderCost(tierUnits, t)
      for (const { it, k } of mine) { claimed.add(k); itemCogs[k] = total * (it.units / tierUnits) }
    }
    const rest = items.map((it, k) => ({ it, k })).filter(({ k }) => !claimed.has(k))
    const usesItemPrices = l.hasProductCogs || l.byCountry.size > 0 || scoped.length > 0
    if (usesItemPrices) {
      for (const { it, k } of rest) itemCogs[k] = unitCost(it, order.country_code, l, cfg) * it.units
    } else {
      const restUnits = rest.reduce((s, { it }) => s + it.units, 0)
      const total = defaultCogs(restUnits, cfg)
      for (const { it, k } of rest) itemCogs[k] = restUnits > 0 ? total * (it.units / restUnits) : 0
    }
    orderFee = supplierOrderFee(order.country_code, order.order_date, cfg)
    // The discount is the supplier's, so it counts the units the supplier
    // actually ships: declared-free items (a warranty, a digital card) are not
    // parcels, and it can never take more off than the items it applies to cost.
    const discUnits = rest.reduce((s, { it }) =>
      s + (it.product_id && l.zeroCost.has(it.product_id) ? 0 : it.units), 0)
    const restCogs = rest.reduce((s, { k }) => s + itemCogs[k], 0)
    saving = discUnits > 1 && addl > 0 ? Math.min((discUnits - 1) * addl, restCogs) : 0
  }

  const cogs = itemCogs.reduce((s, v) => s + v, 0)
  // Order-level terms (fee, packaging, saving) spread over items by units, so
  // product costs add back up to the order's supplier cost exactly.
  const orderLevel = orderFee + packaging - saving
  const perItem = items.map((it, k) => itemCogs[k] + (units > 0 ? orderLevel * (it.units / units) : 0))
  if (items.length === 0 && orderLevel !== 0) perItem.push(orderLevel)
  return { cogs, packaging, orderFee, saving, perItem }
}

/** Shopify transaction fee and payment processing for an order of `revenue`. */
export function orderFees(revenue: number, cfg: ProfitConfig): { shopify: number; payment: number } {
  return {
    shopify: revenue * (num(cfg.shopify.transaction_fee_pct) / 100),
    payment: revenue * (num(cfg.shopify.payment_processing_pct) / 100) + num(cfg.shopify.payment_processing_fixed),
  }
}

export function perOrderExtras(cfg: ProfitConfig): number {
  return (cfg.extra_costs ?? []).filter(e => e.frequency === 'per_order').reduce((s, e) => s + num(e.amount_usd), 0)
}

/** Fixed costs that belong to one calendar day: a monthly cost spread over the
 *  real number of days in that month, an annual one over the days in that year. */
export function fixedCostForDay(day: string, cfg: ProfitConfig): number {
  const [y, m] = day.split('-').map(Number)
  const daysInMonth = new Date(Date.UTC(y, m, 0)).getUTCDate()
  const daysInYear = (y % 4 === 0 && y % 100 !== 0) || y % 400 === 0 ? 366 : 365
  let total = 0
  for (const e of cfg.extra_costs ?? []) {
    if (e.frequency === 'monthly') total += num(e.amount_usd) / daysInMonth
    else if (e.frequency === 'annual') total += num(e.amount_usd) / daysInYear
  }
  return total
}
