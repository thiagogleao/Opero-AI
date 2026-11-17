import { query } from '@/lib/db'
import { KEPT_ORDER_SQL, type DateRange } from '@/lib/engine'

/**
 * Database reads the profit engine and lib/data do not cover: order lists,
 * one order, customers and the catalogue. All read-only,
 * all scoped to one store id that the route already checked against the
 * viewer.
 *
 * Rules every query here follows (each one was a wrong answer before):
 *  - an order's day is `created_at AT TIME ZONE <store tz>`, converted once
 *    (the old agent's created_at::date was a UTC day: 14 orders instead of 20);
 *  - kept orders are the engine's (KEPT_ORDER_SQL), so a count or a sum over
 *    them is the same number the dashboard shows;
 *  - order items join on the text order_id only;
 *  - new vs returning is row_number() over the customer's orders, never the
 *    broken is_first_order flag or the daily-metrics columns (0 new / 407
 *    returning for MOKOO in November);
 *  - a customer's e-mail leaves this file only for a single order the user
 *    named; IPs and user agents never do.
 */

// ─── Orders ───────────────────────────────────────────────────────────────────

export type OrderStatusFilter = 'kept' | 'refunded' | 'all'

export interface OrderListItem {
  orderNumber: number | null
  /** Store-local time, "YYYY-MM-DD HH:MM". */
  localTime: string
  total: number
  financialStatus: string | null
  fulfillmentStatus: string | null
  country: string | null
  /** The customer's first order ever, or a later one; null for guests. */
  customerType: 'novo' | 'recorrente' | null
  items: { title: string | null; variant: string | null; qty: number }[]
}

export interface OrderList {
  /** Over the whole filter, not just the rows returned. */
  matching: number
  matchingRevenue: number
  rows: OrderListItem[]
  truncated: boolean
}

const statusSql = (f: OrderStatusFilter) =>
  f === 'kept' ? `AND ${KEPT_ORDER_SQL}`
    : f === 'refunded' ? `AND o.financial_status IN ('refunded', 'voided', 'partially_refunded')`
    : ''

/** Shared WHERE for a store's orders on the store's own calendar dates. The
 *  coarse created_at bound lets the index work; the exact local-date filter
 *  runs on what is left. */
const windowWhere = (statusFilter: OrderStatusFilter, extra = '') => `o.tenant_id = $1
     AND o.created_at >= ($3::date - 2)::timestamptz AND o.created_at < ($4::date + 3)::timestamptz
     AND (o.created_at AT TIME ZONE $2)::date BETWEEN $3::date AND $4::date
     ${statusSql(statusFilter)} ${extra}`

export async function listOrders(
  storeId: string, tz: string, range: DateRange,
  opts: { status: OrderStatusFilter; country?: string | null; limit: number },
): Promise<OrderList> {
  const params: unknown[] = [storeId, tz, range.from, range.to]
  let countryClause = ''
  if (opts.country) { params.push(opts.country); countryClause = `AND o.country_code = $${params.length}` }
  const where = windowWhere(opts.status, countryClause)

  const [summary] = await query<{ n: number; revenue: number }>(
    `SELECT COUNT(*)::int AS n, COALESCE(SUM(o.total_price), 0)::float8 AS revenue
       FROM shopify_orders o WHERE ${where}`, params)

  params.push(opts.limit)
  const rows = await query<{
    order_number: number | null; local_time: string; total: number; financial_status: string | null
    fulfillment_status: string | null; country_code: string | null; rn: number | null; has_customer: boolean
    items: { title: string | null; variant: string | null; qty: number | null }[] | null
  }>(
    `WITH page AS (
       SELECT o.order_id, o.order_number, o.created_at, o.total_price, o.financial_status,
              o.fulfillment_status, o.country_code, o.customer_id
         FROM shopify_orders o
        WHERE ${where}
        ORDER BY o.created_at DESC
        LIMIT $${params.length}
     )
     SELECT p.order_number, to_char(p.created_at AT TIME ZONE $2, 'YYYY-MM-DD HH24:MI') AS local_time,
            p.total_price::float8 AS total, p.financial_status, p.fulfillment_status, p.country_code,
            (p.customer_id IS NOT NULL) AS has_customer,
            (SELECT COUNT(*) FROM shopify_orders x
              WHERE x.tenant_id = $1 AND x.customer_id = p.customer_id
                AND (x.created_at, x.order_id) <= (p.created_at, p.order_id))::int AS rn,
            (SELECT json_agg(json_build_object('title', oi.product_title, 'variant', oi.variant_title,
                                               'qty', oi.quantity) ORDER BY oi.id)
               FROM shopify_order_items oi WHERE oi.order_id = p.order_id) AS items
       FROM page p
      ORDER BY p.created_at DESC`,
    params,
  )
  return {
    matching: summary?.n ?? 0,
    matchingRevenue: Number(summary?.revenue) || 0,
    truncated: (summary?.n ?? 0) > rows.length,
    rows: rows.map(r => ({
      orderNumber: r.order_number, localTime: r.local_time, total: Number(r.total) || 0,
      financialStatus: r.financial_status, fulfillmentStatus: r.fulfillment_status, country: r.country_code,
      customerType: !r.has_customer || r.rn === null ? null : r.rn <= 1 ? 'novo' : 'recorrente',
      items: (r.items ?? []).map(i => ({ title: i.title, variant: i.variant, qty: Number(i.qty) || 0 })),
    })),
  }
}

export interface OrderDetail {
  orderNumber: number | null
  localTime: string
  total: number
  subtotal: number | null
  discounts: number | null
  tax: number | null
  financialStatus: string | null
  fulfillmentStatus: string | null
  country: string | null
  /** Only when the user named this order; otherwise null and `contactHidden`. */
  customerEmail: string | null
  contactHidden: boolean
  /** 1 = the customer's first order. */
  customerOrderNumber: number | null
  customerTotalOrders: number | null
  refundAmount: number | null
  cancelledAt: string | null
  cancelReason: string | null
  source: string | null
  items: { title: string | null; variant: string | null; sku: string | null; qty: number; unitPrice: number | null }[]
}

export async function getOrder(
  storeId: string, tz: string, orderNumber: number, opts: { revealContact: boolean },
): Promise<OrderDetail | null> {
  const [r] = await query<{
    order_id: string; order_number: number | null; local_time: string; total: number; subtotal: number | null
    discounts: number | null; tax: number | null; financial_status: string | null; fulfillment_status: string | null
    country_code: string | null; customer_email: string | null
    refund_amount: number | null; cancelled_at: string | null; cancel_reason: string | null; source_name: string | null
    rn: number | null; total_orders: number | null
    items: { title: string | null; variant: string | null; sku: string | null; qty: number | null; price: number | null }[] | null
  }>(
    `SELECT o.order_id, o.order_number, to_char(o.created_at AT TIME ZONE $2, 'YYYY-MM-DD HH24:MI') AS local_time,
            o.total_price::float8 AS total, o.subtotal_price::float8 AS subtotal, o.total_discounts::float8 AS discounts,
            o.total_tax::float8 AS tax, o.financial_status, o.fulfillment_status, o.country_code, o.customer_email,
            o.refund_amount::float8 AS refund_amount,
            to_char(o.cancelled_at AT TIME ZONE $2, 'YYYY-MM-DD HH24:MI') AS cancelled_at,
            o.cancel_reason, o.source_name,
            CASE WHEN o.customer_id IS NULL THEN NULL ELSE
              (SELECT COUNT(*) FROM shopify_orders x WHERE x.tenant_id = o.tenant_id AND x.customer_id = o.customer_id
                 AND (x.created_at, x.order_id) <= (o.created_at, o.order_id))::int END AS rn,
            CASE WHEN o.customer_id IS NULL THEN NULL ELSE
              (SELECT COUNT(*) FROM shopify_orders x WHERE x.tenant_id = o.tenant_id AND x.customer_id = o.customer_id)::int END AS total_orders,
            (SELECT json_agg(json_build_object('title', oi.product_title, 'variant', oi.variant_title, 'sku', oi.sku,
                                               'qty', oi.quantity, 'price', oi.price) ORDER BY oi.id)
               FROM shopify_order_items oi WHERE oi.order_id = o.order_id) AS items
       FROM shopify_orders o
      WHERE o.tenant_id = $1 AND o.order_number = $3
      ORDER BY o.created_at DESC
      LIMIT 1`,
    [storeId, tz, orderNumber],
  )
  if (!r) return null
  const n = (v: number | null) => (v === null ? null : Number(v))
  return {
    orderNumber: r.order_number, localTime: r.local_time, total: Number(r.total) || 0,
    subtotal: n(r.subtotal), discounts: n(r.discounts), tax: n(r.tax),
    financialStatus: r.financial_status, fulfillmentStatus: r.fulfillment_status, country: r.country_code,
    customerEmail: opts.revealContact ? r.customer_email : null,
    contactHidden: !opts.revealContact && !!r.customer_email,
    customerOrderNumber: r.rn, customerTotalOrders: r.total_orders,
    refundAmount: n(r.refund_amount),
    cancelledAt: r.cancelled_at, cancelReason: r.cancel_reason, source: r.source_name,
    items: (r.items ?? []).map(i => ({
      title: i.title, variant: i.variant, sku: i.sku, qty: Number(i.qty) || 0, unitPrice: n(i.price),
    })),
  }
}

// ─── Customers ────────────────────────────────────────────────────────────────

export interface CustomerMix {
  newOrders: number
  newRevenue: number
  returningOrders: number
  returningRevenue: number
  /** Orders with no customer attached (guest checkouts, deleted customers). */
  unknownOrders: number
  unknownRevenue: number
}

/** New vs returning among the window's kept orders, by the customer's own
 *  order history (row_number over every order the customer ever placed). */
export async function customerMix(storeId: string, tz: string, range: DateRange): Promise<CustomerMix> {
  const rows = await query<{ kind: string; n: number; revenue: number }>(
    `WITH ranked AS (
       SELECT o.order_id,
              row_number() OVER (PARTITION BY o.customer_id ORDER BY o.created_at, o.order_id) AS rn
         FROM shopify_orders o
        WHERE o.tenant_id = $1 AND o.customer_id IS NOT NULL
          AND o.created_at < ($4::date + 3)::timestamptz
     )
     SELECT CASE WHEN o.customer_id IS NULL THEN 'unknown' WHEN r.rn = 1 THEN 'new' ELSE 'returning' END AS kind,
            COUNT(*)::int AS n, COALESCE(SUM(o.total_price), 0)::float8 AS revenue
       FROM shopify_orders o
       LEFT JOIN ranked r ON r.order_id = o.order_id
      WHERE ${windowWhere('kept')}
      GROUP BY 1`,
    [storeId, tz, range.from, range.to],
  )
  const get = (k: string) => rows.find(r => r.kind === k)
  return {
    newOrders: get('new')?.n ?? 0, newRevenue: Number(get('new')?.revenue) || 0,
    returningOrders: get('returning')?.n ?? 0, returningRevenue: Number(get('returning')?.revenue) || 0,
    unknownOrders: get('unknown')?.n ?? 0, unknownRevenue: Number(get('unknown')?.revenue) || 0,
  }
}

export interface TopCustomer {
  /** A stable pseudonym (hash of the Shopify customer id): lets the user ask
   *  "and customer C-1a2b3c?" without the model ever seeing who it is. */
  ref: string
  ordersInWindow: number
  revenueInWindow: number
  lifetimeOrders: number
  firstOrderDay: string
  country: string | null
}

export async function topCustomers(
  storeId: string, tz: string, range: DateRange, limit: number,
): Promise<{ customers: number; rows: TopCustomer[] }> {
  const params = [storeId, tz, range.from, range.to, limit]
  const where = `${windowWhere('kept')} AND o.customer_id IS NOT NULL`
  const [count] = await query<{ n: number }>(
    `SELECT COUNT(DISTINCT o.customer_id)::int AS n FROM shopify_orders o WHERE ${where}`, params.slice(0, 4))
  const rows = await query<{
    ref: string; orders: number; revenue: number; lifetime: number; first_day: string; country: string | null
  }>(
    `WITH w AS (
       SELECT o.customer_id, COUNT(*)::int AS orders, SUM(o.total_price)::float8 AS revenue,
              MAX(o.country_code) AS country
         FROM shopify_orders o WHERE ${where}
        GROUP BY o.customer_id
        ORDER BY revenue DESC
        LIMIT $5
     )
     SELECT 'C-' || substr(md5(w.customer_id), 1, 6) AS ref, w.orders, w.revenue, w.country,
            h.lifetime, h.first_day
       FROM w
       JOIN LATERAL (
         SELECT COUNT(*)::int AS lifetime,
                to_char(MIN(x.created_at) AT TIME ZONE $2, 'YYYY-MM-DD') AS first_day
           FROM shopify_orders x WHERE x.tenant_id = $1 AND x.customer_id = w.customer_id) h ON true
      ORDER BY w.revenue DESC`,
    params,
  )
  return {
    customers: count?.n ?? 0,
    rows: rows.map(r => ({
      ref: r.ref, ordersInWindow: r.orders, revenueInWindow: Number(r.revenue) || 0,
      lifetimeOrders: r.lifetime, firstOrderDay: r.first_day, country: r.country,
    })),
  }
}

// ─── Catalogue ────────────────────────────────────────────────────────────────

export interface CatalogueView {
  byStatus: Record<string, number>
  matching: number
  rows: { productId: string; title: string | null; status: string | null; type: string | null
          priceMin: number | null; priceMax: number | null; variants: number | null; createdDay: string | null }[]
  truncated: boolean
}

/** The product list from the last sync. Prices are in dollars (the collector
 *  converts the yen store). Stock is not stored: see the live inventory read. */
export async function catalogue(
  storeId: string, tz: string, opts: { search?: string | null; status?: string | null; limit: number },
): Promise<CatalogueView> {
  const statusRows = await query<{ status: string | null; n: number }>(
    `SELECT status, COUNT(*)::int AS n FROM shopify_products WHERE tenant_id = $1 GROUP BY 1`, [storeId])
  const params: unknown[] = [storeId]
  let filter = ''
  if (opts.search) {
    params.push(`%${opts.search.replace(/[%_\\]/g, m => `\\${m}`)}%`)
    filter += ` AND title ILIKE $${params.length}`
  }
  if (opts.status) { params.push(opts.status); filter += ` AND status = $${params.length}` }
  const [count] = await query<{ n: number }>(
    `SELECT COUNT(*)::int AS n FROM shopify_products WHERE tenant_id = $1 ${filter}`, params)
  params.push(opts.limit)
  const limitParam = params.length
  params.push(tz)
  const rows = await query<{
    product_id: string; title: string | null; status: string | null; product_type: string | null
    price_min: number | null; price_max: number | null; variants_count: number | null; created_day: string | null
  }>(
    `SELECT product_id, title, status, product_type, price_min::float8 AS price_min, price_max::float8 AS price_max,
            variants_count, to_char(created_at AT TIME ZONE $${params.length}, 'YYYY-MM-DD') AS created_day
       FROM shopify_products WHERE tenant_id = $1 ${filter}
      ORDER BY (status = 'active') DESC, title
      LIMIT $${limitParam}`,
    params,
  )
  return {
    byStatus: Object.fromEntries(statusRows.map(r => [r.status ?? 'desconhecido', r.n])),
    matching: count?.n ?? 0,
    truncated: (count?.n ?? 0) > rows.length,
    rows: rows.map(r => ({
      productId: r.product_id, title: r.title, status: r.status, type: r.product_type,
      priceMin: r.price_min, priceMax: r.price_max, variants: r.variants_count, createdDay: r.created_day,
    })),
  }
}

/** Shopify credentials for the live inventory read. Never logged, never sent
 *  to the model. */
export async function shopifyCredentials(storeId: string): Promise<{ domain: string; token: string } | null> {
  const [r] = await query<{ shopify_domain: string | null; shopify_access_token: string | null }>(
    `SELECT shopify_domain, shopify_access_token FROM tenants WHERE id = $1`, [storeId])
  if (!r?.shopify_domain || !r.shopify_access_token) return null
  return { domain: r.shopify_domain, token: r.shopify_access_token }
}
