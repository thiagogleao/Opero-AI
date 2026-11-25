import { formatCount, formatMoney, formatNumber, plural } from '../format'

/**
 * The text of the "nova venda" push, sent by the orders/create webhook.
 *
 * Pure, so the wording is tested without a webhook. It follows the same pt-BR
 * rules as every screen (lib/format) — "$45,90", "$1.234", "−$201", never
 * "$12.9K" — because the phone's live feed shows the same order and the same
 * "lucro hoje" right under the notification, and a second format for the same
 * number reads as a different number.
 */

export interface SaleLine { title?: unknown; quantity?: unknown }

export interface SalePushInput {
  storeName: string
  /** "#1234": Shopify's order name, else the number or the id. */
  orderLabel: string
  /** total_price, in the shop's own currency. */
  total: number
  currency: string
  /** The same total in dollars when the shop bills in another currency and a
   *  rate was found; null otherwise. */
  usdTotal: number | null
  /** The store's "lucro" on the sale's own day (the day the push link
   *  opens), or null (no cost settings, slow lookup). */
  profitToday: number | null
  /** How that day is said on the store's clock at send time (lib/period
   *  dayPhrase): "hoje", "ontem", "em 24 nov". Absent: "hoje". The text and
   *  the screen it opens name the same day (R17). */
  profitDay?: string
  lineItems: SaleLine[]
  /** Shipping country code. */
  country: string | null
}

/**
 * An amount in a currency other than the dollar, the way the phone's live feed
 * shows it: "JP¥ 12.750". Whole units: the dollar figure in front carries the
 * precision, the local one is there to recognise the order.
 */
export function formatLocalCurrency(v: number, currency: string): string {
  try {
    return new Intl.NumberFormat('pt-BR', {
      style: 'currency', currency, minimumFractionDigits: 0, maximumFractionDigits: 0,
    }).format(v)
  } catch {
    // Not an ISO currency code: the number still reads pt-BR.
    return `${currency} ${formatNumber(v)}`
  }
}

/** "$45,90"; "$82,88 (JP¥ 12.750)" for a shop billing in yen; the local
 *  amount alone when no exchange rate was found. */
export function saleAmount(total: number, currency: string, usdTotal: number | null): string {
  if (currency === 'USD') return formatMoney(total)
  const local = formatLocalCurrency(total, currency)
  return usdTotal !== null ? `${formatMoney(usdTotal)} (${local})` : local
}

/** The parts an order's products are told in, push and live feed alike. */
export interface OrderItemParts {
  /** First product with ITS OWN quantity: "2× HIBACHI ZERO remote". */
  name: string
  /** "+1 produto", for orders of several products. */
  more: string | null
  /** "7 unidades", only for orders of several products (one product already
   *  says its quantity); null when a quantity is unknown. */
  units: string | null
}

/** A webhook line's quantity as the live feed reads the stored copy of it
 *  (lib/views/portfolio lineItems): null when absent, else Number(). */
const quantityOf = (q: unknown): number | null => (q == null ? null : Number(q))

/**
 * The phone's live-feed rule (app/m/_lib/labels feedLine), for raw webhook
 * lines. The order's unit total used to sit in front of the first product:
 * 1 gift + 6 blind boxes read "7× Happy Capy Blind Box – Free Gift +1" in the
 * push while the feed right under it said "+1 produto · 7 unidades". Null for
 * an order without lines.
 */
export function orderItemParts(lineItems: SaleLine[]): OrderItemParts | null {
  const first = lineItems[0]
  if (!first) return null
  const q = quantityOf(first.quantity) ?? 1
  const title = first.title == null ? '' : String(first.title).trim()
  const name = `${q > 1 ? `${formatCount(q)}× ` : ''}${title || 'Produto sem nome'}`
  const others = lineItems.length - 1
  if (others <= 0) return { name, more: null, units: null }
  const qs = lineItems.map(li => quantityOf(li.quantity))
  const known = qs.every(n => n !== null && Number.isFinite(n))
  const total = known ? qs.reduce<number>((s, n) => s + (n ?? 0), 0) : null
  return {
    name,
    more: `+${plural(others, 'produto', 'produtos')}`,
    units: total !== null ? plural(total, 'unidade', 'unidades') : null,
  }
}

/** "Happy Capy Blind Box – Free Gift +1 produto · 7 unidades", "2× Capy
 *  Plush"; empty for an order without lines. */
export function saleItemsLabel(lineItems: SaleLine[]): string {
  const p = orderItemParts(lineItems)
  if (!p) return ''
  return [p.more ? `${p.name} ${p.more}` : p.name, p.units].filter(Boolean).join(' · ')
}

export function salePushText(s: SalePushInput): { title: string; body: string } {
  return {
    title: `💰 ${saleAmount(s.total, s.currency, s.usdTotal)} · ${s.orderLabel} — ${s.storeName}`,
    body: [
      s.profitToday !== null ? `Lucro ${s.profitDay ?? 'hoje'}: ${formatMoney(s.profitToday)}` : null,
      saleItemsLabel(s.lineItems),
      s.country,
    ].filter(Boolean).join(' · '),
  }
}
