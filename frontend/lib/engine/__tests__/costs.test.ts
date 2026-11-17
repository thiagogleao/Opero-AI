import { describe, expect, it } from 'vitest'
import {
  buildCogsLookups, fixedCostForDay, isConfigured, orderSupplierCost, tierOrderCost, tiersForDate,
  type ProfitConfig,
} from '../costs'

function cfg(over: Partial<ProfitConfig['cogs']> = {}, extra: Partial<ProfitConfig> = {}): ProfitConfig {
  return {
    shopify: { transaction_fee_pct: 0, payment_processing_pct: 2.9, payment_processing_fixed: 0.3 },
    cogs: {
      default_cost_usd: 9, packaging_cost_usd: 0, additional_unit_discount_usd: 0,
      volume_discounts: [], products: [], ...over,
    },
    shipping: { default_rate_usd: 0, rates: [] },
    extra_costs: [],
    ...extra,
  }
}

const order = (items: [string | null, number][], date = '2026-11-10', country: string | null = 'US') => ({
  country_code: country, order_date: date,
  items: items.map(([p, u]) => ({ product_id: p, product_title: p ? `T${p}` : null, units: u })),
})

const sumItems = (r: { perItem: number[] }) => r.perItem.reduce((s, v) => s + v, 0)
const supplierTotal = (r: { cogs: number; packaging: number; orderFee: number; saving: number }) =>
  r.cogs + r.packaging + r.orderFee - r.saving

describe('rate cards', () => {
  const card = { effective_from: '2026-09-11', order_prices: { '1': 9, '2': 15, '4': 26 }, extra_unit_usd: 5 }

  it('charges the exact step, the next step up between steps, and extends past the top', () => {
    expect(tierOrderCost(1, card)).toBe(9)
    expect(tierOrderCost(3, card)).toBe(26)
    expect(tierOrderCost(6, card)).toBe(26 + 2 * 5)
    expect(tierOrderCost(0, card)).toBe(0)
  })

  it('is not in force before its date, and the later card for the same products wins', () => {
    const c = cfg({ price_tiers: [card, { ...card, effective_from: '2026-10-01', order_prices: { '1': 8 } }] })
    expect(tiersForDate(c, '2026-09-10')).toHaveLength(0)
    expect(tiersForDate(c, '2026-09-20')[0].order_prices['1']).toBe(9)
    expect(tiersForDate(c, '2026-10-02')[0].order_prices['1']).toBe(8)
  })

  it('ignores a card that has no prices yet instead of pricing orders at $0', () => {
    const c = cfg({ price_tiers: [{ effective_from: '2026-09-01', order_prices: {}, extra_unit_usd: 0 }] })
    const r = orderSupplierCost(order([['a', 2]]), buildCogsLookups(c), c)
    expect(r.cogs).toBe(18) // default $9 x 2
  })

  it('a whole-order card replaces item prices, the order fee and the extra-unit discount', () => {
    const c = cfg({
      price_tiers: [card], additional_unit_discount_usd: 3,
      order_fees: [{ country_code: 'IT', amount_usd: 3.5 }],
      products: [{ product_id: 'a', name: 'A', cost_usd: 20 }],
    })
    const r = orderSupplierCost(order([['a', 2]], '2026-10-01', 'IT'), buildCogsLookups(c), c)
    expect(r).toMatchObject({ cogs: 15, orderFee: 0, saving: 0 })
    expect(sumItems(r)).toBeCloseTo(supplierTotal(r), 9)
  })

  it('a product-scoped card prices only its products; the rest is priced item by item', () => {
    const c = cfg({
      price_tiers: [{ ...card, product_ids: ['sq'] }],
      products: [{ product_id: 'cal', name: 'Calendar', cost_usd: 12 }],
    })
    const r = orderSupplierCost(order([['sq', 2], ['cal', 1]], '2026-10-01'), buildCogsLookups(c), c)
    expect(r.cogs).toBe(15 + 12)
    expect(sumItems(r)).toBeCloseTo(supplierTotal(r), 9)
  })
})

describe('item prices', () => {
  it('cost_usd 0 means not priced yet and falls back to the default; zero_cost_products means free', () => {
    const c = cfg({
      products: [{ product_id: 'a', name: 'A', cost_usd: 0 }],
      zero_cost_products: ['w'],
    })
    const r = orderSupplierCost(order([['a', 1], ['w', 1]]), buildCogsLookups(c), c)
    expect(r.cogs).toBe(9)
  })

  it('a country price beats the base price, and an unknown country uses the base', () => {
    const c = cfg({
      products: [{ product_id: 'a', name: 'A', cost_usd: 10 }],
      country_prices: [{ product_id: 'a', prices: { DE: 14 } }],
    })
    const l = buildCogsLookups(c)
    expect(orderSupplierCost(order([['a', 1]], '2026-11-10', 'DE'), l, c).cogs).toBe(14)
    expect(orderSupplierCost(order([['a', 1]], '2026-11-10', 'FR'), l, c).cogs).toBe(10)
  })

  it('falls back to the title when the product id is unknown (replaced product)', () => {
    const c = cfg({ products: [{ product_id: 'old', name: 'Tnew', cost_usd: 7 }] })
    const r = orderSupplierCost(order([['new', 1]]), buildCogsLookups(c), c)
    expect(r.cogs).toBe(7)
  })
})

describe('extra-unit discount', () => {
  it('takes $3 off each unit after the first', () => {
    const c = cfg({ additional_unit_discount_usd: 3, products: [{ product_id: 'a', name: 'A', cost_usd: 10 }] })
    const r = orderSupplierCost(order([['a', 4]]), buildCogsLookups(c), c)
    expect(r.saving).toBe(9)
    expect(sumItems(r)).toBeCloseTo(supplierTotal(r), 9)
  })

  it('does not count declared-free items, and never takes off more than the items cost', () => {
    const c = cfg({
      additional_unit_discount_usd: 3,
      products: [{ product_id: 'a', name: 'A', cost_usd: 1 }],
      zero_cost_products: ['card'],
    })
    const r = orderSupplierCost(order([['a', 2], ['card', 5]]), buildCogsLookups(c), c)
    expect(r.saving).toBe(2) // (2-1)*3 = 3, capped at the $2 the two units cost
    expect(supplierTotal(r)).toBeGreaterThanOrEqual(0)
  })
})

describe('packaging and order fees', () => {
  it('per-unit packaging applies only to the listed products, the order fee once per order', () => {
    const c = cfg({
      packaging_cost_usd: 0.5, packaging_per_unit_usd: 1, packaging_per_unit_products: ['box'],
      order_fees: [{ country_code: 'IT', amount_usd: 3.5, effective_from: '2026-10-01' }],
    })
    const l = buildCogsLookups(c)
    const r = orderSupplierCost(order([['box', 3], ['shirt', 1]], '2026-10-05', 'IT'), l, c)
    expect(r.packaging).toBe(0.5 + 3)
    expect(r.orderFee).toBe(3.5)
    expect(orderSupplierCost(order([['box', 1]], '2026-09-30', 'IT'), l, c).orderFee).toBe(0)
    expect(sumItems(r)).toBeCloseTo(supplierTotal(r), 9)
  })
})

describe('fixed costs', () => {
  it('spreads a monthly cost over the real days of each month', () => {
    const c = cfg({}, { extra_costs: [{ name: 'app', amount_usd: 310, frequency: 'monthly' }] })
    expect(fixedCostForDay('2026-10-15', c)).toBeCloseTo(10, 9)   // 31 days
    expect(fixedCostForDay('2026-11-15', c)).toBeCloseTo(310 / 30, 9)
  })
  it('ignores per-order extras (they belong to orders)', () => {
    const c = cfg({}, { extra_costs: [{ name: 'insert', amount_usd: 1, frequency: 'per_order' }] })
    expect(fixedCostForDay('2026-11-15', c)).toBe(0)
  })
})

describe('isConfigured', () => {
  it('treats an empty object as not configured', () => {
    expect(isConfigured({} as ProfitConfig)).toBe(false)
    expect(isConfigured(null)).toBe(false)
    expect(isConfigured(cfg())).toBe(true)
  })
})
