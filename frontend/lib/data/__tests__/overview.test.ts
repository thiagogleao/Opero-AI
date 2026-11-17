import { describe, expect, it } from 'vitest'
import { derive, sumPnL, type PnLLines, type StorePnL } from '../../engine/pnl'
import { assembleOverview, type OverviewInputs } from '../overview'

const zero: PnLLines = {
  revenue: 0, orders: 0, units: 0, cogs: 0, packaging: 0, supplierFees: 0, unitSavings: 0,
  shipping: 0, shopifyFees: 0, paymentFees: 0, perOrderExtras: 0, fixedCosts: 0,
  metaSpend: 0, shopSpend: 0, metaPurchaseValue: 0, metaPurchases: 0,
  refundGross: 0, refundCount: 0, refunds: 0, chargebacks: 0, chargebackFees: 0, chargebackCount: 0,
}

function store(id: string, tz: string, days: { date: string; lines: Partial<PnLLines> }[], configured = true): StorePnL {
  const daily = days.map(d => ({ date: d.date, ...derive({ ...zero, ...d.lines }) }))
  return {
    store: { id, name: id, domain: null, timezone: tz, userId: null, archived: false },
    configured, range: { from: days[0].date, to: days[days.length - 1].date },
    partial: false, minutesCovered: 1440, cutoffMinutes: null,
    totals: sumPnL(daily), daily, hourly: null, countries: null, products: null,
  }
}

// 2026-11-17 18:00 UTC = 15:00 in Brasília = 03:00 on the 18th in Tokyo.
const NOW = new Date('2026-11-17T18:00:00Z')

function inputs(over: Partial<OverviewInputs> = {}): OverviewInputs {
  const range = { from: '2026-11-17', to: '2026-11-17' }
  return {
    stores: [
      { id: 'br', name: 'Loja BR', timezone: 'America/Sao_Paulo' },
      { id: 'jp', name: 'Hibikura', timezone: 'Asia/Tokyo' },
      { id: 'gone', name: 'Apagada', timezone: 'UTC' },
    ],
    period: 'today', range, anchorTimezone: 'America/Sao_Paulo', now: NOW,
    pnl: new Map([
      ['br', store('br', 'America/Sao_Paulo', [{ date: '2026-11-17', lines: { revenue: 1000, orders: 10, cogs: 300, metaSpend: 400, shopSpend: 100 } }])],
      ['jp', store('jp', 'Asia/Tokyo', [{ date: '2026-11-17', lines: { revenue: 500, orders: 4, cogs: 100, metaSpend: 100, refunds: 20, refundGross: 40, refundCount: 1 } }], false)],
    ]),
    syncRows: [
      { tenant_id: 'br', source: 'shopify', last_success: '2026-11-17T17:55:00Z', last_started: '2026-11-17T17:55:00Z', last_status: 'success' },
      { tenant_id: 'jp', source: 'shopify', last_success: '2026-11-17T12:00:00Z', last_started: '2026-11-17T17:50:00Z', last_status: 'error' },
    ],
    liveCovered: new Set(['br']),
    chargebackSeen: new Set(['br']),
    refundsDropped: new Map([['br', 12]]),
    shared: [],
    ...over,
  }
}

describe('assembleOverview', () => {
  it('sums the stores into the totals and the daily series into the same totals', () => {
    const v = assembleOverview(inputs())
    expect(v.totals.revenue).toBe(1500)
    expect(v.totals.operatingProfit).toBeCloseTo(v.stores.reduce((s, r) => s + r.totals.operatingProfit, 0))
    expect(v.daily.reduce((s, d) => s + d.operatingProfit, 0)).toBeCloseTo(v.totals.operatingProfit)
    // Shop Campaigns are inside the daily profit — the old chart left them out.
    expect(v.daily[0].shopSpend).toBe(100)
    expect(v.missingStoreIds).toEqual(['gone'])
  })

  it('measures a store whose day is already over as closed, not zero', () => {
    const v = assembleOverview(inputs())
    const jp = v.stores.find(s => s.id === 'jp')!
    expect(jp.storeToday).toBe('2026-11-18')
    expect(jp.dayState).toBe('closed')
    expect(jp.badges.map(b => b.code)).toContain('dia_encerrado')
    expect(v.stores.find(s => s.id === 'br')!.dayState).toBe('running')
  })

  it('reports freshness per store, so a failing sync is not hidden by a healthy one', () => {
    const v = assembleOverview(inputs())
    expect(v.freshness.newestSuccessAt).toBe('2026-11-17T17:55:00.000Z')
    expect(v.freshness.oldestSuccessAt).toBe('2026-11-17T12:00:00.000Z')
    expect(v.freshness.staleStores).toEqual([{ storeId: 'jp', name: 'Hibikura', failing: true, sources: ['shopify'] }])
  })

  it('flags unconfigured stores, blind chargebacks and adjustments per store', () => {
    const v = assembleOverview(inputs())
    expect(v.configured).toBe(false)
    expect(v.unconfiguredStoreIds).toEqual(['jp'])
    const jp = v.stores.find(s => s.id === 'jp')!
    expect(jp.blindToChargebacks).toBe(true)
    expect(jp.badges.map(b => b.code)).toContain('sem_custos')
    expect(v.stores.find(s => s.id === 'br')!.refundsAlreadyDropped).toBe(12)
    expect(v.adjustmentsByStore).toHaveLength(1)
    expect(v.adjustmentsByStore[0].storeId).toBe('jp')
  })

  it('names stores that share an ad account, on both rows', () => {
    const shared = [{ adStoreId: 'br', adStoreName: 'Loja BR', salesStoreId: 'jp', salesStoreName: 'Hibikura', orders: 3, revenue: 300 }]
    const v = assembleOverview(inputs({ shared }))
    expect(v.sharedAccountNote).not.toBeNull()
    expect(v.stores.every(s => s.sharedAdAccounts.length === 1)).toBe(true)
  })
})
