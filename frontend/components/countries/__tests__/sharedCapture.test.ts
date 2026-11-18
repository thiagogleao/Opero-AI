import { describe, expect, it } from 'vitest'
import { partitionOwnShared, splitOwnShared } from '@/lib/data/campaigns'
import { buildFunnel, sumFunnels } from '@/lib/data/funnel'
import { withoutShared } from '@/lib/data/countries'
import type { AdDayFact, CampaignInfo } from '@/lib/data/meta'
import type { CountryPnL } from '@/lib/engine/pnl'
import { sharedLeftOutText } from '../sharedText'

// EPOCH's October in miniature: its own campaign, and CAMP HALLOW's Freddie
// running in EPOCH's old (shared) account, whose sales land in CAMP HALLOW.
const EPOCH = '73a1d3b1-45ff-410a-af37-93f95a591e6e'
const CAMP = 'ae929078-e0ef-4ddc-9022-283fb67a5dd7'
const OLD = 'act_3618880568247785'
const NEW = 'act_1040512874708609'
const RANGE = { from: '2026-10-01', to: '2026-10-31' }

function fact(over: Partial<AdDayFact>): AdDayFact {
  return {
    date: '2026-10-10', adId: 'ad1', campaignId: 'own', adsetId: 's1', accountId: NEW,
    spend: 0, purchaseValue: 0, purchases: 0, phantomValue: 0, impressions: 0, reach: 0, linkClicks: 0,
    landingPageViews: 0, addToCart: 0, initiateCheckout: 0, videoPlays: 0, videoP25: 0, videoP50: 0,
    videoP75: 0, videoP100: 0, ...over,
  }
}
const camp = (campaignId: string, accountId: string): CampaignInfo => ({ campaignId, name: campaignId, status: 'ACTIVE', objective: null, accountId })

const facts = [
  fact({ adId: 'a1', campaignId: 'own', spend: 25162, purchases: 309, purchaseValue: 33910, impressions: 19_000_000, linkClicks: 190_000 }),
  fact({ adId: 'f1', campaignId: 'freddie', accountId: OLD, spend: 22058, purchases: 439, purchaseValue: 39638, impressions: 570_000, linkClicks: 9_000 }),
]
const campaigns = new Map([['own', camp('own', NEW)], ['freddie', camp('freddie', OLD)]])
const journeys = new Map([['freddie', new Map([[CAMP, 338]])], ['own', new Map([[EPOCH, 200]])]])

describe('partitionOwnShared', () => {
  it('splits the facts by the Campanhas rule and names where the sales landed', () => {
    const p = partitionOwnShared(EPOCH, facts, campaigns, journeys)
    expect(p.own.map(f => f.adId)).toEqual(['a1'])
    expect(p.shared.map(f => f.adId)).toEqual(['f1'])
    expect(p.sharedGroups).toEqual([{ campaignId: 'freddie', salesStoreId: CAMP }])
    // Same money split as splitOwnShared (and so as the campaign report).
    const s = splitOwnShared(EPOCH, facts, campaigns, journeys)
    expect(s.shared.spend).toBe(22058)
    expect(s.own.spend).toBe(25162)
  })
})

describe('buildFunnel', () => {
  const split = partitionOwnShared(EPOCH, facts, campaigns, journeys)
  const f = buildFunnel(EPOCH, RANGE, split, { orders: 381, abandonedCheckouts: 457 }, 1)

  it("measures capture and spend per order on the store's own campaigns", () => {
    // 309 of 381, not 748 of 381 ("196%").
    expect(f.metaCapturePct).toBeCloseTo((309 / 381) * 100, 6)
    expect(f.shopify.costPerOrder).toBeCloseTo(25162 / 381, 6)
    expect(f.spend).toBe(25162)
    expect(f.meta.steps.find(s => s.key === 'purchases')!.value).toBe(309)
  })

  it('names what it left out instead of the generic note', () => {
    expect(f.sharedLeftOut).toMatchObject({ campaigns: 1, spend: 22058, purchases: 439, salesStoreIds: [CAMP] })
    expect(f.notes).toEqual([])
  })

  it('adds the shared campaigns back in a sum that holds the store their sales landed in', () => {
    const camp0 = buildFunnel(CAMP, RANGE, { own: [], shared: [], sharedGroups: [] }, { orders: 141, abandonedCheckouts: 10 }, 1)
    const both = sumFunnels([f, camp0], new Set([EPOCH, CAMP]), RANGE)
    expect(both.metaCapturePct).toBeCloseTo((748 / (381 + 141)) * 100, 6)
    expect(both.spend).toBe(25162 + 22058)
    expect(both.sharedLeftOut).toBeNull()
    // A partner who sees EPOCH but not CAMP HALLOW: they stay out, named.
    const alone = sumFunnels([f], new Set([EPOCH]), RANGE)
    expect(alone.metaCapturePct).toBeCloseTo((309 / 381) * 100, 6)
    expect(alone.sharedLeftOut?.purchases).toBe(439)
  })
})

describe('withoutShared', () => {
  const us = (over: Partial<CountryPnL & { purchases: number }>) => ({
    country: 'US', revenue: 23457, orders: 207, variableCosts: 4880, contribution: 18577,
    metaSpend: 36670, metaPurchaseValue: 56191, purchases: 586, ...over,
  })
  it("takes the shared campaigns' share out of Meta's columns only", () => {
    const [row] = withoutShared([us({})], [{ country: 'US', spend: 21737, pv: 38925, pc: 432 }])
    expect(row.purchases).toBe(154)
    expect(row.metaSpend).toBeCloseTo(14933, 2)
    expect(row.metaPurchaseValue).toBeCloseTo(17266, 2)
    // The store's own side is untouched: the table still adds up.
    expect(row.revenue).toBe(23457)
    expect(row.contribution).toBe(18577)
  })
  it('never goes below zero', () => {
    const [row] = withoutShared([us({ metaSpend: 10, purchases: 1 })], [{ country: 'US', spend: 10.004, pv: 0, pc: 2 }])
    expect(row.metaSpend).toBe(0)
    expect(row.purchases).toBe(0)
  })
})

describe('sharedLeftOutText', () => {
  it('says how many, how much, and where the sales went', () => {
    const t = sharedLeftOutText({ campaigns: 5, spend: 22058.17, purchases: 439, salesStoreIds: [CAMP] }, id => (id === CAMP ? 'CAMP HALLOW' : null), 'do funil, da captura e do gasto por pedido')
    expect(t).toBe('Fora do funil, da captura e do gasto por pedido: 5 campanhas de conta compartilhada ($22.058 de gasto, 439 compras do Meta), porque as vendas delas caíram na CAMP HALLOW. O gasto continua nos livros desta loja.')
  })
  it('does not name a store the viewer cannot see', () => {
    expect(sharedLeftOutText({ campaigns: 1, spend: 50, purchases: 1, salesStoreIds: [CAMP] }, () => null, 'x'))
      .toContain('1 campanha de conta compartilhada ($50,00 de gasto, 1 compra do Meta), porque as vendas dela caíram em outra loja')
  })
})
