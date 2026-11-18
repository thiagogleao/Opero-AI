/**
 * The cost screen's form model: a ProfitConfig as the inputs hold it.
 *
 * Pure (no React, no fetch), so it is unit-tested and runs the same in the
 * browser and on the server render.
 *
 * Why a separate model and not the ProfitConfig itself:
 *  - inputs hold text ("2,9", "" while typing), not numbers;
 *  - every list row carries a stable `_id`, so React keys and field messages
 *    follow the row and never its position. The old screen keyed the supplier
 *    cards by index with an uncontrolled textarea: deleting the first card left
 *    its prices on screen next to the second card's date, and the next blur
 *    wrote them into the surviving card (bugs PE17 / L3).
 *
 * toPayload() turns the form back into the body /api/profit expects, plus an
 * index from payload positions back to row ids, so a server message such as
 * "cogs.price_tiers[1].order_prices" lands on the right card (fieldKey()).
 */

import { canonicalJson, toNumber, type ConfigIssue, type ProfitConfig } from '@/lib/data/profitConfig'
import { formatMoney } from '@/lib/format'

export type FrequencyKey = 'monthly' | 'per_order' | 'annual'

export interface StepRow { _id: string; units: string; price: string }
export interface TierRow {
  _id: string
  label: string
  effective_from: string
  /** 'all': the card prices the whole order. 'some': only `product_ids`. */
  scope: 'all' | 'some'
  product_ids: string[]
  steps: StepRow[]
  extra_unit_usd: string
}
export interface CountryPriceRow { _id: string; country: string; price: string }
export interface CountryListRow { _id: string; product_id: string; name: string; prices: CountryPriceRow[] }
export interface OrderFeeRow { _id: string; country_code: string; name: string; amount_usd: string; effective_from: string }
export interface RateRow { _id: string; country_code: string; name: string; cost_usd: string }
export interface ExtraRow { _id: string; name: string; amount_usd: string; frequency: FrequencyKey }
export interface VolumeRow { _id: string; min_units: string; discount_type: 'pct' | 'abs'; discount_value: string }

export interface CostForm {
  shopify: { transaction_fee_pct: string; payment_processing_pct: string; payment_processing_fixed: string }
  cogs: {
    default_cost_usd: string
    packaging_cost_usd: string
    packaging_per_unit_usd: string
    /** 'all': per-unit packaging on every product; 'some': only the listed ones. */
    packaging_scope: 'all' | 'some'
    packaging_per_unit_products: string[]
    additional_unit_discount_usd: string
    volume_discounts: VolumeRow[]
    /** product_id → unit cost as typed ("" or "0" = not priced yet). */
    products: Record<string, string>
    /** Names stored with the saved prices (the title-price fallback uses them). */
    productNames: Record<string, string>
    /** The saved list's order: a save must not reorder it (see profitConfig). */
    productOrder: string[]
    zero_cost_products: string[]
    price_tiers: TierRow[]
    country_prices: CountryListRow[]
    order_fees: OrderFeeRow[]
  }
  shipping: { default_rate_usd: string; rates: RateRow[] }
  extra_costs: ExtraRow[]
}

// ─── Numbers as text ──────────────────────────────────────────────────────────

/** 2.9 → "2,9"; 0 → "0". Plain decimals with a comma, as people type them here. */
export function numText(n: number | null | undefined): string {
  if (typeof n !== 'number' || !Number.isFinite(n)) return ''
  // Up to 4 decimals, without float noise (0.1 + 0.2) or trailing zeros.
  const s = Number(n.toFixed(4)).toString()
  return s.replace('.', ',')
}

/** What a scalar input sends: its number, 0 when empty, or the raw text so the
 *  server names the field that is wrong. */
function scalar(s: string): number | string {
  const t = s.trim()
  if (!t) return 0
  const n = toNumber(t)
  return n === null ? t : n
}

/** A list cell: its number, null when empty ("informe o valor"), or the raw text. */
function cell(s: string): number | string | null {
  const t = s.trim()
  if (!t) return null
  const n = toNumber(t)
  return n === null ? t : n
}

// ─── Config → form ────────────────────────────────────────────────────────────

/** Deterministic ids for the rows of a loaded config (the same on the server
 *  render and in the browser); rows added later get newId(). */
export function toForm(cfg: ProfitConfig): CostForm {
  const c = cfg.cogs
  const products: Record<string, string> = {}
  const productNames: Record<string, string> = {}
  for (const p of c.products) {
    products[p.product_id] = p.cost_usd > 0 ? numText(p.cost_usd) : ''
    if (p.name) productNames[p.product_id] = p.name
  }
  const packList = c.packaging_per_unit_products ?? []
  return {
    shopify: {
      transaction_fee_pct: numText(cfg.shopify.transaction_fee_pct),
      payment_processing_pct: numText(cfg.shopify.payment_processing_pct),
      payment_processing_fixed: numText(cfg.shopify.payment_processing_fixed),
    },
    cogs: {
      default_cost_usd: numText(c.default_cost_usd),
      packaging_cost_usd: numText(c.packaging_cost_usd),
      packaging_per_unit_usd: numText(c.packaging_per_unit_usd ?? 0),
      packaging_scope: packList.length ? 'some' : 'all',
      packaging_per_unit_products: [...packList],
      additional_unit_discount_usd: numText(c.additional_unit_discount_usd),
      volume_discounts: c.volume_discounts.map((v, i) => ({
        _id: `v${i}`, min_units: String(v.min_units), discount_type: v.discount_type, discount_value: numText(v.discount_value),
      })),
      products,
      productNames,
      productOrder: c.products.map(p => p.product_id),
      zero_cost_products: [...(c.zero_cost_products ?? [])],
      price_tiers: (c.price_tiers ?? []).map((t, i) => ({
        _id: `t${i}`,
        label: t.label ?? '',
        effective_from: t.effective_from,
        scope: (t.product_ids ?? []).length ? 'some' : 'all',
        product_ids: [...(t.product_ids ?? [])],
        steps: Object.entries(t.order_prices)
          .sort((a, b) => Number(a[0]) - Number(b[0]))
          .map(([units, price], k) => ({ _id: `t${i}s${k}`, units, price: numText(price) })),
        extra_unit_usd: numText(t.extra_unit_usd),
      })),
      country_prices: (c.country_prices ?? []).map((cp, i) => ({
        _id: `c${i}`,
        product_id: cp.product_id,
        name: cp.name ?? '',
        prices: Object.entries(cp.prices).map(([country, price], k) => ({ _id: `c${i}p${k}`, country, price: numText(price) })),
      })),
      order_fees: (c.order_fees ?? []).map((f, i) => ({
        _id: `f${i}`, country_code: f.country_code, name: f.name ?? '', amount_usd: numText(f.amount_usd), effective_from: f.effective_from ?? '',
      })),
    },
    shipping: {
      default_rate_usd: numText(cfg.shipping.default_rate_usd),
      rates: cfg.shipping.rates.map((r, i) => ({ _id: `r${i}`, country_code: r.country_code, name: r.name ?? '', cost_usd: numText(r.cost_usd) })),
    },
    extra_costs: cfg.extra_costs.map((e, i) => ({ _id: `e${i}`, name: e.name, amount_usd: numText(e.amount_usd), frequency: e.frequency })),
  }
}

let counter = 0
/** An id for a row added in the browser. Never called during a render. */
export function newId(prefix: string): string {
  counter += 1
  return `${prefix}n${Date.now().toString(36)}${counter.toString(36)}`
}

// ─── Form → request body ──────────────────────────────────────────────────────

export const ROW_LISTS = [
  'cogs.price_tiers', 'cogs.country_prices', 'cogs.order_fees', 'cogs.volume_discounts', 'shipping.rates', 'extra_costs',
] as const
export type RowList = (typeof ROW_LISTS)[number]

/** Payload position → row id, per list; product position → product id. */
export interface PayloadIndex {
  rows: Record<RowList, string[]>
  products: string[]
}

export interface Payload {
  config: Record<string, unknown>
  index: PayloadIndex
}

/**
 * The body for POST/PUT /api/profit: every section, every list in form order
 * (blank rows included — the server drops them silently, and filtering here
 * would shift the positions its messages refer to).
 *
 * Products: the saved ones in their saved order (a cleared price is sent as 0,
 * which un-prices it), then products priced for the first time. A catalogue
 * product nobody typed a price for is not sent.
 */
export function toPayload(f: CostForm, catalogueNames: Record<string, string> = {}): Payload {
  const c = f.cogs
  const saved = new Set(c.productOrder)
  const productIds = [
    ...c.productOrder,
    ...Object.keys(c.products).filter(id => !saved.has(id) && (toNumber(c.products[id].trim()) ?? 1) !== 0 && c.products[id].trim() !== ''),
  ]
  const products = productIds.map(id => ({
    product_id: id,
    name: c.productNames[id] ?? catalogueNames[id] ?? '',
    cost_usd: scalar(c.products[id] ?? ''),
  }))

  const tiers = c.price_tiers.map(t => {
    const order_prices: Record<string, number | string | null> = {}
    for (const s of t.steps) {
      if (!s.units.trim() && !s.price.trim()) continue
      order_prices[s.units.trim()] = cell(s.price)
    }
    return {
      effective_from: t.effective_from.trim(),
      label: t.label.trim(),
      // An empty 'some' list is refused on the client (clientIssues): sent as
      // is, the server would read it as a whole-order card.
      product_ids: t.scope === 'some' ? t.product_ids : [],
      order_prices,
      extra_unit_usd: t.extra_unit_usd.trim() ? cell(t.extra_unit_usd) : 0,
    }
  })

  const countryPrices = c.country_prices.map(cp => {
    const prices: Record<string, number | string | null> = {}
    for (const p of cp.prices) {
      if (!p.country.trim() && !p.price.trim()) continue
      prices[p.country.trim()] = cell(p.price)
    }
    return { product_id: cp.product_id, name: cp.name || catalogueNames[cp.product_id] || '', prices }
  })

  const config: Record<string, unknown> = {
    shopify: {
      transaction_fee_pct: scalar(f.shopify.transaction_fee_pct),
      payment_processing_pct: scalar(f.shopify.payment_processing_pct),
      payment_processing_fixed: scalar(f.shopify.payment_processing_fixed),
    },
    cogs: {
      default_cost_usd: scalar(c.default_cost_usd),
      packaging_cost_usd: scalar(c.packaging_cost_usd),
      packaging_per_unit_usd: scalar(c.packaging_per_unit_usd),
      packaging_per_unit_products: c.packaging_scope === 'some' ? c.packaging_per_unit_products : [],
      additional_unit_discount_usd: scalar(c.additional_unit_discount_usd),
      volume_discounts: c.volume_discounts.map(v => ({
        min_units: cell(v.min_units), discount_type: v.discount_type, discount_value: cell(v.discount_value),
      })),
      products,
      zero_cost_products: c.zero_cost_products,
      price_tiers: tiers,
      country_prices: countryPrices,
      order_fees: c.order_fees.map(o => ({
        country_code: o.country_code.trim(), name: o.name.trim(), amount_usd: cell(o.amount_usd), effective_from: o.effective_from.trim(),
      })),
    },
    shipping: {
      default_rate_usd: scalar(f.shipping.default_rate_usd),
      rates: f.shipping.rates.map(r => ({ country_code: r.country_code.trim(), name: r.name.trim(), cost_usd: cell(r.cost_usd) })),
    },
    extra_costs: f.extra_costs.map(e => ({ name: e.name.trim(), amount_usd: cell(e.amount_usd), frequency: e.frequency })),
  }

  return {
    config,
    index: {
      rows: {
        'cogs.price_tiers': c.price_tiers.map(t => t._id),
        'cogs.country_prices': c.country_prices.map(x => x._id),
        'cogs.order_fees': c.order_fees.map(x => x._id),
        'cogs.volume_discounts': c.volume_discounts.map(x => x._id),
        'shipping.rates': f.shipping.rates.map(x => x._id),
        'extra_costs': f.extra_costs.map(x => x._id),
      },
      products: productIds,
    },
  }
}

// ─── Messages ↔ fields ────────────────────────────────────────────────────────

/** A row's key prefix: "cogs.price_tiers#t0". */
export const rowKey = (list: RowList, id: string) => `${list}#${id}`
/** A product's key prefix: "cogs.products@123". */
export const productKey = (id: string) => `cogs.products@${id}`

/**
 * The server's path ("cogs.price_tiers[1].order_prices.3") as a stable field
 * key ("cogs.price_tiers#t7.order_prices.3"): list positions become the id of
 * the row that was at that position in the payload.
 */
export function fieldKey(path: string, index: PayloadIndex): string {
  const product = /^cogs\.products\[(\d+)\](.*)$/.exec(path)
  if (product) return `${productKey(index.products[Number(product[1])] ?? '?')}${product[2]}`
  for (const list of ROW_LISTS) {
    const m = new RegExp(`^${list.replace('.', '\\.')}\\[(\\d+)\\](.*)$`).exec(path)
    if (m) return `${rowKey(list, index.rows[list][Number(m[1])] ?? '?')}${m[2]}`
  }
  return path
}

/**
 * A validator message as the screen shows it. The rules in profitConfig write
 * amounts the JavaScript way ("abatimento de $12.60"); everything on screen is
 * pt-BR ("$12,60"), so amounts are rewritten here, in one place.
 */
export function ptMessage(text: string): string {
  return text.replace(/\$(\d+)\.(\d{2})\b/g, (_, int: string, dec: string) => formatMoney(Number(`${int}.${dec}`), { cents: 'always' }))
}

export interface FieldMessages {
  /** field key → messages. */
  errors: Map<string, string[]>
  warnings: Map<string, string[]>
}

export function messagesByField(issues: ConfigIssue[], warnings: ConfigIssue[], index: PayloadIndex): FieldMessages {
  const group = (xs: ConfigIssue[]) => {
    const m = new Map<string, string[]>()
    for (const x of xs) {
      const k = fieldKey(x.path, index)
      m.set(k, [...(m.get(k) ?? []), ptMessage(x.message)])
    }
    return m
  }
  return { errors: group(issues), warnings: group(warnings) }
}

/**
 * Problems the server cannot see, because they vanish when the form becomes
 * JSON: two rows for the same country or unit count collapse into one object
 * key, and a card limited to "some products" with none chosen would be sent
 * as a whole-order card.
 */
export function clientIssues(f: CostForm): ConfigIssue[] {
  const out: ConfigIssue[] = []
  for (const t of f.cogs.price_tiers) {
    const base = rowKey('cogs.price_tiers', t._id)
    if (t.scope === 'some' && t.product_ids.length === 0) {
      out.push({ path: `${base}.product_ids`, message: 'Escolha pelo menos um produto, ou marque que a tabela vale para o pedido inteiro.' })
    }
    const seen = new Set<string>()
    for (const s of t.steps) {
      const u = s.units.trim()
      if (!u) continue
      if (seen.has(u)) out.push({ path: `${base}.step#${s._id}`, message: `${u} unidade(s) aparece duas vezes.` })
      seen.add(u)
    }
  }
  for (const cp of f.cogs.country_prices) {
    const seen = new Set<string>()
    for (const p of cp.prices) {
      const cc = p.country.trim().toUpperCase()
      if (!cc) continue
      if (seen.has(cc)) out.push({ path: `${rowKey('cogs.country_prices', cp._id)}.price#${p._id}`, message: `${cc} aparece duas vezes nesta lista.` })
      seen.add(cc)
    }
  }
  if (f.cogs.packaging_scope === 'some' && f.cogs.packaging_per_unit_products.length === 0 && f.cogs.packaging_per_unit_usd.trim() && toNumber(f.cogs.packaging_per_unit_usd) !== 0) {
    out.push({ path: 'cogs.packaging_per_unit_products', message: 'Escolha os produtos que usam esta embalagem, ou marque que vale para todos.' })
  }
  return out
}

// ─── What changed ─────────────────────────────────────────────────────────────

export const SECTION_NAMES: { key: string; label: string; pick: (c: Record<string, unknown>) => unknown }[] = [
  { key: 'fees', label: 'taxas', pick: c => c.shopify },
  { key: 'default', label: 'custo padrão e descontos', pick: c => pickCogs(c, ['default_cost_usd', 'additional_unit_discount_usd', 'volume_discounts']) },
  { key: 'products', label: 'custo por produto', pick: c => pickCogs(c, ['products']) },
  { key: 'zero', label: 'produtos sem custo', pick: c => pickCogs(c, ['zero_cost_products']) },
  { key: 'tiers', label: 'tabelas do fornecedor', pick: c => pickCogs(c, ['price_tiers']) },
  { key: 'country', label: 'preço por país', pick: c => pickCogs(c, ['country_prices']) },
  { key: 'orderFees', label: 'taxa por pedido', pick: c => pickCogs(c, ['order_fees']) },
  { key: 'packaging', label: 'embalagem', pick: c => pickCogs(c, ['packaging_cost_usd', 'packaging_per_unit_usd', 'packaging_per_unit_products']) },
  { key: 'shipping', label: 'frete', pick: c => c.shipping },
  { key: 'extras', label: 'custos extras', pick: c => c.extra_costs },
]

function pickCogs(c: Record<string, unknown>, keys: string[]) {
  const cogs = (c.cogs ?? {}) as Record<string, unknown>
  return Object.fromEntries(keys.map(k => [k, cogs[k]]))
}

/** The labels of the sections whose payload differs. */
export function changedSections(a: Record<string, unknown>, b: Record<string, unknown>): string[] {
  return SECTION_NAMES.filter(s => canonicalJson(s.pick(a)) !== canonicalJson(s.pick(b))).map(s => s.label)
}

/** "taxas", "taxas e frete", "taxas, frete e embalagem". */
export function joinPt(xs: string[]): string {
  return xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`
}
