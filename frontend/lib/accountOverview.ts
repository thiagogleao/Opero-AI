import { getProfitSummary, getDailyProfitData, type DailyProfitPoint } from './profitCalc'
import { getOverviewMetrics, getDailyRevenue } from './queries'
import { query } from './db'
import type { Tenant } from './tenant'

export interface StoreOverviewRow {
  id: string
  name: string
  domain: string | null
  /** false = store has no cost config, so profit is only revenue − ad spend */
  configured: boolean
  revenue: number
  orders: number
  adSpend: number
  profit: number
  margin: number
  roas: number
  aov: number
  /** true = this store's queries failed; its numbers are zeroed, not real */
  failed: boolean
}

export interface AccountTotals {
  revenue: number
  orders: number
  adSpend: number
  profit: number
  margin: number
  roas: number
  aov: number
}

export interface AccountOverview {
  stores: StoreOverviewRow[]
  totals: AccountTotals
  daily: DailyProfitPoint[]
  unconfigured: string[]
  failed: string[]
  lastSyncIso: string | null
}

/** Stores that can actually report numbers — a half-finished OAuth has no token. */
export function accountStores(tenants: Tenant[]): Tenant[] {
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

/** Account-wide numbers: every store of one user summed for the period,
 *  plus the per-store rows behind the total. */
export async function getAccountOverview(
  tenants: Tenant[],
  dateFrom: string,
  dateTo: string
): Promise<AccountOverview> {
  const nameOf = labeller(tenants)

  // A single-day range draws no chart, and getDailyProfitData recomputes the
  // whole summary internally — so skip it rather than pay for an unused series.
  const wantDaily = dateFrom !== dateTo
  const byDate = new Map<string, DailyProfitPoint>()

  // One store failing (bad credentials, sync gap) must not blank the whole
  // page, so failures are caught per store and flagged on the row.
  const stores = await Promise.all(tenants.map(async (t): Promise<StoreOverviewRow> => {
    const base = { id: t.id, name: nameOf(t), domain: t.shopify_domain }
    try {
      const metrics = await getOverviewMetrics(t.id, dateFrom, dateTo)
      const summary = await getProfitSummary(t.id, dateFrom, dateTo)

      const revenue = Number(metrics.revenue)
      const orders  = Number(metrics.orders)
      // The profit summary drops ad accounts the user switched off, so it is the
      // truer spend whenever costs are configured at all.
      const adSpend = summary.configured ? summary.fbSpend : Number(metrics.spend)
      const profit  = summary.configured ? summary.netProfit : revenue - adSpend

      if (wantDaily) {
        const points = summary.configured
          ? (await getDailyProfitData(t.id, dateFrom, dateTo)).dailyData
          : (await getDailyRevenue(t.id, dateFrom, dateTo))
              .filter(d => d.revenue > 0 || d.spend > 0)
              .map(d => ({
                date: d.date, revenue: d.revenue, fbSpend: d.spend,
                profit: d.revenue - d.spend, margin: null,
              }))
        for (const p of points) {
          const cur = byDate.get(p.date) ?? { date: p.date, revenue: 0, profit: 0, fbSpend: 0, margin: null }
          cur.revenue += p.revenue
          cur.profit  += p.profit
          cur.fbSpend += p.fbSpend
          byDate.set(p.date, cur)
        }
      }

      return {
        ...base,
        configured: summary.configured,
        revenue, orders, adSpend, profit,
        margin: revenue > 0 ? (profit / revenue) * 100 : 0,
        roas:   adSpend > 0 ? revenue / adSpend : 0,
        aov:    orders  > 0 ? revenue / orders  : 0,
        failed: false,
      }
    } catch (err) {
      console.error('[overview] store failed', t.id, err)
      return {
        ...base, configured: false, revenue: 0, orders: 0, adSpend: 0,
        profit: 0, margin: 0, roas: 0, aov: 0, failed: true,
      }
    }
  }))

  const sum = stores.reduce((a, s) => ({
    revenue: a.revenue + s.revenue,
    orders:  a.orders  + s.orders,
    adSpend: a.adSpend + s.adSpend,
    profit:  a.profit  + s.profit,
  }), { revenue: 0, orders: 0, adSpend: 0, profit: 0 })

  // Margin and ROAS come from the summed totals — averaging each store's own
  // ratio would weight a tiny store the same as a large one.
  const totals: AccountTotals = {
    ...sum,
    margin: sum.revenue  > 0 ? (sum.profit / sum.revenue) * 100 : 0,
    roas:   sum.adSpend  > 0 ? sum.revenue / sum.adSpend : 0,
    aov:    sum.orders   > 0 ? sum.revenue / sum.orders  : 0,
  }

  const daily = [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    .map(p => ({
      date: p.date,
      revenue: Math.round(p.revenue * 100) / 100,
      profit:  Math.round(p.profit  * 100) / 100,
      fbSpend: Math.round(p.fbSpend * 100) / 100,
      margin:  p.revenue > 0 ? Math.round((p.profit / p.revenue) * 1000) / 10 : null,
    }))

  let lastSyncIso: string | null = null
  try {
    const [row] = await query<{ finished_at: string | null }>(
      `SELECT MAX(finished_at)::text AS finished_at
       FROM sync_runs
       WHERE tenant_id = ANY($1::text[]) AND status = 'success'`,
      [tenants.map(t => t.id)]
    )
    lastSyncIso = row?.finished_at ?? null
  } catch { /* sync time is cosmetic — never block the page on it */ }

  return {
    stores: [...stores].sort((a, b) => b.profit - a.profit),
    totals,
    daily,
    unconfigured: stores.filter(s => !s.configured && !s.failed).map(s => s.name),
    failed: stores.filter(s => s.failed).map(s => s.name),
    lastSyncIso,
  }
}
