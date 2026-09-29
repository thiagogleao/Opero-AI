import { query } from './db'
import { getProfitSummary } from './profitCalc'
import { REFERENCE_TZ, todayInTz, shiftDate } from './mobileRange'

/**
 * Profit accumulating through a single day.
 *
 * The point is to see the shape of the day, not just its close: a morning that
 * was ahead and gave it all back looks identical to a flat day once both are
 * summed into one number.
 *
 * Ad spend is the limitation. Meta reports it per day, never per hour, so the
 * day's recorded spend is spread evenly across the hours it covers. That makes
 * the curve fall during any hour whose sales did not cover a flat share of the
 * burn — which is the question being asked — but it cannot show that a burst of
 * delivery at 3pm was what drained it. The revenue side is exact.
 */

export interface IntradayPoint {
  /** Hour of day, 0-23, in the reference timezone. */
  hour: number
  label: string
  revenue: number
  orders: number
  /** Cumulative through the end of this hour. */
  cumRevenue: number
  cumProfit: number
}

export interface Intraday {
  day: string
  points: IntradayPoint[]
  /** Peak of the cumulative profit curve, and whether the day gave it back. */
  peak: { hour: number; profit: number } | null
  closing: number
  /** False when no store has cost settings, so profit is only revenue − ads. */
  configured: boolean
}

interface StoreDay {
  hourly: Map<number, { revenue: number; orders: number }>
  /** Cost of everything except ads, as a share of revenue. */
  nonAdRatio: number
  adSpend: number
  configured: boolean
}

/** Hours of the day that have already happened; 24 for any day but today. */
function hoursCovered(day: string, tz: string): number {
  if (day !== todayInTz(tz)) return 24
  const hour = Number(
    new Intl.DateTimeFormat('en-GB', { timeZone: tz, hour: '2-digit', hour12: false }).format(new Date())
  )
  return Math.max(1, hour + 1)
}

async function loadStoreDay(tenantId: string, day: string): Promise<StoreDay> {
  // One summary gives the day's ad spend (already excluding switched-off ad
  // accounts) and the cost base, so the hourly split needs only the revenue.
  const summary = await getProfitSummary(tenantId, day, day)

  const rows = await query<{ hour: number; revenue: string; orders: string }>(
    `SELECT
       EXTRACT(HOUR FROM (o.created_at AT TIME ZONE $3))::int AS hour,
       SUM(o.total_price::numeric)::text                      AS revenue,
       COUNT(*)::text                                          AS orders
     FROM shopify_orders o
     JOIN tenants t ON t.id = o.tenant_id
     WHERE o.tenant_id = $1
       AND (o.created_at AT TIME ZONE COALESCE(t.timezone, 'UTC'))::date = $2::date
       AND o.financial_status NOT IN ('refunded', 'voided')
     GROUP BY 1`,
    // The day is bounded by the store's own timezone, matching every other
    // total in the app, while the hour is read in the reference timezone so
    // that summing several stores lines their hours up.
    [tenantId, day, REFERENCE_TZ]
  )

  const hourly = new Map<number, { revenue: number; orders: number }>()
  for (const r of rows) {
    hourly.set(r.hour, { revenue: Number(r.revenue), orders: Number(r.orders) })
  }

  const nonAdRatio = summary.configured && summary.totalRevenue > 0
    ? (summary.totalCosts - summary.fbSpend) / summary.totalRevenue
    : 0

  return { hourly, nonAdRatio, adSpend: summary.fbSpend, configured: summary.configured }
}

/** Totals for one day counted only up to the end of `throughHour` (0-23). */
export interface PartialDay {
  revenue: number
  orders: number
  adSpend: number
  profit: number
}

/**
 * What a day looked like at this hour.
 *
 * Comparing a day in progress against a finished one is the easiest way to make
 * a good day look terrible: at 2pm today has fourteen hours of sales and
 * yesterday has twenty-four. This cuts the older day at the same hour so the
 * two are the same length.
 *
 * Orders are cut exactly, by their timestamp. Ad spend can only be prorated —
 * Meta reports it daily — so a finished day contributes (hour+1)/24 of its
 * spend, the same even-burn assumption the intraday curve makes.
 */
export async function getDayThroughHour(
  tenantIds: string[],
  day: string,
  throughHour: number,
  tz: string = REFERENCE_TZ,
): Promise<PartialDay> {
  const covered = hoursCovered(day, tz)
  const lastHour = Math.min(throughHour, covered - 1)

  const days = await Promise.all(tenantIds.map(async id => {
    try {
      return await loadStoreDay(id, day)
    } catch (err) {
      console.error('[intraday] partial day failed', id, err)
      return null
    }
  }))
  const loaded = days.filter((d): d is StoreDay => d !== null)

  const out: PartialDay = { revenue: 0, orders: 0, adSpend: 0, profit: 0 }

  for (const d of loaded) {
    const share = (lastHour + 1) / covered
    const spend = d.adSpend * share
    out.adSpend += spend
    out.profit  -= spend

    for (let hour = 0; hour <= lastHour; hour++) {
      const cell = d.hourly.get(hour)
      if (!cell) continue
      out.revenue += cell.revenue
      out.orders  += cell.orders
      out.profit  += cell.revenue - cell.revenue * d.nonAdRatio
    }
  }

  return out
}

/**
 * Totals for a window, with its final day optionally cut at an hour.
 *
 * `throughHour` is null when the window is entirely in the past and every day
 * of it is complete; pass an hour to make the window match one that is still
 * running.
 */
export async function getComparableTotals(
  tenantIds: string[],
  from: string,
  to: string,
  throughHour: number | null,
): Promise<PartialDay> {
  const total: PartialDay = { revenue: 0, orders: 0, adSpend: 0, profit: 0 }

  // Whole days: everything before the final one, or all of it when the window
  // has already closed.
  const fullTo = throughHour === null ? to : shiftDate(to, -1)
  if (fullTo >= from) {
    const rows = await Promise.all(tenantIds.map(async id => {
      try {
        const s = await getProfitSummary(id, from, fullTo)
        return { revenue: s.totalRevenue, orders: s.orderCount, adSpend: s.fbSpend, profit: s.netProfit }
      } catch (err) {
        console.error('[intraday] comparable window failed', id, err)
        return { revenue: 0, orders: 0, adSpend: 0, profit: 0 }
      }
    }))
    for (const r of rows) {
      total.revenue += r.revenue; total.orders += r.orders
      total.adSpend += r.adSpend; total.profit += r.profit
    }
  }

  if (throughHour !== null) {
    const partial = await getDayThroughHour(tenantIds, to, throughHour)
    total.revenue += partial.revenue; total.orders += partial.orders
    total.adSpend += partial.adSpend; total.profit += partial.profit
  }

  return total
}

/** Cumulative profit by hour, summed across the given stores. */
export async function getIntradayProfit(
  tenantIds: string[],
  day: string,
  tz: string = REFERENCE_TZ,
): Promise<Intraday> {
  const covered = hoursCovered(day, tz)

  const days = await Promise.all(tenantIds.map(async id => {
    try {
      return await loadStoreDay(id, day)
    } catch (err) {
      console.error('[intraday] store failed', id, err)
      return null
    }
  }))
  const loaded = days.filter((d): d is StoreDay => d !== null)

  // Each store burns its own day's spend evenly over the hours so far.
  const spendPerHour = loaded.reduce((s, d) => s + d.adSpend / covered, 0)

  const points: IntradayPoint[] = []
  let cumRevenue = 0
  let cumProfit = 0

  for (let hour = 0; hour < covered; hour++) {
    let revenue = 0
    let orders = 0
    let profit = -spendPerHour

    for (const d of loaded) {
      const cell = d.hourly.get(hour)
      if (!cell) continue
      revenue += cell.revenue
      orders  += cell.orders
      profit  += cell.revenue - cell.revenue * d.nonAdRatio
    }

    cumRevenue += revenue
    cumProfit  += profit

    points.push({
      hour,
      label: `${String(hour).padStart(2, '0')}:00`,
      revenue: Math.round(revenue * 100) / 100,
      orders,
      cumRevenue: Math.round(cumRevenue * 100) / 100,
      cumProfit:  Math.round(cumProfit  * 100) / 100,
    })
  }

  const peak = points.reduce<{ hour: number; profit: number } | null>(
    (best, p) => (best === null || p.cumProfit > best.profit ? { hour: p.hour, profit: p.cumProfit } : best),
    null
  )

  return {
    day,
    points,
    peak,
    closing: points.length ? points[points.length - 1].cumProfit : 0,
    configured: loaded.some(d => d.configured),
  }
}
