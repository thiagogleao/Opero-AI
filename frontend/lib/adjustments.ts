import { query } from './db'

/**
 * Refunds and chargebacks — the money that leaves after the sale.
 *
 * Every row carries two dates: when it reached us, and when the order it
 * belongs to was placed. Nothing else in this file matters as much. A $500
 * chargeback landing today for an August order is not a bad day today, and
 * pretending otherwise is how a good day reads as a disaster.
 *
 * A chargeback is modelled as one row whose status changes, not as a stream of
 * events. Its effect on profit is derived from that status, so winning a
 * dispute reverses the charge by itself at the next sync instead of needing a
 * second record that could go missing.
 */

const API_VERSION = '2024-10'

/** What Shopify Payments charges per dispute, regardless of the outcome. */
export const CHARGEBACK_FEE = 15

export interface AdjustmentStore {
  id: string
  shopify_domain: string
  shopify_access_token: string
}

/** Dispute states where the money is currently out of our hands. */
const OPEN_STATES = new Set(['needs_response', 'under_review', 'charge_refunded'])
const LOST_STATES = new Set(['lost'])
const WON_STATES  = new Set(['won'])

/** True when this dispute is currently costing us the money. */
export function disputeCosts(status: string | null): boolean {
  if (!status) return true
  if (WON_STATES.has(status)) return false
  return OPEN_STATES.has(status) || LOST_STATES.has(status)
}

const isoDate = (v: string | null | undefined): string | null =>
  v ? new Date(v).toISOString().slice(0, 10) : null

interface Money { amount: string; currencyCode: string }

interface GqlOrder {
  id: string
  createdAt: string
  refunds?: {
    id: string
    createdAt: string
    note?: string | null
    totalRefundedSet?: { shopMoney?: Money; presentmentMoney?: Money }
  }[]
}

const REFUNDS_QUERY = `
query refunds($cursor: String, $q: String!) {
  orders(first: 50, after: $cursor, query: $q) {
    pageInfo { hasNextPage endCursor }
    edges { node {
      id
      createdAt
      refunds {
        id
        createdAt
        note
        totalRefundedSet {
          shopMoney { amount currencyCode }
          presentmentMoney { amount currencyCode }
        }
      }
    } }
  }
}`

interface ShopifyDispute {
  id: number | string
  order_id: number | string | null
  amount: string
  currency: string
  reason: string
  status: string
  evidence_due_by: string | null
  finalized_on: string | null
  initiated_at: string
}

async function shopify(store: AdjustmentStore, path: string): Promise<Response> {
  return fetch(`https://${store.shopify_domain}/admin/api/${API_VERSION}/${path}`, {
    headers: { 'X-Shopify-Access-Token': store.shopify_access_token },
  })
}

/** Follow Shopify's Link header to the next page. */
function nextPage(res: Response): string | null {
  const link = res.headers.get('Link') ?? ''
  const next = link.split(',').find(p => p.includes('rel="next"'))
  return next ? next.split(';')[0].trim().replace(/[<>]/g, '') : null
}

export interface SyncAdjustments {
  tenantId: string
  refunds: number
  disputes: number
  skipped?: string
  error?: string
}

/**
 * Pull refunds and disputes for one store.
 *
 * `sinceDays` bounds the incremental pass. Disputes are always read whole:
 * there are tens of them, not thousands, and their status changes over time,
 * so re-reading is how a win or a loss ever gets noticed.
 */
export async function syncAdjustments(
  store: AdjustmentStore,
  opts: { sinceDays?: number } = {}
): Promise<SyncAdjustments> {
  const out: SyncAdjustments = { tenantId: store.id, refunds: 0, disputes: 0 }
  const since = new Date(Date.now() - (opts.sinceDays ?? 60) * 86400000).toISOString()

  // ── Refunds ───────────────────────────────────────────────────────────────
  // Through GraphQL, for one reason: the REST transaction amount is in the
  // currency the customer paid in. A refund of PKR 24,800 is $89.56, and
  // summing that first number as dollars turns a routine refund into a
  // five-figure hole in the day. shopMoney is the store's own currency.
  try {
    const filter =
      `updated_at:>=${since.slice(0, 10)} ` +
      `AND (financial_status:refunded OR financial_status:partially_refunded)`
    let cursor: string | null = null

    for (;;) {
      const res: Response = await fetch(
        `https://${store.shopify_domain}/admin/api/${API_VERSION}/graphql.json`,
        {
          method: 'POST',
          headers: {
            'X-Shopify-Access-Token': store.shopify_access_token,
            'Content-Type': 'application/json',
          },
          body: JSON.stringify({ query: REFUNDS_QUERY, variables: { cursor, q: filter } }),
        }
      )
      if (!res.ok) throw new Error(`refunds HTTP ${res.status}`)
      const json = await res.json()
      if (json.errors) throw new Error(`refunds GraphQL: ${JSON.stringify(json.errors).slice(0, 200)}`)

      const conn = json.data?.orders
      for (const edge of conn?.edges ?? []) {
        const order = edge.node as GqlOrder
        const orderId = String(order.id).split('/').pop() ?? null

        for (const refund of order.refunds ?? []) {
          const shop = refund.totalRefundedSet?.shopMoney
          const presented = refund.totalRefundedSet?.presentmentMoney
          const amount = Number(shop?.amount ?? 0)
          if (amount <= 0) continue

          await query(
            `INSERT INTO order_adjustments (
               tenant_id, kind, external_id, order_id, event_date, order_date,
               amount, currency, original_amount, original_currency, reason, synced_at
             ) VALUES ($1,'refund',$2,$3,$4::date,$5::date,$6,$7,$8,$9,$10,NOW())
             ON CONFLICT (tenant_id, kind, external_id) DO UPDATE SET
               amount = $6, currency = $7, original_amount = $8,
               original_currency = $9, event_date = $4::date, synced_at = NOW()`,
            [
              store.id, String(refund.id).split('/').pop(), orderId,
              isoDate(refund.createdAt), isoDate(order.createdAt),
              amount, shop?.currencyCode ?? null,
              presented ? Number(presented.amount) : null,
              presented?.currencyCode ?? null,
              refund.note ?? null,
            ]
          )
          out.refunds++
        }
      }

      if (!conn?.pageInfo?.hasNextPage) break
      cursor = conn.pageInfo.endCursor
    }
  } catch (err) {
    out.error = err instanceof Error ? err.message : String(err)
  }

  // ── Chargebacks ───────────────────────────────────────────────────────────
  try {
    let url: string | null = `shopify_payments/disputes.json?limit=250`
    const orderDates = new Map<string, string | null>()
    const orderTotals = new Map<string, { total: number; currency: string | null } | null>()

    while (url) {
      const res: Response = await shopify(store, url)
      if (res.status === 403) {
        // The token predates the payments scope. Reinstalling the private app
        // issues a new one; until then this store simply has no dispute data.
        out.skipped = 'sem permissão de Shopify Payments neste token'
        break
      }
      if (!res.ok) throw new Error(`disputes HTTP ${res.status}`)
      const { disputes = [] } = await res.json() as { disputes: ShopifyDispute[] }

      for (const d of disputes) {
        const orderId = d.order_id ? String(d.order_id) : null
        let order: { created_at: string; total_price: string; currency: string | null } | undefined
        if (orderId && !orderDates.has(orderId)) {
          ;[order] = await query<{ created_at: string; total_price: string; currency: string | null }>(
            `SELECT created_at::text, total_price::text, currency
             FROM shopify_orders WHERE tenant_id = $1 AND order_id = $2`,
            [store.id, orderId]
          )
          orderDates.set(orderId, order ? isoDate(order.created_at) : null)
          orderTotals.set(orderId, order ? { total: Number(order.total_price), currency: order.currency } : null)
        }

        // Disputes arrive in whatever the customer paid in — one of these is
        // LBP 5,886,900, which is $65.77. Shopify does not hand back a shop-
        // currency amount here, so the order's own total stands in for it: a
        // chargeback is raised against the whole order, and the order is
        // already stored in the store's currency.
        const known = orderId ? orderTotals.get(orderId) : null
        const shopCurrency = known?.currency ?? 'USD'
        const converted = d.currency !== shopCurrency && known?.total
        const amount = converted ? known.total : Number(d.amount)
        if (converted) {
          console.log(
            `[adjustments] dispute ${d.id}: ${d.currency} ${d.amount} lida como ` +
            `${shopCurrency} ${known.total} pelo total do pedido`
          )
        }

        await query(
          `INSERT INTO order_adjustments (
             tenant_id, kind, external_id, order_id, event_date, order_date,
             amount, fee, currency, original_amount, original_currency,
             reason, status, evidence_due_by, finalized_on, synced_at
           ) VALUES ($1,'chargeback',$2,$3,$4::date,$5::date,$6,$7,$8,$9,$10,$11,$12,$13,$14,NOW())
           ON CONFLICT (tenant_id, kind, external_id) DO UPDATE SET
             -- Status is the field that moves; everything else is restated so a
             -- correction on Shopify's side lands here too.
             status = $12, amount = $6, currency = $8, evidence_due_by = $13,
             finalized_on = $14, order_date = $5::date, synced_at = NOW()`,
          [
            store.id, String(d.id), orderId,
            isoDate(d.initiated_at), orderId ? orderDates.get(orderId) ?? null : null,
            amount, CHARGEBACK_FEE, shopCurrency,
            Number(d.amount), d.currency,
            d.reason, d.status,
            d.evidence_due_by ?? null, d.finalized_on ?? null,
          ]
        )
        out.disputes++
      }

      url = nextPage(res)
      if (url) url = url.replace(`https://${store.shopify_domain}/admin/api/${API_VERSION}/`, '')
    }
  } catch (err) {
    out.error = [out.error, err instanceof Error ? err.message : String(err)].filter(Boolean).join(' · ')
  }

  return out
}

export async function adjustmentStores(): Promise<AdjustmentStore[]> {
  return query<AdjustmentStore>(
    `SELECT id, shopify_domain, shopify_access_token
     FROM tenants
     WHERE shopify_access_token IS NOT NULL AND shopify_domain IS NOT NULL
     ORDER BY created_at`
  )
}

// ─── Reading ──────────────────────────────────────────────────────────────────

export interface AdjustmentTotals {
  /** Gross value refunded. */
  refundAmount: number
  refundCount: number
  /** Gross value of disputes currently costing us, plus their fees. */
  chargebackAmount: number
  chargebackFees: number
  chargebackCount: number
  /** Disputes won in the window — money that came back. */
  wonAmount: number
  wonCount: number
}

const EMPTY: AdjustmentTotals = {
  refundAmount: 0, refundCount: 0,
  chargebackAmount: 0, chargebackFees: 0, chargebackCount: 0,
  wonAmount: 0, wonCount: 0,
}

/**
 * Adjustments that *arrived* in a window, whatever day their order is from.
 *
 * `basis: 'order'` instead counts adjustments belonging to orders placed in the
 * window — the retroactive view, for asking what a past day really earned.
 */
export async function getAdjustments(
  tenantId: string, from: string, to: string,
  basis: 'event' | 'order' = 'event',
): Promise<AdjustmentTotals> {
  const column = basis === 'event' ? 'event_date' : 'order_date'
  try {
    const [row] = await query<Record<string, string>>(
      `SELECT
         COALESCE(SUM(amount) FILTER (WHERE kind = 'refund'), 0)::text        AS refund_amount,
         count(*) FILTER (WHERE kind = 'refund')::text                        AS refund_count,
         COALESCE(SUM(amount) FILTER (WHERE kind = 'chargeback' AND status IS DISTINCT FROM 'won'), 0)::text AS cb_amount,
         COALESCE(SUM(fee)    FILTER (WHERE kind = 'chargeback' AND status IS DISTINCT FROM 'won'), 0)::text AS cb_fees,
         count(*) FILTER (WHERE kind = 'chargeback' AND status IS DISTINCT FROM 'won')::text AS cb_count,
         COALESCE(SUM(amount) FILTER (WHERE kind = 'chargeback' AND status = 'won'), 0)::text AS won_amount,
         count(*) FILTER (WHERE kind = 'chargeback' AND status = 'won')::text AS won_count
       FROM order_adjustments
       WHERE tenant_id = $1 AND ${column} BETWEEN $2::date AND $3::date`,
      [tenantId, from, to]
    )
    return {
      refundAmount: Number(row?.refund_amount ?? 0),
      refundCount: Number(row?.refund_count ?? 0),
      chargebackAmount: Number(row?.cb_amount ?? 0),
      chargebackFees: Number(row?.cb_fees ?? 0),
      chargebackCount: Number(row?.cb_count ?? 0),
      wonAmount: Number(row?.won_amount ?? 0),
      wonCount: Number(row?.won_count ?? 0),
    }
  } catch {
    // Table not migrated yet — no adjustments is the safe reading.
    return EMPTY
  }
}

export interface ChargebackHealth {
  /** Disputes opened in the last 90 days. */
  count: number
  orders: number
  /** Count-based rate, which is the one payment processors act on. */
  rate: number
  amount: number
  fees: number
  open: number
  lost: number
  won: number
  /** Disputes still answerable, soonest deadline first. */
  dueSoon: { externalId: string; amount: number; currency: string; reason: string; dueBy: string | null }[]
  hasData: boolean
}

/** The number that decides whether Shopify Payments stays switched on. */
export async function getChargebackHealth(tenantId: string): Promise<ChargebackHealth> {
  const empty: ChargebackHealth = {
    count: 0, orders: 0, rate: 0, amount: 0, fees: 0,
    open: 0, lost: 0, won: 0, dueSoon: [], hasData: false,
  }
  try {
    const [row] = await query<Record<string, string>>(
      `SELECT count(*)::text AS n,
              COALESCE(SUM(amount), 0)::text AS amount,
              COALESCE(SUM(fee), 0)::text    AS fees,
              count(*) FILTER (WHERE status IN ('needs_response','under_review'))::text AS open,
              count(*) FILTER (WHERE status = 'lost')::text AS lost,
              count(*) FILTER (WHERE status = 'won')::text  AS won
       FROM order_adjustments
       WHERE tenant_id = $1 AND kind = 'chargeback'
         AND event_date > CURRENT_DATE - 90`,
      [tenantId]
    )
    const [ord] = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM shopify_orders o
       JOIN tenants t ON t.id = o.tenant_id
       WHERE o.tenant_id = $1
         AND (o.created_at AT TIME ZONE COALESCE(t.timezone,'UTC'))::date > CURRENT_DATE - 90
         AND o.financial_status NOT IN ('voided')`,
      [tenantId]
    )
    const dueSoon = await query<{
      external_id: string; amount: string; currency: string; reason: string; evidence_due_by: string | null
    }>(
      `SELECT external_id, amount::text, currency, reason, evidence_due_by::text
       FROM order_adjustments
       WHERE tenant_id = $1 AND kind = 'chargeback' AND status = 'needs_response'
       ORDER BY evidence_due_by NULLS LAST
       LIMIT 5`,
      [tenantId]
    )

    const count = Number(row?.n ?? 0)
    const orders = Number(ord?.n ?? 0)
    return {
      count, orders,
      rate: orders > 0 ? (count / orders) * 100 : 0,
      amount: Number(row?.amount ?? 0),
      fees: Number(row?.fees ?? 0),
      open: Number(row?.open ?? 0),
      lost: Number(row?.lost ?? 0),
      won: Number(row?.won ?? 0),
      dueSoon: dueSoon.map(d => ({
        externalId: d.external_id,
        amount: Number(d.amount),
        currency: d.currency,
        reason: d.reason,
        dueBy: d.evidence_due_by,
      })),
      hasData: count > 0,
    }
  } catch {
    return empty
  }
}
