import { describe, expect, it } from 'vitest'
import { sumPnL, type DayPnL, type HourPoint, type PnL, type PnLLines, type StorePnL } from '../../engine/pnl'
import { comparisonRange } from '../../engine/dates'
import {
  assemblePortfolio, badgesFor, combineHealth, combineIntraday, dayStateOf, greenSinceOf, storeFreshness,
  type PortfolioStoreInput, type StoreComparison, type SyncRow,
} from '../portfolio'

// 2026-11-17 15:45 in Belém/São Paulo = 18:45 UTC = 2026-11-18 03:45 in Tokyo.
const NOW = new Date('2026-11-17T18:45:00Z')

const pnl = (over: Partial<PnLLines> = {}): PnL => sumPnL([{ ...sumPnL([]), ...over }])

function store(
  id: string, tz: string, days: Record<string, Partial<PnLLines>>, opts: { configured?: boolean; hourly?: HourPoint[] | null } = {},
): StorePnL {
  const daily: DayPnL[] = Object.entries(days).map(([date, l]) => ({ date, ...pnl(l) }))
  const dates = Object.keys(days).sort()
  return {
    store: { id, name: id, domain: null, timezone: tz, userId: null, archived: false },
    configured: opts.configured ?? true,
    range: { from: dates[0], to: dates[dates.length - 1] },
    partial: false, minutesCovered: 1440, cutoffMinutes: null,
    totals: sumPnL(daily), daily, hourly: opts.hourly ?? null, countries: null, products: null,
  }
}

const hours = (profits: number[]): HourPoint[] =>
  profits.map((p, h) => ({ hour: h, revenue: 10, orders: 1, contribution: 5, cumProfit: p, cumRevenue: 10 * (h + 1) }))

const fresh = (id: string): SyncRow[] => [
  { tenant_id: id, source: 'shopify', last_success: new Date(NOW.getTime() - 5 * 60000), last_started: NOW, last_status: 'success' },
  { tenant_id: id, source: 'facebook', last_success: new Date(NOW.getTime() - 20 * 60000), last_started: NOW, last_status: 'success' },
]

describe('dayStateOf', () => {
  it('tells running, closed, complete and not started apart', () => {
    const today = { from: '2026-11-17', to: '2026-11-17' }
    expect(dayStateOf(today, '2026-11-17', '2026-11-17')).toBe('running')
    // Tokyo is already on the 18th while Brazil is on the 17th.
    expect(dayStateOf(today, '2026-11-18', '2026-11-17')).toBe('closed')
    expect(dayStateOf({ from: '2026-11-16', to: '2026-11-16' }, '2026-11-18', '2026-11-17')).toBe('complete')
    expect(dayStateOf(today, '2026-11-16', '2026-11-17')).toBe('not_started')
  })
})

describe('greenSinceOf', () => {
  it('reports the last crossing above zero, not the first non-negative hour', () => {
    expect(greenSinceOf([{ hour: 0, cumProfit: 5 }, { hour: 1, cumProfit: -3 }, { hour: 2, cumProfit: -1 }, { hour: 3, cumProfit: 4 }])).toBe(3)
    expect(greenSinceOf([{ hour: 0, cumProfit: 1 }, { hour: 1, cumProfit: 2 }])).toBe(0)
    expect(greenSinceOf([{ hour: 0, cumProfit: 1 }, { hour: 1, cumProfit: -2 }])).toBeNull()
    expect(greenSinceOf([])).toBeNull()
  })
})

describe('combineIntraday', () => {
  it('sums by hour of each store own day and holds a shorter curve at its last value', () => {
    const pts = combineIntraday([
      { storeId: 'a', name: 'a', timezone: 'America/Belem', hoursCovered: 3, points: hours([1, 2, 3]) },
      { storeId: 'b', name: 'b', timezone: 'America/Belem', hoursCovered: 2, points: hours([10, 20]) },
    ])
    expect(pts.map(p => p.cumProfit)).toEqual([11, 22, 23])
    expect(pts.map(p => p.storesReporting)).toEqual([2, 2, 1])
    expect(pts[2].revenue).toBe(10)
  })
})

describe('storeFreshness', () => {
  it('judges a store only by its own runs', () => {
    const rows: SyncRow[] = [
      ...fresh('other'),
      { tenant_id: 'late', source: 'shopify', last_success: new Date(NOW.getTime() - 3 * 3600000), last_started: NOW, last_status: 'error' },
    ]
    const f = storeFreshness('late', rows, true, NOW)
    expect(f.orders.ageMinutes).toBe(180)
    expect(f.stale).toBe(true)
    expect(f.failing).toBe(true)
    expect(f.ads).toBeNull()
    expect(storeFreshness('other', rows, true, NOW).stale).toBe(false)
  })
  it('turns into badges', () => {
    const f = storeFreshness('late', [
      { tenant_id: 'late', source: 'shopify', last_success: null, last_started: NOW, last_status: 'error' },
    ], false, NOW)
    const codes = badgesFor({ configured: false, dayState: 'closed', timezone: 'Asia/Tokyo', freshness: f }, { from: '2026-11-17', to: '2026-11-17' })
      .map(b => b.code)
    expect(codes).toEqual(['sem_custos', 'dia_encerrado', 'sync_falhando', 'sem_webhook'])
  })
})

describe('assemblePortfolio', () => {
  const range = { from: '2026-11-17', to: '2026-11-17' }
  const stores: PortfolioStoreInput[] = [
    { id: 'mokoo', name: 'MOKOO', timezone: 'America/Belem' },
    { id: 'glooty', name: 'Glooty', timezone: 'America/Belem' },
    { id: 'hibikura', name: 'Hibikura', timezone: 'Asia/Tokyo' },
  ]
  const current = new Map<string, StorePnL>([
    ['mokoo', { ...store('mokoo', 'America/Belem', { '2026-11-17': { revenue: 1000, orders: 10, cogs: 400, metaSpend: 300 } }, { hourly: hours([-50, 20, 300]) }), partial: true }],
    // No cost settings: still counted, as revenue minus ads.
    ['glooty', { ...store('glooty', 'America/Belem', { '2026-11-17': { revenue: 0, orders: 0, metaSpend: 120 } }, { configured: false, hourly: hours([-40, -80, -120]) }), partial: true }],
    // Tokyo's 17th is over: in the totals, beside the curve.
    ['hibikura', store('hibikura', 'Asia/Tokyo', { '2026-11-17': { revenue: 1596, orders: 18, cogs: 600, metaSpend: 400, refunds: 30 } }, { hourly: hours(Array(24).fill(1)) })],
  ])
  const cmp = comparisonRange('today', range, 'America/Sao_Paulo', NOW)
  const compared = new Map<string, StoreComparison>([
    ['mokoo', { included: true, range: { from: cmp.from, to: cmp.to }, cutoffMinutes: 945, totals: pnl({ revenue: 800, orders: 8, metaSpend: 280 }) }],
    ['glooty', { included: false, range: { from: cmp.from, to: cmp.to }, cutoffMinutes: null, totals: pnl() }],
    ['hibikura', { included: true, range: { from: cmp.from, to: cmp.to }, cutoffMinutes: null, totals: pnl({ revenue: 744, orders: 9, metaSpend: 500 }) }],
  ])
  const view = assemblePortfolio({
    stores, period: 'today', range, comparison: cmp, anchorTimezone: 'America/Sao_Paulo', now: NOW,
    current, compared, chargebackHealth: null, liveFeed: [],
    liveCovered: new Set(['mokoo']), syncRows: [...fresh('mokoo'), ...fresh('glooty'), ...fresh('hibikura')],
  })

  it('totals are the sum of the store rows', () => {
    expect(view.totals.revenue).toBe(2596)
    expect(view.totals.operatingProfit).toBeCloseTo((1000 - 400 - 300) + (0 - 120) + (1596 - 600 - 400), 6)
    expect(view.totals.cashResult).toBeCloseTo(view.totals.operatingProfit - 30, 6)
    expect(view.configured).toBe(false)
    expect(view.unconfiguredStoreIds).toEqual(['glooty'])
  })
  it('the daily series sums to the totals', () => {
    expect(view.daily).toHaveLength(1)
    expect(view.daily[0].operatingProfit).toBeCloseTo(view.totals.operatingProfit, 6)
    expect(view.daily[0].cashResult).toBeCloseTo(view.totals.cashResult, 6)
  })
  it('plots only stores whose day is running and reports the closed one apart', () => {
    const i = view.intraday!
    expect(i.stores.map(s => s.storeId)).toEqual(['mokoo', 'glooty'])
    expect(i.closedStores.map(s => s.storeId)).toEqual(['hibikura'])
    expect(i.closing).toBe(300 - 120)
    expect(i.configured).toBe(false)
    const hib = view.stores.find(s => s.id === 'hibikura')!
    expect(hib.dayClosed).toBe(true)
    expect(hib.badges.map(b => b.code)).toContain('dia_encerrado')
  })
  it('compares only the stores that have something to compare with', () => {
    expect(view.comparison.totals.revenue).toBe(800 + 744)
    expect(view.comparison.sameTimeOfDay).toBe(true)
    expect(view.comparison.label).toBe('ontem até esta hora')
  })
  it('lists where refunds landed and which stores lack a live feed', () => {
    expect(view.adjustmentsByStore.map(a => a.storeId)).toEqual(['hibikura'])
    expect(view.freshness.storesWithoutLiveFeed.map(s => s.storeId)).toEqual(['glooty', 'hibikura'])
    expect(view.freshness.staleStores).toEqual([])
  })
  it('reads freshness as unknown, not stale, when it was not loaded', () => {
    const v = assemblePortfolio({
      stores, period: 'today', range, comparison: cmp, anchorTimezone: 'America/Sao_Paulo', now: NOW,
      current, compared, chargebackHealth: null, liveFeed: [], liveCovered: new Set(['mokoo', 'glooty', 'hibikura']), syncRows: null,
    })
    expect(v.freshness.staleStores).toEqual([])
    expect(v.stores.every(s => !s.badges.some(b => b.code.startsWith('sync_')))).toBe(true)
  })
})

describe('combineHealth', () => {
  it('recomputes the rate from summed counts and keeps each store apart', () => {
    const h = (count: number, orders: number) => ({
      count, orders, rate: orders ? (count / orders) * 100 : 0, amount: count * 50, fees: count * 15,
      open: 0, lost: count, won: 0, dueSoon: [], hasData: count > 0,
    })
    const out = combineHealth([
      { store: { id: 'a', name: 'A', timezone: 'UTC' }, health: h(4, 100) },
      { store: { id: 'b', name: 'B', timezone: 'UTC' }, health: h(1, 900) },
      { store: { id: 'c', name: 'C', timezone: 'UTC' }, health: h(0, 50) },
    ])
    expect(out.count).toBe(5)
    expect(out.rate).toBeCloseTo((5 / 1050) * 100, 6)
    expect(out.byStore.map(s => s.storeId)).toEqual(['a', 'b'])
  })
})
