import { describe, expect, it } from 'vitest'
import { captureText } from '../Details'

// MOKOO · Mês passado on the phone: the capture now counts only the days
// Meta's country split covers whole (87%, as the desktop and the Funil), so
// the row's 179 purchases are not its numerator. Without the figures, "46
// compras atribuídas (88% de 41 pedidos …)" read as a contradiction.
const row = (orders: number, purchases: number, capturePct: number | null, captureOrders?: number, capturePurchases?: number) => ({
  orders, meta: { spend: 100, purchases, purchaseValue: 1000, capturePct, captureOrders: captureOrders as number, capturePurchases },
})

describe('captureText (phone Países)', () => {
  it('every order and purchase counted: a plain share of the real orders', () => {
    expect(captureText(row(5, 1, 20, 5, 1))).toBe('20% dos pedidos reais')
    // An answer cached before the fields existed.
    expect(captureText(row(5, 1, 20))).toBe('20% dos pedidos reais')
  })

  it("days left out: the capture's own two figures, as the desktop's 154 ÷ 177", () => {
    expect(captureText(row(373, 179, (154 / 177) * 100, 177, 154))).toBe('87%: 154 compras ÷ 177 pedidos com divisão do Meta')
    expect(captureText(row(46, 46, (36 / 41) * 100, 41, 36))).toBe('88%: 36 compras ÷ 41 pedidos com divisão do Meta')
  })

  it('stores without a split in the sum (Todas): the orders it was measured on', () => {
    expect(captureText(row(36, 1, 20, 5, 1))).toBe('20%: 1 compra ÷ 5 pedidos com divisão do Meta')
  })
})
