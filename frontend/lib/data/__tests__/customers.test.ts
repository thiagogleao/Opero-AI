import { describe, expect, it } from 'vitest'
import { LTV_SEGMENTS, ltvSegment } from '../customers'

describe('ltvSegment', () => {
  it('buckets customers by their order count', () => {
    expect([1, 2, 3, 4, 6, 7, 40].map(ltvSegment)).toEqual([
      '1 pedido', '2–3 pedidos', '2–3 pedidos', '4–6 pedidos', '4–6 pedidos', '7+ pedidos', '7+ pedidos',
    ])
    expect(LTV_SEGMENTS).toHaveLength(4)
  })
})
