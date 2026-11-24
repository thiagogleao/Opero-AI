import { describe, expect, it } from 'vitest'
import { sumPnL, type DayPnL, type HourPoint, type PnL, type PnLLines, type StorePnL } from '../../engine/pnl'
import { comparisonRange } from '../../engine/dates'
import {
  assemblePortfolio, badgesFor, combineHealth, combineIntraday, dayStateOf, greenSinceOf, sourceFreshness, storeFreshness,
  STALE_AFTER_MINUTES, type PortfolioStoreInput, type StoreComparison, type SyncRow,
} from '../portfolio'
import { STALE_AFTER_MIN, staleness } from '../../sync/plan'
import { buildVerdict, verdictInputFromPortfolio } from '../verdict'

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
  it('uses the top bar thresholds (lib/sync/plan): amber is late, red with a failed run is failing', () => {
    const at = (min: number, source: 'shopify' | 'facebook', status = 'success'): SyncRow =>
      ({ tenant_id: 's', source, last_success: new Date(NOW.getTime() - min * 60000), last_started: NOW, last_status: status })
    const one = (r: SyncRow) => sourceFreshness(r.source as 'shopify' | 'facebook', r, NOW)
    // Orders: amber at 20 min, red at 60 (the phone used 30: 25 min was "fine" here and late on the desktop).
    expect(one(at(19, 'shopify')).stale).toBe(false)
    expect(one(at(20, 'shopify')).stale).toBe(true)
    expect(one(at(25, 'shopify')).stale).toBe(true)
    expect(one(at(25, 'shopify', 'error')).failing).toBe(false) // amber, not red
    expect(one(at(60, 'shopify', 'error')).failing).toBe(true)
    expect(one(at(60, 'shopify', 'partial')).failing).toBe(true)
    expect(one(at(90, 'shopify', 'success')).failing).toBe(false)
    // Meta: amber at 45, red at 120 (the phone used 90).
    expect(one(at(44, 'facebook')).stale).toBe(false)
    expect(one(at(45, 'facebook')).stale).toBe(true)
    expect(one(at(100, 'facebook', 'error')).failing).toBe(false)
    expect(one(at(120, 'facebook', 'error')).failing).toBe(true)
    expect(STALE_AFTER_MINUTES).toEqual({ shopify: STALE_AFTER_MIN.shopify[0], facebook: STALE_AFTER_MIN.facebook[0] })
    for (const min of [5, 19, 20, 44, 45, 59, 60, 119, 120, 600]) {
      for (const source of ['shopify', 'facebook'] as const) {
        expect(one(at(min, source)).stale, `${source} ${min}`).toBe(staleness(source, new Date(NOW.getTime() - min * 60000), NOW) !== 'ok')
      }
    }
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
  it('the judged daily series follows the verdict: Glooty (no costs) is out, so the bars add up to its amount', () => {
    const v = buildVerdict(verdictInputFromPortfolio(view))
    expect(view.dailyJudged).toHaveLength(1)
    expect(view.dailyJudged[0].operatingProfit).toBeCloseTo(v.amount!, 6)
    expect(view.dailyJudged[0].operatingProfit).toBeCloseTo((1000 - 400 - 300) + (1596 - 600 - 400), 6)
    expect(view.dailyJudged[0].metaSpend).toBe(700)
    // With every store configured (or none), it is the same series.
    const mokooOnly = assemblePortfolio({
      stores: [stores[0]], period: 'today', range, comparison: cmp, anchorTimezone: 'America/Sao_Paulo', now: NOW,
      current, compared, chargebackHealth: null, liveFeed: [], liveCovered: new Set(), syncRows: null,
    })
    expect(mokooOnly.dailyJudged).toBe(mokooOnly.daily)
  })
  it('plots only stores whose day is running and reports the closed one apart', () => {
    const i = view.intraday!
    // Glooty has no costs: out of the summed curve, as out of the verdict.
    expect(i.stores.map(s => s.storeId)).toEqual(['mokoo'])
    expect(i.closedStores.map(s => s.storeId)).toEqual(['hibikura'])
    expect(i.unconfiguredStores.map(s => s.storeId)).toEqual(['glooty'])
    expect(i.unconfiguredStores[0]).toMatchObject({ revenue: 0, adSpend: 120, operatingProfit: -120 })
    expect(i.closing).toBe(300)
    expect(i.configured).toBe(true)
    const hib = view.stores.find(s => s.id === 'hibikura')!
    expect(hib.dayClosed).toBe(true)
    expect(hib.badges.map(b => b.code)).toContain('dia_encerrado')
  })
  it('a summed past day ends the curve at the verdict amount (14 nov: $1.298 under $1.362)', () => {
    const day = { from: '2026-11-14', to: '2026-11-14' }
    const dcmp = comparisonRange('custom', day, 'America/Sao_Paulo', NOW)
    const cur = new Map<string, StorePnL>([
      ['mokoo', store('mokoo', 'America/Belem', { '2026-11-14': { revenue: 1000, orders: 10, cogs: 400, metaSpend: 300 } }, { hourly: hours([-50, 120, 250, 300]) })],
      ['glooty', store('glooty', 'America/Belem', { '2026-11-14': { revenue: 0, orders: 0, metaSpend: 64 } }, { configured: false, hourly: hours([-20, -40, -64, -64]) })],
      ['hibikura', store('hibikura', 'Asia/Tokyo', { '2026-11-14': { revenue: 900, orders: 9, cogs: 300, metaSpend: 200 } }, { hourly: hours([10, 200, 380, 400]) })],
    ])
    const cmpd = new Map<string, StoreComparison>(['mokoo', 'glooty', 'hibikura'].map(id => [id, { included: true, range: { from: dcmp.from, to: dcmp.to }, cutoffMinutes: null, totals: pnl() }]))
    const v14 = assemblePortfolio({
      stores, period: 'custom', range: day, comparison: dcmp, anchorTimezone: 'America/Sao_Paulo', now: NOW,
      current: cur, compared: cmpd, chargebackHealth: null, liveFeed: [], liveCovered: new Set(), syncRows: null,
    })
    const verdict = buildVerdict(verdictInputFromPortfolio(v14))
    const i = v14.intraday!
    expect(i.stores.map(s => s.storeId)).toEqual(['mokoo', 'hibikura'])
    expect(i.points[i.points.length - 1].cumProfit).toBeCloseTo(verdict.amount!, 6)
    expect(i.closing).toBeCloseTo(v14.dailyJudged[0].operatingProfit, 6)
    // The peak is never above what the judged stores really made.
    expect(i.peak!.profit).toBe(700)
    expect(i.unconfiguredStores.map(s => s.name)).toEqual(['Glooty'])
    // Only configured stores, or only unconfigured ones: nothing is left out.
    const onlyGlooty = assemblePortfolio({
      stores: [stores[1]], period: 'custom', range: day, comparison: dcmp, anchorTimezone: 'America/Belem', now: NOW,
      current: cur, compared: cmpd, chargebackHealth: null, liveFeed: [], liveCovered: new Set(), syncRows: null,
    })
    expect(onlyGlooty.intraday!.stores.map(s => s.storeId)).toEqual(['glooty'])
    expect(onlyGlooty.intraday!.unconfiguredStores).toEqual([])
    expect(onlyGlooty.intraday!.configured).toBe(false)
  })
  it('carries the range note when buildPortfolio cut the window, null otherwise', () => {
    expect(view.rangeNote).toBeNull()
    const cut = assemblePortfolio({
      stores: [stores[0]], period: 'custom', range, comparison: cmp, anchorTimezone: 'America/Sao_Paulo', now: NOW,
      current, compared, chargebackHealth: null, liveFeed: [], liveCovered: new Set(), syncRows: null, rangeNote: 'O período pedido passa de 366 dias…',
    })
    expect(cut.rangeNote).toBe('O período pedido passa de 366 dias…')
  })
  it('compares only the stores that have something to compare with', () => {
    expect(view.comparison.totals.revenue).toBe(800 + 744)
    expect(view.comparison.sameTimeOfDay).toBe(true)
    expect(view.comparison.label).toBe('ontem até esta hora')
  })
  it('says where the comparison was cut: one minute when every cut store shares it, null when the clocks differ', () => {
    // MOKOO cut at 15h45; Hibikura's closed day compared whole (null): one clock.
    expect(view.comparison.cutoffMinutes).toBe(945)
    const twoClocks = new Map(compared)
    twoClocks.set('hibikura', { ...compared.get('hibikura')!, cutoffMinutes: 3 * 60 + 45 })
    const v = assemblePortfolio({
      stores, period: 'today', range, comparison: cmp, anchorTimezone: 'America/Sao_Paulo', now: NOW,
      current, compared: twoClocks, chargebackHealth: null, liveFeed: [], liveCovered: new Set(), syncRows: null,
    })
    expect(v.comparison).toMatchObject({ sameTimeOfDay: true, cutoffMinutes: null })
    const whole = new Map([...compared].map(([id, c]) => [id, { ...c, cutoffMinutes: null }]))
    const w = assemblePortfolio({
      stores, period: 'today', range, comparison: cmp, anchorTimezone: 'America/Sao_Paulo', now: NOW,
      current, compared: whole, chargebackHealth: null, liveFeed: [], liveCovered: new Set(), syncRows: null,
    })
    expect(w.comparison).toMatchObject({ sameTimeOfDay: false, cutoffMinutes: null })
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

describe('assemblePortfolio · first order (Hibikura opened on 7 nov)', () => {
  // 2026-11-18 in Tokyo; the first kept order is 2026-11-07 on Tokyo's calendar.
  const now = new Date('2026-11-18T05:00:00Z')
  const hibikura: PortfolioStoreInput = { id: 'hib', name: 'Hibikura', timezone: 'Asia/Tokyo' }
  const firstOrderDates = new Map([['hib', '2026-11-07']])
  const viewFor = (period: 'lastmonth' | '30d', range: { from: string; to: string }, days: Record<string, Partial<PnLLines>>, first?: ReadonlyMap<string, string>) => {
    const cmp = comparisonRange(period, range, 'Asia/Tokyo', now)
    return assemblePortfolio({
      stores: [hibikura], period, range, comparison: cmp, anchorTimezone: 'Asia/Tokyo', now,
      current: new Map([['hib', store('hib', 'Asia/Tokyo', days)]]),
      compared: new Map([['hib', { included: true, range: { from: cmp.from, to: cmp.to }, cutoffMinutes: null, totals: pnl() }]]),
      chargebackHealth: null, liveFeed: [], liveCovered: new Set(['hib']), syncRows: null, firstOrderDates: first,
    })
  }

  it('puts the first order on the row, null when it was not loaded', () => {
    const oct = { from: '2026-10-01', to: '2026-10-31' }
    expect(viewFor('lastmonth', oct, { '2026-10-01': {} }, firstOrderDates).stores[0].firstOrderDate).toBe('2026-11-07')
    expect(viewFor('lastmonth', oct, { '2026-10-01': {} }).stores[0].firstOrderDate).toBeNull()
  })
  it('October reads "começou a vender em 7 nov", not "não teve vendas no mês passado"', () => {
    const v = buildVerdict(verdictInputFromPortfolio(viewFor('lastmonth', { from: '2026-10-01', to: '2026-10-31' }, { '2026-10-01': {} }, firstOrderDates)))
    expect(v.headline).toBe('A Hibikura começou a vender em 7 nov — não há dados de outubro.')
    expect(v.chips.map(c => c.label)).toContain('Vende desde 7 nov')
    expect(v.headline).not.toMatch(/não teve vendas/)
  })
  it('30 days that start before the first order carry the note', () => {
    const v = buildVerdict(verdictInputFromPortfolio(viewFor('30d', { from: '2026-10-19', to: '2026-11-17' }, {
      '2026-11-07': { revenue: 3000, orders: 40, cogs: 900, metaSpend: 1200 },
    }, firstOrderDates)))
    expect(v.notes.map(n => n.text)).toContain('A Hibikura só começou a vender em 7 nov: o período tem dias antes disso.')
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
  it('lists every dispute still in time, counted per store, never cut at 5 (12 waited, 4 were shown)', () => {
    const d = (id: string, dueBy: string | null) => ({ externalId: id, amount: 30, currency: 'USD', reason: 'fraudulent', dueBy })
    const h = (n: number) => ({
      count: n, orders: 100, rate: n, amount: 0, fees: 0, open: n, lost: 0, won: 0,
      // getChargebackHealth's own list stops at 5.
      dueSoon: Array.from({ length: Math.min(n, 5) }, (_, k) => d(`x${k}`, '2026-11-20 00:00:00+00')), hasData: n > 0,
    })
    const epochList = ['22', '26', '28', '30', '25'].map((day, k) => d(`e${k}`, `2026-${day === '25' ? '12' : '11'}-${day} 04:00:00+00`))
    const out = combineHealth([
      { store: { id: 'epoch', name: 'EPOCH', timezone: 'UTC' }, health: h(6), awaiting: { list: epochList, overdue: 1 } },
      { store: { id: 'camp', name: 'CAMP HALLOW', timezone: 'UTC' }, health: h(3), awaiting: { list: [d('c0', '2026-11-19 23:00:00+00'), d('c1', '2026-11-29 23:00:00+00'), d('c2', null)], overdue: 0 } },
      { store: { id: 'mokoo', name: 'MOKOO', timezone: 'UTC' }, health: h(1), awaiting: { list: [d('m0', '2026-12-03 04:00:00+00')], overdue: 0 } },
      // Not loaded: falls back to the store's own (cut) list.
      { store: { id: 'dump', name: 'Dumpling', timezone: 'UTC' }, health: h(2) },
    ])
    expect(out.dueSoon).toHaveLength(5 + 3 + 1 + 2)
    expect(out.dueSoon[0].externalId).toBe('c0')
    expect(out.dueSoon.map(x => x.externalId)).toContain('e4') // EPOCH's 25 dez, the fifth
    expect(out.dueSoon.map(x => x.externalId)).toContain('m0')
    expect(out.dueSoon[out.dueSoon.length - 1].externalId).toBe('c2') // no deadline: last
    expect(out.awaitingByStore).toEqual([
      { storeId: 'epoch', name: 'EPOCH', count: 5 },
      { storeId: 'camp', name: 'CAMP HALLOW', count: 3 },
      { storeId: 'dump', name: 'Dumpling', count: 2 },
      { storeId: 'mokoo', name: 'MOKOO', count: 1 },
    ])
    expect(out.awaitingByStore.reduce((a, x) => a + x.count, 0)).toBe(out.dueSoon.length)
    expect(out.overdue).toBe(1)
  })
})
