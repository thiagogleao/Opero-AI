/**
 * Products, from the profit engine.
 *
 * Revenue, costs and contribution per product come from computePnL's own
 * per-order pass (opts.products): the order total is spread over its lines by
 * line value, and each line carries the supplier cost the engine computed for
 * it plus its share of the order-level costs. So the product table adds up to
 * the store — revenue, variable costs and contribution — to the cent. The two
 * earlier tables each had a private cost model (one charged packaging and
 * shipping once per product row, one ignored rate cards and declared-free
 * items) and pre-discount line prices, and neither reconciled with anything.
 *
 * Meta spend is NOT spread by revenue share (that gave every product the same
 * ROAS). The optional column is the spend of the ads that our own journey data
 * links to the product's orders: an ad's spend in the window is divided over
 * the orders it is credited with (by credited revenue), and each order's part
 * over its lines by line value. Spend on ads that no order of the window links
 * back to stays unallocated and is reported as such.
 */

import { query } from '../db'
import { computeStorePnL, type PnL } from '../engine/pnl'
import { isIsoDate, type DateRange } from '../engine/dates'
import { accountCreditsSql } from '../attribution'
import type { Model } from '../attributionModels'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface ProductRow {
  /** The engine's key: the Shopify product id, or "t:<title>" for lines that
   *  carry no product id. */
  key: string
  productId: string | null
  /** The catalogue title when the product is known, else the line's title. */
  title: string
  imageUrl: string | null
  units: number
  /** Orders containing the product. */
  orders: number
  /** The order totals spread over their lines by line value. Products add up
   *  to the store's revenue exactly: discounts, shipping charged and tax ride
   *  along in proportion. Not the list price × quantity. */
  revenue: number
  /** % of the store's revenue. */
  revenueShare: number | null
  /** Product cost + its share of packaging, supplier fees, shipping, Shopify
   *  and payment fees and per-order extras — the engine's variable costs. */
  variableCosts: number
  /** revenue − variableCosts: what the product leaves to pay for ads. */
  contribution: number
  /** contribution / revenue, in %. */
  contributionMargin: number | null
  /** "Gasto Meta atribuído pela jornada": spend of the ads the journeys link to
   *  this product's orders. An attribution, not the books. */
  attributedSpend: number
  /** contribution − attributedSpend. */
  contributionAfterAttributedSpend: number
}

export interface ProductAttribution {
  model: Model
  label: string
  note: string
  /** Sum of the products' attributedSpend. */
  attributedSpend: number
  /** Part of attributedSpend billed in another store's ad account (CAMP
   *  HALLOW's ads run in EPOCH's account). Not in this store's books. */
  billedElsewhere: number
  /** This store's own Meta spend that went to ads crediting orders of other
   *  stores of the same login. In the books here, attributed there. */
  ownSpendCreditedElsewhere: number
  /** ownSpendCreditedElsewhere by the store whose orders the ads credit, most
   *  spend first (EPOCH's October: $15.203 to CAMP HALLOW). Ids only: the
   *  caller names the stores its viewer may see. Always set by
   *  getProductReport; optional only so older fixtures still type-check. */
  ownSpendCreditedElsewhereByStore?: { storeId: string; spend: number }[]
  /** This store's own Meta spend on ads that no order of the window links back
   *  to. In the books, attributed to no product. */
  unlinkedSpend: number
}

export interface ProductReport {
  storeId: string
  range: DateRange
  /** False: the store has no cost settings; costs are zero and contribution
   *  equals revenue. Say "custos não configurados". */
  configured: boolean
  /** The store's P&L for the same window (engine definitions). The products'
   *  revenue, variableCosts and contribution sum to these totals. */
  totals: PnL
  products: ProductRow[]
  attribution: ProductAttribution
}

// ─── Pure helpers (exported for the tests) ────────────────────────────────────

export interface LineItem { productId: string | null; title: string | null; units: number | null; price: number | null }

/** The engine's product key for a line. */
export function productKey(productId: string | null, title: string | null): string {
  return productId || `t:${title ?? '—'}`
}

/**
 * Each line's share of its order, the way the engine spreads an order's total
 * (lib/engine/pnl.ts priceOrder): by line value (price × units), by units when
 * no line has a price, evenly as a last resort. An order with no lines is one
 * line of an unknown product.
 */
export function lineShares(items: LineItem[]): { key: string; share: number }[] {
  if (!items.length) return [{ key: productKey(null, null), share: 1 }]
  const units = items.map(i => Math.max(0, Number(i.units ?? 1)))
  const values = items.map((i, k) => Math.max(0, Number(i.price ?? 0)) * units[k])
  const valueSum = values.reduce((s, v) => s + v, 0)
  const unitSum = units.reduce((s, u) => s + u, 0)
  return items.map((i, k) => ({
    key: productKey(i.productId, i.title),
    share: valueSum > 0 ? values[k] / valueSum : unitSum > 0 ? units[k] / unitSum : 1 / items.length,
  }))
}

export interface CreditRow { storeId: string; orderId: string; adId: string; weight: number; revenue: number }
export interface AdSpendRow { adId: string; adStoreId: string; spend: number }

export interface SpendAllocation {
  /** This store's orders: the spend linked to each, and the part of it billed
   *  in another store's account. */
  perOrder: Map<string, { spend: number; billedElsewhere: number }>
  ownAllocatedHere: number
  ownAllocatedSiblings: number
  /** ownAllocatedSiblings by the sibling store credited. */
  ownAllocatedBySibling: Map<string, number>
  siblingAllocatedHere: number
}

/**
 * Divide each ad's spend over the orders it is credited with, across the
 * stores of one login. An order's share is its credited revenue over the ad's
 * credited revenue (by credit weight when every credited order is free).
 */
export function allocateAdSpend(credits: CreditRow[], spend: AdSpendRow[], storeId: string): SpendAllocation {
  const byAd = new Map<string, CreditRow[]>()
  for (const c of credits) {
    const list = byAd.get(c.adId) ?? []
    list.push(c)
    byAd.set(c.adId, list)
  }
  const out: SpendAllocation = { perOrder: new Map(), ownAllocatedHere: 0, ownAllocatedSiblings: 0, ownAllocatedBySibling: new Map(), siblingAllocatedHere: 0 }
  for (const s of spend) {
    const rows = byAd.get(s.adId)
    if (!rows?.length || !(s.spend > 0)) continue
    const revBasis = rows.reduce((a, r) => a + Math.max(0, r.revenue), 0)
    const wBasis = rows.reduce((a, r) => a + Math.max(0, r.weight), 0)
    for (const r of rows) {
      const share = revBasis > 0 ? Math.max(0, r.revenue) / revBasis : wBasis > 0 ? Math.max(0, r.weight) / wBasis : 1 / rows.length
      const amount = s.spend * share
      const own = s.adStoreId === storeId
      if (r.storeId === storeId) {
        const o = out.perOrder.get(r.orderId) ?? { spend: 0, billedElsewhere: 0 }
        o.spend += amount
        if (!own) o.billedElsewhere += amount
        out.perOrder.set(r.orderId, o)
        if (own) out.ownAllocatedHere += amount
        else out.siblingAllocatedHere += amount
      } else if (own) {
        out.ownAllocatedSiblings += amount
        out.ownAllocatedBySibling.set(r.storeId, (out.ownAllocatedBySibling.get(r.storeId) ?? 0) + amount)
      }
    }
  }
  return out
}

// ─── Loading ──────────────────────────────────────────────────────────────────

const pct = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null)

async function loadCredits(storeId: string, range: DateRange, model: Model): Promise<{ credits: CreditRow[]; spend: AdSpendRow[] }> {
  const params = [storeId, range.from, range.to]
  const [credits, spend] = await Promise.all([
    query<{ tenant_id: string; order_id: string; ad_id: string; weight: number; revenue: number }>(
      `WITH ${accountCreditsSql(model)}
       SELECT tenant_id, order_id, ad_id, weight::float8 AS weight, revenue::float8 AS revenue FROM credits`,
      params),
    // Spend of every credited ad, under whichever store of the login runs it.
    query<{ ad_id: string; tenant_id: string; spend: number }>(
      `WITH ${accountCreditsSql(model)}
       SELECT m.ad_id, m.tenant_id, SUM(m.spend)::float8 AS spend
         FROM fb_ad_daily_metrics m
         JOIN acct a ON a.id = m.tenant_id
        WHERE m.date BETWEEN $2::date AND $3::date
          AND m.ad_id IN (SELECT ad_id FROM credits)
        GROUP BY 1, 2`,
      params),
  ])
  return {
    credits: credits.map(r => ({ storeId: r.tenant_id, orderId: r.order_id, adId: r.ad_id, weight: Number(r.weight) || 0, revenue: Number(r.revenue) || 0 })),
    spend: spend.map(r => ({ adId: r.ad_id, adStoreId: r.tenant_id, spend: Number(r.spend) || 0 })),
  }
}

/** Lines of some orders of one store, as the engine reads them. */
async function loadLines(storeId: string, orderIds: string[]): Promise<Map<string, LineItem[]>> {
  const out = new Map<string, LineItem[]>()
  if (!orderIds.length) return out
  const rows = await query<{ order_id: string; p: string | null; t: string | null; u: number | null; v: number | null }>(
    `SELECT oi.order_id, oi.product_id AS p, oi.product_title AS t, oi.quantity AS u, oi.price::float8 AS v
       FROM shopify_order_items oi
       JOIN shopify_orders o ON o.order_id = oi.order_id
      WHERE o.tenant_id = $1 AND oi.order_id = ANY($2::text[])
        AND (oi.tenant_id IS NULL OR oi.tenant_id = o.tenant_id)
      ORDER BY oi.order_id, oi.id`,
    [storeId, orderIds],
  )
  for (const r of rows) {
    const list = out.get(r.order_id) ?? []
    list.push({ productId: r.p, title: r.t, units: r.u, price: r.v === null ? null : Number(r.v) })
    out.set(r.order_id, list)
  }
  return out
}

async function loadCatalogue(storeId: string, ids: string[]): Promise<Map<string, { title: string | null; imageUrl: string | null }>> {
  if (!ids.length) return new Map()
  const rows = await query<{ product_id: string; title: string | null; image_url: string | null }>(
    `SELECT product_id, title, image_url FROM shopify_products WHERE tenant_id = $1 AND product_id = ANY($2::text[])`,
    [storeId, ids],
  )
  return new Map(rows.map(r => [r.product_id, { title: r.title, imageUrl: r.image_url }]))
}

export const ATTRIBUTED_SPEND_LABEL = 'Gasto Meta atribuído pela jornada'

/**
 * Every product the store sold in the window, most revenue first.
 * `model` picks the journey credit rule for the attributed-spend column.
 */
export async function getProductReport(
  store: { id: string }, range: DateRange, opts: { model?: Model } = {},
): Promise<ProductReport | null> {
  if (!isIsoDate(range.from) || !isIsoDate(range.to) || range.from > range.to) {
    throw new RangeError(`invalid range ${range.from}..${range.to}`)
  }
  const model = opts.model ?? 'first'
  const [pnl, journey] = await Promise.all([
    computeStorePnL(store.id, range, { products: true }),
    loadCredits(store.id, range, model),
  ])
  if (!pnl) return null

  const alloc = allocateAdSpend(journey.credits, journey.spend, store.id)
  const lines = await loadLines(store.id, [...alloc.perOrder.keys()])
  const spendByKey = new Map<string, number>()
  for (const [orderId, o] of alloc.perOrder) {
    for (const { key, share } of lineShares(lines.get(orderId) ?? [])) {
      spendByKey.set(key, (spendByKey.get(key) ?? 0) + o.spend * share)
    }
  }

  const engineProducts = pnl.products ?? []
  const catalogue = await loadCatalogue(store.id, engineProducts.map(p => p.productId).filter((x): x is string => !!x))
  const storeRevenue = pnl.totals.revenue

  const products: ProductRow[] = engineProducts.map(p => {
    const cat = p.productId ? catalogue.get(p.productId) : undefined
    const attributedSpend = spendByKey.get(p.key) ?? 0
    return {
      key: p.key,
      productId: p.productId,
      title: cat?.title || p.title,
      imageUrl: cat?.imageUrl ?? null,
      units: p.units,
      orders: p.orders,
      revenue: p.revenue,
      revenueShare: pct(p.revenue, storeRevenue),
      variableCosts: p.variableCosts,
      contribution: p.contribution,
      contributionMargin: pct(p.contribution, p.revenue),
      attributedSpend,
      contributionAfterAttributedSpend: p.contribution - attributedSpend,
    }
  })

  const attributedSpend = products.reduce((s, p) => s + p.attributedSpend, 0)
  const billedElsewhere = [...alloc.perOrder.values()].reduce((s, o) => s + o.billedElsewhere, 0)
  return {
    storeId: store.id,
    range,
    configured: pnl.configured,
    totals: pnl.totals,
    products,
    attribution: {
      model,
      label: ATTRIBUTED_SPEND_LABEL,
      note:
        'Gasto dos anúncios que a jornada registrada pela Shopify liga aos pedidos de cada produto ' +
        '(dividido pela receita creditada a cada pedido e, no pedido, pelo valor de cada item). ' +
        'É uma atribuição, não a contabilidade: o gasto de anúncios sem pedido ligado no período fica fora dos produtos.',
      attributedSpend,
      billedElsewhere,
      ownSpendCreditedElsewhere: alloc.ownAllocatedSiblings,
      ownSpendCreditedElsewhereByStore: [...alloc.ownAllocatedBySibling]
        .map(([storeId, spend]) => ({ storeId, spend }))
        .sort((a, b) => b.spend - a.spend),
      unlinkedSpend: Math.max(0, pnl.totals.metaSpend - alloc.ownAllocatedHere - alloc.ownAllocatedSiblings),
    },
  }
}
