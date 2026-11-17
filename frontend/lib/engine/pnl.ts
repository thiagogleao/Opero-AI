/**
 * The profit engine. One implementation for every screen.
 *
 * computePnL prices every order in a window once, for any number of stores, in
 * five queries, and returns the totals, the day-by-day series, the hours of a
 * single day, countries and products — all from the same per-order costs. That
 * is the point: a total that is the sum of its own days cannot disagree with
 * its daily chart, and a country table built from the same orders cannot
 * disagree with the store. Every earlier copy of this maths drifted from the
 * others (Shop Campaigns missing from the daily chart, countries priced at a
 * flat default, products at a third model), and each drift was a wrong number
 * on some screen.
 *
 * Definitions, used everywhere:
 *   revenue          Shopify total_price (USD) of orders not refunded/voided,
 *                    placed on the window's dates in the store's own timezone.
 *   variable costs   product cost + packaging + supplier fees − extra-unit
 *                    discount + shipping + Shopify/payment fees + per-order extras.
 *   contribution     revenue − variable costs (what is left to pay for ads).
 *   operatingProfit  contribution − Meta ads − Shopify ads − fixed costs.
 *                    This is the "lucro" headline.
 *   adjustments      refunds (the contribution they took back) + chargebacks
 *                    (full value) + chargeback fees, dated when they arrived.
 *   cashResult       operatingProfit − adjustments.
 *   breakEvenRoas    revenue / contribution: the Meta ROAS at which ads eat the
 *                    whole contribution. Fixed costs and Shopify ads are left
 *                    out on purpose: they do not scale with Meta spend.
 */

import { query } from '../db'
import {
  buildCogsLookups, fixedCostForDay, isConfigured, orderFees, orderSupplierCost,
  perOrderExtras, shippingCost, type CostItem, type ProfitConfig,
} from './costs'
import { daysBetween, eachDay, minutesIntoDay, safeTz, todayInTz, type DateRange } from './dates'

/** Any single ad-day above this is a Meta reporting glitch (one EPOCH ad
 *  reported a $183,000 purchase on $15 of spend), never a sale. */
export const PHANTOM_PURCHASE_VALUE = 20000

/** SQL for Meta purchase value / purchases with the phantom rows removed. */
export const purchaseValueSql = (col = 'purchase_value') =>
  `(CASE WHEN COALESCE(${col}, 0) > ${PHANTOM_PURCHASE_VALUE} THEN 0 ELSE COALESCE(${col}, 0) END)`
export const purchasesSql = (valueCol = 'purchase_value', countCol = 'purchases') =>
  `(CASE WHEN COALESCE(${valueCol}, 0) > ${PHANTOM_PURCHASE_VALUE} THEN 0 ELSE COALESCE(${countCol}, 0) END)`

/** Order statuses that never count as a sale. */
export const EXCLUDED_STATUSES = ['refunded', 'voided'] as const
export const KEPT_ORDER_SQL = `o.financial_status NOT IN ('refunded', 'voided')`

// ─── Types ────────────────────────────────────────────────────────────────────

export interface StoreInfo {
  id: string
  name: string
  domain: string | null
  timezone: string
  userId: string | null
  archived: boolean
}

/** The raw lines of a P&L. Costs are positive numbers. */
export interface PnLLines {
  revenue: number
  orders: number
  units: number
  cogs: number
  packaging: number
  supplierFees: number
  unitSavings: number
  shipping: number
  shopifyFees: number
  paymentFees: number
  perOrderExtras: number
  fixedCosts: number
  metaSpend: number
  shopSpend: number
  metaPurchaseValue: number
  metaPurchases: number
  refundGross: number
  refundCount: number
  refunds: number
  chargebacks: number
  chargebackFees: number
  chargebackCount: number
}

export interface PnL extends PnLLines {
  /** cogs + packaging + supplierFees − unitSavings. What the supplier bills. */
  productCost: number
  fees: number
  variableCosts: number
  contribution: number
  adSpend: number
  operatingProfit: number
  adjustments: number
  cashResult: number
  /** operatingProfit / revenue, in % (null without revenue). */
  margin: number | null
  contributionMargin: number | null
  breakEvenRoas: number | null
  /** Store revenue / Meta spend. */
  roas: number | null
  /** Meta-reported purchase value / Meta spend. */
  metaRoas: number | null
  profitPerOrder: number | null
}

export interface DayPnL extends PnL { date: string }

export interface HourPoint {
  hour: number
  revenue: number
  orders: number
  contribution: number
  /** Cumulative operating profit through the end of this hour, with the day's
   *  ad spend and fixed costs spread evenly over the hours covered. */
  cumProfit: number
  cumRevenue: number
}

export interface CountryPnL {
  country: string
  revenue: number
  orders: number
  variableCosts: number
  contribution: number
  /** What Meta's country breakdown attributes; unreliable, see CLAUDE.md. */
  metaSpend: number
  metaPurchaseValue: number
}

export interface ProductPnL {
  key: string
  productId: string | null
  title: string
  units: number
  orders: number
  /** The order's total spread over its lines by line value, so products add
   *  up to the store's revenue exactly (shipping and tax ride along). */
  revenue: number
  variableCosts: number
  contribution: number
}

export interface StorePnL {
  store: StoreInfo
  configured: boolean
  range: DateRange
  /** True when the window includes the store's current day. */
  partial: boolean
  /** Minutes into the store's day when partial (else 1440). */
  minutesCovered: number
  /** When cut at a time of day for a fair comparison: minutes into that day. */
  cutoffMinutes: number | null
  totals: PnL
  daily: DayPnL[]
  /** Only for single-day windows. */
  hourly: HourPoint[] | null
  countries: CountryPnL[] | null
  products: ProductPnL[] | null
}

export interface PnLOptions {
  /** Price these stores with a draft config instead of the saved one. */
  configOverride?: Record<string, ProfitConfig>
  /** Single-day windows only: keep orders up to this local minute of the day,
   *  and prorate that day's ad spend and fixed costs to the same share. Used to
   *  compare "today until now" with "yesterday until the same time". */
  cutoffMinutes?: Record<string, number | null>
  countries?: boolean
  products?: boolean
}

// ─── Helpers ──────────────────────────────────────────────────────────────────

function emptyLines(): PnLLines {
  return {
    revenue: 0, orders: 0, units: 0, cogs: 0, packaging: 0, supplierFees: 0, unitSavings: 0,
    shipping: 0, shopifyFees: 0, paymentFees: 0, perOrderExtras: 0, fixedCosts: 0,
    metaSpend: 0, shopSpend: 0, metaPurchaseValue: 0, metaPurchases: 0,
    refundGross: 0, refundCount: 0, refunds: 0, chargebacks: 0, chargebackFees: 0, chargebackCount: 0,
  }
}

const LINE_KEYS = Object.keys(emptyLines()) as (keyof PnLLines)[]

export function addLines(a: PnLLines, b: PnLLines): PnLLines {
  const out = emptyLines()
  for (const k of LINE_KEYS) out[k] = a[k] + b[k]
  return out
}

const ratio = (a: number, b: number): number | null => (b > 0 ? a / b : null)

/** Derived figures from raw lines. The only place these formulas live. */
export function derive(l: PnLLines): PnL {
  const productCost = l.cogs + l.packaging + l.supplierFees - l.unitSavings
  const fees = l.shopifyFees + l.paymentFees
  const variableCosts = productCost + l.shipping + fees + l.perOrderExtras
  const contribution = l.revenue - variableCosts
  const adSpend = l.metaSpend + l.shopSpend
  const operatingProfit = contribution - l.metaSpend - l.shopSpend - l.fixedCosts
  const adjustments = l.refunds + l.chargebacks + l.chargebackFees
  const margin = ratio(operatingProfit, l.revenue)
  const cm = ratio(contribution, l.revenue)
  return {
    ...l,
    productCost, fees, variableCosts, contribution, adSpend, operatingProfit, adjustments,
    cashResult: operatingProfit - adjustments,
    margin: margin === null ? null : margin * 100,
    contributionMargin: cm === null ? null : cm * 100,
    breakEvenRoas: contribution > 0 ? l.revenue / contribution : null,
    roas: ratio(l.revenue, l.metaSpend),
    metaRoas: ratio(l.metaPurchaseValue, l.metaSpend),
    profitPerOrder: l.orders > 0 ? operatingProfit / l.orders : null,
  }
}

export function sumPnL(items: PnLLines[]): PnL {
  return derive(items.reduce((acc, x) => addLines(acc, x), emptyLines()))
}

/** Should a dispute in this status count against profit? Everything except a
 *  won dispute does, which is how the books have been kept so far. */
export function chargebackCounts(status: string | null): boolean {
  return status !== 'won'
}

// ─── Loading ──────────────────────────────────────────────────────────────────

interface StoreRow {
  id: string; shop_name: string | null; shopify_domain: string | null; timezone: string | null
  user_id: string | null; archived: boolean; settings: ProfitConfig | null
}

interface OrderRow {
  tenant_id: string; order_id: string; total: number; country_code: string | null
  d: string; h: number; mins: number
  items: { p: string | null; t: string | null; u: number | null; v: number | null }[]
}

interface DayValueRow { tenant_id: string; d: string; spend: number; pv?: number; pc?: number }

interface AdjRow {
  tenant_id: string; kind: string; event_date: string; amount: number; fee: number | null
  currency: string | null; status: string | null; order_status: string | null
  order_currency: string | null; fx_rate: number | null; order_known: boolean
}

export async function loadStores(ids: string[]): Promise<StoreRow[]> {
  if (!ids.length) return []
  return query<StoreRow>(
    `SELECT t.id, t.shop_name, t.shopify_domain, t.timezone, t.user_id,
            (t.archived_at IS NOT NULL) AS archived, p.settings
       FROM tenants t
       LEFT JOIN profit_settings p ON p.tenant_id = t.id
      WHERE t.id = ANY($1::text[])`,
    [ids],
  )
}

/** Orders in [from, to] on each store's own calendar, items attached. The
 *  coarse created_at bound (±2 days) lets the index do the work; the exact
 *  per-timezone date filter runs on what is left. */
async function loadOrders(ids: string[], from: string, to: string): Promise<OrderRow[]> {
  return query<OrderRow>(
    `SELECT o.tenant_id, o.order_id, o.total_price::float8 AS total, o.country_code,
            (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date::text AS d,
            EXTRACT(HOUR FROM (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC')))::int AS h,
            (EXTRACT(HOUR FROM (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))) * 60
             + EXTRACT(MINUTE FROM (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))))::int AS mins,
            COALESCE(
              (SELECT json_agg(json_build_object('p', oi.product_id, 't', oi.product_title,
                                                 'u', oi.quantity, 'v', oi.price) ORDER BY oi.id)
                 FROM shopify_order_items oi
                WHERE oi.order_id = o.order_id
                  AND (oi.tenant_id IS NULL OR oi.tenant_id = o.tenant_id)),
              '[]'::json) AS items
       FROM shopify_orders o
       JOIN tenants t ON t.id = o.tenant_id
      WHERE o.tenant_id = ANY($1::text[])
        AND o.created_at >= ($2::date - 2)::timestamptz
        AND o.created_at <  ($3::date + 3)::timestamptz
        AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date BETWEEN $2::date AND $3::date
        AND ${KEPT_ORDER_SQL}`,
    [ids, from, to],
  )
}

async function loadMeta(ids: string[], from: string, to: string): Promise<DayValueRow[]> {
  return query<DayValueRow>(
    `SELECT tenant_id, date::text AS d,
            COALESCE(SUM(spend), 0)::float8 AS spend,
            COALESCE(SUM(${purchaseValueSql()}), 0)::float8 AS pv,
            COALESCE(SUM(${purchasesSql()}), 0)::float8 AS pc
       FROM fb_ad_daily_metrics
      WHERE tenant_id = ANY($1::text[]) AND date BETWEEN $2::date AND $3::date
      GROUP BY 1, 2`,
    [ids, from, to],
  )
}

async function loadShopCampaigns(ids: string[], from: string, to: string): Promise<DayValueRow[]> {
  return query<DayValueRow>(
    `SELECT tenant_id, date::text AS d, COALESCE(SUM(spend), 0)::float8 AS spend
       FROM shop_campaign_daily
      WHERE tenant_id = ANY($1::text[]) AND date BETWEEN $2::date AND $3::date
      GROUP BY 1, 2`,
    [ids, from, to],
  ).catch(() => [])
}

async function loadAdjustments(ids: string[], from: string, to: string): Promise<AdjRow[]> {
  return query<AdjRow>(
    `SELECT a.tenant_id, a.kind, a.event_date::text AS event_date, a.amount::float8 AS amount,
            a.fee::float8 AS fee, a.currency, a.status,
            o.financial_status AS order_status, o.currency AS order_currency,
            o.fx_rate::float8 AS fx_rate, (o.order_id IS NOT NULL) AS order_known
       FROM order_adjustments a
       LEFT JOIN shopify_orders o ON o.order_id = a.order_id AND o.tenant_id = a.tenant_id
      WHERE a.tenant_id = ANY($1::text[]) AND a.event_date BETWEEN $2::date AND $3::date`,
    [ids, from, to],
  ).catch(() => [])
}

async function loadCountrySpend(ids: string[], from: string, to: string) {
  return query<{ tenant_id: string; country: string; spend: number; pv: number }>(
    `SELECT tenant_id, breakdown_value AS country,
            COALESCE(SUM(spend), 0)::float8 AS spend,
            COALESCE(SUM(${purchaseValueSql()}), 0)::float8 AS pv
       FROM fb_ad_breakdowns
      WHERE tenant_id = ANY($1::text[]) AND breakdown_type = 'country'
        AND date BETWEEN $2::date AND $3::date
      GROUP BY 1, 2`,
    [ids, from, to],
  ).catch(() => [])
}

/** USD value of an adjustment. Every row so far is in USD; a shop-currency row
 *  (the yen store) is converted with the rate stored on its order. */
function adjustmentUsd(r: AdjRow): number {
  const amount = Number(r.amount) || 0
  if (!r.currency || r.currency === 'USD') return amount
  if (r.fx_rate && r.order_currency === r.currency) return amount * r.fx_rate
  // No rate we can trust: refuse to subtract yen as dollars.
  return 0
}

// ─── Computing ────────────────────────────────────────────────────────────────

interface PricedOrder {
  date: string; hour: number; mins: number; country: string; revenue: number; units: number
  lines: PnLLines
  items: { key: string; productId: string | null; title: string; units: number; revenue: number; cost: number }[]
}

function priceOrder(o: OrderRow, cfg: ProfitConfig | null, lookups: ReturnType<typeof buildCogsLookups> | null, extras: number): PricedOrder {
  const raw = Array.isArray(o.items) ? o.items : []
  const items: CostItem[] = raw.length
    ? raw.map(i => ({ product_id: i.p ?? null, product_title: i.t ?? null, units: Math.max(0, Number(i.u ?? 1)) }))
    : [{ product_id: null, product_title: null, units: 1 }]
  const revenue = Number(o.total) || 0
  const units = items.reduce((s, i) => s + i.units, 0)
  const lines = emptyLines()
  lines.revenue = revenue
  lines.orders = 1
  lines.units = units

  // Spread the order total over its lines by line value (units when no price).
  const lineValues = raw.length ? raw.map(i => Math.max(0, Number(i.v ?? 0)) * Math.max(0, Number(i.u ?? 1))) : [1]
  const valueSum = lineValues.reduce((s, v) => s + v, 0)
  const share = (k: number) => valueSum > 0 ? lineValues[k] / valueSum : (units > 0 ? items[k].units / units : 1 / items.length)

  let perItemCost = items.map(() => 0)
  if (cfg && lookups) {
    const sup = orderSupplierCost({ country_code: o.country_code, order_date: o.d, items }, lookups, cfg)
    const fees = orderFees(revenue, cfg)
    lines.cogs = sup.cogs
    lines.packaging = sup.packaging
    lines.supplierFees = sup.orderFee
    lines.unitSavings = sup.saving
    lines.shipping = shippingCost(o.country_code, cfg)
    lines.shopifyFees = fees.shopify
    lines.paymentFees = fees.payment
    lines.perOrderExtras = extras
    // Order-level costs other than the supplier's ride on line value.
    const orderLevel = lines.shipping + fees.shopify + fees.payment + extras
    perItemCost = items.map((_, k) => (sup.perItem[k] ?? 0) + orderLevel * share(k))
  }

  return {
    date: o.d, hour: o.h, mins: o.mins, country: o.country_code || '??', revenue, units, lines,
    items: items.map((it, k) => ({
      key: it.product_id || `t:${it.product_title ?? '—'}`,
      productId: it.product_id,
      title: it.product_title || 'Sem produto',
      units: it.units,
      revenue: revenue * share(k),
      cost: perItemCost[k],
    })),
  }
}

/**
 * Price `storeIds` over [from, to] (same calendar dates, each store in its own
 * timezone). Unknown ids are skipped. Stores with no cost settings still get
 * revenue, orders and ad spend; their costs are zero and `configured` is false,
 * so their "profit" is revenue − ads and the screen must say so.
 */
export async function computePnL(
  storeIds: string[], range: DateRange, opts: PnLOptions = {}, now: Date = new Date(),
): Promise<Map<string, StorePnL>> {
  const ids = [...new Set(storeIds)].filter(Boolean)
  const out = new Map<string, StorePnL>()
  if (!ids.length) return out
  const { from, to } = range

  const [stores, orders, meta, shop, adjs, countrySpend] = await Promise.all([
    loadStores(ids),
    loadOrders(ids, from, to),
    loadMeta(ids, from, to),
    loadShopCampaigns(ids, from, to),
    loadAdjustments(ids, from, to),
    opts.countries ? loadCountrySpend(ids, from, to) : Promise.resolve([]),
  ])

  const days = eachDay(from, to)
  const single = from === to

  for (const s of stores) {
    const tz = safeTz(s.timezone)
    const cfg = opts.configOverride?.[s.id] ?? s.settings
    const configured = isConfigured(cfg)
    const lookups = configured ? buildCogsLookups(cfg) : null
    const extras = configured ? perOrderExtras(cfg) : 0
    const storeToday = todayInTz(tz, now)
    const partial = to >= storeToday && from <= storeToday
    const minutesCovered = partial ? Math.max(1, minutesIntoDay(tz, now)) : 1440
    const cutoff = single ? (opts.cutoffMinutes?.[s.id] ?? null) : null

    // Day buckets, every date of the window present.
    const dayLines = new Map<string, PnLLines>(days.map(d => [d, emptyLines()]))
    const hourLines = single ? Array.from({ length: 24 }, () => ({ revenue: 0, orders: 0, contribution: 0 })) : null
    const countryMap = opts.countries ? new Map<string, CountryPnL>() : null
    const productMap = opts.products ? new Map<string, ProductPnL & { orderSet: Set<string> }>() : null

    for (const o of orders) {
      if (o.tenant_id !== s.id) continue
      if (cutoff !== null && o.mins > cutoff) continue
      const p = priceOrder(o, configured ? cfg : null, lookups, extras)
      const bucket = dayLines.get(p.date)
      if (!bucket) continue
      dayLines.set(p.date, addLines(bucket, p.lines))
      const variable = derive(p.lines).variableCosts
      if (hourLines && p.hour >= 0 && p.hour < 24) {
        hourLines[p.hour].revenue += p.revenue
        hourLines[p.hour].orders += 1
        hourLines[p.hour].contribution += p.revenue - variable
      }
      if (countryMap) {
        const c = countryMap.get(p.country) ?? { country: p.country, revenue: 0, orders: 0, variableCosts: 0, contribution: 0, metaSpend: 0, metaPurchaseValue: 0 }
        c.revenue += p.revenue; c.orders += 1; c.variableCosts += variable; c.contribution += p.revenue - variable
        countryMap.set(p.country, c)
      }
      if (productMap) {
        for (const it of p.items) {
          const r = productMap.get(it.key) ?? { key: it.key, productId: it.productId, title: it.title, units: 0, orders: 0, revenue: 0, variableCosts: 0, contribution: 0, orderSet: new Set<string>() }
          r.units += it.units; r.revenue += it.revenue; r.variableCosts += it.cost; r.contribution += it.revenue - it.cost
          if (!r.orderSet.has(o.order_id)) { r.orderSet.add(o.order_id); r.orders += 1 }
          productMap.set(it.key, r)
        }
      }
    }

    // Ad spend and Meta's own purchase figures, by day.
    const share = cutoff !== null ? Math.min(1, cutoff / 1440) : 1
    for (const m of meta) {
      if (m.tenant_id !== s.id) continue
      const b = dayLines.get(m.d); if (!b) continue
      // A cut day keeps the share of spend that matches the share of the day;
      // Meta only reports whole days.
      b.metaSpend += m.spend * share
      b.metaPurchaseValue += (m.pv ?? 0) * share
      b.metaPurchases += (m.pc ?? 0) * share
    }
    for (const r of shop) {
      if (r.tenant_id !== s.id) continue
      const b = dayLines.get(r.d); if (!b) continue
      b.shopSpend += r.spend * share
    }
    if (configured) {
      for (const d of days) {
        const b = dayLines.get(d)!
        // Fixed costs accrue with the clock: today carries only the part of
        // the day that has passed.
        const elapsed = d > storeToday ? 0 : d === storeToday ? minutesCovered / 1440 : 1
        b.fixedCosts += fixedCostForDay(d, cfg) * Math.min(elapsed, share)
      }
    }

    // Refunds and chargebacks, on the day they arrived. A refund is charged at
    // the window's contribution margin (1 for a store with no cost settings).
    const storeAdjs = adjs.filter(a => a.tenant_id === s.id)
    const periodCm = (() => { const t = sumPnL([...dayLines.values()]); return t.revenue > 0 ? t.contribution / t.revenue : 1 })()
    for (const a of storeAdjs) {
      const b = dayLines.get(a.event_date); if (!b) continue
      if (cutoff !== null) continue // a cut comparison is about sales, not about disputes
      const usd = adjustmentUsd(a)
      if (a.kind === 'refund') {
        // A fully refunded order we hold was already dropped from the day it
        // was placed, wherever that day is; subtracting its refund too would
        // charge the same loss twice.
        if (a.order_known && a.order_status === 'refunded') continue
        b.refundGross += usd
        b.refundCount += 1
        // A refund takes back the order's contribution: the product and the
        // shipping return with the sale, the ads already spent do not.
        b.refunds += usd * Math.max(0, Math.min(1, periodCm))
      } else if (a.kind === 'chargeback' && chargebackCounts(a.status)) {
        b.chargebacks += usd
        b.chargebackFees += Number(a.fee) || 0
        b.chargebackCount += 1
      }
    }

    const daily: DayPnL[] = days.map(d => ({ date: d, ...derive(dayLines.get(d)!) }))
    const totals = sumPnL(daily)

    let hourly: HourPoint[] | null = null
    if (hourLines) {
      const day = days[0]
      const hoursCovered = cutoff !== null ? Math.max(1, Math.ceil(cutoff / 60))
        : day === storeToday ? Math.max(1, Math.ceil(minutesCovered / 60)) : 24
      const burn = totals.metaSpend + totals.shopSpend + totals.fixedCosts
      let cumC = 0, cumR = 0
      hourly = []
      for (let h = 0; h < hoursCovered; h++) {
        cumC += hourLines[h].contribution
        cumR += hourLines[h].revenue
        hourly.push({
          hour: h, revenue: hourLines[h].revenue, orders: hourLines[h].orders,
          contribution: hourLines[h].contribution,
          cumRevenue: cumR,
          cumProfit: cumC - burn * ((h + 1) / hoursCovered),
        })
      }
    }

    let countries: CountryPnL[] | null = null
    if (countryMap) {
      for (const c of countrySpend) {
        if (c.tenant_id !== s.id) continue
        const key = c.country || '??'
        const row = countryMap.get(key) ?? { country: key, revenue: 0, orders: 0, variableCosts: 0, contribution: 0, metaSpend: 0, metaPurchaseValue: 0 }
        row.metaSpend += c.spend; row.metaPurchaseValue += c.pv
        countryMap.set(key, row)
      }
      countries = [...countryMap.values()].sort((a, b) => b.revenue - a.revenue || b.metaSpend - a.metaSpend)
    }

    let products: ProductPnL[] | null = null
    if (productMap) {
      products = [...productMap.values()]
        .map(({ orderSet: _o, ...r }) => r)
        .sort((a, b) => b.revenue - a.revenue)
    }

    out.set(s.id, {
      store: {
        id: s.id, name: s.shop_name || s.shopify_domain || s.id, domain: s.shopify_domain,
        timezone: tz, userId: s.user_id, archived: !!s.archived,
      },
      configured, range: { from, to }, partial, minutesCovered: partial ? minutesCovered : 1440,
      cutoffMinutes: cutoff,
      totals, daily, hourly, countries, products,
    })
  }
  return out
}

/** One store, one window. */
export async function computeStorePnL(storeId: string, range: DateRange, opts: PnLOptions = {}, now?: Date): Promise<StorePnL | null> {
  const m = await computePnL([storeId], range, opts, now)
  return m.get(storeId) ?? null
}

/**
 * "Today until now" against "yesterday until the same time", per store on its
 * own clock. A store whose day is already over (Tokyo, seen from Brazil in the
 * afternoon) is compared whole day against whole day.
 */
export async function computeSameTimeComparison(
  storeIds: string[], day: string, now: Date = new Date(),
): Promise<Map<string, StorePnL>> {
  const stores = await loadStores(storeIds)
  const cut: Record<string, number | null> = {}
  for (const s of stores) {
    const tz = safeTz(s.timezone)
    const storeToday = todayInTz(tz, now)
    // The comparison day is the day before `day`; it is cut only when `day`
    // is the store's current day.
    cut[s.id] = storeToday === day ? minutesIntoDay(tz, now) : null
  }
  const prev = new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
  return computePnL(storeIds, { from: prev, to: prev }, { cutoffMinutes: cut }, now)
}

export { daysBetween }
