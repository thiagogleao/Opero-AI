import { describe, expect, it } from 'vitest'
import type { PnL } from '@/lib/engine/pnl'
import { buildProductsVerdict, type ProductLike } from '../productsVerdict'

const P = (key: string, orders: number, revenue: number, contribution: number | null, units = orders): ProductLike =>
  ({ key, title: key, units, orders, revenue, contribution })

const base = {
  subject: 'a MOKOO', subjectOf: 'da MOKOO', subjectIn: 'na MOKOO', configured: true,
  rangeLabel: '10–16 nov', periodPhrase: 'nos últimos 7 dias', partialLabel: null, dayLabel: null,
}

describe('buildProductsVerdict', () => {
  const products = [P('Christmas Capy', 52, 4090, 2627, 168), P('Moo Milk', 42, 3791, 2560, 158), P('Happy Capy', 11, 670, 453), P('Free Gift', 6, 0, -40)]
  const totals = { revenue: 8551, orders: 100, units: 343, contribution: 5600 } as PnL

  it('names the product that carried the period and the share it took', () => {
    const v = buildProductsVerdict({ ...base, products, totals })
    expect(v.headline).toBe('Christmas Capy puxou a MOKOO nos últimos 7 dias: 48% das vendas e 47% da contribuição.')
    expect(v.amount).toBe(5600)
    expect(v.amountTone).toBe('pos')
  })

  it('keeps free gifts out of the "no prejuízo" chip and says what they cost', () => {
    const v = buildProductsVerdict({ ...base, products, totals })
    expect(v.chips.some(c => c.code === 'prejuizo')).toBe(false)
    // Units given away, not product lines (Free Gift: 6 units in 6 orders).
    expect(v.details.map(d => d.text).join(' ')).toContain('6 brindes dados de graça custaram $40,00')
    const one = buildProductsVerdict({ ...base, products: [...products.slice(0, 3), P('Free Gift', 1, 0, -6.5)], totals })
    expect(one.details.map(d => d.text).join(' ')).toContain('1 brinde dado de graça custou $6,50')
    // MOKOO 7 dias: six Free Gift rows with 1+1+2+3+3+7 = 17 units.
    const six = [1, 1, 2, 3, 3, 7].map((u, i) => P(`Free Gift ${i}`, u, 0, -18.5, u))
    const many = buildProductsVerdict({ ...base, products: [...products.slice(0, 3), ...six], totals })
    expect(many.details.map(d => d.text).join(' ')).toContain('17 brindes dados de graça (6 produtos de brinde) custaram $111')
  })

  it('calls out products sold below cost, gifts apart', () => {
    const v = buildProductsVerdict({ ...base, products: [...products, P('Gift Box', 3, 90, -12)], totals })
    expect(v.chips[0].label).toBe('1 no prejuízo antes dos anúncios')
    const text = v.details.map(d => d.text).join(' ')
    expect(text).toContain('1 produto vendido saiu no prejuízo antes dos anúncios: Gift Box.')
    expect(text).toContain('À parte, 6 brindes dados de graça custaram $40,00.')
  })

  it('shows sales, not contribution, without cost settings', () => {
    const v = buildProductsVerdict({ ...base, configured: false, products: products.map(p => ({ ...p, contribution: null })), totals })
    expect(v.amount).toBe(8551)
    expect(v.basis).toBe('revenue_minus_ads')
    expect(v.chips.map(c => c.label)).toContain('Custos não configurados')
  })

  it('leaves stores without costs out of a several-store contribution and names them', () => {
    const v = buildProductsVerdict({
      ...base, subject: 'suas lojas', subjectOf: 'das suas lojas', subjectIn: 'nas suas lojas',
      products: [...products, { ...P('No Straps', 2, 130, null), store: 'Glooty' }], totals, contributionTotal: 5600, excludedStores: ['Glooty'],
    })
    expect(v.amount).toBe(5600)
    expect(v.amountCaption).toContain('(sem Glooty)')
  })

  it('has no fake $0 when nothing sold', () => {
    const v = buildProductsVerdict({ ...base, products: [], totals: { revenue: 0, orders: 0, units: 0, contribution: 0 } as PnL })
    expect(v.amount).toBeNull()
    expect(v.headline).toBe('Nenhuma venda na MOKOO nos últimos 7 dias.')
  })
})
