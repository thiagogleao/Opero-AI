import { describe, expect, it } from 'vitest'
import { allocateAdSpend, lineShares, productKey } from '../products'

describe('productKey', () => {
  it('uses the product id, else the title, like the engine', () => {
    expect(productKey('123', 'Capy')).toBe('123')
    expect(productKey(null, 'Capy')).toBe('t:Capy')
    expect(productKey('', null)).toBe('t:—')
  })
})

describe('lineShares', () => {
  it('splits by line value and sums to 1', () => {
    const s = lineShares([
      { productId: 'a', title: 'A', units: 2, price: 10 },
      { productId: 'b', title: 'B', units: 1, price: 30 },
    ])
    expect(s.map(x => x.key)).toEqual(['a', 'b'])
    expect(s[0].share).toBeCloseTo(0.4)
    expect(s[1].share).toBeCloseTo(0.6)
  })

  it('falls back to units when no line has a price (free items)', () => {
    const s = lineShares([
      { productId: 'a', title: 'A', units: 3, price: 0 },
      { productId: 'b', title: 'B', units: 1, price: null },
    ])
    expect(s[0].share).toBeCloseTo(0.75)
    expect(s[1].share).toBeCloseTo(0.25)
  })

  it('treats a missing quantity as one unit, as the engine does', () => {
    const s = lineShares([
      { productId: 'a', title: 'A', units: null, price: 10 },
      { productId: 'b', title: 'B', units: 1, price: 10 },
    ])
    expect(s[0].share).toBeCloseTo(0.5)
  })

  it('makes an order with no lines one unknown product', () => {
    expect(lineShares([])).toEqual([{ key: 't:—', share: 1 }])
  })
})

describe('allocateAdSpend', () => {
  const STORE = 'epoch', SIB = 'camp'

  it('splits an ad over its orders by credited revenue', () => {
    const a = allocateAdSpend(
      [
        { storeId: STORE, orderId: 'o1', adId: 'ad1', weight: 1, revenue: 30 },
        { storeId: STORE, orderId: 'o2', adId: 'ad1', weight: 1, revenue: 10 },
      ],
      [{ adId: 'ad1', adStoreId: STORE, spend: 100 }],
      STORE,
    )
    expect(a.perOrder.get('o1')!.spend).toBeCloseTo(75)
    expect(a.perOrder.get('o2')!.spend).toBeCloseTo(25)
    expect(a.ownAllocatedHere).toBeCloseTo(100)
    expect(a.ownAllocatedSiblings).toBe(0)
  })

  it('keeps own spend that lands in a sibling store out of this store, and names spend billed elsewhere', () => {
    // EPOCH's ad sold one EPOCH order and one CAMP HALLOW order; a CAMP ad
    // billed to EPOCH… seen from CAMP.
    const credits = [
      { storeId: STORE, orderId: 'e1', adId: 'ad1', weight: 1, revenue: 50 },
      { storeId: SIB, orderId: 'c1', adId: 'ad1', weight: 1, revenue: 50 },
    ]
    const spend = [{ adId: 'ad1', adStoreId: STORE, spend: 80 }]
    const fromEpoch = allocateAdSpend(credits, spend, STORE)
    expect(fromEpoch.ownAllocatedHere).toBeCloseTo(40)
    expect(fromEpoch.ownAllocatedSiblings).toBeCloseTo(40)
    expect(fromEpoch.perOrder.has('c1')).toBe(false)

    const fromCamp = allocateAdSpend(credits, spend, SIB)
    expect(fromCamp.perOrder.get('c1')).toEqual({ spend: 40, billedElsewhere: 40 })
    expect(fromCamp.siblingAllocatedHere).toBeCloseTo(40)
    expect(fromCamp.ownAllocatedHere).toBe(0)
  })

  it('uses weights when every credited order is free, and ignores ads with no spend', () => {
    const a = allocateAdSpend(
      [
        { storeId: STORE, orderId: 'o1', adId: 'ad1', weight: 0.5, revenue: 0 },
        { storeId: STORE, orderId: 'o2', adId: 'ad1', weight: 1, revenue: 0 },
        { storeId: STORE, orderId: 'o3', adId: 'ad2', weight: 1, revenue: 10 },
      ],
      [{ adId: 'ad1', adStoreId: STORE, spend: 30 }, { adId: 'ad2', adStoreId: STORE, spend: 0 }],
      STORE,
    )
    expect(a.perOrder.get('o1')!.spend).toBeCloseTo(10)
    expect(a.perOrder.get('o2')!.spend).toBeCloseTo(20)
    expect(a.perOrder.has('o3')).toBe(false)
  })

  it('adds the spend of an ad that moved between accounts once per account', () => {
    const a = allocateAdSpend(
      [{ storeId: STORE, orderId: 'o1', adId: 'ad1', weight: 1, revenue: 10 }],
      [{ adId: 'ad1', adStoreId: STORE, spend: 10 }, { adId: 'ad1', adStoreId: SIB, spend: 5 }],
      STORE,
    )
    expect(a.perOrder.get('o1')).toEqual({ spend: 15, billedElsewhere: 5 })
  })
})
