import { accountOverviewForRange, type AccountOverviewView, type OverviewStoreRow } from './data/overview'
import type { AdjustmentImpact } from './adjustments'
import type { StoreFreshness } from './views/portfolio'
import type { SharedAdAccount } from './attributionModels'
import type { Tenant } from './tenant'

/**
 * The account overview in the shape the current /overview screen and the
 * alerts (lib/alerts.ts) read. Every number now comes from lib/data/overview.ts
 * — one computePnL call for all the stores — so this file only renames fields.
 * New code should use buildAccountOverview / accountOverviewForRange there and
 * read the engine's PnL directly.
 */

export interface StoreOverviewRow {
  id: string
  name: string
  domain: string | null
  /** false = store has no cost config, so profit is only revenue − ad spend */
  configured: boolean
  revenue: number
  orders: number
  /** Meta spend. Shopify ads ("Anúncios Shopify") are their own line,
   *  `shopSpend`, and are never mixed into the Meta ROAS. */
  adSpend: number
  shopSpend: number
  /** Revenue − variable costs, before any ads. */
  contribution: number
  /** The engine's operating profit: contribution − Meta − Shopify ads − fixed costs. */
  profit: number
  margin: number
  /** Store revenue ÷ Meta spend. */
  roas: number
  /** revenue ÷ contribution: the Meta ROAS below which ads eat the margin.
   *  Null when the store has no positive contribution, and when it has no
   *  cost settings (the engine's 1.00 there only means "no costs known").
   *  Alerts should judge each store against its own break-even. */
  breakEvenRoas: number | null
  aov: number
  /** The store's own today, and where its day stands for this window. */
  storeToday: string
  dayState: OverviewStoreRow['dayState']
  freshness: StoreFreshness
  /** true = the engine returned nothing for this store; its numbers are zero, not real */
  failed: boolean
  /** Refunds and chargebacks that landed in the window for this store. */
  impact: AdjustmentImpact
}

export interface AccountTotals {
  revenue: number
  orders: number
  adSpend: number
  shopSpend: number
  contribution: number
  profit: number
  margin: number
  roas: number
  aov: number
}

/** Same fields as profitCalc's DailyProfitPoint. `profit` is the operating
 *  profit, so the days sum to the totals' profit (Shop Campaigns included). */
export interface OverviewDailyPoint {
  date: string
  revenue: number
  profit: number
  fbSpend: number
  margin: number | null
}

export interface AccountOverview {
  stores: StoreOverviewRow[]
  totals: AccountTotals
  daily: OverviewDailyPoint[]
  unconfigured: string[]
  failed: string[]
  /** Newest successful sync across the stores (what AutoSync waits on). */
  lastSyncIso: string | null
  /** Oldest of the stores' last successful syncs: a store whose sync stopped
   *  shows here, where the newest would hide it. */
  oldestSyncIso: string | null
  /** Stores whose numbers are older than their sync cadence allows. */
  staleStores: string[]
  /** Refunds and chargebacks that landed in this window, whatever day their
   *  order is from. Kept apart from `totals` on purpose: money arriving today
   *  for an August order is not a verdict on today's operation. */
  adjustments: AdjustmentImpact
  /** Stores whose token cannot read disputes — their silence is not good news. */
  blindStores: string[]
  /** CAMP HALLOW selling on ads billed to EPOCH, and the like. */
  sharedAdAccounts: SharedAdAccount[]
  sharedAccountNote: string | null
}

/** Stores that can actually report numbers — a half-finished OAuth has no token. */
export function accountStores<T extends { shopify_access_token: string | null }>(tenants: T[]): T[] {
  return tenants.filter(t => t.shopify_access_token !== null)
}

type Named = { shop_name: string | null; shopify_domain: string | null }

const baseLabel = (t: Named) =>
  t.shop_name ?? t.shopify_domain?.replace('.myshopify.com', '') ?? 'Loja'

/** Clone stores legitimately share a Shopify name, which would render as two
 *  identical rows. Append the handle only where names actually collide. */
function labeller(tenants: Named[]): (t: Named) => string {
  const counts = new Map<string, number>()
  for (const t of tenants) counts.set(baseLabel(t), (counts.get(baseLabel(t)) ?? 0) + 1)
  return t =>
    (counts.get(baseLabel(t)) ?? 0) > 1 && t.shopify_domain
      ? `${baseLabel(t)} (${t.shopify_domain.replace('.myshopify.com', '')})`
      : baseLabel(t)
}

function impactOf(r: OverviewStoreRow): AdjustmentImpact {
  const t = r.totals
  return {
    refundHit: t.refunds, refundGross: t.refundGross, refundCount: t.refundCount,
    chargebackHit: t.chargebacks, chargebackFees: t.chargebackFees, chargebackCount: t.chargebackCount,
    total: t.adjustments,
    alreadyCounted: r.refundsAlreadyDropped,
    blindToChargebacks: r.blindToChargebacks,
  }
}

function toRow(r: OverviewStoreRow, domain: string | null): StoreOverviewRow {
  const t = r.totals
  return {
    id: r.id, name: r.name, domain,
    configured: r.configured,
    revenue: t.revenue, orders: t.orders,
    adSpend: t.metaSpend, shopSpend: t.shopSpend,
    contribution: t.contribution,
    profit: t.operatingProfit,
    margin: t.margin ?? 0,
    roas: t.roas ?? 0,
    breakEvenRoas: r.configured ? t.breakEvenRoas : null,
    aov: t.orders > 0 ? t.revenue / t.orders : 0,
    storeToday: r.storeToday, dayState: r.dayState, freshness: r.freshness,
    failed: false,
    impact: impactOf(r),
  }
}

function legacyShape(view: AccountOverviewView, tenants: (Named & { id: string })[], nameOf: (t: Named) => string): AccountOverview {
  const domainOf = new Map(tenants.map(t => [t.id, t.shopify_domain]))
  const stores = view.stores.map(r => toRow(r, domainOf.get(r.id) ?? null))
  const failed = tenants.filter(t => view.missingStoreIds.includes(t.id)).map(nameOf)
  const t = view.totals
  const r2 = (v: number) => Math.round(v * 100) / 100
  const adjustments = view.stores.map(impactOf).reduce<AdjustmentImpact>((a, s) => ({
    refundHit: a.refundHit + s.refundHit, refundGross: a.refundGross + s.refundGross,
    refundCount: a.refundCount + s.refundCount, chargebackHit: a.chargebackHit + s.chargebackHit,
    chargebackFees: a.chargebackFees + s.chargebackFees, chargebackCount: a.chargebackCount + s.chargebackCount,
    total: a.total + s.total, alreadyCounted: a.alreadyCounted + s.alreadyCounted,
    blindToChargebacks: a.blindToChargebacks || s.blindToChargebacks,
  }), {
    refundHit: 0, refundGross: 0, refundCount: 0, chargebackHit: 0, chargebackFees: 0, chargebackCount: 0,
    total: 0, alreadyCounted: 0, blindToChargebacks: false,
  })

  return {
    stores,
    totals: {
      revenue: t.revenue, orders: t.orders, adSpend: t.metaSpend, shopSpend: t.shopSpend,
      contribution: t.contribution, profit: t.operatingProfit,
      margin: t.margin ?? 0, roas: t.roas ?? 0, aov: t.orders > 0 ? t.revenue / t.orders : 0,
    },
    daily: view.daily.map(d => ({
      date: d.date, revenue: r2(d.revenue), profit: r2(d.operatingProfit), fbSpend: r2(d.metaSpend),
      margin: d.margin === null ? null : Math.round(d.margin * 10) / 10,
    })),
    unconfigured: view.stores.filter(s => !s.configured).map(s => s.name),
    failed,
    lastSyncIso: view.freshness.newestSuccessAt,
    oldestSyncIso: view.freshness.oldestSuccessAt,
    staleStores: view.freshness.staleStores.map(s => s.name),
    adjustments,
    blindStores: view.stores.filter(s => s.blindToChargebacks).map(s => s.name),
    sharedAdAccounts: view.sharedAdAccounts,
    sharedAccountNote: view.sharedAccountNote,
  }
}

/**
 * Account-wide numbers for explicit dates: every store summed, plus the rows
 * behind the total. Each store reads the dates on its own calendar.
 */
export async function getAccountOverview(
  tenants: Pick<Tenant, 'id' | 'shop_name' | 'shopify_domain' | 'timezone'>[],
  dateFrom: string,
  dateTo: string,
): Promise<AccountOverview> {
  const nameOf = labeller(tenants)
  const view = await accountOverviewForRange(
    tenants.map(t => ({ id: t.id, name: nameOf(t), timezone: t.timezone || 'UTC' })),
    { from: dateFrom, to: dateTo },
  )
  return legacyShape(view, tenants, nameOf)
}
