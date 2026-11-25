/**
 * A store's cost settings: reading them, checking them, merging edits into
 * them, and explaining what each part costs.
 *
 * Pure functions only (no database; the clock only as a default argument), so
 * the cost screen can run the same checks in the browser that the server runs
 * before saving, and so every rule here is unit-tested. The request/response
 * types of /api/profit live at the bottom for the same reason.
 *
 * Why this exists: the save route used to store whatever JSON it was sent. A
 * failed page load followed by "Salvar" replaced a store's rate cards, country
 * prices and per-order fees with an empty form, a rate card saved before its
 * prices were typed priced every later order at $0, and a malformed config
 * crashed the calculator. Every one of those is refused here, with a message
 * that says which field and why, in Portuguese.
 *
 * Merge rules for a partial body (never wipe what was not sent):
 *   - a section or key that is absent (or null) keeps the saved value;
 *   - a list that is present replaces the saved list ([] clears it), except
 *     `cogs.products`, which is merged by product_id: a product absent from
 *     the body keeps its saved cost. Send cost_usd 0 to un-price one (0 means
 *     "not priced yet" and falls back to the default cost, exactly like a
 *     missing entry, so merging can never change a number by itself).
 */

import {
  buildCogsLookups, fixedCostForDay, isConfigured, tiersForDate,
  type CogsPriceTier, type CountryPriceList, type ExtraCost, type ProfitConfig, type SupplierOrderFee,
} from '../engine/costs'
import { daysBetween, isIsoDate, isPeriod, type DateRange, type Period } from '../engine/dates'
import type { DayPnL, PnL, PnLLines, ProductPnL } from '../engine/pnl'
import { windowFor } from '../period/windows'

export type { ProfitConfig }

// ─── Issues ───────────────────────────────────────────────────────────────────

/** One problem with one field. `path` is dotted with list indexes, e.g.
 *  "cogs.price_tiers[0].order_prices", so the screen can put the message next
 *  to the input that caused it. An empty path is about the whole config. */
export interface ConfigIssue {
  path: string
  message: string
}

export interface ParsedConfig {
  /** Usable config: valid fields from the input, saved/default values for
   *  everything absent or invalid, invalid list entries dropped. */
  config: ProfitConfig
  /** Blocking problems. A save is refused while this is not empty; a preview
   *  runs on `config` (which ignored them) and shows them. */
  issues: ConfigIssue[]
  /** Not wrong, but worth a second look ("custo padrão $0"). Never blocking. */
  warnings: ConfigIssue[]
}

class Ctx {
  issues: ConfigIssue[] = []
  warnings: ConfigIssue[] = []
  err(path: string, message: string) { this.issues.push({ path, message }) }
  warn(path: string, message: string) { this.warnings.push({ path, message }) }
}

// ─── Defaults ─────────────────────────────────────────────────────────────────

/** Every key present, every cost zero. Filling a saved config with these is
 *  lossless: the engine reads an absent list, an empty list and a zero the same
 *  way. */
export function defaultProfitConfig(): ProfitConfig {
  return {
    shopify: { transaction_fee_pct: 0, payment_processing_pct: 0, payment_processing_fixed: 0 },
    cogs: {
      default_cost_usd: 0,
      packaging_cost_usd: 0,
      packaging_per_unit_usd: 0,
      packaging_per_unit_products: [],
      additional_unit_discount_usd: 0,
      volume_discounts: [],
      products: [],
      zero_cost_products: [],
      price_tiers: [],
      country_prices: [],
      order_fees: [],
    },
    shipping: { default_rate_usd: 0, rates: [] },
    extra_costs: [],
  }
}

// ─── Primitive readers ────────────────────────────────────────────────────────

type Obj = Record<string, unknown>
const isObj = (v: unknown): v is Obj => !!v && typeof v === 'object' && !Array.isArray(v)
const absent = (v: unknown) => v === undefined || v === null
/** A cell left empty in the form (sent as null, or a blank string). */
const isBlank = (v: unknown) => absent(v) || (typeof v === 'string' && v.trim() === '')

/** A finite number, or a plain decimal string ("2.9", "2,9") from a form
 *  input. Anything else, the empty string included, is not a number. */
export function toNumber(v: unknown): number | null {
  if (typeof v === 'number') return Number.isFinite(v) ? v : null
  if (typeof v === 'string') {
    const s = v.trim()
    if (!/^-?\d+([.,]\d+)?$/.test(s)) return null
    return Number(s.replace(',', '.'))
  }
  return null
}

const str = (v: unknown): string =>
  typeof v === 'string' ? v.trim() : typeof v === 'number' && Number.isFinite(v) ? String(v) : ''

/** Shopify product ids are compared as the numeric string the orders carry. A
 *  GraphQL gid is reduced to that number, or it would never match an order. */
export function toProductId(v: unknown): string | null {
  if (typeof v === 'number') return Number.isSafeInteger(v) && v > 0 ? String(v) : null
  if (typeof v !== 'string') return null
  const s = v.trim()
  const gid = /^gid:\/\/shopify\/Product\/(\d+)$/.exec(s)
  return gid ? gid[1] : s || null
}

const toCountry = (v: unknown): string | null => {
  const s = str(v).toUpperCase()
  return /^[A-Z]{2}$/.test(s) ? s : null
}

const MSG = {
  number: 'Deve ser um número.',
  negative: 'Não pode ser negativo.',
  pct: 'Deve ser um percentual entre 0 e 100.',
  list: 'Deve ser uma lista.',
  object: 'Formato inválido.',
  date: 'Data inválida. Use o formato AAAA-MM-DD.',
  country: 'Código de país inválido. Use as 2 letras do país (ex.: US, DE).',
  productId: 'Informe o ID do produto.',
}

interface NumRule { min?: number; max?: number; msg?: string }

/** A number field: absent keeps `fallback`, invalid is an issue and keeps it. */
function num(ctx: Ctx, path: string, v: unknown, fallback: number, rule: NumRule = { min: 0 }): number {
  if (absent(v)) return fallback
  const n = toNumber(v)
  if (n === null) { ctx.err(path, MSG.number); return fallback }
  if ((rule.min !== undefined && n < rule.min) || (rule.max !== undefined && n > rule.max)) {
    ctx.err(path, rule.msg ?? (rule.min === 0 && rule.max === undefined ? MSG.negative : MSG.number))
    return fallback
  }
  return n
}

const PCT: NumRule = { min: 0, max: 100, msg: MSG.pct }

/** A list field: absent keeps `fallback`; present replaces it. `item` returns
 *  null to drop an entry (a blank row, or one it reported as invalid). */
function list<T>(
  ctx: Ctx, path: string, v: unknown, fallback: T[],
  item: (x: unknown, p: string) => T | null,
): { items: T[]; index: number[] } {
  if (absent(v)) return { items: fallback, index: fallback.map((_, i) => i) }
  if (!Array.isArray(v)) { ctx.err(path, MSG.list); return { items: fallback, index: fallback.map((_, i) => i) } }
  const items: T[] = []
  const index: number[] = []
  v.forEach((x, i) => {
    const r = item(x, `${path}[${i}]`)
    if (r !== null) { items.push(r); index.push(i) }
  })
  return { items, index }
}

function idList(ctx: Ctx, path: string, v: unknown, fallback: string[]): string[] {
  const { items } = list(ctx, path, v, fallback, (x, p) => {
    const id = toProductId(x)
    if (!id) ctx.err(p, MSG.productId)
    return id
  })
  return [...new Set(items)]
}

const money = (v: number) => `$${v.toFixed(2)}`
const brDate = (d: string) => `${d.slice(8, 10)}/${d.slice(5, 7)}/${d.slice(0, 4)}`

// ─── Sections ─────────────────────────────────────────────────────────────────

function parseShopify(ctx: Ctx, v: unknown, base: ProfitConfig['shopify']): ProfitConfig['shopify'] {
  if (absent(v)) return base
  if (!isObj(v)) { ctx.err('shopify', MSG.object); return base }
  return {
    transaction_fee_pct: num(ctx, 'shopify.transaction_fee_pct', v.transaction_fee_pct, base.transaction_fee_pct, PCT),
    payment_processing_pct: num(ctx, 'shopify.payment_processing_pct', v.payment_processing_pct, base.payment_processing_pct, PCT),
    payment_processing_fixed: num(ctx, 'shopify.payment_processing_fixed', v.payment_processing_fixed, base.payment_processing_fixed),
  }
}

type ProductCost = ProfitConfig['cogs']['products'][number]

/** Merged by product_id onto the saved list (see the header). */
function parseProducts(ctx: Ctx, v: unknown, base: ProductCost[]): ProductCost[] {
  const path = 'cogs.products'
  if (absent(v)) return base
  if (!Array.isArray(v)) { ctx.err(path, MSG.list); return base }
  const saved = new Map(base.map(p => [p.product_id, p]))
  const sent = new Map<string, ProductCost>()
  v.forEach((x, i) => {
    const p = `${path}[${i}]`
    if (!isObj(x)) { ctx.err(p, MSG.object); return }
    const id = toProductId(x.product_id)
    const cost = num(ctx, `${p}.cost_usd`, x.cost_usd, id ? saved.get(id)?.cost_usd ?? 0 : 0)
    if (!id) {
      // A row with no id and no price is an empty line of the form.
      if (cost > 0 || str(x.name)) ctx.err(`${p}.product_id`, MSG.productId)
      return
    }
    const name = str(x.name) || saved.get(id)?.name || ''
    const prev = sent.get(id)
    if (prev) {
      if (prev.cost_usd > 0 && cost > 0 && prev.cost_usd !== cost) {
        ctx.err(`${p}.cost_usd`,
          `O produto ${name || id} aparece duas vezes com custos diferentes (${money(prev.cost_usd)} e ${money(cost)}).`)
        return
      }
      if (cost > 0 || !prev.name) sent.set(id, { product_id: id, name: name || prev.name, cost_usd: Math.max(cost, prev.cost_usd) })
      return
    }
    sent.set(id, { product_id: id, name, cost_usd: cost })
  })
  // Saved order first, new products after: the price-by-title fallback lets
  // the last of two same-named products win, so a save must not reorder them.
  const savedIds = new Set(base.map(p => p.product_id))
  return [...base.map(p => sent.get(p.product_id) ?? p), ...[...sent.values()].filter(p => !savedIds.has(p.product_id))]
}

function parseTier(ctx: Ctx, x: unknown, p: string): CogsPriceTier | null {
  if (!isObj(x)) { ctx.err(p, MSG.object); return null }
  let ok = true
  const effective_from = str(x.effective_from)
  if (!isIsoDate(effective_from)) { ctx.err(`${p}.effective_from`, 'Informe a data em que a tabela começa a valer (AAAA-MM-DD).'); ok = false }
  const label = str(x.label)

  const product_ids = idList(ctx, `${p}.product_ids`, x.product_ids, [])

  const order_prices: Record<string, number> = {}
  if (!isObj(x.order_prices)) {
    ctx.err(`${p}.order_prices`, 'Informe os preços por quantidade de unidades no pedido.')
    ok = false
  } else {
    for (const [k, raw] of Object.entries(x.order_prices)) {
      const units = /^\s*\d+\s*$/.test(k) ? Number(k) : NaN
      if (!Number.isSafeInteger(units) || units < 1) {
        ctx.err(`${p}.order_prices`, `Quantidade inválida: "${k}". Use números inteiros a partir de 1.`)
        ok = false
        continue
      }
      const price = toNumber(raw)
      if (price === null || price < 0) {
        // An empty box (a new card starts with three) is missing, not wrong.
        ctx.err(`${p}.order_prices.${units}`, isBlank(raw)
          ? `Informe o preço do pedido com ${units} unidade(s).`
          : `Preço inválido para ${units} unidade(s).`)
        ok = false
        continue
      }
      // The engine looks prices up by String(units): "03" would never match.
      order_prices[String(units)] = price
    }
    // An empty card is a draft: applied, it would price every order from its
    // date at $0 (PE12).
    if (ok && !Object.values(order_prices).some(v => v > 0)) {
      ctx.err(`${p}.order_prices`, 'A tabela precisa de pelo menos um preço maior que zero.')
      ok = false
    }
  }
  const extra_unit_usd = num(ctx, `${p}.extra_unit_usd`, x.extra_unit_usd, 0)
  if (!ok) return null
  const tier: CogsPriceTier = { effective_from, label, order_prices, extra_unit_usd }
  if (product_ids.length) tier.product_ids = product_ids
  return tier
}

/** Cross-checks between rate cards: things each card alone cannot show. */
function checkTiers(ctx: Ctx, tiers: CogsPriceTier[], index: number[]) {
  const path = (k: number) => `cogs.price_tiers[${index[k]}]`
  const scope = (t: CogsPriceTier) => [...(t.product_ids ?? [])].sort().join(',')
  const name = (t: CogsPriceTier) => t.label ? `"${t.label}"` : `de ${brDate(t.effective_from)}`

  // Two cards for the same products on the same date: the engine keeps
  // whichever comes first, silently.
  const seen = new Map<string, number>()
  tiers.forEach((t, k) => {
    const key = `${scope(t)}|${t.effective_from}`
    if (seen.has(key)) ctx.err(`${path(k)}.effective_from`, 'Já existe outra tabela para os mesmos produtos começando nesta data.')
    else seen.set(key, k)
  })

  // A card with no products prices the whole order and the engine then ignores
  // every product card (PE13). A product card that starts on or after it can
  // never apply.
  const whole = tiers.filter(t => !(t.product_ids ?? []).length)
    .sort((a, b) => a.effective_from.localeCompare(b.effective_from))[0]
  if (whole) {
    tiers.forEach((t, k) => {
      if (!(t.product_ids ?? []).length || t.effective_from < whole.effective_from) return
      ctx.err(`${path(k)}.product_ids`,
        `Esta tabela nunca seria usada: desde ${brDate(whole.effective_from)} a tabela ${name(whole)}, que não lista produtos, ` +
        'já preça o pedido inteiro. Liste os produtos daquela tabela ou remova esta.')
    })
  }

  // One product in two product cards with different scopes: only the first
  // card that claims it prices it, which depends on list order.
  const owner = new Map<string, number>()
  tiers.forEach((t, k) => {
    for (const id of t.product_ids ?? []) {
      const o = owner.get(id)
      if (o !== undefined && scope(tiers[o]) !== scope(t)) {
        ctx.warn(`${path(k)}.product_ids`,
          `O produto ${id} também está na tabela ${name(tiers[o])}; só a primeira das duas preça esse produto.`)
      } else if (o === undefined) owner.set(id, k)
    }
  })
}

function parseCountryPrices(ctx: Ctx, x: unknown, p: string): CountryPriceList | null {
  if (!isObj(x)) { ctx.err(p, MSG.object); return null }
  const id = toProductId(x.product_id)
  const prices: Record<string, number> = {}
  let ok = true
  if (!absent(x.prices) && !isObj(x.prices)) { ctx.err(`${p}.prices`, MSG.object); ok = false }
  for (const [k, raw] of Object.entries(isObj(x.prices) ? x.prices : {})) {
    const cc = toCountry(k)
    if (!cc) { ctx.err(`${p}.prices.${k}`, MSG.country); ok = false; continue }
    const price = toNumber(raw)
    if (price === null || price < 0) {
      ctx.err(`${p}.prices.${cc}`, isBlank(raw) ? `Informe o preço para ${cc}.` : `Preço inválido para ${cc}.`)
      ok = false
      continue
    }
    prices[cc] = price
  }
  if (!id) {
    if (Object.keys(prices).length) ctx.err(`${p}.product_id`, MSG.productId)
    return null
  }
  // A list with no prices changes nothing; it is an unfinished row.
  if (!ok || !Object.keys(prices).length) return null
  const out: CountryPriceList = { product_id: id, prices }
  const name = str(x.name)
  if (name) out.name = name
  return out
}

function parseOrderFee(ctx: Ctx, x: unknown, p: string): SupplierOrderFee | null {
  if (!isObj(x)) { ctx.err(p, MSG.object); return null }
  const amountRaw = toNumber(x.amount_usd)
  if (!str(x.country_code) && !amountRaw) return null // blank row
  let ok = true
  const cc = toCountry(x.country_code)
  if (!cc) { ctx.err(`${p}.country_code`, MSG.country); ok = false }
  if (amountRaw === null) { ctx.err(`${p}.amount_usd`, absent(x.amount_usd) ? 'Informe o valor.' : MSG.number); ok = false }
  const from = str(x.effective_from)
  if (from && !isIsoDate(from)) { ctx.err(`${p}.effective_from`, MSG.date); ok = false }
  if (!ok || !cc || amountRaw === null) return null
  // MOKOO's supplier credits Algeria orders: a negative fee is a rebate.
  if (amountRaw < 0) ctx.warn(`${p}.amount_usd`, `Valor negativo: funciona como abatimento de ${money(-amountRaw)} por pedido para ${cc}.`)
  const out: SupplierOrderFee = { country_code: cc, amount_usd: amountRaw }
  const name = str(x.name)
  if (name) out.name = name
  if (from) out.effective_from = from
  return out
}

/** Entries with a duplicate key are reported (the engine would use only the
 *  first) and the later ones dropped. */
function uniqueBy<T>(ctx: Ctx, items: T[], index: number[], key: (t: T) => string, path: (i: number) => string, msg: (k: string) => string) {
  const seen = new Set<string>()
  const keep: T[] = []
  const keepIdx: number[] = []
  items.forEach((t, k) => {
    const id = key(t)
    if (seen.has(id)) { ctx.err(path(index[k]), msg(id)); return }
    seen.add(id); keep.push(t); keepIdx.push(index[k])
  })
  return { items: keep, index: keepIdx }
}

type VolumeDiscount = ProfitConfig['cogs']['volume_discounts'][number]

function parseVolumeDiscount(ctx: Ctx, x: unknown, p: string): VolumeDiscount | null {
  if (!isObj(x)) { ctx.err(p, MSG.object); return null }
  const minUnits = toNumber(x.min_units)
  if (minUnits === null || !Number.isInteger(minUnits) || minUnits < 1) {
    ctx.err(`${p}.min_units`, 'Informe a quantidade mínima (inteiro a partir de 1).')
    return null
  }
  const type = absent(x.discount_type) ? 'pct' : x.discount_type
  if (type !== 'pct' && type !== 'abs') { ctx.err(`${p}.discount_type`, 'Use "pct" (percentual) ou "abs" (valor por unidade).'); return null }
  // Older configs stored the percentage as discount_pct.
  const before = ctx.issues.length
  const value = num(ctx, `${p}.discount_value`, x.discount_value ?? x.discount_pct, 0, type === 'pct' ? PCT : { min: 0 })
  if (ctx.issues.length > before) return null
  return { min_units: minUnits, discount_type: type, discount_value: value }
}

function parseCogs(ctx: Ctx, v: unknown, base: ProfitConfig['cogs']): ProfitConfig['cogs'] {
  if (absent(v)) return base
  if (!isObj(v)) { ctx.err('cogs', MSG.object); return base }
  const P = 'cogs'

  const tiers = list(ctx, `${P}.price_tiers`, v.price_tiers, base.price_tiers ?? [], (x, p) => parseTier(ctx, x, p))
  if (!absent(v.price_tiers)) checkTiers(ctx, tiers.items, tiers.index)

  const cpRaw = list(ctx, `${P}.country_prices`, v.country_prices, base.country_prices ?? [], (x, p) => parseCountryPrices(ctx, x, p))
  const country_prices = absent(v.country_prices) ? cpRaw.items
    : uniqueBy(ctx, cpRaw.items, cpRaw.index, c => c.product_id, i => `${P}.country_prices[${i}].product_id`,
        id => `O produto ${id} já tem outra lista de preços por país.`).items

  const feeRaw = list(ctx, `${P}.order_fees`, v.order_fees, base.order_fees ?? [], (x, p) => parseOrderFee(ctx, x, p))
  const order_fees = absent(v.order_fees) ? feeRaw.items
    : uniqueBy(ctx, feeRaw.items, feeRaw.index, f => f.country_code, i => `${P}.order_fees[${i}].country_code`,
        cc => `${cc} aparece duas vezes; só a primeira taxa seria cobrada.`).items

  const cogs: ProfitConfig['cogs'] = {
    default_cost_usd: num(ctx, `${P}.default_cost_usd`, v.default_cost_usd, base.default_cost_usd),
    packaging_cost_usd: num(ctx, `${P}.packaging_cost_usd`, v.packaging_cost_usd, base.packaging_cost_usd),
    packaging_per_unit_usd: num(ctx, `${P}.packaging_per_unit_usd`, v.packaging_per_unit_usd, base.packaging_per_unit_usd ?? 0),
    packaging_per_unit_products: idList(ctx, `${P}.packaging_per_unit_products`, v.packaging_per_unit_products, base.packaging_per_unit_products ?? []),
    additional_unit_discount_usd: num(ctx, `${P}.additional_unit_discount_usd`, v.additional_unit_discount_usd, base.additional_unit_discount_usd),
    volume_discounts: list(ctx, `${P}.volume_discounts`, v.volume_discounts, base.volume_discounts, (x, p) => parseVolumeDiscount(ctx, x, p)).items,
    products: parseProducts(ctx, v.products, base.products),
    zero_cost_products: idList(ctx, `${P}.zero_cost_products`, v.zero_cost_products, base.zero_cost_products ?? []),
    price_tiers: tiers.items,
    country_prices,
    order_fees,
  }
  return cogs
}

function parseShipping(ctx: Ctx, v: unknown, base: ProfitConfig['shipping']): ProfitConfig['shipping'] {
  if (absent(v)) return base
  if (!isObj(v)) { ctx.err('shipping', MSG.object); return base }
  const raw = list(ctx, 'shipping.rates', v.rates, base.rates, (x, p) => {
    if (!isObj(x)) { ctx.err(p, MSG.object); return null }
    const cost = toNumber(x.cost_usd)
    // EPOCH's form saved a blank row ({country_code: "", cost_usd: 0}).
    if (!str(x.country_code) && !cost && !str(x.name)) return null
    let ok = true
    const cc = toCountry(x.country_code)
    if (!cc) { ctx.err(`${p}.country_code`, MSG.country); ok = false }
    if (cost === null || cost < 0) { ctx.err(`${p}.cost_usd`, cost === null ? MSG.number : MSG.negative); ok = false }
    return ok && cc && cost !== null ? { country_code: cc, name: str(x.name), cost_usd: cost } : null
  })
  const rates = absent(v.rates) ? raw.items
    : uniqueBy(ctx, raw.items, raw.index, r => r.country_code, i => `shipping.rates[${i}].country_code`,
        cc => `${cc} aparece duas vezes; só o primeiro frete seria usado.`).items
  return {
    default_rate_usd: num(ctx, 'shipping.default_rate_usd', v.default_rate_usd, base.default_rate_usd),
    rates,
  }
}

const FREQUENCIES = ['monthly', 'per_order', 'annual'] as const

function parseExtraCosts(ctx: Ctx, v: unknown, base: ExtraCost[]): ExtraCost[] {
  return list(ctx, 'extra_costs', v, base, (x, p) => {
    if (!isObj(x)) { ctx.err(p, MSG.object); return null }
    const name = str(x.name)
    const amount = toNumber(x.amount_usd)
    if (!name && !amount) return null // blank row
    let ok = true
    if (!name) { ctx.err(`${p}.name`, 'Dê um nome a este custo.'); ok = false }
    if (amount === null || amount < 0) { ctx.err(`${p}.amount_usd`, amount === null ? MSG.number : MSG.negative); ok = false }
    const frequency = x.frequency
    if (!FREQUENCIES.includes(frequency as ExtraCost['frequency'])) {
      ctx.err(`${p}.frequency`, 'Escolha mensal, anual ou por pedido.'); ok = false
    }
    return ok && amount !== null ? { name, amount_usd: amount, frequency: frequency as ExtraCost['frequency'] } : null
  }).items
}

function warnings(ctx: Ctx, cfg: ProfitConfig) {
  const c = cfg.cogs
  if (c.default_cost_usd === 0 && !(c.price_tiers ?? []).some(t => !(t.product_ids ?? []).length)) {
    ctx.warn('cogs.default_cost_usd',
      'Custo padrão é $0: todo produto sem preço próprio conta como grátis. ' +
      'Para um produto que é grátis de verdade, use a lista de produtos sem custo.')
  }
  const zero = new Set(c.zero_cost_products ?? [])
  c.products.forEach((p, i) => {
    if (zero.has(p.product_id) && p.cost_usd > 0) {
      ctx.warn(`cogs.products[${i}].cost_usd`,
        `${p.name || p.product_id} está na lista de produtos sem custo; o custo de ${money(p.cost_usd)} é ignorado.`)
    }
  })
}

// ─── Public API ───────────────────────────────────────────────────────────────

/**
 * Check `input` (a full or partial config) and merge it onto `base` (the saved
 * config, already normalised; defaults when omitted). See the header for the
 * merge rules.
 */
export function parseProfitConfig(input: unknown, base: ProfitConfig = defaultProfitConfig()): ParsedConfig {
  const ctx = new Ctx()
  if (!isObj(input)) {
    ctx.err('', 'A configuração enviada não é um objeto.')
    return { config: base, issues: ctx.issues, warnings: ctx.warnings }
  }
  const config: ProfitConfig = {
    shopify: parseShopify(ctx, input.shopify, base.shopify),
    cogs: parseCogs(ctx, input.cogs, base.cogs),
    shipping: parseShipping(ctx, input.shipping, base.shipping),
    extra_costs: parseExtraCosts(ctx, input.extra_costs, base.extra_costs),
  }
  warnings(ctx, config)
  return { config, issues: ctx.issues, warnings: ctx.warnings }
}

export interface NormalizedSavedConfig extends ParsedConfig {
  /** What the engine thinks: false for no row, {} or a config missing a
   *  section. Such a store shows revenue − ads flagged "custos não configurados". */
  configured: boolean
}

/** A stored config made safe to show and edit: every key present, broken
 *  entries dropped and reported. For every config in production this is
 *  lossless (checked by pricing each store with both). */
export function normalizeSavedConfig(raw: unknown): NormalizedSavedConfig {
  const configured = isConfigured(raw as ProfitConfig | null)
  const parsed = parseProfitConfig(configured ? raw : {}, defaultProfitConfig())
  return { configured, ...parsed }
}

/** No cost of any kind. Saving this would mark a store "configured" with
 *  every cost at zero, hiding the "custos não configurados" flag — and it is
 *  exactly what a form that failed to load sends. */
export function isEmptyConfig(cfg: ProfitConfig): boolean {
  const c = cfg.cogs
  const anyPositive = (xs: number[]) => xs.some(v => v > 0)
  return !anyPositive([
    cfg.shopify.transaction_fee_pct, cfg.shopify.payment_processing_pct, cfg.shopify.payment_processing_fixed,
    c.default_cost_usd, c.packaging_cost_usd, c.packaging_per_unit_usd ?? 0,
    ...c.products.map(p => p.cost_usd),
    ...(c.price_tiers ?? []).flatMap(t => Object.values(t.order_prices)),
    ...(c.country_prices ?? []).flatMap(cp => Object.values(cp.prices)),
    ...(c.order_fees ?? []).map(f => Math.abs(f.amount_usd)),
    cfg.shipping.default_rate_usd, ...cfg.shipping.rates.map(r => r.cost_usd),
    ...cfg.extra_costs.map(e => e.amount_usd),
  ])
}

/** JSON with sorted keys, so two configs that mean the same compare equal. */
export function canonicalJson(v: unknown): string {
  if (Array.isArray(v)) return `[${v.map(canonicalJson).join(',')}]`
  if (isObj(v)) {
    return `{${Object.keys(v).filter(k => v[k] !== undefined).sort()
      .map(k => `${JSON.stringify(k)}:${canonicalJson(v[k])}`).join(',')}}`
  }
  return JSON.stringify(v ?? null)
}

export const sameConfig = (a: ProfitConfig, b: ProfitConfig) => canonicalJson(a) === canonicalJson(b)

/**
 * What a save request should do, given the version the client loaded and the
 * version stored now. Optimistic concurrency: a client that never loaded the
 * config (its load failed) or loaded an older one cannot overwrite it.
 */
export function saveDecision(
  baseVersion: unknown, currentVersion: string,
): { ok: true } | { ok: false; status: 400 | 409; issue: ConfigIssue } {
  if (typeof baseVersion !== 'string' || !baseVersion) {
    return { ok: false, status: 400, issue: { path: 'baseVersion', message: 'Carregue a configuração antes de salvar (versão ausente).' } }
  }
  if (baseVersion !== currentVersion) {
    return {
      ok: false, status: 409,
      issue: { path: 'baseVersion', message: 'A configuração foi alterada depois que esta tela a carregou. Recarregue para ver a versão atual antes de salvar.' },
    }
  }
  return { ok: true }
}

/** The version of a store with no saved row. */
export const NO_CONFIG_VERSION = 'none'

// ─── What each part of the config costs ───────────────────────────────────────

export type CostLineKey =
  | 'product_cost' | 'packaging' | 'supplier_fees' | 'unit_discount' | 'shipping'
  | 'shopify_fee' | 'payment_fee' | 'per_order_extras' | 'fixed_costs'

export type ConfigSection = 'shopify' | 'cogs' | 'shipping' | 'extra_costs'

export interface CostLine {
  key: CostLineKey
  label: string
  /** The part of the config that drives this line. */
  section: ConfigSection
  /** USD over the window. Costs are positive; the extra-unit discount is negative. */
  amount: number
}

/** The cost lines of a P&L, in the order a statement lists them. They sum to
 *  variableCosts + fixedCosts exactly (ads are not part of the config). */
export function costLines(t: PnLLines): CostLine[] {
  return [
    { key: 'product_cost', label: 'Custo dos produtos', section: 'cogs', amount: t.cogs },
    { key: 'packaging', label: 'Embalagem', section: 'cogs', amount: t.packaging },
    { key: 'supplier_fees', label: 'Taxa fixa do fornecedor por país', section: 'cogs', amount: t.supplierFees },
    { key: 'unit_discount', label: 'Desconto por unidade adicional', section: 'cogs', amount: -t.unitSavings },
    { key: 'shipping', label: 'Frete', section: 'shipping', amount: t.shipping },
    { key: 'shopify_fee', label: 'Taxa de transação Shopify', section: 'shopify', amount: t.shopifyFees },
    { key: 'payment_fee', label: 'Processamento de pagamento', section: 'shopify', amount: t.paymentFees },
    { key: 'per_order_extras', label: 'Custos extras por pedido', section: 'extra_costs', amount: t.perOrderExtras },
    { key: 'fixed_costs', label: 'Custos fixos (mensais e anuais)', section: 'extra_costs', amount: t.fixedCosts },
  ]
}

export interface ExtraCostShare {
  name: string
  frequency: ExtraCost['frequency']
  /** USD charged over the window. Sums to perOrderExtras + fixedCosts. */
  amount: number
}

/** Each extra cost's share of the window. Per-order costs are the amount times
 *  the orders; monthly and annual ones take their part of each day's fixed
 *  cost, so a half-finished today carries only its elapsed part, as in the
 *  engine. */
export function extraCostShares(cfg: ProfitConfig, totals: PnLLines, daily: Pick<DayPnL, 'date' | 'fixedCosts'>[]): ExtraCostShare[] {
  return cfg.extra_costs.map(e => {
    if (e.frequency === 'per_order') return { name: e.name, frequency: e.frequency, amount: e.amount_usd * totals.orders }
    let amount = 0
    for (const d of daily) {
      const all = fixedCostForDay(d.date, cfg)
      if (all > 0) amount += d.fixedCosts * (fixedCostForDay(d.date, { ...cfg, extra_costs: [e] }) / all)
    }
    return { name: e.name, frequency: e.frequency, amount }
  })
}

export type PricingSource =
  | 'whole_order_card' | 'product_card' | 'free' | 'country_price' | 'product_price' | 'title_price' | 'default'

export const PRICING_SOURCE_LABEL: Record<PricingSource, string> = {
  whole_order_card: 'Tabela do fornecedor (pedido inteiro)',
  product_card: 'Tabela do fornecedor (por produto)',
  free: 'Declarado sem custo',
  country_price: 'Preço por país (com o preço base onde o país não está na lista)',
  product_price: 'Preço do produto',
  title_price: 'Preço do produto (pelo nome)',
  default: 'Custo padrão (produto sem preço próprio)',
}

/** How the engine prices one product on `date`, in its order of precedence:
 *  whole-order card, product card, declared free, country price, product
 *  price, price by title, default cost. */
export function pricingSource(
  item: { productId: string | null; title: string }, cfg: ProfitConfig, date: string,
  lookups = buildCogsLookups(cfg),
): PricingSource {
  const cards = tiersForDate(cfg, date)
  if (cards.some(t => !(t.product_ids ?? []).length)) return 'whole_order_card'
  const id = item.productId
  if (id && cards.some(t => (t.product_ids ?? []).includes(id))) return 'product_card'
  if (id && lookups.zeroCost.has(id)) return 'free'
  if (id && Object.values(lookups.byCountry.get(id) ?? {}).some(v => Number(v) > 0)) return 'country_price'
  if (id && lookups.byId.has(id)) return 'product_price'
  if (lookups.byTitle.has(item.title)) return 'title_price'
  return 'default'
}

export interface PricingCoverage {
  /** The day the rules were read at: the window's last day. */
  asOf: string
  bySource: { source: PricingSource; label: string; units: number; products: number; revenue: number }[]
  /** Products that fell to the default cost, most units first (up to 25). */
  unpriced: { key: string; productId: string | null; title: string; units: number; revenue: number }[]
  unpricedUnits: number
  defaultCostUsd: number
  /** Rate cards that start inside the window: before that date the products
   *  they cover were priced by the previous rule. */
  cardChanges: { label: string; effectiveFrom: string }[]
}

/** Which rule priced the units sold in the window. Answers "how many units
 *  are falling to the default cost?", which is how a new product ends up
 *  costing $0 without anyone noticing. */
export function pricingCoverage(products: ProductPnL[], cfg: ProfitConfig, range: DateRange): PricingCoverage {
  const lookups = buildCogsLookups(cfg)
  const by = new Map<PricingSource, { units: number; products: number; revenue: number }>()
  const unpriced: PricingCoverage['unpriced'] = []
  for (const p of products) {
    const src = pricingSource({ productId: p.productId, title: p.title }, cfg, range.to, lookups)
    const b = by.get(src) ?? { units: 0, products: 0, revenue: 0 }
    b.units += p.units; b.products += 1; b.revenue += p.revenue
    by.set(src, b)
    if (src === 'default') unpriced.push({ key: p.key, productId: p.productId, title: p.title, units: p.units, revenue: p.revenue })
  }
  unpriced.sort((a, b) => b.units - a.units || b.revenue - a.revenue)
  const order = Object.keys(PRICING_SOURCE_LABEL) as PricingSource[]
  return {
    asOf: range.to,
    bySource: order.filter(s => by.has(s)).map(s => ({ source: s, label: PRICING_SOURCE_LABEL[s], ...by.get(s)! })),
    unpriced: unpriced.slice(0, 25),
    unpricedUnits: unpriced.reduce((s, p) => s + p.units, 0),
    defaultCostUsd: cfg.cogs.default_cost_usd,
    cardChanges: (cfg.cogs.price_tiers ?? [])
      .filter(t => t.effective_from > range.from && t.effective_from <= range.to)
      .map(t => ({ label: t.label || 'Tabela do fornecedor', effectiveFrom: t.effective_from })),
  }
}

export const SECTION_LABEL: Record<ConfigSection, string> = {
  cogs: 'Fornecedor (produtos, embalagem e taxas)',
  shipping: 'Frete',
  shopify: 'Taxas da Shopify e do pagamento',
  extra_costs: 'Custos extras',
}

export interface SectionCost {
  section: ConfigSection
  label: string
  /** Sum of this section's lines. */
  amount: number
  pctOfRevenue: number | null
}

export interface CostBreakdown {
  /** Sum of `lines` (and of `bySection`) = variableCosts + fixedCosts. Ads are
   *  not part of the cost settings and are left out. */
  totalCost: number
  lines: (CostLine & { pctOfRevenue: number | null; perOrder: number | null })[]
  /** What each part of the settings form contributes, in form order. */
  bySection: SectionCost[]
  extraCosts: ExtraCostShare[]
  /** Null when the store has no cost settings. */
  coverage: PricingCoverage | null
}

/** Everything the cost screen shows next to the preview, from one engine run. */
export function costBreakdown(
  p: { totals: PnL; daily: Pick<DayPnL, 'date' | 'fixedCosts'>[]; products: ProductPnL[] | null; range: DateRange },
  cfg: ProfitConfig | null,
): CostBreakdown {
  const t = p.totals
  const pct = (v: number) => (t.revenue > 0 ? (v / t.revenue) * 100 : null)
  const lines = costLines(t).map(l => ({ ...l, pctOfRevenue: pct(l.amount), perOrder: t.orders > 0 ? l.amount / t.orders : null }))
  const sections = Object.keys(SECTION_LABEL) as ConfigSection[]
  const bySection = sections.map(section => {
    const amount = lines.filter(l => l.section === section).reduce((s, l) => s + l.amount, 0)
    return { section, label: SECTION_LABEL[section], amount, pctOfRevenue: pct(amount) }
  })
  return {
    totalCost: t.variableCosts + t.fixedCosts,
    lines,
    bySection,
    extraCosts: cfg ? extraCostShares(cfg, t, p.daily) : [],
    coverage: cfg && p.products ? pricingCoverage(p.products, cfg, p.range) : null,
  }
}

// ─── Request window ───────────────────────────────────────────────────────────

/** Longest window the preview and the export price in one request. A year and
 *  a month: enough for "12 meses" and a year-on-year look, short enough that a
 *  typo in a date cannot ask the server to price five years of orders. */
export const MAX_WINDOW_DAYS = 400

export type WindowResult =
  | { ok: true; period: Period; range: DateRange }
  | { ok: false; issue: ConfigIssue }

/**
 * The dates a request asks for, resolved on the server in the store's
 * timezone (rolling windows are complete days ending yesterday). A preset by
 * name, or period "custom" with from/to. Absent → `fallback`.
 */
export function parseWindow(
  input: { period?: unknown; from?: unknown; to?: unknown },
  tz: string, fallback: Period = '30d', now: Date = new Date(),
): WindowResult {
  // A query string gives null for a missing parameter, a form gives ''.
  const given = (v: unknown) => (v === undefined || v === null || v === '' ? undefined : v)
  const [p, from, to] = [given(input.period), given(input.from), given(input.to)]
  if (p !== undefined && !isPeriod(p)) return { ok: false, issue: { path: 'period', message: 'Período inválido.' } }
  // Dates without a period name mean "these dates".
  const period: Period = isPeriod(p) ? p : from !== undefined || to !== undefined ? 'custom' : fallback
  if (period === 'custom') {
    if (!isIsoDate(from)) return { ok: false, issue: { path: 'from', message: MSG.date } }
    if (!isIsoDate(to)) return { ok: false, issue: { path: 'to', message: MSG.date } }
    if (from > to) return { ok: false, issue: { path: 'from', message: 'A data inicial é depois da final.' } }
  }
  const range = windowFor(period, tz, from as string | undefined, to as string | undefined, now)
  if (daysBetween(range.from, range.to) > MAX_WINDOW_DAYS) {
    return { ok: false, issue: { path: 'from', message: `Escolha um período de até ${MAX_WINDOW_DAYS} dias.` } }
  }
  return { ok: true, period, range }
}

// ─── API contract of /api/profit ──────────────────────────────────────────────
// Kept here, in a module with no server imports, so the cost screen can import
// the types (and run parseProfitConfig for instant field messages).

export interface ProfitStoreSummary {
  id: string
  /** Disambiguated name from lib/access ("Dumpling Squishy · 8jcp3a"). */
  name: string
  timezone: string
  archived: boolean
}

/** GET /api/profit?store=<id> */
export interface ProfitConfigResponse {
  store: ProfitStoreSummary
  /** False: no settings saved yet; `config` is then all defaults (zeros). */
  configured: boolean
  /** Send back as `baseVersion` when saving. */
  version: string
  /** The saved settings, every key present, broken entries dropped. */
  config: ProfitConfig
  /** Problems found in what is saved (the entries were left out of `config`). */
  issues: ConfigIssue[]
  warnings: ConfigIssue[]
}

/** POST /api/profit — price a draft without saving it. */
export interface ProfitPreviewRequest {
  /** Defaults to the store the site has selected. */
  storeId?: string
  /** Full or partial settings, merged onto the saved ones like a save would.
   *  Absent: the saved settings are priced. */
  config?: unknown
  /** Default '30d'. 'custom' needs from/to (YYYY-MM-DD). */
  period?: Period
  from?: string
  to?: string
}

export interface ProfitPreviewResponse {
  store: ProfitStoreSummary
  period: Period
  range: DateRange
  /** "18 out – 16 nov". */
  label: string
  /** The window includes the store's current day. */
  partial: boolean
  source: 'saved' | 'draft'
  /** False only when nothing is saved and no draft was sent: then costs are
   *  zero and "lucro" is revenue − ads ("custos não configurados"). */
  configured: boolean
  /** Version of the saved settings the draft was merged onto. */
  version: string
  /** Engine totals and day series (lib/engine PnL / DayPnL), as on every screen. */
  totals: PnL
  daily: DayPnL[]
  breakdown: CostBreakdown
  /** The draft changes something: the saved settings' result for the same
   *  window, for a "antes → depois" comparison. Null otherwise. */
  saved: { configured: boolean; totals: PnL } | null
  /** The draft differs from what is saved. Always false for source 'saved'. */
  changed: boolean
  /** Problems in the draft. The preview ignored those entries; a save would
   *  be refused until they are fixed. */
  issues: ConfigIssue[]
  warnings: ConfigIssue[]
}

/** PUT /api/profit */
export interface ProfitSaveRequest {
  storeId: string
  /** `version` from the GET (or the last save) this edit started from. */
  baseVersion: string
  /** Full or partial settings; what is absent keeps its saved value. */
  config: unknown
}

export interface ProfitSaveResponse {
  ok: true
  /** False when the settings were already exactly these (nothing written). */
  changed: boolean
  version: string
  configured: true
  config: ProfitConfig
  warnings: ConfigIssue[]
}

/** Every error of /api/profit: 400 malformed request, 401, 404 store not
 *  found (or not the viewer's), 409 saved settings changed since loaded (with
 *  the current `version`), 413 body too large, 422 invalid settings. */
export interface ProfitApiError {
  error: string
  /** Set when the refusal is not about a field: 'store_archived' (an archived
   *  store is for consultation only), as opposed to a 409 version conflict. */
  code?: string
  issues?: ConfigIssue[]
  warnings?: ConfigIssue[]
  version?: string
}

/** Refusal for a save that would leave a store with no cost at all. */
export const EMPTY_CONFIG_ISSUE: ConfigIssue = {
  path: '',
  message: 'A configuração ficaria sem nenhum custo, e a loja passaria a mostrar a receita inteira como lucro. ' +
    'Preencha pelo menos um custo antes de salvar.',
}
