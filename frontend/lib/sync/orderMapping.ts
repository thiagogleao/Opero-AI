/**
 * Shopify REST order JSON (a webhook payload) → shopify_orders / items rows.
 *
 * A line-by-line twin of app/collectors/shopify_mapping.py, so an order written
 * by the webhook is byte-for-byte the row the collector would write ten
 * minutes later. Both are tested against app/tests/fixtures/order_jpy.json —
 * change one, change the other and the fixture.
 *
 * Money is in the SHOP currency on a REST order and is stored in US dollars;
 * `country_code` stays the billing country (the profit engine prices by it);
 * `geo_country_code` is where the parcel goes, with US territories split out.
 */

export const US_TERRITORIES = new Set(['PR', 'VI', 'GU', 'AS', 'MP', 'UM'])

type Json = Record<string, unknown>

export class MissingRate extends Error {}

export interface OrderRow {
  order_id: string
  order_number: number | null
  created_at: string | null
  processed_at: string | null
  cancelled_at: string | null
  cancel_reason: string | null
  financial_status: string | null
  fulfillment_status: string | null
  currency: string | null
  fx_rate: number | null
  total_price: number
  subtotal_price: number
  total_discounts: number
  total_tax: number
  total_shipping: number
  current_total_price: number | null
  country_code: string | null
  geo_country_code: string | null
  province_code: string | null
  customer_id: string | null
  customer_email: string | null
  source_name: string | null
  tags: string | null
  landing_site: string | null
  referring_site: string | null
  browser_ip: string | null
  user_agent: string | null
  accept_language: string | null
}

export interface ItemRow {
  order_id: string
  line_item_id: string
  product_id: string | null
  variant_id: string | null
  product_title: string | null
  variant_title: string | null
  title: string | null
  sku: string | null
  quantity: number
  price: number
  total_discount: number
  fulfillment_status: string | null
}

const obj = (v: unknown): Json => (v && typeof v === 'object' && !Array.isArray(v) ? v as Json : {})
const str = (v: unknown): string | null => (v === null || v === undefined || v === '' ? null : String(v))

export function toFloat(v: unknown, fallback = 0): number {
  const n = typeof v === 'number' ? v : typeof v === 'string' && v.trim() !== '' ? Number(v) : NaN
  return Number.isFinite(n) ? n : fallback
}

/** ISO timestamp with offset → ISO in UTC ("…+00:00"), or null. */
export function parseTs(v: unknown): string | null {
  if (!v) return null
  const t = Date.parse(String(v))
  if (!Number.isFinite(t)) return null
  return new Date(t).toISOString().replace('.000Z', '+00:00').replace(/\.(\d{3})Z$/, '.$1+00:00')
}

/** The calendar day of a Shopify timestamp in the shop's own timezone: the
 *  timestamp carries the shop's offset, so its first ten characters are it. */
export function localDay(v: unknown): string | null {
  if (!v) return null
  const s = String(v)
  return /^\d{4}-\d{2}-\d{2}/.test(s) ? s.slice(0, 10) : null
}

export function geoCountry(country: unknown, province: unknown): string | null {
  const c = country ? String(country).toUpperCase() : null
  const p = province ? String(province).toUpperCase() : null
  if (c === 'US' && p && US_TERRITORIES.has(p)) return p
  return c
}

function address(order: Json): [string | null, string | null] {
  for (const key of ['shipping_address', 'billing_address']) {
    const a = obj(order[key])
    if (a.country_code) return [str(a.country_code), str(a.province_code)]
  }
  return [null, null]
}

export function shippingTotal(order: Json): number {
  const sm = obj(obj(order.total_shipping_price_set).shop_money)
  if ('amount' in sm) return toFloat(sm.amount)
  const lines = Array.isArray(order.shipping_lines) ? order.shipping_lines : []
  return lines.reduce((s: number, l) => s + toFloat(obj(l).price), 0)
}

export type RateFor = (day: string | null) => number | null

/** USD per unit of shop currency, or null for a USD shop. */
export function orderRate(order: Json, rateFor: RateFor): number | null {
  const currency = String(order.currency || 'USD').toUpperCase()
  if (currency === 'USD') return null
  const rate = rateFor(localDay(order.created_at))
  if (!rate) throw new MissingRate(`pedido ${String(order.id)} em ${currency} sem cotação`)
  return rate
}

/** Python's round(x, 6). */
const round6 = (v: number) => Math.round(v * 1e6) / 1e6

export function mapOrder(order: Json, rateFor: RateFor): OrderRow {
  const rate = orderRate(order, rateFor)
  const usd = (v: number) => (rate ? round6(v * rate) : v)
  const details = obj(order.client_details)
  const customer = obj(order.customer)
  const billing = obj(order.billing_address)
  const [country, province] = address(order)
  const current = order.current_total_price
  return {
    order_id: String(order.id),
    order_number: order.order_number === undefined || order.order_number === null ? null : Number(order.order_number),
    created_at: parseTs(order.created_at),
    processed_at: parseTs(order.processed_at),
    cancelled_at: parseTs(order.cancelled_at),
    cancel_reason: str(order.cancel_reason),
    financial_status: str(order.financial_status),
    fulfillment_status: str(order.fulfillment_status),
    currency: str(order.currency),
    fx_rate: rate,
    total_price: usd(toFloat(order.total_price)),
    subtotal_price: usd(toFloat(order.subtotal_price)),
    total_discounts: usd(toFloat(order.total_discounts)),
    total_tax: usd(toFloat(order.total_tax)),
    total_shipping: usd(shippingTotal(order)),
    current_total_price: current === undefined || current === null ? null : usd(toFloat(current)),
    country_code: str(billing.country_code),
    geo_country_code: geoCountry(country, province),
    province_code: province,
    customer_id: customer.id ? String(customer.id) : null,
    customer_email: str(order.email),
    source_name: str(order.source_name),
    tags: str(order.tags),
    landing_site: str(order.landing_site),
    referring_site: str(order.referring_site),
    browser_ip: str(order.browser_ip) ?? str(details.browser_ip),
    user_agent: str(details.user_agent),
    accept_language: str(details.accept_language),
  }
}

export function mapLineItems(order: Json, rateFor: RateFor): ItemRow[] {
  const rate = orderRate(order, rateFor)
  const usd = (v: number) => (rate ? round6(v * rate) : v)
  const items = Array.isArray(order.line_items) ? order.line_items : []
  return items.map(raw => {
    const item = obj(raw)
    return {
      order_id: String(order.id),
      line_item_id: String(item.id),
      product_id: item.product_id ? String(item.product_id) : null,
      variant_id: item.variant_id ? String(item.variant_id) : null,
      product_title: str(item.title),
      variant_title: str(item.variant_title),
      title: str(item.name) ?? str(item.title),
      sku: str(item.sku),
      quantity: Math.trunc(toFloat(item.quantity, 1)) || 1,
      price: usd(toFloat(item.price)),
      total_discount: usd(toFloat(item.total_discount)),
      fulfillment_status: str(item.fulfillment_status),
    }
  })
}
