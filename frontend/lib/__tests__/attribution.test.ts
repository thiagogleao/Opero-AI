import { describe, expect, it } from 'vitest'
import { attributionTotals, decodeJourneyCursor, encodeJourneyCursor, othersRow } from '../attribution'
import type { CreativeAttribution } from '../attributionModels'

const ad = (o: Partial<CreativeAttribution>): CreativeAttribution => ({
  adId: 'x', name: null, campaignName: null, thumbnail: null,
  orders: 0, revenue: 0, siblingOrders: 0, siblingRevenue: 0, spend: 0, adStoreId: null,
  metaPurchases: 0, metaRevenue: 0, roasJourney: null, roasMeta: null, ...o,
})

describe('attributionTotals', () => {
  const EPOCH = 'epoch', CAMP = 'camp'

  it('counts spend and Meta claims only for ads of the store’s own account', () => {
    const rows = [
      // EPOCH ad selling in both stores.
      ad({ adId: 'a', adStoreId: EPOCH, orders: 2, revenue: 200, siblingOrders: 3, siblingRevenue: 300, spend: 250, metaPurchases: 6, metaRevenue: 600 }),
      // EPOCH ad with spend and no journey sale.
      ad({ adId: 'b', adStoreId: EPOCH, spend: 50, metaPurchases: 1, metaRevenue: 80 }),
      // Ad of an account no token reads.
      ad({ adId: 'c', adStoreId: null, orders: 1, revenue: 90 }),
    ]
    const t = attributionTotals(EPOCH, rows)
    expect(t.orders).toBe(3)
    expect(t.revenue).toBe(290)
    expect(t.spend).toBe(300)
    expect(t.metaRevenue).toBe(680)
    expect(t.journeyRevenueOwnAds).toBe(500)
    expect(t.siblingRevenue).toBe(300)
    expect(t.unknownAdRevenue).toBe(90)
    expect(t.roasJourney).toBeCloseTo(500 / 300)
    expect(t.metaGapPct).toBeCloseTo(((680 - 500) / 500) * 100)
    expect(t.adsWithActivity).toBe(3)
  })

  it('seen from the store that sells on another store’s ads, that spend is shared, not its own', () => {
    const rows = [ad({ adId: 'a', adStoreId: EPOCH, orders: 3, revenue: 300, siblingOrders: 2, siblingRevenue: 200, spend: 250 })]
    const t = attributionTotals(CAMP, rows)
    expect(t.spend).toBe(0)
    expect(t.sharedSpend).toBe(250)
    expect(t.revenue).toBe(300)
    expect(t.roasJourney).toBeNull()
  })
})

describe('othersRow', () => {
  it('sums the rows below the cut so the table still adds up', () => {
    const r = othersRow([ad({ spend: 10, revenue: 30, orders: 1 }), ad({ spend: 5, revenue: 0, siblingRevenue: 15 })])!
    expect(r.count).toBe(2)
    expect(r.spend).toBe(15)
    expect(r.roasJourney).toBeCloseTo(45 / 15)
    expect(othersRow([])).toBeNull()
  })

  it('names a count of 1.000 or more with the separator (regression: "Outros 1478 anúncios")', () => {
    const r = othersRow(Array.from({ length: 1478 }, () => ad({ spend: 1 })))!
    expect(r.count).toBe(1478)
    expect(r.name).toBe('Outros 1.478 anúncios')
  })
})

describe('journey cursor', () => {
  it('round-trips and rejects anything it did not write', () => {
    const c = encodeJourneyCursor('2026-11-17T02:04:58.123456Z', '6403421946098')
    expect(decodeJourneyCursor(c)).toEqual({ createdAt: '2026-11-17T02:04:58.123456Z', orderId: '6403421946098' })
    expect(decodeJourneyCursor('abc')).toBeNull()
    expect(decodeJourneyCursor(Buffer.from("x|1' OR 1=1").toString('base64url'))).toBeNull()
    expect(decodeJourneyCursor(null)).toBeNull()
  })
})
