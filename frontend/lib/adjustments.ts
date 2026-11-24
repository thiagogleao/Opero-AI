import { query } from './db'
import { todayInTz } from './engine/dates'
import { usdRate } from './sync/fx'
import { adminUrl } from './sync/shopifyApi'

/**
 * Refunds and chargebacks — the money that leaves after the sale.
 *
 * Every row carries two dates, both in the STORE's timezone like every other
 * date in the app: when it reached us (event_date) and when its order was
 * placed (order_date). A $500 chargeback landing today for an August order is
 * not a bad day today.
 *
 * `amount` is always US dollars. What Shopify reported — the customer's
 * currency for a refund, the dispute's currency for a chargeback — is kept in
 * original_amount / original_currency. A row that cannot be converted is not
 * written (and is counted in `unconverted`) rather than stored in yen or
 * rupees read as dollars: the yen store's first ¥12,750 refund would have
 * been subtracted as $12,750.
 *
 * A chargeback is one row whose status changes; its effect on profit is
 * derived from that status, so a won dispute reverses itself at the next sync.
 */

/** What Shopify Payments charges per dispute, regardless of the outcome. */
export const CHARGEBACK_FEE = 15

export interface AdjustmentStore {
  id: string
  shopify_domain: string
  shopify_access_token: string
  /** IANA timezone of the store: event and order dates are its calendar days. */
  timezone: string
  /** The shop's own currency (shopMoney); null = USD. */
  shopify_currency: string | null
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

/** The store-local calendar day of a timestamp. */
export function localDate(ts: string | null | undefined, tz: string): string | null {
  if (!ts) return null
  const t = Date.parse(ts)
  return Number.isFinite(t) ? todayInTz(tz, new Date(t)) : null
}

export interface KnownOrder {
  /** total_price as stored: already US dollars. */
  totalUsd: number
  /** The shop currency the order was billed in. */
  currency: string | null
  /** USD per unit of that currency, as applied to the order. */
  fxRate: number | null
}

/**
 * US dollars for an amount Shopify reported, or null when there is no honest
 * conversion. In order of preference:
 *   1. already dollars;
 *   2. the rate the order itself was converted with (same currency);
 *   3. a chargeback only: the order's dollar total — a dispute is raised
 *      against the whole order, and Shopify gives no shop-currency amount for
 *      it (one was LBP 5,886,900 = $65.77). This is how every existing
 *      chargeback was valued, so their amounts do not move;
 *   4. the day's rate for that currency (fx_rates, fetched when missing) —
 *      what was missing for a dispute whose order we never imported (INR 3,600
 *      was stored as $3,600).
 */
export async function toUsd(input: {
  amount: number
  currency: string | null
  kind: 'refund' | 'chargeback'
  day: string
  order: KnownOrder | null
  rateFor: (currency: string, day: string) => Promise<number | null>
}): Promise<number | null> {
  const cur = (input.currency || 'USD').toUpperCase()
  if (cur === 'USD') return input.amount
  const o = input.order
  if (o && (o.currency || '').toUpperCase() === cur && o.fxRate && o.fxRate > 0) return round2(input.amount * o.fxRate)
  if (input.kind === 'chargeback' && o && o.totalUsd > 0) return o.totalUsd
  const rate = await input.rateFor(cur, input.day)
  return rate ? round2(input.amount * rate) : null
}

const round2 = (v: number) => Math.round(v * 100) / 100

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

/** Follow Shopify's Link header to the next page. */
function nextPage(res: Response): string | null {
  const link = res.headers.get('Link') ?? ''
  const next = link.split(',').find(p => p.includes('rel="next"'))
  return next ? next.split(';')[0].trim().replace(/[<>]/g, '') : null
}

/** syncAdjustments' note when the token cannot read Shopify Payments
 *  disputes (HTTP 403). autoSync writes it on the pass's sync_runs row
 *  (source 'adjustments'), where disputesReadable finds it. */
export const DISPUTES_FORBIDDEN = 'sem permissão de Shopify Payments neste token'

/**
 * Whether a store's disputes can be read, from its latest finished
 * adjustments pass: false when that pass hit the 403 (DISPUTES_FORBIDDEN in
 * its message), true when it finished without it, null when no pass was
 * recorded (the scheduler before v2 wrote none) or it failed for another
 * reason. Glooty and Hibikura have no chargeback row ever, and the missing
 * permission was only known from a live token check in Ajustes.
 */
export function disputesReadable(run: { status: string | null; error_message: string | null } | null | undefined): boolean | null {
  if (!run) return null
  if (run.error_message?.includes(DISPUTES_FORBIDDEN)) return false
  return run.status === 'success' ? true : null
}

export interface SyncAdjustments {
  tenantId: string
  refunds: number
  disputes: number
  /** Rows not written because no USD conversion was possible. */
  unconverted: number
  skipped?: string
  error?: string
}

/** Orders this pass needs, from the database: dollars, currency, rate, local day. */
async function knownOrders(store: AdjustmentStore, ids: string[]): Promise<Map<string, KnownOrder & { day: string }>> {
  const out = new Map<string, KnownOrder & { day: string }>()
  if (!ids.length) return out
  const rows = await query<{ order_id: string; total: string; currency: string | null; fx_rate: string | null; day: string }>(
    `SELECT order_id, total_price::text AS total, currency, fx_rate::text,
            (created_at AT TIME ZONE $3)::date::text AS day
       FROM shopify_orders WHERE tenant_id = $1 AND order_id = ANY($2::text[])`,
    [store.id, ids, store.timezone],
  )
  for (const r of rows) {
    out.set(r.order_id, { totalUsd: Number(r.total) || 0, currency: r.currency, fxRate: r.fx_rate ? Number(r.fx_rate) : null, day: r.day })
  }
  return out
}

const rateFor = (currency: string, day: string) => usdRate(currency, day, { fetchMissing: true })

/**
 * Pull refunds and disputes for one store.
 *
 * `sinceDays` bounds the refund pass (orders updated since). Disputes are
 * always read whole: there are tens, not thousands, and a status can change
 * weeks later, so re-reading is how a win is ever seen.
 */
export async function syncAdjustments(
  store: AdjustmentStore,
  opts: { sinceDays?: number } = {}
): Promise<SyncAdjustments> {
  const out: SyncAdjustments = { tenantId: store.id, refunds: 0, disputes: 0, unconverted: 0 }
  const tz = store.timezone || 'UTC'
  const since = new Date(Date.now() - (opts.sinceDays ?? 60) * 86400000).toISOString()
  const headers = { 'X-Shopify-Access-Token': store.shopify_access_token }

  // ── Refunds ───────────────────────────────────────────────────────────────
  // GraphQL, because shopMoney is the store's own currency; the REST amount is
  // the customer's (a PKR 24,800 refund is $89.56).
  try {
    const filter =
      `updated_at:>=${since.slice(0, 10)} ` +
      `AND (financial_status:refunded OR financial_status:partially_refunded)`
    let cursor: string | null = null
    for (;;) {
      const res: Response = await fetch(adminUrl(store.shopify_domain, 'graphql.json'), {
        method: 'POST',
        headers: { ...headers, 'Content-Type': 'application/json' },
        body: JSON.stringify({ query: REFUNDS_QUERY, variables: { cursor, q: filter } }),
      })
      if (!res.ok) throw new Error(`estornos: Shopify HTTP ${res.status}`)
      const json = await res.json()
      if (json.errors) throw new Error(`estornos GraphQL: ${JSON.stringify(json.errors).slice(0, 200)}`)

      const conn = json.data?.orders
      const nodes = (conn?.edges ?? []).map((e: { node: GqlOrder }) => e.node) as GqlOrder[]
      const orders = await knownOrders(store, nodes.map(n => String(n.id).split('/').pop() ?? ''))
      for (const order of nodes) {
        const orderId = String(order.id).split('/').pop() ?? null
        const known = orderId ? orders.get(orderId) ?? null : null
        for (const refund of order.refunds ?? []) {
          const shop = refund.totalRefundedSet?.shopMoney
          const presented = refund.totalRefundedSet?.presentmentMoney
          const raw = Number(shop?.amount ?? 0)
          if (!(raw > 0)) continue
          const eventDate = localDate(refund.createdAt, tz)
          if (!eventDate) continue
          const usd = await toUsd({
            amount: raw, currency: shop?.currencyCode ?? store.shopify_currency, kind: 'refund',
            day: eventDate, order: known, rateFor,
          })
          if (usd === null) { out.unconverted++; continue }
          await query(
            `INSERT INTO order_adjustments (
               tenant_id, kind, external_id, order_id, event_date, order_date,
               amount, currency, original_amount, original_currency, reason, synced_at
             ) VALUES ($1,'refund',$2,$3,$4::date,$5::date,$6,'USD',$7,$8,$9,NOW())
             ON CONFLICT (tenant_id, kind, external_id) DO UPDATE SET
               amount = $6, currency = 'USD', original_amount = $7, original_currency = $8,
               event_date = $4::date, order_date = $5::date, synced_at = NOW()`,
            [
              store.id, String(refund.id).split('/').pop(), orderId,
              eventDate, known?.day ?? localDate(order.createdAt, tz),
              usd,
              presented ? Number(presented.amount) : raw,
              presented?.currencyCode ?? shop?.currencyCode ?? null,
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
    let url: string | null = adminUrl(store.shopify_domain, 'shopify_payments/disputes.json?limit=250')
    while (url) {
      const res: Response = await fetch(url, { headers })
      if (res.status === 403) {
        // The token predates the payments scope; until it is reissued this
        // store simply has no dispute data (blindToChargebacks says so).
        out.skipped = DISPUTES_FORBIDDEN
        break
      }
      if (!res.ok) throw new Error(`disputas: Shopify HTTP ${res.status}`)
      const { disputes = [] } = await res.json() as { disputes: ShopifyDispute[] }
      const orders = await knownOrders(store, disputes.map(d => (d.order_id ? String(d.order_id) : '')).filter(Boolean))

      for (const d of disputes) {
        const orderId = d.order_id ? String(d.order_id) : null
        const known = orderId ? orders.get(orderId) ?? null : null
        const eventDate = localDate(d.initiated_at, tz)
        if (!eventDate) continue
        const usd = await toUsd({ amount: Number(d.amount), currency: d.currency, kind: 'chargeback', day: eventDate, order: known, rateFor })
        if (usd === null) { out.unconverted++; continue }
        await query(
          `INSERT INTO order_adjustments (
             tenant_id, kind, external_id, order_id, event_date, order_date,
             amount, fee, currency, original_amount, original_currency,
             reason, status, evidence_due_by, finalized_on, synced_at
           ) VALUES ($1,'chargeback',$2,$3,$4::date,$5::date,$6,$7,'USD',$8,$9,$10,$11,$12,$13,NOW())
           ON CONFLICT (tenant_id, kind, external_id) DO UPDATE SET
             -- Status is the field that moves; the rest is restated so a
             -- correction on Shopify's side lands here too.
             status = $11, amount = $6, currency = 'USD', original_amount = $8, original_currency = $9,
             evidence_due_by = $12, finalized_on = $13, event_date = $4::date, order_date = $5::date,
             synced_at = NOW()`,
          [
            store.id, String(d.id), orderId, eventDate, known?.day ?? null,
            usd, CHARGEBACK_FEE, Number(d.amount), d.currency,
            d.reason, d.status, d.evidence_due_by ?? null, d.finalized_on ?? null,
          ]
        )
        out.disputes++
      }
      url = nextPage(res)
    }
  } catch (err) {
    out.error = [out.error, err instanceof Error ? err.message : String(err)].filter(Boolean).join(' · ')
  }

  return out
}

/** Active stores with a Shopify token (archived ones keep history, no sync). */
export async function adjustmentStores(): Promise<AdjustmentStore[]> {
  return query<AdjustmentStore>(
    `SELECT id, shopify_domain, shopify_access_token, COALESCE(timezone, 'UTC') AS timezone, shopify_currency
     FROM tenants
     WHERE shopify_access_token IS NOT NULL AND shopify_domain IS NOT NULL
       AND archived_at IS NULL
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

export interface AdjustmentImpact {
  /** What refunds actually cost: the contribution the order would have left. */
  refundHit: number
  refundGross: number
  refundCount: number
  /** Chargebacks take the whole value, and the fee on top. */
  chargebackHit: number
  chargebackFees: number
  chargebackCount: number
  /** Everything above, as one number to subtract from profit. */
  total: number
  /** Refunds skipped because the profit engine already dropped their order. */
  alreadyCounted: number
  /** True when this store's token cannot read disputes — clean here means blind. */
  blindToChargebacks: boolean
}

export const NO_IMPACT: AdjustmentImpact = {
  refundHit: 0, refundGross: 0, refundCount: 0,
  chargebackHit: 0, chargebackFees: 0, chargebackCount: 0,
  total: 0, alreadyCounted: 0, blindToChargebacks: false,
}

/**
 * What the adjustments that *arrived* in this window take off the profit.
 *
 * Two things make this more than a sum:
 *
 * The profit engine already drops a fully refunded order from the day it was
 * placed — whatever window that day is in. Its refund is therefore skipped
 * here whenever we hold the order as 'refunded', as lib/engine/pnl.ts does.
 * (Skipping only when the order fell inside this window charged the loss
 * twice across periods: once by dropping the order from October, again as a
 * November refund.)
 *
 * A refund costs the contribution, not the revenue: treating the order as
 * though it never happened returns the product and shipping cost along with the
 * sale. A chargeback costs the full value plus the fee, because there the goods
 * are gone and the money went with them.
 */
export async function getAdjustmentImpact(
  tenantId: string, from: string, to: string, nonAdRatio: number
): Promise<AdjustmentImpact> {
  try {
    const refunds = await query<{ amount: string; status: string | null }>(
      `SELECT a.amount::text, o.financial_status AS status
       FROM order_adjustments a
       LEFT JOIN shopify_orders o ON o.order_id = a.order_id AND o.tenant_id = a.tenant_id
       WHERE a.tenant_id = $1 AND a.kind = 'refund'
         AND a.event_date BETWEEN $2::date AND $3::date`,
      [tenantId, from, to]
    )

    let refundGross = 0, alreadyCounted = 0, refundCount = 0
    for (const r of refunds) {
      if (r.status === 'refunded') { alreadyCounted += Number(r.amount); continue }
      refundGross += Number(r.amount)
      refundCount++
    }

    const [cb] = await query<{ amount: string; fees: string; n: string }>(
      `SELECT COALESCE(SUM(amount), 0)::text AS amount,
              COALESCE(SUM(fee), 0)::text    AS fees,
              count(*)::text                 AS n
       FROM order_adjustments
       WHERE tenant_id = $1 AND kind = 'chargeback'
         AND status IS DISTINCT FROM 'won'
         AND event_date BETWEEN $2::date AND $3::date`,
      [tenantId, from, to]
    )

    const [seen] = await query<{ n: string }>(
      `SELECT count(*)::text AS n FROM order_adjustments WHERE tenant_id = $1 AND kind = 'chargeback'`,
      [tenantId]
    )

    const refundHit = refundGross * (1 - nonAdRatio)
    const chargebackHit = Number(cb?.amount ?? 0)
    const chargebackFees = Number(cb?.fees ?? 0)

    return {
      refundHit, refundGross, refundCount,
      chargebackHit, chargebackFees,
      chargebackCount: Number(cb?.n ?? 0),
      total: refundHit + chargebackHit + chargebackFees,
      alreadyCounted,
      blindToChargebacks: Number(seen?.n ?? 0) === 0,
    }
  } catch {
    return NO_IMPACT
  }
}

/** A dispute waiting for the store's evidence. */
export interface AwaitingDispute { externalId: string; amount: number; currency: string; reason: string; dueBy: string | null }

/**
 * Chargebacks by status, in the groups the screens name. Every status lands in
 * exactly one group, so the groups add up to the count: "7 em aberto · 5
 * perdidas · 11 ganhas" next to "31 de 700 pedidos" (CAMP HALLOW, 90 days)
 * left out the 8 disputes Shopify marks "prevented", which were in the count,
 * the rate and the amount all the same.
 */
export interface DisputeStatusCounts {
  /** needs_response or under_review: still being decided. */
  open: number
  lost: number
  won: number
  /** Shopify's "prevented": closed before a decision (with its fee in the
   *  data, $15 each). Counted like any dispute (the prudent side): whether the
   *  processor's ratio counts it is not something the data says. */
  prevented: number
  /** Any other status (accepted, charge_refunded, empty or new). */
  other: number
}

export const NO_DISPUTES: DisputeStatusCounts = { open: 0, lost: 0, won: 0, prevented: 0, other: 0 }

/** Status rows (status, count) → the groups (pure). */
export function groupDisputeStatuses(rows: readonly { status: string | null; n: number | string }[]): DisputeStatusCounts {
  const out = { ...NO_DISPUTES }
  for (const r of rows) {
    const n = Number(r.n) || 0
    if (r.status === 'needs_response' || r.status === 'under_review') out.open += n
    else if (r.status === 'lost') out.lost += n
    else if (r.status === 'won') out.won += n
    else if (r.status === 'prevented') out.prevented += n
    else out.other += n
  }
  return out
}

/**
 * The chargebacks that ARRIVED in a window — event_date inside it, the
 * engine's rule for the period's chargeback cost (lib/engine/pnl) — by their
 * status today. The Resumo called every one of them "disputa aberta": EPOCH's
 * October read "37 disputas abertas" over 14 lost, 7 prevented and 16 open.
 */
export async function getWindowDisputeStatuses(tenantId: string, from: string, to: string): Promise<DisputeStatusCounts> {
  const rows = await query<{ status: string | null; n: string }>(
    `SELECT status, count(*)::text AS n
       FROM order_adjustments
      WHERE tenant_id = $1 AND kind = 'chargeback' AND event_date BETWEEN $2::date AND $3::date
      GROUP BY status`,
    [tenantId, from, to],
  )
  return groupDisputeStatuses(rows)
}

export interface ChargebackHealth {
  /** Disputes opened in the last 90 days, whatever their status. */
  count: number
  orders: number
  /** Count-based rate, which is the one payment processors act on. */
  rate: number
  amount: number
  fees: number
  open: number
  lost: number
  won: number
  /** The rest of `count` (DisputeStatusCounts): open + lost + won + prevented
   *  + other = count. Optional for hand-built fixtures; getChargebackHealth
   *  always sets them. */
  prevented?: number
  other?: number
  /**
   * EVERY dispute still waiting for the store's evidence ("needs_response")
   * whose deadline has not passed (or is unknown), soonest deadline first.
   * Not the first rows: a cut at 5 per store, then at 5 across stores, showed
   * "4–5 of 12" under a heading that reads as the to-do list.
   */
  dueSoon: AwaitingDispute[]
  /** Still "needs_response" but the evidence deadline already passed: counted,
   *  not listed (nothing can be sent any more). Optional for hand-built
   *  fixtures; getChargebackHealth always sets it. */
  overdue?: number
  hasData: boolean
  /** The store's disputes can be read (disputesReadable): false when its
   *  token has no Shopify Payments permission, so a zero proves nothing;
   *  null when unknown. Absent on sums and hand-built fixtures. */
  readable?: boolean | null
}

/** A "needs_response" chargeback row as the health query reads it. */
export interface NeedsResponseRow {
  external_id: string
  amount: string | number
  currency: string | null
  reason: string | null
  evidence_due_by: string | null
  /** evidence_due_by is set and already past (decided by the database clock). */
  overdue: boolean
}

/** Rows already ordered by deadline → the answerable list and the overdue count. */
export function splitNeedsResponse(rows: readonly NeedsResponseRow[]): { dueSoon: AwaitingDispute[]; overdue: number } {
  const dueSoon: AwaitingDispute[] = []
  let overdue = 0
  for (const r of rows) {
    if (r.overdue) { overdue++; continue }
    dueSoon.push({
      externalId: r.external_id,
      amount: Number(r.amount) || 0,
      currency: r.currency || 'USD',
      // Empty when Shopify gave none: the screen says "motivo não informado".
      reason: r.reason ?? '',
      dueBy: r.evidence_due_by,
    })
  }
  return { dueSoon, overdue }
}

/**
 * Several stores' health, summed (pure). The rate is recomputed from the
 * summed counts rather than averaged: a store with four orders and one dispute
 * would otherwise drag the whole number up as hard as one with four thousand.
 * The answerable disputes of every store are kept, soonest deadline first.
 */
export function combineChargebackHealth(each: readonly ChargebackHealth[]): ChargebackHealth {
  const sum = each.reduce((a, h) => ({
    count: a.count + h.count,
    orders: a.orders + h.orders,
    amount: a.amount + h.amount,
    fees: a.fees + h.fees,
    open: a.open + h.open,
    lost: a.lost + h.lost,
    won: a.won + h.won,
    prevented: a.prevented + (h.prevented ?? 0),
    other: a.other + (h.other ?? 0),
    overdue: a.overdue + (h.overdue ?? 0),
  }), { count: 0, orders: 0, amount: 0, fees: 0, open: 0, lost: 0, won: 0, prevented: 0, other: 0, overdue: 0 })

  return {
    ...sum,
    rate: sum.orders > 0 ? (sum.count / sum.orders) * 100 : 0,
    dueSoon: each.flatMap(h => h.dueSoon)
      .sort((a, b) => (a.dueBy ?? '9999').localeCompare(b.dueBy ?? '9999')),
    hasData: each.some(h => h.hasData),
  }
}

/** Chargeback health across several stores at once (combineChargebackHealth). */
export async function getCombinedChargebackHealth(tenantIds: string[]): Promise<ChargebackHealth> {
  return combineChargebackHealth(await Promise.all(tenantIds.map(id => getChargebackHealth(id))))
}

/** The number that decides whether Shopify Payments stays switched on. */
export async function getChargebackHealth(tenantId: string): Promise<ChargebackHealth> {
  const empty: ChargebackHealth = {
    count: 0, orders: 0, rate: 0, amount: 0, fees: 0,
    open: 0, lost: 0, won: 0, prevented: 0, other: 0, dueSoon: [], overdue: 0, hasData: false,
  }
  try {
    const [row] = await query<Record<string, string>>(
      `SELECT count(*)::text AS n,
              COALESCE(SUM(amount), 0)::text AS amount,
              COALESCE(SUM(fee), 0)::text    AS fees,
              count(*) FILTER (WHERE status IN ('needs_response','under_review'))::text AS open,
              count(*) FILTER (WHERE status = 'lost')::text AS lost,
              count(*) FILTER (WHERE status = 'won')::text  AS won,
              count(*) FILTER (WHERE status = 'prevented')::text AS prevented
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
    // Every dispute waiting for evidence, whatever its age (the deadline, not
    // the 90 days, decides whether it can still be answered); the database
    // clock splits the answerable ones from those past their deadline.
    const waiting = await query<NeedsResponseRow>(
      `SELECT external_id, amount::text, currency, reason, evidence_due_by::text,
              (evidence_due_by IS NOT NULL AND evidence_due_by <= now()) AS overdue
       FROM order_adjustments
       WHERE tenant_id = $1 AND kind = 'chargeback' AND status = 'needs_response'
       ORDER BY evidence_due_by NULLS LAST, external_id`,
      [tenantId]
    )
    const { dueSoon, overdue } = splitNeedsResponse(waiting)
    // The latest finished refunds/disputes pass says whether the token can
    // read disputes at all. Context only: a failed read is "unknown".
    const [run] = await query<{ status: string | null; error_message: string | null }>(
      `SELECT status, error_message FROM sync_runs
        WHERE tenant_id = $1 AND source = 'adjustments' AND status <> 'running'
        ORDER BY started_at DESC LIMIT 1`,
      [tenantId]
    ).catch(() => [])

    const count = Number(row?.n ?? 0)
    const orders = Number(ord?.n ?? 0)
    const open = Number(row?.open ?? 0)
    const lost = Number(row?.lost ?? 0)
    const won = Number(row?.won ?? 0)
    const prevented = Number(row?.prevented ?? 0)
    return {
      count, orders,
      rate: orders > 0 ? (count / orders) * 100 : 0,
      amount: Number(row?.amount ?? 0),
      fees: Number(row?.fees ?? 0),
      open, lost, won, prevented,
      // Whatever status is left (accepted, charge_refunded, empty), so the
      // parts always add up to the count.
      other: Math.max(0, count - open - lost - won - prevented),
      dueSoon,
      overdue,
      hasData: count > 0,
      readable: disputesReadable(run),
    }
  } catch {
    return empty
  }
}
