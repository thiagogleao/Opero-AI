import { describe, expect, it } from 'vitest'
import { sumPnL, type PnL, type PnLLines } from '@/lib/engine/pnl'
import type { SharedAdAccount } from '@/lib/attributionModels'
import { adChannels, freshnessCell, laneState, lastSaleDate, pairOrdersIn, pairsMixedIn, resultSortValue, resumoLinkOverrides, rowResult, sharedAccountBadges, trailRange } from '../model'

const pnl = (over: Partial<PnLLines> = {}): PnL => sumPnL([{ ...sumPnL([]), ...over }])
const NOW = new Date('2026-11-18T01:30:00Z')
const ago = (min: number) => new Date(NOW.getTime() - min * 60000).toISOString()

describe('rowResult', () => {
  it('is real profit for a store with costs', () => {
    const r = rowResult({ configured: true, totals: pnl({ revenue: 100, orders: 2, cogs: 30, metaSpend: 40 }) })
    expect(r).toEqual({ kind: 'profit', value: 30 })
    expect(resultSortValue(r)).toBe(30)
  })

  it('is revenue − ads without costs, and never sorts with real profit', () => {
    const r = rowResult({ configured: false, totals: pnl({ revenue: 156.3, orders: 2, metaSpend: 819.5 }) })
    expect(r.kind).toBe('revenue_minus_ads')
    expect(r.value).toBeCloseTo(-663.2, 6)
    expect(resultSortValue(r)).toBeNull()
  })

  it('is nothing (not $0) without orders and without spend', () => {
    expect(rowResult({ configured: true, totals: pnl() })).toEqual({ kind: 'none', value: null })
  })

  it('ads without a sale are a loss, not "sem vendas"', () => {
    const r = rowResult({ configured: true, totals: pnl({ metaSpend: 25 }) })
    expect(r).toEqual({ kind: 'profit', value: -25 })
  })
})

describe('adChannels', () => {
  it('judges the only channel that spent against the store break-even', () => {
    const t = pnl({ revenue: 16514, orders: 228, cogs: 5000, shopSpend: 6019 })
    const { gauge, spendOnly } = adChannels(t, true)
    expect(gauge?.label).toBe('Shopify')
    expect(gauge?.roas).toBeCloseTo(16514 / 6019, 6)
    expect(gauge?.breakEven).toBeCloseTo(t.breakEvenRoas!, 6)
    expect(spendOnly).toEqual([])
  })

  it('with both channels, Meta keeps the gauge and Shopify is spend only', () => {
    const { gauge, spendOnly } = adChannels(pnl({ revenue: 10942, orders: 134, cogs: 3461, metaSpend: 5624, shopSpend: 226 }), true)
    expect(gauge?.channel).toBe('meta')
    expect(gauge?.roas).toBeCloseTo(10942 / 5624, 6)
    expect(spendOnly).toHaveLength(1)
    expect(spendOnly[0].roas).toBeNull()
    expect(spendOnly[0].spend).toBe(226)
  })

  it('measures both channels together when both carry real spend (never revenue ÷ a small Meta spend)', () => {
    const { gauge, spendOnly } = adChannels(pnl({ revenue: 6130, orders: 88, cogs: 1500, metaSpend: 600, shopSpend: 1796 }), true)
    expect(gauge?.label).toBe('Anúncios')
    expect(gauge?.roas).toBeCloseTo(6130 / 2396, 6)
    expect(spendOnly).toEqual([])
    // Dumpling 8jcp3a today: $56 of Meta next to $1.796 of Shopify ads is a Shopify store.
    const d = adChannels(pnl({ revenue: 6130, orders: 88, metaSpend: 55.81, shopSpend: 1796 }), true)
    expect(d.gauge?.label).toBe('Shopify')
    expect(d.spendOnly.map(c => c.label)).toEqual(['Meta'])
  })

  it('has no break-even without costs and no gauge without spend', () => {
    expect(adChannels(pnl({ revenue: 156, metaSpend: 819 }), false).gauge?.breakEven).toBeNull()
    expect(adChannels(pnl({ revenue: 100, orders: 1 }), true).gauge).toBeNull()
  })
})

describe('sharedAccountBadges', () => {
  const pair: SharedAdAccount = { adStoreId: 'epoch', adStoreName: 'EPOCH', salesStoreId: 'camp', salesStoreName: 'CAMP HALLOW', orders: 66, revenue: 7035.94 }

  it('names the paying store on the selling store and the other way round', () => {
    expect(sharedAccountBadges('camp', [pair], 'Nos últimos 90 dias')[0].label).toBe('anúncios na conta da EPOCH')
    expect(sharedAccountBadges('epoch', [pair], 'Nos últimos 90 dias')[0].label).toBe('paga anúncios da CAMP HALLOW')
    expect(sharedAccountBadges('epoch', [pair], 'Nos últimos 90 dias')[0].detail).toContain('66 pedidos')
    expect(sharedAccountBadges('mokoo', [pair], 'x')).toEqual([])
  })

  it('tells a window the pair mixed from one it did not, and stays cautious when unknown', () => {
    // CAMP HALLOW stopped selling on 30 out: a November week has no cross orders.
    expect(pairOrdersIn([], pair)).toBe(0)
    expect(pairOrdersIn([{ ...pair, orders: 12 }], pair)).toBe(12)
    expect(pairOrdersIn(null, pair)).toBeNull()
    expect(pairsMixedIn([pair], [])).toEqual([])
    expect(pairsMixedIn([pair], [{ ...pair, orders: 3 }])).toEqual([pair])
    expect(pairsMixedIn([pair], null)).toEqual([pair])
  })
})

describe('freshness', () => {
  const lane = (min: number | null, staleness: 'ok' | 'amber' | 'red' | 'unknown', lastStatus: 'success' | 'error' | null = 'success') =>
    ({ lastSuccessAt: min === null ? null : ago(min), lastStatus, staleness })

  it('maps lanes like the top bar: red with an error is failing', () => {
    expect(laneState(lane(5, 'ok'))).toBe('ok')
    expect(laneState(lane(30, 'amber'))).toBe('stale')
    expect(laneState(lane(200, 'red', 'error'))).toBe('failing')
    expect(laneState(lane(200, 'red'))).toBe('stale')
    expect(laneState(null)).toBeNull()
  })

  it('reports the OLDEST source and the worst state, so a fresh source never hides a late one', () => {
    const c = freshnessCell({ shopify: lane(4, 'ok'), facebook: lane(130, 'red', 'error') }, NOW)
    expect(c.state).toBe('failing')
    expect(c.label).toBe('há 2 h')
    expect(c.detail).toBe('pedidos há 4 min · Meta há 2 h (última tentativa falhou)')
  })

  it('a store without ad sync is judged on orders alone; nothing known is unknown', () => {
    expect(freshnessCell({ shopify: lane(6, 'ok'), facebook: null }, NOW)).toMatchObject({ state: 'ok', label: 'há 6 min' })
    expect(freshnessCell(undefined, NOW).state).toBe('unknown')
    expect(freshnessCell({ shopify: lane(null, 'unknown'), facebook: null }, NOW)).toMatchObject({ state: 'unknown', label: 'nunca' })
  })
})

describe('trailRange', () => {
  it('is 30 days ending with the window, or the whole window when longer (max 92)', () => {
    expect(trailRange({ from: '2026-11-10', to: '2026-11-16' })).toEqual({ from: '2026-10-18', to: '2026-11-16' })
    expect(trailRange({ from: '2026-11-17', to: '2026-11-17' })).toEqual({ from: '2026-10-19', to: '2026-11-17' })
    expect(trailRange({ from: '2026-09-01', to: '2026-10-31' })).toEqual({ from: '2026-09-01', to: '2026-10-31' })
    // 1 Aug – 31 Oct is exactly 92 days: a longer window is cut there.
    expect(trailRange({ from: '2026-01-01', to: '2026-10-31' })).toEqual({ from: '2026-08-01', to: '2026-10-31' })
  })
})

describe('resumoLinkOverrides', () => {
  const week = { from: '2026-11-10', to: '2026-11-16' }
  it('keeps the period when the store is on the same date as Brasília', () => {
    expect(resumoLinkOverrides({ id: 'mokoo', storeToday: '2026-11-17' }, { today: '2026-11-17', period: '7d', range: week }))
      .toEqual({ loja: 'mokoo' })
  })
  it('opens a store a day ahead (Tóquio after noon) on the exact dates of the row', () => {
    expect(resumoLinkOverrides({ id: 'hib', storeToday: '2026-11-18' }, { today: '2026-11-17', period: 'today', range: { from: '2026-11-17', to: '2026-11-17' } }))
      .toEqual({ loja: 'hib', periodo: 'custom', de: '2026-11-17', ate: '2026-11-17' })
    expect(resumoLinkOverrides({ id: 'hib', storeToday: '2026-11-18' }, { today: '2026-11-17', period: '7d', range: week }))
      .toEqual({ loja: 'hib', periodo: 'custom', de: '2026-11-10', ate: '2026-11-16' })
  })
  it('a custom window already has explicit dates', () => {
    expect(resumoLinkOverrides({ id: 'hib', storeToday: '2026-11-18' }, { today: '2026-11-17', period: 'custom', range: week }))
      .toEqual({ loja: 'hib' })
  })
})

describe('lastSaleDate', () => {
  it('is the date on the store calendar, not the UTC date', () => {
    // 23h50 on 17 nov in Belém is 02h50 UTC on the 18th.
    expect(lastSaleDate('2026-11-18T02:50:00.000Z', 'America/Belem')).toBe('2026-11-17')
    expect(lastSaleDate('2026-11-18T02:50:00.000Z', 'Asia/Tokyo')).toBe('2026-11-18')
  })
  it('is null without an order or with a bad timestamp', () => {
    expect(lastSaleDate(null, 'America/Belem')).toBeNull()
    expect(lastSaleDate('nope', 'America/Belem')).toBeNull()
  })
})
