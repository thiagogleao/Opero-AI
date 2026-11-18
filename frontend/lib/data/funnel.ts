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
 *  - Shared-account campaigns (in this store's books, sales mostly in another
 *    shop: CAMP HALLOW's in EPOCH's old account) are left out of the steps,
 *    the capture and the spend per order, by the Campanhas rule
 *    (lib/data/campaigns partitionOwnShared), and named in `sharedLeftOut`.
 *    Counted, EPOCH's October read "o Meta viu 196% dos pedidos reais": 439
 *    of its 748 purchases were of campaigns whose sales landed in CAMP HALLOW.
 */

import { query } from '../db'
import { KEPT_ORDER_SQL } from '../engine/pnl'
import { isIsoDate, type DateRange } from '../engine/dates'
import { getSharedAdAccountsForStore } from '../attribution'
import { SHARED_ACCOUNT_NOTE } from '../attributionModels'
import { getOwnSharedFacts, type OwnSharedFacts } from './campaigns'
import type { AdDayFact } from './meta'

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

/** What a store's funnel leaves out: its shared-account campaigns. */
export interface FunnelSharedLeftOut {
  campaigns: number
  spend: number
  purchases: number
  purchaseValue: number
  /** Their Meta steps, so a sum over several stores can add them back when
   *  the stores their sales landed in are in the sum too. */
  values: Record<MetaStepKey, number>
  /** Stores most of their tracked orders landed in (ids). */
  salesStoreIds: string[]
}

export interface FunnelReport {
  storeId: string
  range: DateRange
  /** Meta spend of the store's own campaigns in the window (shared-account
   *  campaigns are in sharedLeftOut). */
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
  /** Shared-account campaigns left out of the steps, the capture and the
   *  spend per order; null when the store has none in the window. */
  sharedLeftOut: FunnelSharedLeftOut | null
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

/**
 * One funnel for several stores: Meta's step counts and Shopify's counts add
 * up; the rates are recomputed by the same rule (lib/data/funnel). A store's
 * shared-account campaigns come back in when every store their sales landed
 * in is in the sum (EPOCH's old account and CAMP HALLOW in "Todas": those
 * purchases are orders of the sum); otherwise they stay out, and are named.
 */
export function sumFunnels(list: FunnelReport[], inSum: ReadonlySet<string>, range: DateRange): FunnelReport {
  const values = Object.fromEntries(META_STEPS.map(s => [s.key, 0])) as Record<MetaStepKey, number>
  let spend = 0, orders = 0, abandoned = 0
  const left = { campaigns: 0, spend: 0, purchases: 0, purchaseValue: 0, values: { ...values }, salesStoreIds: new Set<string>() }
  for (const f of list) {
    spend += f.spend
    orders += f.shopify.orders
    abandoned += f.shopify.abandonedCheckouts
    for (const st of f.meta.steps) values[st.key] += st.value
    const lo = f.sharedLeftOut
    if (!lo) continue
    if (lo.salesStoreIds.length > 0 && lo.salesStoreIds.every(id => inSum.has(id))) {
      spend += lo.spend
      for (const k of META_STEPS) values[k.key] += lo.values[k.key]
    } else {
      left.campaigns += lo.campaigns; left.spend += lo.spend; left.purchases += lo.purchases; left.purchaseValue += lo.purchaseValue
      for (const k of META_STEPS) left.values[k.key] += lo.values[k.key]
      for (const id of lo.salesStoreIds) left.salesStoreIds.add(id)
    }
  }
  const hasLeft = left.spend > 0 || left.purchases > 0
  return {
    storeId: 'todas',
    range,
    spend,
    meta: buildMetaSteps(values, spend),
    shopify: {
      orders, abandonedCheckouts: abandoned,
      abandonmentPct: orders + abandoned > 0 ? (abandoned / (orders + abandoned)) * 100 : null,
      costPerOrder: orders > 0 && spend > 0 ? spend / orders : null,
    },
    metaCapturePct: orders > 0 && spend > 0 ? (values.purchases / orders) * 100 : null,
    notes: [...new Set(list.flatMap(f => f.notes))],
    sharedLeftOut: hasLeft ? { ...left, salesStoreIds: [...left.salesStoreIds] } : null,
  }
}

// ─── Loading ──────────────────────────────────────────────────────────────────

const num = (v: unknown): number => Number(v) || 0

const emptyValues = (): Record<MetaStepKey, number> =>
  ({ impressions: 0, link_clicks: 0, landing_page_views: 0, add_to_cart: 0, initiate_checkout: 0, purchases: 0 })

/** Meta's step counts and spend over ad-day facts (phantoms already dropped
 *  by the fact read, lib/data/meta loadAdDayFacts). */
export function stepValues(facts: readonly AdDayFact[]): { values: Record<MetaStepKey, number>; spend: number; purchaseValue: number } {
  const values = emptyValues()
  let spend = 0, purchaseValue = 0
  for (const f of facts) {
    values.impressions += f.impressions
    values.link_clicks += f.linkClicks
    values.landing_page_views += f.landingPageViews
    values.add_to_cart += f.addToCart
    values.initiate_checkout += f.initiateCheckout
    values.purchases += f.purchases
    spend += f.spend
    purchaseValue += f.purchaseValue
  }
  return { values, spend, purchaseValue }
}

/** The funnel from a store's split facts and its Shopify counts. No database. */
export function buildFunnel(
  storeId: string, range: DateRange, split: OwnSharedFacts,
  counts: { orders: number; abandonedCheckouts: number }, sharedPairs: number,
): FunnelReport {
  const own = stepValues(split.own)
  const out = stepValues(split.shared)
  const { orders, abandonedCheckouts } = counts
  const sharedLeftOut: FunnelSharedLeftOut | null = split.sharedGroups.length
    ? {
        campaigns: split.sharedGroups.filter(g => g.campaignId).length,
        spend: out.spend, purchases: out.values.purchases, purchaseValue: out.purchaseValue, values: out.values,
        salesStoreIds: [...new Set(split.sharedGroups.map(g => g.salesStoreId).filter((x): x is string => !!x))],
      }
    : null
  return {
    storeId,
    range,
    spend: own.spend,
    meta: buildMetaSteps(own.values, own.spend),
    shopify: {
      orders,
      abandonedCheckouts,
      abandonmentPct: orders + abandonedCheckouts > 0 ? (abandonedCheckouts / (orders + abandonedCheckouts)) * 100 : null,
      costPerOrder: orders > 0 && own.spend > 0 ? own.spend / orders : null,
    },
    metaCapturePct: orders > 0 && own.spend > 0 ? (own.values.purchases / orders) * 100 : null,
    // The left-out campaigns get their own sentence on screen (with the store
    // names); the generic note stays for a store that sells on another's ads.
    notes: !sharedLeftOut && sharedPairs > 0 ? [SHARED_ACCOUNT_NOTE] : [],
    sharedLeftOut,
  }
}

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
  const [split, counts, shared] = await Promise.all([
    getOwnSharedFacts(store.id, range),
    getCheckoutCounts(store, range),
    getSharedAdAccountsForStore(store.id, range).catch(() => []),
  ])
  return buildFunnel(store.id, range, split, counts, shared.length)
}
