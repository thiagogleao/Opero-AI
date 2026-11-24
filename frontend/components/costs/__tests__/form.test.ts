import { describe, expect, it } from 'vitest'
import { defaultProfitConfig, parseProfitConfig, sameConfig, type ProfitConfig } from '@/lib/data/profitConfig'
import {
  changedSections, clientIssues, fieldKey, joinPt, messagesByField, numText, productKey, ptMessage, rowKey, toForm, toPayload,
} from '../form'

/** Shaped like production: MOKOO's country lists and EU fees, Hibikura's
 *  one-product card, Dumpling's scoped card, a zero-cost warranty. */
function sample(): ProfitConfig {
  const c = defaultProfitConfig()
  c.shopify = { transaction_fee_pct: 2.9, payment_processing_pct: 0, payment_processing_fixed: 0.3 }
  c.cogs.default_cost_usd = 9
  c.cogs.additional_unit_discount_usd = 3
  c.cogs.packaging_per_unit_usd = 1.8
  c.cogs.packaging_per_unit_products = ['111', '222']
  c.cogs.products = [
    { product_id: '111', name: 'Capy Chef', cost_usd: 13.7 },
    { product_id: '222', name: 'Capy Gamer', cost_usd: 0 },
    { product_id: '333', name: 'Garantia', cost_usd: 0 },
  ]
  c.cogs.zero_cost_products = ['333']
  c.cogs.price_tiers = [
    { effective_from: '2026-09-11', label: 'Squishies', product_ids: ['111'], order_prices: { '1': 7.8, '2': 12.5, '10': 40 }, extra_unit_usd: 4.79 },
    { effective_from: '2026-11-08', label: 'Hibachi', product_ids: ['444'], order_prices: { '1': 11 }, extra_unit_usd: 4.7 },
  ]
  c.cogs.country_prices = [{ product_id: '111', name: 'Capy Chef', prices: { US: 10.5, DE: 12.25 } }]
  c.cogs.order_fees = [
    { country_code: 'DE', amount_usd: 3.5, effective_from: '2026-06-22' },
    { country_code: 'DZ', amount_usd: -2, name: 'Argélia' },
  ]
  c.shipping = { default_rate_usd: 4.9, rates: [{ country_code: 'US', name: 'EUA', cost_usd: 5.5 }] }
  c.extra_costs = [
    { name: 'Shopify plano', amount_usd: 39, frequency: 'monthly' },
    { name: 'Embalagem extra', amount_usd: 0.4, frequency: 'per_order' },
  ]
  return c
}

describe('numText', () => {
  it('writes decimals with a comma and no float noise', () => {
    expect(numText(2.9)).toBe('2,9')
    expect(numText(0.1 + 0.2)).toBe('0,3')
    expect(numText(0)).toBe('0')
    expect(numText(13.7)).toBe('13,7')
    expect(numText(null)).toBe('')
  })
})

describe('toForm → toPayload', () => {
  it('round-trips a saved config without changing it', () => {
    const cfg = sample()
    const { config } = toPayload(toForm(cfg))
    const parsed = parseProfitConfig(config, cfg)
    expect(parsed.issues).toEqual([])
    expect(sameConfig(parsed.config, cfg)).toBe(true)
  })

  it('round-trips the defaults (a store with nothing saved)', () => {
    const cfg = defaultProfitConfig()
    const parsed = parseProfitConfig(toPayload(toForm(cfg)).config, cfg)
    expect(sameConfig(parsed.config, cfg)).toBe(true)
  })

  it('reads comma decimals and sends a cleared price as 0 (not priced yet)', () => {
    const cfg = sample()
    const f = toForm(cfg)
    f.shopify.transaction_fee_pct = '3,5'
    f.cogs.products['111'] = ''
    const parsed = parseProfitConfig(toPayload(f).config, cfg)
    expect(parsed.config.shopify.transaction_fee_pct).toBe(3.5)
    expect(parsed.config.cogs.products.find(p => p.product_id === '111')?.cost_usd).toBe(0)
  })

  it('sends a newly priced catalogue product with its catalogue name, after the saved ones', () => {
    const cfg = sample()
    const f = toForm(cfg)
    f.cogs.products['999'] = '13,70'
    f.cogs.products['998'] = '' // touched and cleared: not sent
    const p = toPayload(f, { '999': 'Needoh Advent' })
    const products = (p.config.cogs as { products: { product_id: string; name: string; cost_usd: unknown }[] }).products
    expect(products.map(x => x.product_id)).toEqual(['111', '222', '333', '999'])
    expect(products[3]).toEqual({ product_id: '999', name: 'Needoh Advent', cost_usd: 13.7 })
    expect(p.index.products).toEqual(['111', '222', '333', '999'])
  })

  it('keeps invalid text so the server names the field', () => {
    const f = toForm(sample())
    f.cogs.default_cost_usd = 'abc'
    const parsed = parseProfitConfig(toPayload(f).config, sample())
    expect(parsed.issues.map(i => i.path)).toContain('cogs.default_cost_usd')
  })

  it('a card for the whole order sends no product list', () => {
    const f = toForm(sample())
    f.cogs.price_tiers[1].scope = 'all'
    const tiers = (toPayload(f).config.cogs as { price_tiers: { product_ids: string[] }[] }).price_tiers
    expect(tiers[1].product_ids).toEqual([])
  })
})

describe('fieldKey', () => {
  it('maps list positions to the row that was there', () => {
    const f = toForm(sample())
    // Delete the first card: the server's [0] is now the second card.
    f.cogs.price_tiers = f.cogs.price_tiers.slice(1)
    const { index } = toPayload(f)
    expect(fieldKey('cogs.price_tiers[0].order_prices.3', index)).toBe(`${rowKey('cogs.price_tiers', 't1')}.order_prices.3`)
    expect(fieldKey('cogs.products[1].cost_usd', index)).toBe(`${productKey('222')}.cost_usd`)
    expect(fieldKey('shipping.rates[0].country_code', index)).toBe(`${rowKey('shipping.rates', 'r0')}.country_code`)
    expect(fieldKey('shopify.transaction_fee_pct', index)).toBe('shopify.transaction_fee_pct')
  })

  it('puts the server messages of a bad card on that card after a deletion (PE17)', () => {
    const cfg = sample()
    const f = toForm(cfg)
    f.cogs.price_tiers = f.cogs.price_tiers.slice(1)
    f.cogs.price_tiers[0].steps[0].price = 'x'
    const p = toPayload(f)
    const parsed = parseProfitConfig(p.config, cfg)
    const m = messagesByField(parsed.issues, parsed.warnings, p.index)
    expect([...m.errors.keys()]).toEqual([`${rowKey('cogs.price_tiers', 't1')}.order_prices.1`])
  })
})

describe('clientIssues', () => {
  it('refuses a "some products" card with none chosen and repeated rows', () => {
    const f = toForm(sample())
    f.cogs.price_tiers[0].product_ids = []
    f.cogs.price_tiers[0].steps.push({ _id: 'x', units: '2', price: '9' })
    f.cogs.country_prices[0].prices.push({ _id: 'y', country: 'de', price: '1' })
    const paths = clientIssues(f).map(i => i.path)
    expect(paths).toContain(`${rowKey('cogs.price_tiers', 't0')}.product_ids`)
    expect(paths).toContain(`${rowKey('cogs.price_tiers', 't0')}.step#x`)
    expect(paths).toContain(`${rowKey('cogs.country_prices', 'c0')}.price#y`)
  })

  it('has nothing to say about a saved config', () => {
    expect(clientIssues(toForm(sample()))).toEqual([])
  })
})

describe('changedSections', () => {
  it('names only the sections that differ', () => {
    const base = toPayload(toForm(sample())).config
    const f = toForm(sample())
    f.shipping.default_rate_usd = '6'
    f.cogs.order_fees[0].amount_usd = '4'
    expect(changedSections(toPayload(f).config, base)).toEqual(['taxa por pedido', 'frete'])
    expect(joinPt(['a', 'b', 'c'])).toBe('a, b e c')
  })
})

describe('ptMessage', () => {
  it('rewrites the validator amounts in pt-BR and leaves the rest alone', () => {
    expect(ptMessage('Valor negativo: funciona como abatimento de $12.60 por pedido para DZ.'))
      .toBe('Valor negativo: funciona como abatimento de $12,60 por pedido para DZ.')
    expect(ptMessage('custos diferentes ($1234.50 e $9.00).')).toBe('custos diferentes ($1.234,50 e $9,00).')
    expect(ptMessage('Informe o valor.')).toBe('Informe o valor.')
  })
  it('is applied to field messages', () => {
    const f = toForm(sample())
    const m = messagesByField([], [{ path: 'cogs.default_cost_usd', message: 'de $3.50' }], toPayload(f).index)
    expect(m.warnings.get('cogs.default_cost_usd')).toEqual(['de $3,50'])
  })
})

describe('price cells: an empty one asks for the price, a bad one is invalid', () => {
  const messages = (r: ReturnType<typeof parseProfitConfig>) => Object.fromEntries(r.issues.map(i => [i.path, i.message]))

  it('says so straight from the validator, for a supplier step left empty', () => {
    const f = toForm(sample())
    f.cogs.price_tiers[0].steps.push({ _id: 'e', units: '3', price: '' }, { _id: 'b', units: '4', price: 'abc' })
    const m = messages(parseProfitConfig(toPayload(f).config))
    expect(m['cogs.price_tiers[0].order_prices.3']).toBe('Informe o preço do pedido com 3 unidade(s).')
    expect(m['cogs.price_tiers[0].order_prices.4']).toBe('Preço inválido para 4 unidade(s).')
  })

  it('and for a country price left empty', () => {
    const f = toForm(sample())
    f.cogs.country_prices[0].prices.push({ _id: 'e', country: 'FR', price: '' }, { _id: 'n', country: 'IT', price: '-1' })
    const m = messages(parseProfitConfig(toPayload(f).config))
    expect(m['cogs.country_prices[0].prices.FR']).toBe('Informe o preço para FR.')
    expect(m['cogs.country_prices[0].prices.IT']).toBe('Preço inválido para IT.')
  })

  it('treats a blank string like an empty cell (an API caller, not the form)', () => {
    const r = parseProfitConfig({ cogs: { price_tiers: [{ effective_from: '2026-11-01', order_prices: { 1: '  ', 2: 9 }, extra_unit_usd: 0 }] } })
    expect(messages(r)['cogs.price_tiers[0].order_prices.1']).toBe('Informe o preço do pedido com 1 unidade(s).')
  })
})

describe('typed keys reach the server, "__proto__" included', () => {
  // A plain object swallows `o['__proto__'] = x`: the row vanished from the
  // payload and nothing told the person. Sent as an own key, the validator
  // refuses it by name — through JSON, as the browser sends it.
  const viaJson = (f: ReturnType<typeof toForm>) => JSON.parse(JSON.stringify(toPayload(f).config)) as unknown

  it('a supplier step typed "__proto__" is refused, not dropped', () => {
    const f = toForm(sample())
    f.cogs.price_tiers[0].steps.push({ _id: 'p', units: '__proto__', price: '5' })
    const r = parseProfitConfig(viaJson(f), sample())
    expect(r.issues.map(i => i.message)).toContain('Quantidade inválida: "__proto__". Use números inteiros a partir de 1.')
  })

  it('a country typed "__proto__" is refused, not dropped', () => {
    const f = toForm(sample())
    f.cogs.country_prices[0].prices.push({ _id: 'p', country: '__proto__', price: '5' })
    const r = parseProfitConfig(viaJson(f), sample())
    expect(r.issues.map(i => i.path)).toContain('cogs.country_prices[0].prices.__proto__')
  })
})
