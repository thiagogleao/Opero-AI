/**
 * New, returning and guest orders, and lifetime value — from shopify_orders.
 *
 * Definitions (CLAUDE.md): an order is "new" when it is the customer's first
 * order in the store's collected history — row_number() over the customer's
 * orders by time, across all history, never relative to the window's start
 * (the old rule made a customer's second order of the month "new" again).
 * Orders without a customer (guest checkout) are their own bucket rather than
 * being counted as returning. Refunded and voided orders are not purchases, as
 * in the profit engine, so new + returning + guest = the engine's order count
 * and their revenue sums to the engine's revenue.
 *
 * Lifetime value is counted from the orders themselves. The stored
 * shopify_customers.orders_count is overwritten by the collector with the count
 * of the current sync batch and undercounts repeat customers about sixfold.
 *
 * "History" is what Opero has collected, which starts at `historyStart`: a
 * customer who bought before that is "new" on their first collected order.
 */

import { query } from '../db'
import { KEPT_ORDER_SQL } from '../engine/pnl'
import { isIsoDate, type DateRange } from '../engine/dates'

// ─── Types ────────────────────────────────────────────────────────────────────

export interface CustomerDay {
  date: string
  newOrders: number
  returningOrders: number
  guestOrders: number
  newRevenue: number
  returningRevenue: number
  guestRevenue: number
}

export interface CustomerSplit {
  storeId: string
  range: DateRange
  /** First order Opero holds for the store (store's own date). */
  historyStart: string | null
  orders: number
  revenue: number
  /** Orders that are the customer's first; new + returning + guest = orders. */
  newOrders: number
  /** Orders of customers who had ordered before (earlier in the window or before it). */
  returningOrders: number
  /** Orders with no customer attached. */
  guestOrders: number
  newRevenue: number
  returningRevenue: number
  guestRevenue: number
  /** Distinct identified customers who ordered in the window. */
  customers: number
  /** Customers whose first order fell in the window (= newOrders). */
  newCustomers: number
  /** Customers who had ordered before the window (customers − newCustomers). */
  returningCustomers: number
  /** Repeat orders, inside the window, of customers who were new in it. */
  repeatOrdersOfNewCustomers: number
  /** returningOrders ÷ identified orders, in %. */
  repeatOrderPct: number | null
  /** Every date of the window. */
  daily: CustomerDay[]
}

export type LtvSegment = '1 pedido' | '2–3 pedidos' | '4–6 pedidos' | '7+ pedidos'

export interface LtvBucket {
  segment: LtvSegment
  customers: number
  /** % of identified customers. */
  pct: number | null
  avgOrders: number | null
  /** Average revenue per customer of the bucket (USD). */
  avgLtv: number | null
  avgOrderValue: number | null
}

export interface CustomerLtv {
  storeId: string
  /** Always the whole collected history, whatever period the screen shows. */
  scope: 'histórico completo'
  historyStart: string | null
  customers: number
  /** Orders of identified customers. */
  orders: number
  revenue: number
  /** Customers with two or more orders. */
  repeatCustomers: number
  /** repeatCustomers ÷ customers, in %. */
  repeatCustomerPct: number | null
  avgLtv: number | null
  avgOrders: number | null
  /** Guest orders in the history: no customer, so outside the LTV. */
  guestOrders: number
  buckets: LtvBucket[]
}

// ─── Pure helpers ─────────────────────────────────────────────────────────────

const pct = (a: number, b: number): number | null => (b > 0 ? (a / b) * 100 : null)
const num = (v: unknown): number => Number(v) || 0

export const LTV_SEGMENTS: LtvSegment[] = ['1 pedido', '2–3 pedidos', '4–6 pedidos', '7+ pedidos']

export function ltvSegment(orders: number): LtvSegment {
  if (orders <= 1) return '1 pedido'
  if (orders <= 3) return '2–3 pedidos'
  if (orders <= 6) return '4–6 pedidos'
  return '7+ pedidos'
}

// ─── Loading ──────────────────────────────────────────────────────────────────

/** Every kept order of the store with its rank in its customer's history. The
 *  rank is computed over the whole history before the window is applied. */
const RANKED_CTE = `
  tz AS (SELECT COALESCE(timezone, 'UTC') AS name FROM tenants WHERE id = $1),
  ranked AS (
    SELECT (o.created_at AT TIME ZONE tz.name)::date AS d,
           o.total_price::float8 AS total,
           NULLIF(o.customer_id, '') AS customer_id,
           CASE WHEN NULLIF(o.customer_id, '') IS NULL THEN NULL
                ELSE row_number() OVER (PARTITION BY NULLIF(o.customer_id, '') ORDER BY o.created_at, o.order_id)
           END AS rn,
           MIN((o.created_at AT TIME ZONE tz.name)::date) OVER (PARTITION BY NULLIF(o.customer_id, '')) AS first_d
      FROM shopify_orders o, tz
     WHERE o.tenant_id = $1 AND ${KEPT_ORDER_SQL}
  )`

async function historyStart(storeId: string): Promise<string | null> {
  const [row] = await query<{ d: string | null }>(
    `SELECT (MIN(o.created_at) AT TIME ZONE COALESCE(MIN(t.timezone), 'UTC'))::date::text AS d
       FROM shopify_orders o JOIN tenants t ON t.id = o.tenant_id
      WHERE o.tenant_id = $1`,
    [storeId],
  )
  return row?.d ?? null
}

export async function getCustomerSplit(store: { id: string }, range: DateRange): Promise<CustomerSplit> {
  if (!isIsoDate(range.from) || !isIsoDate(range.to) || range.from > range.to) {
    throw new RangeError(`invalid range ${range.from}..${range.to}`)
  }
  const [days, [agg], start] = await Promise.all([
    query<{ d: string; n_new: number; n_ret: number; n_guest: number; r_new: number; r_ret: number; r_guest: number }>(
      `WITH ${RANKED_CTE}
       SELECT g.d::date::text AS d,
              COUNT(r.d) FILTER (WHERE r.rn = 1)::int                AS n_new,
              COUNT(r.d) FILTER (WHERE r.rn > 1)::int                AS n_ret,
              COUNT(r.d) FILTER (WHERE r.d IS NOT NULL AND r.rn IS NULL)::int AS n_guest,
              COALESCE(SUM(r.total) FILTER (WHERE r.rn = 1), 0)::float8 AS r_new,
              COALESCE(SUM(r.total) FILTER (WHERE r.rn > 1), 0)::float8 AS r_ret,
              COALESCE(SUM(r.total) FILTER (WHERE r.d IS NOT NULL AND r.rn IS NULL), 0)::float8 AS r_guest
         FROM generate_series($2::date, $3::date, interval '1 day') AS g(d)
         LEFT JOIN ranked r ON r.d = g.d::date
        GROUP BY g.d
        ORDER BY g.d`,
      [store.id, range.from, range.to],
    ),
    query<{ customers: number; repeat_new: number }>(
      `WITH ${RANKED_CTE}
       SELECT COUNT(DISTINCT customer_id)::int AS customers,
              COUNT(*) FILTER (WHERE rn > 1 AND first_d >= $2::date)::int AS repeat_new
         FROM ranked
        WHERE d BETWEEN $2::date AND $3::date`,
      [store.id, range.from, range.to],
    ),
    historyStart(store.id),
  ])

  const daily: CustomerDay[] = days.map(r => ({
    date: r.d,
    newOrders: num(r.n_new), returningOrders: num(r.n_ret), guestOrders: num(r.n_guest),
    newRevenue: num(r.r_new), returningRevenue: num(r.r_ret), guestRevenue: num(r.r_guest),
  }))
  const t = daily.reduce((a, d) => ({
    newOrders: a.newOrders + d.newOrders, returningOrders: a.returningOrders + d.returningOrders,
    guestOrders: a.guestOrders + d.guestOrders, newRevenue: a.newRevenue + d.newRevenue,
    returningRevenue: a.returningRevenue + d.returningRevenue, guestRevenue: a.guestRevenue + d.guestRevenue,
  }), { newOrders: 0, returningOrders: 0, guestOrders: 0, newRevenue: 0, returningRevenue: 0, guestRevenue: 0 })
  const customers = num(agg?.customers)

  return {
    storeId: store.id,
    range,
    historyStart: start,
    orders: t.newOrders + t.returningOrders + t.guestOrders,
    revenue: t.newRevenue + t.returningRevenue + t.guestRevenue,
    ...t,
    customers,
    newCustomers: t.newOrders,
    returningCustomers: customers - t.newOrders,
    repeatOrdersOfNewCustomers: num(agg?.repeat_new),
    repeatOrderPct: pct(t.returningOrders, t.newOrders + t.returningOrders),
    daily,
  }
}

/** Lifetime value buckets over the whole collected history. */
export async function getCustomerLtv(store: { id: string }): Promise<CustomerLtv> {
  const [rows, [guests], start] = await Promise.all([
    query<{ n: number; spent: number }>(
      `SELECT COUNT(*)::int AS n, SUM(o.total_price)::float8 AS spent
         FROM shopify_orders o
        WHERE o.tenant_id = $1 AND ${KEPT_ORDER_SQL} AND NULLIF(o.customer_id, '') IS NOT NULL
        GROUP BY o.customer_id`,
      [store.id],
    ),
    query<{ n: number }>(
      `SELECT COUNT(*)::int AS n FROM shopify_orders o
        WHERE o.tenant_id = $1 AND ${KEPT_ORDER_SQL} AND NULLIF(o.customer_id, '') IS NULL`,
      [store.id],
    ),
    historyStart(store.id),
  ])

  const acc = new Map<LtvSegment, { customers: number; orders: number; revenue: number }>(
    LTV_SEGMENTS.map(s => [s, { customers: 0, orders: 0, revenue: 0 }]),
  )
  let customers = 0, orders = 0, revenue = 0, repeat = 0
  for (const r of rows) {
    const n = num(r.n), spent = num(r.spent)
    const b = acc.get(ltvSegment(n))!
    b.customers += 1; b.orders += n; b.revenue += spent
    customers += 1; orders += n; revenue += spent
    if (n >= 2) repeat += 1
  }

  return {
    storeId: store.id,
    scope: 'histórico completo',
    historyStart: start,
    customers,
    orders,
    revenue,
    repeatCustomers: repeat,
    repeatCustomerPct: pct(repeat, customers),
    avgLtv: customers > 0 ? revenue / customers : null,
    avgOrders: customers > 0 ? orders / customers : null,
    guestOrders: num(guests?.n),
    buckets: LTV_SEGMENTS.map(segment => {
      const b = acc.get(segment)!
      return {
        segment,
        customers: b.customers,
        pct: pct(b.customers, customers),
        avgOrders: b.customers > 0 ? b.orders / b.customers : null,
        avgLtv: b.customers > 0 ? b.revenue / b.customers : null,
        avgOrderValue: b.orders > 0 ? b.revenue / b.orders : null,
      }
    }),
  }
}
