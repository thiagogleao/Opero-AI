import { describe, expect, it } from 'vitest'
import { sumPnL, type CountryPnL, type DayPnL, type PnL, type PnLLines, type ProductPnL } from '../../engine/pnl'
import { comparisonRange } from '../../engine/dates'
import {
  adChannelOf, campaignHighlights, channelRoas, chargebackLevel, chartSeries, chartValue, comparisonPlan, dueInTz, empateGap, kpiDays, ledgerAdCents, seriesIdle, storeKpis, topCountries, topProducts, trailRanges, windowDaysSinceStart,
  CHARGEBACK_LIMIT_PCT, TRAIL_DAYS,
} from '../store'
import type { CampaignRow } from '../../data/campaigns'
import type { CampaignAction, CampaignDecision } from '../../campaignSignal'

const pnl = (over: Partial<PnLLines> = {}): PnL => sumPnL([{ ...sumPnL([]), ...over }])
const day = (date: string, over: Partial<PnLLines> = {}): DayPnL => ({ date, ...pnl(over) })

// 2026-11-17 22:30 in Belém = 2026-11-18 01:30 UTC.
const NOW = new Date('2026-11-18T01:30:00Z')
const TZ = 'America/Belem'

describe('comparisonPlan', () => {
  it('prices a closed window whole', () => {
    const range = { from: '2026-11-10', to: '2026-11-16' }
    const cmp = comparisonRange('7d', range, TZ, NOW)
    expect(comparisonPlan(range, cmp, '2026-11-17', 1350)).toEqual({ kind: 'whole', range: { from: '2026-11-03', to: '2026-11-09' } })
  })

  it('cuts yesterday at this minute when the window is today', () => {
    const range = { from: '2026-11-17', to: '2026-11-17' }
    const cmp = comparisonRange('today', range, TZ, NOW)
    expect(comparisonPlan(range, cmp, '2026-11-17', 1350)).toEqual({ kind: 'same_time', day: '2026-11-17' })
  })

  it('cuts only the last day of a month still running, run-up whole', () => {
    const range = { from: '2026-11-01', to: '2026-11-17' }
    const cmp = comparisonRange('mtd', range, TZ, NOW)
    expect(comparisonPlan(range, cmp, '2026-11-17', 1350)).toEqual({
      kind: 'cut_last', lastDay: '2026-10-17', runUp: { from: '2026-10-01', to: '2026-10-16' }, cutMinutes: 1350,
    })
  })

  it('a custom range ending today is cut too (the engine does not flag it as same-time)', () => {
    const range = { from: '2026-11-15', to: '2026-11-17' }
    const cmp = comparisonRange('custom', range, TZ, NOW)
    expect(cmp.sameTimeOfDay).toBe(false)
    const plan = comparisonPlan(range, cmp, '2026-11-17', 600)
    expect(plan).toEqual({ kind: 'cut_last', lastDay: '2026-11-14', runUp: { from: '2026-11-12', to: '2026-11-13' }, cutMinutes: 600 })
  })
})

describe('storeKpis', () => {
  const range = { from: '2026-11-10', to: '2026-11-16' }
  // MOKOO-like week: revenue 10 942, product 3 461, fees 317, Meta 5 624, Shopify ads 226.
  const t = pnl({ revenue: 10942, orders: 134, cogs: 3461, shopifyFees: 317, metaSpend: 5624, shopSpend: 226 })

  it('splits what an order leaves for ads from what the ads cost, and the gap is the profit per order', () => {
    const k = storeKpis(t, null, true, range)
    expect(k.adCostPerOrder).toBeCloseTo((5624 + 226) / 134, 6)
    expect(k.leftBeforeAdsPerOrder).toBeCloseTo((10942 - 3461 - 317) / 134, 6)
    expect(k.leftBeforeAdsPerOrder! - k.adCostPerOrder!).toBeCloseTo(k.profitPerOrder!, 6)
    expect(k.metaCents).toBeCloseTo(51.4, 1)
    expect(k.days).toBe(7)
  })

  it('hides break-even, margin and what is left when costs are not configured', () => {
    const k = storeKpis(pnl({ revenue: 156, orders: 2, metaSpend: 819.5 }), null, false, range)
    // The engine's break-even without costs would be 1.00: a fake number.
    expect(k.breakEven).toBeNull()
    expect(k.margin).toBeNull()
    expect(k.leftBeforeAdsPerOrder).toBeNull()
    expect(k.profitPerOrder).toBeNull()
    expect(k.adCostPerOrder).toBeCloseTo(409.75, 6)
    expect(k.metaRoas).toBeCloseTo(156 / 819.5, 6)
  })

  it('has no ROAS without Meta spend and no ticket without orders', () => {
    const k = storeKpis(pnl({ revenue: 0, orders: 0, shopSpend: 10 }), null, true, range)
    expect(k.metaRoas).toBeNull()
    expect(k.aov).toBeNull()
    expect(k.adCostPerOrder).toBeNull()
  })

  it('counts the days with Shopify ad spend and carries the comparison', () => {
    const daily = [day('2026-11-10', { shopSpend: 5 }), day('2026-11-11'), day('2026-11-12', { shopSpend: 3 })]
    const k = storeKpis(t, pnl({ revenue: 19281, orders: 200, metaSpend: 10289 }), true, range, daily)
    expect(k.shopDays).toBe(2)
    expect(k.previous?.revenue).toBe(19281)
    expect(k.previous?.metaRoas).toBeCloseTo(19281 / 10289, 6)
  })

  it('averages a closed window over all its days, from the totals', () => {
    const daily = ['10', '11', '12', '13', '14', '15', '16'].map(d => day(`2026-11-${d}`, { revenue: 1, orders: 1 }))
    const span = kpiDays(range, daily, { firstOrderDate: '2026-04-11', runningDay: null })
    const k = storeKpis(t, null, true, range, daily, span)
    expect(k.avgRange).toBeNull()
    expect(k.avgDays).toBe(7)
    expect(k.revenuePerDay).toBeCloseTo(10942 / 7, 6)
    expect(k.ordersPerDay).toBeCloseTo(134 / 7, 6)
    expect(k.metaPerDay).toBeCloseTo(5624 / 7, 6)
    // No span at all: the same, as before.
    expect(storeKpis(t, null, true, range).revenuePerDay).toBeCloseTo(10942 / 7, 6)
  })

  it('averages a store that started inside the window over its own closed days', () => {
    // Hibikura, Este mês on 18 nov (running): it sold from 7 nov. The page
    // divided by 18 ("$490 por dia") next to a chart counting from 7 nov.
    const mtd = { from: '2026-11-01', to: '2026-11-18' }
    const daily = [
      ...['01', '02', '03', '04', '05', '06'].map(d => day(`2026-11-${d}`)),
      day('2026-11-07', { revenue: 95.63, orders: 2 }),
      day('2026-11-08', { revenue: 239.25, orders: 2, metaSpend: 165.26 }),
      day('2026-11-09', { revenue: 88.38, orders: 1, metaSpend: 279.67 }),
      day('2026-11-10', { revenue: 492.93, orders: 6, metaSpend: 282.07 }),
      day('2026-11-11', { revenue: 442.56, orders: 6, metaSpend: 424.92 }),
      day('2026-11-12', { revenue: 544.91, orders: 8, metaSpend: 405.58 }),
      day('2026-11-13', { revenue: 802.26, orders: 11, metaSpend: 500.8 }),
      day('2026-11-14', { revenue: 673.51, orders: 9, metaSpend: 318.3 }),
      day('2026-11-15', { revenue: 1314.58, orders: 16, metaSpend: 868.96 }),
      day('2026-11-16', { revenue: 743.94, orders: 9, metaSpend: 517.88 }),
      day('2026-11-17', { revenue: 1596.21, orders: 18, metaSpend: 600.02 }),
      day('2026-11-18', { revenue: 120, orders: 2, metaSpend: 90 }),
    ]
    const totals = sumPnL(daily)
    const span = kpiDays(mtd, daily, { firstOrderDate: '2026-11-07', runningDay: '2026-11-18' })
    expect(span).toEqual({ startedOn: '2026-11-07', avg: { from: '2026-11-07', to: '2026-11-17' }, avgDays: 11, spanDays: 12 })
    const k = storeKpis(totals, null, true, mtd, daily, span)
    const closed = daily.filter(d => d.date >= '2026-11-07' && d.date <= '2026-11-17')
    expect(k.avgRange).toEqual({ from: '2026-11-07', to: '2026-11-17' })
    expect(k.revenuePerDay).toBeCloseTo(closed.reduce((a, d) => a + d.revenue, 0) / 11, 6)
    expect(k.revenuePerDay).toBeCloseTo(7034.16 / 11, 2)
    expect(k.ordersPerDay).toBeCloseTo(88 / 11, 6)
    expect(k.metaPerDay).toBeCloseTo(closed.reduce((a, d) => a + d.metaSpend, 0) / 11, 6)
    expect(k.startedOn).toBe('2026-11-07')
    expect(k.spanDays).toBe(12)
  })
})

describe('kpiDays', () => {
  const mtd = { from: '2026-11-01', to: '2026-11-18' }
  const quiet = (from: number, to: number) => Array.from({ length: to - from + 1 }, (_, i) => day(`2026-11-${String(from + i).padStart(2, '0')}`))

  it('starts on the first ad when the ads came before the first sale (Glooty: ads 4 nov, sale 6 nov)', () => {
    const daily = [...quiet(1, 3), day('2026-11-04', { metaSpend: 74.48 }), day('2026-11-05', { metaSpend: 155.99 }),
      day('2026-11-06', { revenue: 403.71, orders: 4, metaSpend: 267.99 }), ...quiet(7, 18)]
    const r = kpiDays(mtd, daily, { firstOrderDate: '2026-11-06', runningDay: '2026-11-18' })
    expect(r).toEqual({ startedOn: '2026-11-04', avg: { from: '2026-11-04', to: '2026-11-17' }, avgDays: 14, spanDays: 15 })
  })

  it('agrees with the chart line: activity in the days before the window means the store existed', () => {
    const daily = [...quiet(1, 6), day('2026-11-07', { revenue: 90, orders: 1 }), ...quiet(8, 10)]
    const range = { from: '2026-11-01', to: '2026-11-10' }
    const before = [day('2026-10-25', { metaSpend: 40 }), day('2026-10-26')]
    const r = kpiDays(range, daily, { firstOrderDate: '2026-11-07', before, runningDay: null })
    expect(r).toEqual({ startedOn: null, avg: range, avgDays: 10, spanDays: 10 })
    // The chart's own rule on the same days keeps every window day too.
    expect(windowDaysSinceStart(chartSeries(before, daily, []), '2026-11-07').startedOn).toBeNull()
  })

  it('leaves only the running day out of an established store (MOKOO, Este mês)', () => {
    const daily = quiet(1, 18).map(d => ({ ...d, revenue: 100, orders: 1 }))
    expect(kpiDays(mtd, daily, { firstOrderDate: '2026-04-11', runningDay: '2026-11-18' }))
      .toEqual({ startedOn: null, avg: { from: '2026-11-01', to: '2026-11-17' }, avgDays: 17, spanDays: 18 })
  })

  it('has no closed day to average on the first day of a window that is running', () => {
    const today = { from: '2026-11-18', to: '2026-11-18' }
    expect(kpiDays(today, [day('2026-11-18', { revenue: 50, orders: 1 })], { firstOrderDate: '2026-04-11', runningDay: '2026-11-18' }))
      .toEqual({ startedOn: null, avg: null, avgDays: 0, spanDays: 1 })
  })

  it('ignores a running day outside the window and a window before the first sale', () => {
    const week = { from: '2026-11-10', to: '2026-11-16' }
    const daily = Array.from({ length: 7 }, (_, i) => day(`2026-11-${10 + i}`, { revenue: 10, orders: 1 }))
    expect(kpiDays(week, daily, { firstOrderDate: '2026-04-11', runningDay: '2026-11-17' }).avg).toEqual(week)
    // Hibikura in October: nothing in the window, first sale after it.
    const october = { from: '2026-10-01', to: '2026-10-31' }
    const r = kpiDays(october, [day('2026-10-01'), day('2026-10-31')], { firstOrderDate: '2026-11-07', runningDay: null })
    expect(r.avgDays).toBe(0)
    expect(r.spanDays).toBe(0)
  })
})

describe('adChannelOf / channelRoas', () => {
  it('keeps the Meta ROAS when Shopify ads are a side cost, and sums both when both carry spend', () => {
    const mokoo = { revenue: 10942, metaSpend: 5624, shopSpend: 226 }
    expect(adChannelOf(mokoo)).toBe('meta')
    expect(channelRoas(mokoo)).toBeCloseTo(10942 / 5624, 6)
    const mixed = { revenue: 6000, metaSpend: 1000, shopSpend: 1000 }
    expect(adChannelOf(mixed)).toBe('both')
    expect(channelRoas(mixed)).toBeCloseTo(3, 6)
    expect(adChannelOf({ metaSpend: 55.81, shopSpend: 1796 })).toBe('shop')
    expect(adChannelOf({ metaSpend: 0, shopSpend: 0 })).toBeNull()
    expect(channelRoas({ revenue: 100, metaSpend: 0, shopSpend: 0 })).toBeNull()
  })
})

describe('dueInTz', () => {
  it('reads the deadline on the store clock, not the UTC date', () => {
    // 01h UTC on the 8th is 22h on the 7th in São Paulo: the old slice said "até 8 dez".
    expect(dueInTz('2026-12-08 01:00:00+00', 'America/Sao_Paulo')).toEqual({ date: '2026-12-07', minutes: 22 * 60 })
    expect(dueInTz('2026-12-25 23:00:00+00', 'Asia/Tokyo')).toEqual({ date: '2026-12-26', minutes: 8 * 60 })
    expect(dueInTz('2026-12-04T09:00:00.000Z', 'America/Belem')).toEqual({ date: '2026-12-04', minutes: 6 * 60 })
    expect(dueInTz('não é data', 'America/Belem')).toBeNull()
  })
})

describe('empateGap', () => {
  it('names why a configured store has no break-even, and stays out of the way otherwise', () => {
    // EPOCH at 03h: costs set, $137 of Meta, no order yet.
    expect(empateGap(true, null, { revenue: 0, contribution: 0 })).toBe('no_sales')
    // Sales that do not cover the products: no ROAS breaks even.
    expect(empateGap(true, null, { revenue: 40, contribution: -12 })).toBe('no_margin')
    // A known break-even, or a store really without cost settings: RoasGauge says it right.
    expect(empateGap(true, 1.51, { revenue: 11058, contribution: 7313 })).toBeNull()
    expect(empateGap(false, null, { revenue: 0, contribution: 0 })).toBeNull()
    expect(empateGap(false, null, { revenue: 156, contribution: 156 })).toBeNull()
  })
})

describe('topProducts / topCountries', () => {
  const prod = (key: string, revenue: number, units = 1, orders = 1, contribution = revenue / 2): ProductPnL =>
    ({ key, productId: key, title: key, units, orders, revenue, variableCosts: revenue - contribution, contribution })

  it('keeps the five biggest by revenue and sums the rest', () => {
    const list = topProducts([prod('a', 10), prod('b', 50), prod('c', 30), prod('d', 5), prod('e', 20), prod('f', 1), prod('g', 4)], 120)
    expect(list.rows.map(r => r.key)).toEqual(['b', 'c', 'e', 'a', 'd'])
    expect(list.rest).toEqual({ count: 2, revenue: 5, orders: 0 })
    expect(list.total).toBe(7)
    expect(list.topShare).toBeCloseTo((115 / 120) * 100, 6)
    expect(list.rows[0].share).toBeCloseTo((50 / 120) * 100, 6)
    expect(list.rows[0].contributionMargin).toBeCloseTo(50, 6)
  })

  it('names a product without title and ignores lines with nothing sold', () => {
    const list = topProducts([{ ...prod('x', 0, 0, 0), title: '' }, { ...prod('y', 8), title: '' }], 8)
    expect(list.rows).toHaveLength(1)
    expect(list.rows[0].title).toBe('Produto sem nome')
  })

  const country = (c: string, orders: number, revenue: number, metaSpend = 0): CountryPnL =>
    ({ country: c, orders, revenue, variableCosts: 0, contribution: revenue, metaSpend, metaPurchaseValue: 0 })

  it('lists countries with real orders only (Meta spend alone is not a market)', () => {
    const list = topCountries([country('US', 92, 7779), country('BR', 0, 0, 120), country('MX', 6, 700), country('GB', 10, 504)], 8983)
    expect(list.rows.map(r => r.country)).toEqual(['US', 'MX', 'GB'])
    expect(list.rows[0].aov).toBeCloseTo(7779 / 92, 6)
    expect(list.rest.count).toBe(0)
  })

  it('sums orders of the countries after the top five', () => {
    const cs = ['A', 'B', 'C', 'D', 'E', 'F', 'G'].map((c, i) => country(c, i + 1, 100 - i))
    const list = topCountries(cs, 700)
    expect(list.rows).toHaveLength(5)
    expect(list.rest).toEqual({ count: 2, revenue: 95 + 94, orders: 6 + 7 })
  })
})

describe('trailRanges / chartSeries', () => {
  it('draws the 30 days before the window, and today when the window ends yesterday', () => {
    const t = trailRanges({ from: '2026-11-10', to: '2026-11-16' }, '2026-11-17')
    expect(t.before).toEqual({ from: '2026-10-11', to: '2026-11-09' })
    expect(t.after).toEqual({ from: '2026-11-17', to: '2026-11-17' })
    expect(TRAIL_DAYS).toBe(30)
  })

  it('adds nothing after a window that includes today or ended long ago', () => {
    expect(trailRanges({ from: '2026-11-17', to: '2026-11-17' }, '2026-11-17').after).toBeNull()
    expect(trailRanges({ from: '2026-10-01', to: '2026-10-31' }, '2026-11-17').after).toBeNull()
  })

  it('joins before, window and after in date order, flags the window, and keeps each date once', () => {
    const s = chartSeries(
      [day('2026-11-08', { revenue: 10 }), day('2026-11-09', { revenue: 5 })],
      [day('2026-11-10', { revenue: 20, metaSpend: 5 }), day('2026-11-11')],
      [day('2026-11-11'), day('2026-11-12', { revenue: 1 })],
    )
    expect(s.map(d => d.date)).toEqual(['2026-11-08', '2026-11-09', '2026-11-10', '2026-11-11', '2026-11-12'])
    expect(s.map(d => d.inWindow)).toEqual([false, false, true, true, false])
    expect(s[2].profit).toBeCloseTo(15, 6)
  })

  it('drops the empty days before the store started, never the window itself', () => {
    const s = chartSeries(
      [day('2026-11-05'), day('2026-11-06'), day('2026-11-07', { metaSpend: 4 }), day('2026-11-08')],
      [day('2026-11-09'), day('2026-11-10')],
      [],
    )
    expect(s.map(d => d.date)).toEqual(['2026-11-07', '2026-11-08', '2026-11-09', '2026-11-10'])
    const empty = chartSeries([day('2026-11-01')], [day('2026-11-02'), day('2026-11-03')], [])
    expect(empty.map(d => d.date)).toEqual(['2026-11-02', '2026-11-03'])
  })
})

describe('windowDaysSinceStart', () => {
  // Hibikura, Este mês (1–17 nov closed): no order or spend before 7 nov.
  const hibikura = () => chartSeries(
    [day('2026-10-31')],
    [
      ...['01', '02', '03', '04', '05', '06'].map(d => day(`2026-11-${d}`)),
      day('2026-11-07', { revenue: 95.63, orders: 2 }),
      day('2026-11-08', { revenue: 239.25, orders: 2, metaSpend: 165.26 }),
      day('2026-11-09', { revenue: 88.38, orders: 1, metaSpend: 279.67 }),
    ],
    [],
  )

  it('leaves out the window days before the store existed', () => {
    const r = windowDaysSinceStart(hibikura(), '2026-11-07')
    expect(r.days.map(d => d.date)).toEqual(['2026-11-07', '2026-11-08', '2026-11-09'])
    expect(r.startedOn).toBe('2026-11-07')
  })

  it('falls back on the first day with activity when the first order is unknown', () => {
    expect(windowDaysSinceStart(hibikura(), null).startedOn).toBe('2026-11-07')
  })

  it('counts ads that ran before the first sale: they are real losses', () => {
    const s = chartSeries([], [day('2026-11-05'), day('2026-11-06', { metaSpend: 40 }), day('2026-11-07', { revenue: 90, orders: 1 })], [])
    const r = windowDaysSinceStart(s, '2026-11-07')
    expect(r.days.map(d => d.date)).toEqual(['2026-11-06', '2026-11-07'])
    expect(r.startedOn).toBe('2026-11-06')
  })

  it('keeps quiet days after the start: the store existed and sold nothing', () => {
    // CAMP HALLOW in November: last sale 30 out, every window day empty.
    const s = chartSeries([day('2026-10-30', { revenue: 120, orders: 2 })], [day('2026-11-01'), day('2026-11-02')], [])
    expect(windowDaysSinceStart(s, '2026-06-01')).toEqual({ days: s.filter(d => d.inWindow), startedOn: null })
    // A first order long before the window wins over 30 quiet days of context.
    const quiet = chartSeries([], [day('2026-11-01'), day('2026-11-02', { revenue: 50, orders: 1 })], [])
    expect(windowDaysSinceStart(quiet, '2026-06-01').days).toHaveLength(2)
    // Nothing known and nothing active: every window day stays.
    expect(windowDaysSinceStart(chartSeries([], [day('2026-11-01'), day('2026-11-02')], []), null).days).toHaveLength(2)
  })
})

describe('chartValue', () => {
  // Glooty 7 nov: $60,95 of sales, $650 of Meta.
  const [d] = chartSeries([], [day('2026-11-07', { revenue: 60.95, metaSpend: 650, orders: 1 })], [])

  it('draws profit with cost settings and revenue − ads without', () => {
    expect(chartValue(d, true)).toBeCloseTo(d.profit, 6)
    expect(chartValue(d, false)).toBeCloseTo(60.95 - 650, 6)
  })

  it('halves BOTH kinds in the split view, as the verdict does', () => {
    // The chart of a store without costs drew the whole store under a
    // "(sua parte)" title: verdict −$904, band −$1.807 (Glooty, Este mês).
    expect(chartValue(d, false, 0.5)).toBeCloseTo((60.95 - 650) / 2, 6)
    expect(chartValue(d, true, 0.5)).toBeCloseTo(d.profit / 2, 6)
    // The band total is the sum of what is drawn.
    const days = chartSeries([], [
      day('2026-11-01', { revenue: 100, metaSpend: 300 }), day('2026-11-02', { revenue: 0, metaSpend: 1507 }),
    ], [])
    expect(days.reduce((a, x) => a + chartValue(x, false, 0.5), 0)).toBeCloseTo(-1707 / 2, 6)
  })
})

describe('seriesIdle', () => {
  it('is true when no day sold, spent or cost anything (Hibikura in October)', () => {
    const october = chartSeries([day('2026-09-30')], [day('2026-10-01'), day('2026-10-02'), day('2026-10-31')], [])
    expect(seriesIdle(october, true)).toBe(true)
    expect(seriesIdle(october, false)).toBe(true)
  })

  it('is false as soon as one day has a sale, an ad or a fixed cost', () => {
    expect(seriesIdle(chartSeries([], [day('2026-10-01'), day('2026-10-02', { metaSpend: 3 })], []), false)).toBe(false)
    expect(seriesIdle(chartSeries([], [day('2026-10-01', { revenue: 20, orders: 1 })], []), true)).toBe(false)
    // A fixed cost on an empty day is a real loss: still drawn with costs set.
    const fixed = chartSeries([], [day('2026-10-01', { fixedCosts: 5 })], [])
    expect(seriesIdle(fixed, true)).toBe(false)
    // Context drawn before an empty window keeps the chart (window idle, series not).
    const ctx = chartSeries([day('2026-09-30', { revenue: 9, orders: 1 })], [day('2026-10-01')], [])
    expect(seriesIdle(ctx, true)).toBe(false)
  })
})

describe('chargebackLevel', () => {
  it('reads none / ok / watch / over against Shopify Payments line', () => {
    expect(chargebackLevel({ count: 0, rate: 0 })).toBe('none')
    expect(chargebackLevel({ count: 13, rate: 0.62 })).toBe('ok')
    expect(chargebackLevel({ count: 5, rate: 1.2 })).toBe('watch')
    expect(chargebackLevel({ count: 9, rate: CHARGEBACK_LIMIT_PCT })).toBe('over')
  })
})

describe('campaignHighlights', () => {
  const decision = (action: CampaignAction | null): CampaignDecision => ({ action } as unknown as CampaignDecision)
  const camp = (name: string, spend: number, purchaseValue: number, action: CampaignAction | null, shared = false): CampaignRow =>
    ({ name, campaignId: name, spend, purchaseValue, decision: decision(action), shared: shared ? { note: 'x' } : null } as unknown as CampaignRow)

  it('ranks by spend, counts actions and measures what Meta attributes of the store revenue', () => {
    const h = campaignHighlights({
      storeRevenue: 1000,
      campaigns: [
        camp('a', 100, 300, 'cortar'), camp('b', 500, 400, 'escalar'), camp('c', 0, 50, null),
        camp('d', 50, 100, 'manter', true), camp('e', 10, 0, 'observar'), camp('f', 20, 0, 'observar'), camp('g', 5, 0, null),
      ],
    })
    expect(h.top.map(c => c.name)).toEqual(['b', 'a', 'd', 'f', 'e'])
    expect(h.rest).toEqual({ count: 1, spend: 5 })
    expect(h.withSpend).toBe(6)
    expect(h.actions).toEqual({ escalar: 1, manter: 1, cortar: 1, observar: 2 })
    // Shared-account campaigns sold elsewhere: not this store's attribution.
    expect(h.attributedShare).toBeCloseTo(((300 + 400 + 50) / 1000) * 100, 6)
  })

  it('has no attributed share without store revenue', () => {
    expect(campaignHighlights({ storeRevenue: 0, campaigns: [] }).attributedShare).toBeNull()
  })

  it('never counts the unsynced-ads bucket as a campaign, and names its spend apart', () => {
    // MOKOO 11–17 nov: six campaigns plus $4,47 of ads not yet tied to one.
    // The Resumo said "Ver as 7 campanhas" and "Mais 2 campanhas com $254"
    // over a campaigns page whose tab reads "Campanhas 6".
    const unsynced = {
      ...camp('Anúncios ainda não sincronizados', 4.47, 0, null), campaignId: null, unsynced: true,
      unsyncedAds: [{ adId: '1', name: 'x', spend: 4.47 }, { adId: '2', name: 'y', spend: 0 }],
    } as CampaignRow
    const h = campaignHighlights({
      storeRevenue: 11058,
      campaigns: [
        camp('a', 2000, 3000, 'manter'), camp('b', 1500, 2000, 'cortar'), camp('c', 1200, 1800, 'manter'),
        camp('d', 700, 900, 'observar'), camp('e', 277, 400, null), camp('CATÁLOGO', 250, 496, null),
        unsynced,
      ],
    })
    expect(h.top.map(c => c.name)).toEqual(['a', 'b', 'c', 'd', 'e'])
    expect(h.withSpend).toBe(6)
    expect(h.listed).toBe(6)
    expect(h.rest).toEqual({ count: 1, spend: 250 })
    expect(h.unsynced).toEqual({ spend: 4.47, ads: 1 })
    // The money still adds up: top + rest + unsynced = every row's spend.
    const all = 2000 + 1500 + 1200 + 700 + 277 + 250 + 4.47
    expect(h.top.reduce((s, c) => s + c.spend, 0) + h.rest.spend + h.unsynced.spend).toBeCloseTo(all, 6)
  })

  it('keeps a big unsynced bucket out of the top five (Glooty, $445)', () => {
    const big = { ...camp('Anúncios ainda não sincronizados', 445, 0, null), campaignId: null, unsynced: true, unsyncedAds: [] } as CampaignRow
    const h = campaignHighlights({ storeRevenue: 1118, campaigns: [big, camp('a', 300, 0, null), camp('b', 10, 0, null)] })
    expect(h.top.map(c => c.name)).toEqual(['a', 'b'])
    expect(h.listed).toBe(2)
    expect(h.unsynced.spend).toBe(445)
  })
})

describe('ledgerAdCents', () => {
  it('allocates the ad cents the way the ledger does (largest remainder with the profit)', () => {
    // Hibikura, 18 nov until 11h44: 817,47 sold, 167 product, 46,84 fees, 322,9 Meta.
    // Plain rounding gives Meta 39¢; the ledger's largest remainder gives 40¢.
    const t = pnl({ revenue: 817.47, orders: 11, cogs: 167, shopifyFees: 46.84, metaSpend: 322.9 })
    expect(Math.round((t.metaSpend / t.revenue) * 100)).toBe(39)
    expect(ledgerAdCents(t, true)).toEqual({ meta: 40, shop: 0 })
  })
  it('without costs only the ads count, and a spend above the sales is simply rounded', () => {
    const t = pnl({ revenue: 156.3, orders: 2, metaSpend: 819.5 })
    expect(ledgerAdCents(t, false)).toEqual({ meta: 524, shop: 0 })
  })
  it('has nothing to divide without sales', () => {
    expect(ledgerAdCents(pnl({ metaSpend: 10 }), true)).toEqual({ meta: null, shop: null })
  })
})
