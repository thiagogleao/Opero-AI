import { query } from '@/lib/db'
import { getProfitSummary, getDailyProfitData } from '@/lib/profitCalc'
import { mobileAuthOk, unauthorized } from '@/lib/mobileAuth'
import { hourInTz } from '@/lib/alerts'
import { resolveRange, previousRange, REFERENCE_TZ, todayInTz, type Period } from '@/lib/mobileRange'
import { getIntradayProfit, getComparableTotals } from '@/lib/intradayProfit'
import { getAdjustmentImpact, NO_IMPACT, getCombinedChargebackHealth } from '@/lib/adjustments'

export const runtime = 'nodejs'
export const dynamic = 'force-dynamic'

interface DailyPoint {
  date: string; revenue: number; profit: number; fbSpend: number; margin: number | null
}

export async function GET(req: Request) {
  if (!(await mobileAuthOk(req))) return unauthorized()

  const { searchParams } = new URL(req.url)
  const period   = (searchParams.get('period') ?? 'today') as Period
  const storeId  = searchParams.get('store')          // omitted / "all" = every store
  const { from, to } = resolveRange(
    period, REFERENCE_TZ, searchParams.get('from'), searchParams.get('to')
  )

  const allTenants = await query<{
    id: string; shopify_domain: string | null; shop_name: string | null; timezone: string | null
  }>(
    `SELECT id, shopify_domain, shop_name, COALESCE(timezone, 'UTC') AS timezone
     FROM tenants
     WHERE shopify_access_token IS NOT NULL
     ORDER BY created_at`
  )

  const label = (t: { shop_name: string | null; shopify_domain: string | null }) =>
    t.shop_name ?? t.shopify_domain?.replace('.myshopify.com', '') ?? 'Loja'

  // Clone stores legitimately share a Shopify name, which would render as two
  // identical rows. Append the handle only where names actually collide.
  const counts = new Map<string, number>()
  for (const t of allTenants) counts.set(label(t), (counts.get(label(t)) ?? 0) + 1)
  const nameOf = (t: typeof allTenants[number]) =>
    (counts.get(label(t)) ?? 0) > 1 && t.shopify_domain
      ? `${label(t)} (${t.shopify_domain.replace('.myshopify.com', '')})`
      : label(t)

  const selected = storeId && storeId !== 'all'
    ? allTenants.filter(t => t.id === storeId)
    : allTenants

  // A single-day range renders no chart, and getDailyProfitData recomputes the
  // whole summary internally — so skip it entirely rather than pay for a series
  // the UI will not draw. This is the common case ("Hoje") and the slowest one.
  // That day gets the hour-by-hour curve instead.
  const wantDaily = from !== to

  // Summary and daily run as one wave instead of two sequential ones; the two
  // do not depend on each other and this roughly halves wall time.
  const byDate = new Map<string, DailyPoint>()
  const prev = previousRange(from, to)
  // A window that runs to today is only as long as the day is old so far.
  const inProgress = to === todayInTz(REFERENCE_TZ)
  const throughHour = inProgress ? hourInTz(REFERENCE_TZ) : null
  const [stores, previousTotals] = await Promise.all([
    // One store failing (bad credentials, sync gap) must not blank the whole
    // dashboard, so failures are reported per row.
    Promise.all(selected.map(async t => {
      const base = {
        id: t.id, name: nameOf(t), domain: t.shopify_domain, timezone: t.timezone ?? 'UTC',
      }
      try {
        const s = await getProfitSummary(t.id, from, to)
        return {
          ...base,
          revenue: s.totalRevenue, profit: s.netProfit, orders: s.orderCount,
          adSpend: s.fbSpend, margin: s.margin, cogs: s.totalCogs,
          shipping: s.totalShipping, fees: s.totalFees,
          aov: s.orderCount > 0 ? s.totalRevenue / s.orderCount : 0,
          error: false,
        }
      } catch (err) {
        console.error('[mobile] summary failed for', t.id, err)
        return { ...base, revenue: 0, profit: 0, orders: 0, adSpend: 0, margin: 0,
                 cogs: 0, shipping: 0, fees: 0, aov: 0, error: true }
      }
    })),

    // The same window one length earlier, so every headline figure can say
    // whether it is better or worse than the run-up to it. When the current
    // window is still running, the older one is cut at the same hour — today
    // at 2pm against a full yesterday would make every good day look bad.
    getComparableTotals(selected.map(t => t.id), prev.from, prev.to, throughHour),

    // Daily series, summed across the selected stores by calendar date.
    wantDaily ? Promise.all(selected.map(async t => {
      try {
        const { dailyData } = await getDailyProfitData(t.id, from, to)
        for (const p of dailyData) {
          const cur = byDate.get(p.date) ?? { date: p.date, revenue: 0, profit: 0, fbSpend: 0, margin: null }
          cur.revenue += p.revenue
          cur.profit  += p.profit
          cur.fbSpend += p.fbSpend
          byDate.set(p.date, cur)
        }
      } catch (err) {
        console.error('[mobile] daily failed for', t.id, err)
      }
    })) : Promise.resolve([]),
  ])
  const daily = [...byDate.values()]
    .sort((a, b) => a.date.localeCompare(b.date))
    // Margin is recomputed from the summed totals — averaging each store's
    // margin would weight a tiny store the same as a large one.
    .map(p => ({ ...p, margin: p.revenue > 0 ? Math.round((p.profit / p.revenue) * 1000) / 10 : null }))

  const ids = selected.map(t => t.id)

  // Refunds and chargebacks that landed in this window. Returned apart from
  // `totals` on purpose: a chargeback arriving today for an August order is not
  // a verdict on today's trading, and burying it inside the headline would read
  // as one.
  const perStoreImpact = await Promise.all(selected.map(async t => {
    try {
      const s = await getProfitSummary(t.id, from, to)
      const nonAdRatio = s.configured && s.totalRevenue > 0
        ? (s.totalCosts - s.fbSpend) / s.totalRevenue
        : 0
      return { id: t.id, name: nameOf(t), ...(await getAdjustmentImpact(t.id, from, to, nonAdRatio)) }
    } catch {
      return { id: t.id, name: nameOf(t), ...NO_IMPACT }
    }
  }))

  const adjustments = perStoreImpact.reduce((a, i) => ({
    refundHit: a.refundHit + i.refundHit,
    refundGross: a.refundGross + i.refundGross,
    refundCount: a.refundCount + i.refundCount,
    chargebackHit: a.chargebackHit + i.chargebackHit,
    chargebackFees: a.chargebackFees + i.chargebackFees,
    chargebackCount: a.chargebackCount + i.chargebackCount,
    total: a.total + i.total,
    alreadyCounted: a.alreadyCounted + i.alreadyCounted,
    blindToChargebacks: a.blindToChargebacks || i.blindToChargebacks,
  }), { ...NO_IMPACT })

  // Which store the money left from. Only stores that actually lost something
  // are listed: a row of zeroes says nothing and crowds out the ones that do.
  const adjustmentsByStore = perStoreImpact
    .filter(s => s.total > 0)
    .sort((a, b) => b.total - a.total)

  // Ninety-day dispute rate: not a property of the chosen period, but the
  // number that decides whether the store keeps Shopify Payments at all.
  const chargebackHealth = await getCombinedChargebackHealth(ids).catch(() => null)

  // Only a one-day view has an inside to look at.
  const intraday = wantDaily ? null : await getIntradayProfit(ids, from).catch(err => {
    console.error('[mobile] intraday failed', err)
    return null
  })
  const recent = ids.length ? await query<{
    order_id: string; order_number: string | null; total_price: string; currency: string
    country_code: string | null; line_items: unknown; received_at: string
    shop_name: string | null; shopify_domain: string | null
  }>(
    `SELECT lo.order_id, lo.order_number, lo.total_price::text, lo.currency,
            lo.country_code, lo.line_items, lo.received_at::text,
            t.shop_name, t.shopify_domain
     FROM live_orders lo
     JOIN tenants t ON t.id = lo.tenant_id
     WHERE lo.tenant_id = ANY($1::text[])
     ORDER BY lo.received_at DESC
     LIMIT 40`, [ids]
  ) : []

  const totals = stores.reduce((a, s) => ({
    revenue: a.revenue + s.revenue,
    profit:  a.profit  + s.profit,
    orders:  a.orders  + s.orders,
    adSpend: a.adSpend + s.adSpend,
    cogs:    a.cogs    + s.cogs,
    shipping: a.shipping + s.shipping,
    fees:    a.fees    + s.fees,
  }), { revenue: 0, profit: 0, orders: 0, adSpend: 0, cogs: 0, shipping: 0, fees: 0 })

  const lastSync = await query<{ finished_at: string }>(
    `SELECT MAX(finished_at)::text AS finished_at FROM sync_runs WHERE status = 'success'`
  )

  return Response.json({
    period, from, to,
    storeId: storeId ?? 'all',
    previous: { ...previousTotals, from: prev.from, to: prev.to, throughHour },
    totals,
    stores,
    daily,
    intraday,
    allStores: allTenants.map(t => ({ id: t.id, name: nameOf(t) })),
    adjustments,
    adjustmentsByStore,
    chargebackHealth,
    lastSyncAt: lastSync[0]?.finished_at ?? null,
    recentOrders: recent.map(r => ({
      orderId: r.order_id,
      orderNumber: r.order_number,
      total: Number(r.total_price),
      currency: r.currency,
      country: r.country_code,
      items: r.line_items,
      receivedAt: r.received_at,
      store: r.shop_name ?? r.shopify_domain?.replace('.myshopify.com', '') ?? 'Loja',
    })),
  })
}
