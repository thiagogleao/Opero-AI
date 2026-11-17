/**
 * The purchase funnel: what Meta measured, and what Shopify recorded, apart.
 *
 * The old funnel ran Meta's steps straight into Shopify's order count and so
 * printed "134% de conversão" between Meta purchases and real orders. Those are
 * two different sources measuring overlapping things; their ratio is Meta's
 * capture, not a conversion. Here:
 *  - Meta's steps are only the ones the pixel actually measures (a step that is
 *    zero while later steps are not — landing page views, today — is left out
 *    and named), and a step-to-step rate above 100% is not shown as a rate.
 *  - Shopify's row is orders and abandoned checkouts, on the store's own days.
 *    Abandoned checkouts are counted, never valued: their totals are corrupt
 *    (one marks $263,859, currencies are null) and filtering by value dropped a
 *    third of EPOCH's checkouts.
 *  - Meta purchases go through the engine's phantom filter.
 */

import { query } from '../db'
import { KEPT_ORDER_SQL, purchasesSql } from '../engine/pnl'
import { isIsoDate, type DateRange } from '../engine/dates'
import { getSharedAdAccountsForStore } from '../attribution'
import { SHARED_ACCOUNT_NOTE } from '../attributionModels'

// ─── Types ────────────────────────────────────────────────────────────────────

export type MetaStepKey = 'impressions' | 'link_clicks' | 'landing_page_views' | 'add_to_cart' | 'initiate_checkout' | 'purchases'

export interface FunnelStep {
  key: MetaStepKey
  label: string
  value: number
  /** value ÷ previous shown step, in %. Null for the first step, and when the
   *  step exceeds the one before it (Meta counts the steps separately; above
   *  100% is not a conversion). */
  ratePct: number | null
  /** True when this step counted more than the step before it. */
  exceedsPrevious: boolean
  /** Meta spend ÷ value. */
  costPer: number | null
}

export interface FunnelReport {
  storeId: string
  range: DateRange
  /** Meta spend of the store's own ad account in the window. */
  spend: number
  meta: {
    steps: FunnelStep[]
    /** Steps the pixel does not measure for this store (always zero). */
    omitted: { key: MetaStepKey; label: string }[]
    cpm: number | null
  }
  shopify: {
    /** Kept orders (not refunded/voided) on the store's own dates — the
     *  engine's order count. */
    orders: number
    /** Count only; the stored values are not trustworthy. */
    abandonedCheckouts: number
    /** abandoned ÷ (abandoned + orders), in %. */
    abandonmentPct: number | null
    /** Meta spend ÷ real orders. */
    costPerOrder: number | null
  }
  /** Meta purchases ÷ Shopify orders, in %: how much of the real sales Meta
   *  claims. Not a conversion rate; can be above 100. */
  metaCapturePct: number | null
  /** Portuguese sentences to show under the funnel (shared ad account…). */
  notes: string[]
}

export const META_STEPS: { key: MetaStepKey; label: string }[] = [
  { key: 'impressions',        label: 'Impressões' },
  { key: 'link_clicks',        label: 'Cliques no link' },
  { key: 'landing_page_views', label: 'Visualizações da página' },
  { key: 'add_to_cart',        label: 'Adições ao carrinho' },
  { key: 'initiate_checkout',  label: 'Checkouts iniciados' },
  { key: 'purchases',          label: 'Compras (Meta)' },
]

// ─── Pure helpers (exported for the tests) ────────────────────────────────────

/**
 * Meta's steps as a funnel. A zero step is dropped when any later step has a
 * value (the pixel does not measure it); trailing zeros stay, they are real.
 * With nothing measured at all (no Meta ads in the window) there is no funnel.
 */
export function buildMetaSteps(values: Record<MetaStepKey, number>, spend: number): FunnelReport['meta'] {
  if (META_STEPS.every(s => (values[s.key] ?? 0) <= 0)) return { steps: [], omitted: [], cpm: null }
  const omitted: { key: MetaStepKey; label: string }[] = []
  const kept = META_STEPS.filter((s, i) => {
    const later = META_STEPS.slice(i + 1).some(x => (values[x.key] ?? 0) > 0)
    if ((values[s.key] ?? 0) <= 0 && later) { omitted.push(s); return false }
    return true
  })
  const steps: FunnelStep[] = []
  for (const s of kept) {
    const value = values[s.key] ?? 0
    const prev = steps.length ? steps[steps.length - 1].value : null
    const exceedsPrevious = prev !== null && value > prev
    steps.push({
      key: s.key, label: s.label, value,
      ratePct: prev !== null && prev > 0 && !exceedsPrevious ? (value / prev) * 100 : null,
      exceedsPrevious,
      costPer: value > 0 && spend > 0 ? spend / value : null,
    })
  }
  const impressions = values.impressions ?? 0
  return { steps, omitted, cpm: impressions > 0 ? (spend / impressions) * 1000 : null }
}

// ─── Loading ──────────────────────────────────────────────────────────────────

const num = (v: unknown): number => Number(v) || 0

/** Abandoned checkouts and kept orders of one store, on its own calendar. */
export async function getCheckoutCounts(store: { id: string }, range: DateRange): Promise<{ orders: number; abandonedCheckouts: number }> {
  const [row] = await query<{ orders: number; abandoned: number }>(
    `WITH tz AS (SELECT COALESCE(timezone, 'UTC') AS name FROM tenants WHERE id = $1)
     SELECT (SELECT COUNT(*) FROM shopify_orders o, tz
              WHERE o.tenant_id = $1
                AND o.created_at >= ($2::date - 2)::timestamptz AND o.created_at < ($3::date + 3)::timestamptz
                AND (o.created_at AT TIME ZONE tz.name)::date BETWEEN $2::date AND $3::date
                AND ${KEPT_ORDER_SQL})::int AS orders,
            (SELECT COUNT(*) FROM shopify_abandoned_checkouts c, tz
              WHERE c.tenant_id = $1
                AND c.created_at >= ($2::date - 2)::timestamptz AND c.created_at < ($3::date + 3)::timestamptz
                AND (c.created_at AT TIME ZONE tz.name)::date BETWEEN $2::date AND $3::date)::int AS abandoned`,
    [store.id, range.from, range.to],
  )
  return { orders: num(row?.orders), abandonedCheckouts: num(row?.abandoned) }
}

export async function getFunnel(store: { id: string }, range: DateRange): Promise<FunnelReport> {
  if (!isIsoDate(range.from) || !isIsoDate(range.to) || range.from > range.to) {
    throw new RangeError(`invalid range ${range.from}..${range.to}`)
  }
  const [[m], counts, shared] = await Promise.all([
    query<Record<MetaStepKey | 'spend', number>>(
      // ::float8 everywhere: pg returns bigint sums as strings, which is how the
      // old funnel printed "4278774" with no separators.
      `SELECT COALESCE(SUM(impressions), 0)::float8        AS impressions,
              COALESCE(SUM(link_clicks), 0)::float8        AS link_clicks,
              COALESCE(SUM(landing_page_views), 0)::float8 AS landing_page_views,
              COALESCE(SUM(add_to_cart), 0)::float8        AS add_to_cart,
              COALESCE(SUM(initiate_checkout), 0)::float8  AS initiate_checkout,
              COALESCE(SUM(${purchasesSql()}), 0)::float8  AS purchases,
              COALESCE(SUM(spend), 0)::float8              AS spend
         FROM fb_ad_daily_metrics
        WHERE tenant_id = $1 AND date BETWEEN $2::date AND $3::date`,
      [store.id, range.from, range.to],
    ),
    getCheckoutCounts(store, range),
    getSharedAdAccountsForStore(store.id, range).catch(() => []),
  ])
  const values = Object.fromEntries(META_STEPS.map(s => [s.key, num(m?.[s.key])])) as Record<MetaStepKey, number>
  const spend = num(m?.spend)
  const { orders, abandonedCheckouts } = counts
  return {
    storeId: store.id,
    range,
    spend,
    meta: buildMetaSteps(values, spend),
    shopify: {
      orders,
      abandonedCheckouts,
      abandonmentPct: orders + abandonedCheckouts > 0 ? (abandonedCheckouts / (orders + abandonedCheckouts)) * 100 : null,
      costPerOrder: orders > 0 && spend > 0 ? spend / orders : null,
    },
    metaCapturePct: orders > 0 && spend > 0 ? (values.purchases / orders) * 100 : null,
    notes: shared.length ? [SHARED_ACCOUNT_NOTE] : [],
  }
}
