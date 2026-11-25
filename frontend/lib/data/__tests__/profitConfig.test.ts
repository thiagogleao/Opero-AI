import { describe, expect, it } from 'vitest'
import {
  NO_CONFIG_VERSION, canonicalJson, costBreakdown, costLines, defaultProfitConfig, extraCostShares,
  isEmptyConfig, normalizeSavedConfig, parseProfitConfig, pricingCoverage, pricingSource, sameConfig,
  parseWindow, saveDecision, toNumber, toProductId, type ProfitConfig,
} from '../profitConfig'
import { buildCogsLookups, orderSupplierCost, supplierOrderFee } from '../../engine/costs'
import { derive, type PnLLines, type ProductPnL } from '../../engine/pnl'

/** A config shaped like the production ones (MOKOO + Hibikura features). */
function saved(): ProfitConfig {
  return {
    shopify: { transaction_fee_pct: 2.9, payment_processing_pct: 0, payment_processing_fixed: 0.3 },
    cogs: {
      default_cost_usd: 9,
      packaging_cost_usd: 0,
      packaging_per_unit_usd: 1.8,
      packaging_per_unit_products: ['111'],
      additional_unit_discount_usd: 3,
      volume_discounts: [],
      products: [
        { product_id: '111', name: 'Capy', cost_usd: 8.2 },
        { product_id: '222', name: 'Card', cost_usd: 0 },
      ],
      zero_cost_products: ['333'],
      price_tiers: [{
        effective_from: '2026-11-08', label: 'Hibachi', product_ids: ['444'],
        order_prices: { 1: 11.6, 2: 16.8 }, extra_unit_usd: 4.7,
      }],
      country_prices: [{ product_id: '111', name: 'Capy', prices: { DE: 8, PR: 10.5 } }],
      order_fees: [{ country_code: 'AT', name: 'Austria', amount_usd: 3.5, effective_from: '2026-06-22' }],
    },
    shipping: { default_rate_usd: 0, rates: [] },
    extra_costs: [{ name: 'Shopify plan', amount_usd: 39, frequency: 'monthly' }],
  }
}

const paths = (r: { issues: { path: string }[] }) => r.issues.map(i => i.path)

describe('primitive readers', () => {
  it('reads numbers from form strings, with comma or dot', () => {
    expect(toNumber('2,9')).toBe(2.9)
    expect(toNumber(' 3.5 ')).toBe(3.5)
    expect(toNumber('')).toBeNull()
    expect(toNumber('abc')).toBeNull()
    expect(toNumber(Number.NaN)).toBeNull()
  })
  it('reduces a GraphQL gid to the numeric id orders carry', () => {
    expect(toProductId('gid://shopify/Product/8853674918094')).toBe('8853674918094')
    expect(toProductId(123)).toBe('123')
    expect(toProductId('  ')).toBeNull()
  })
})

describe('normalizeSavedConfig', () => {
  it('fills every default and keeps a complete config unchanged', () => {
    const n = normalizeSavedConfig(saved())
    expect(n.configured).toBe(true)
    expect(n.issues).toEqual([])
    expect(n.config.cogs.price_tiers).toEqual(saved().cogs.price_tiers)
    expect(n.config.cogs.order_fees).toEqual(saved().cogs.order_fees)
    expect(sameConfig(normalizeSavedConfig(n.config).config, n.config)).toBe(true)
  })

  it('treats no row, {} and a config missing a section as not configured', () => {
    for (const raw of [null, {}, { cogs: saved().cogs }]) {
      const n = normalizeSavedConfig(raw)
      expect(n.configured).toBe(false)
      expect(n.config).toEqual(defaultProfitConfig())
    }
  })

  it('fills keys an old config never had', () => {
    const old = saved() as unknown as { cogs: Record<string, unknown> }
    delete old.cogs.price_tiers
    delete old.cogs.zero_cost_products
    delete old.cogs.packaging_per_unit_usd
    const n = normalizeSavedConfig(old)
    expect(n.config.cogs.price_tiers).toEqual([])
    expect(n.config.cogs.zero_cost_products).toEqual([])
    expect(n.config.cogs.packaging_per_unit_usd).toBe(0)
  })

  it('drops the blank shipping row the old form saved, silently', () => {
    const raw = saved()
    raw.shipping.rates = [{ country_code: '', name: '', cost_usd: 0 }]
    const n = normalizeSavedConfig(raw)
    expect(n.issues).toEqual([])
    expect(n.config.shipping.rates).toEqual([])
  })
})

describe('partial bodies never wipe the saved config', () => {
  it('a body with one field changes only that field', () => {
    const r = parseProfitConfig({ shopify: { transaction_fee_pct: 3 } }, saved())
    expect(r.issues).toEqual([])
    expect(r.config.shopify).toEqual({ transaction_fee_pct: 3, payment_processing_pct: 0, payment_processing_fixed: 0.3 })
    const { shopify: _a, ...changed } = r.config
    const { shopify: _b, ...before } = normalizeSavedConfig(saved()).config
    expect(canonicalJson(changed)).toBe(canonicalJson(before))
  })

  it('an empty body or null sections keep everything', () => {
    const base = normalizeSavedConfig(saved()).config
    expect(sameConfig(parseProfitConfig({}, base).config, base)).toBe(true)
    expect(sameConfig(parseProfitConfig({ cogs: null, shipping: null }, base).config, base)).toBe(true)
  })

  it('a list that is sent replaces the saved one; [] clears it', () => {
    const base = normalizeSavedConfig(saved()).config
    const r = parseProfitConfig({ cogs: { order_fees: [] } }, base)
    expect(r.config.cogs.order_fees).toEqual([])
    expect(r.config.cogs.price_tiers).toEqual(base.cogs.price_tiers)
  })

  it('products merge by id: an absent product keeps its cost, 0 un-prices one', () => {
    const base = normalizeSavedConfig(saved()).config
    const r = parseProfitConfig({ cogs: { products: [{ product_id: '222', name: 'Card', cost_usd: 0.5 }, { product_id: '999', name: 'New', cost_usd: 4 }] } }, base)
    expect(r.issues).toEqual([])
    expect(r.config.cogs.products).toEqual([
      { product_id: '111', name: 'Capy', cost_usd: 8.2 },
      { product_id: '222', name: 'Card', cost_usd: 0.5 },
      { product_id: '999', name: 'New', cost_usd: 4 },
    ])
    const un = parseProfitConfig({ cogs: { products: [{ product_id: '111', cost_usd: 0 }] } }, base)
    expect(un.config.cogs.products[0]).toEqual({ product_id: '111', name: 'Capy', cost_usd: 0 })
    // A row without cost keeps the saved cost instead of zeroing it.
    const noCost = parseProfitConfig({ cogs: { products: [{ product_id: '111', name: 'Capy v2' }] } }, base)
    expect(noCost.config.cogs.products[0]).toEqual({ product_id: '111', name: 'Capy v2', cost_usd: 8.2 })
  })

  it('refuses one product sent twice with two different costs', () => {
    const r = parseProfitConfig({ cogs: { products: [{ product_id: '1', cost_usd: 2 }, { product_id: '1', cost_usd: 3 }] } })
    expect(paths(r)).toEqual(['cogs.products[1].cost_usd'])
    expect(r.issues[0].message).toMatch(/duas vezes/)
  })
})

describe('field-level messages', () => {
  it('rejects a non-object body', () => {
    const r = parseProfitConfig('x')
    expect(paths(r)).toEqual([''])
  })

  it('reports invalid numbers and percentages by path, in Portuguese', () => {
    const r = parseProfitConfig({
      shopify: { transaction_fee_pct: 150, payment_processing_pct: 'abc', payment_processing_fixed: -1 },
      cogs: { default_cost_usd: -2 },
    }, saved())
    expect(paths(r)).toEqual([
      'shopify.transaction_fee_pct', 'shopify.payment_processing_pct', 'shopify.payment_processing_fixed', 'cogs.default_cost_usd',
    ])
    expect(r.issues[0].message).toBe('Deve ser um percentual entre 0 e 100.')
    expect(r.issues[1].message).toBe('Deve ser um número.')
    expect(r.issues[2].message).toBe('Não pode ser negativo.')
    // The invalid value never reaches the config: the saved one is kept.
    expect(r.config.shopify.transaction_fee_pct).toBe(2.9)
  })

  it('reports a list sent as something else', () => {
    const r = parseProfitConfig({ extra_costs: 'nope' }, saved())
    expect(paths(r)).toEqual(['extra_costs'])
    expect(r.config.extra_costs).toEqual(saved().extra_costs)
  })
})

describe('rate cards (price_tiers)', () => {
  const tier = (over: Record<string, unknown> = {}) => ({
    effective_from: '2026-11-01', label: 'Calendário', product_ids: ['gid://shopify/Product/555', '556'],
    order_prices: { '1': 9, '02': 15 }, extra_unit_usd: '4,79', ...over,
  })

  it('normalises product ids, unit keys and numbers', () => {
    const r = parseProfitConfig({ cogs: { price_tiers: [tier()] } })
    expect(r.issues).toEqual([])
    expect(r.config.cogs.price_tiers).toEqual([{
      effective_from: '2026-11-01', label: 'Calendário', product_ids: ['555', '556'],
      order_prices: { 1: 9, 2: 15 }, extra_unit_usd: 4.79,
    }])
  })

  it('a card with product_ids prices only its products; the rest falls to item prices', () => {
    const r = parseProfitConfig({ cogs: { products: [{ product_id: '7', name: 'Other', cost_usd: 5 }], price_tiers: [tier()] } })
    const cfg = r.config
    const cost = orderSupplierCost({
      country_code: 'US', order_date: '2026-11-05',
      items: [{ product_id: '555', product_title: 'Cal', units: 2 }, { product_id: '7', product_title: 'Other', units: 1 }],
    }, buildCogsLookups(cfg), cfg)
    expect(cost.cogs).toBe(15 + 5)
  })

  it('refuses a card with no price above zero (PE12: it would price orders at $0)', () => {
    const r = parseProfitConfig({ cogs: { price_tiers: [tier({ order_prices: {} })] } })
    expect(paths(r)).toEqual(['cogs.price_tiers[0].order_prices'])
    expect(r.config.cogs.price_tiers).toEqual([])
  })

  it('refuses bad dates, unit counts and prices', () => {
    const r = parseProfitConfig({ cogs: { price_tiers: [tier({ effective_from: '2026-02-30', order_prices: { abc: 3, 2: -1 } })] } })
    // Integer-like keys come first in a JS object, so compare as sets.
    expect(paths(r).sort()).toEqual([
      'cogs.price_tiers[0].effective_from', 'cogs.price_tiers[0].order_prices', 'cogs.price_tiers[0].order_prices.2',
    ])
  })

  it('refuses a product card the engine would never use under an earlier whole-order card (PE13)', () => {
    const whole = { effective_from: '2026-09-11', order_prices: { 1: 9 }, extra_unit_usd: 4.79 }
    const r = parseProfitConfig({ cogs: { price_tiers: [whole, tier()] } })
    expect(paths(r)).toEqual(['cogs.price_tiers[1].product_ids'])
    expect(r.issues[0].message).toMatch(/nunca seria usada/)
    // Starting before the whole-order card, it does apply for a while: allowed.
    expect(parseProfitConfig({ cogs: { price_tiers: [whole, tier({ effective_from: '2026-09-01' })] } }).issues).toEqual([])
  })

  it('refuses two cards for the same products starting on the same day', () => {
    const r = parseProfitConfig({ cogs: { price_tiers: [tier(), tier({ product_ids: ['556', '555'] })] } })
    expect(paths(r)).toEqual(['cogs.price_tiers[1].effective_from'])
  })

  it('warns when one product sits in two cards of different scope', () => {
    const r = parseProfitConfig({ cogs: { price_tiers: [tier(), tier({ product_ids: ['555'] })] } })
    expect(r.issues).toEqual([])
    expect(r.warnings.map(w => w.path)).toContain('cogs.price_tiers[1].product_ids')
  })
})

describe('country prices', () => {
  it('upper-cases codes and refuses invalid ones by path', () => {
    const r = parseProfitConfig({ cogs: { country_prices: [{ product_id: '1', prices: { de: 8, Germany: 9, FR: -1 } }] } })
    expect(paths(r)).toEqual(['cogs.country_prices[0].prices.Germany', 'cogs.country_prices[0].prices.FR'])
    expect(r.config.cogs.country_prices).toEqual([])
    const ok = parseProfitConfig({ cogs: { country_prices: [{ product_id: '1', name: 'Capy', prices: { de: '8,5' } }] } })
    expect(ok.config.cogs.country_prices).toEqual([{ product_id: '1', name: 'Capy', prices: { DE: 8.5 } }])
  })

  it('drops an unfinished row and refuses a product listed twice', () => {
    const r = parseProfitConfig({ cogs: { country_prices: [
      { product_id: '1', prices: {} },
      { product_id: '2', prices: { US: 8 } },
      { product_id: '2', prices: { DE: 8 } },
    ] } })
    expect(paths(r)).toEqual(['cogs.country_prices[2].product_id'])
    expect(r.config.cogs.country_prices).toEqual([{ product_id: '2', prices: { US: 8 } }])
  })
})

describe('supplier order fees with dates', () => {
  it('keeps the start date and the engine honours it', () => {
    const r = parseProfitConfig({ cogs: { order_fees: [{ country_code: 'at', name: 'Austria', amount_usd: '3.5', effective_from: '2026-06-22' }] } })
    expect(r.issues).toEqual([])
    expect(r.config.cogs.order_fees).toEqual([{ country_code: 'AT', name: 'Austria', amount_usd: 3.5, effective_from: '2026-06-22' }])
    expect(supplierOrderFee('AT', '2026-06-21', r.config)).toBe(0)
    expect(supplierOrderFee('AT', '2026-06-22', r.config)).toBe(3.5)
  })

  it('refuses a bad date, a missing amount and a duplicate country', () => {
    const r = parseProfitConfig({ cogs: { order_fees: [
      { country_code: 'AT', amount_usd: 3.5, effective_from: '22/06/2026' },
      { country_code: 'BE' },
      { country_code: 'DE', amount_usd: 3.5 },
      { country_code: 'de', amount_usd: 4 },
      { country_code: '', amount_usd: '' },
    ] } })
    expect(paths(r)).toEqual([
      'cogs.order_fees[0].effective_from', 'cogs.order_fees[1].amount_usd', 'cogs.order_fees[3].country_code',
    ])
    expect(r.config.cogs.order_fees).toEqual([{ country_code: 'DE', amount_usd: 3.5 }])
  })

  it('accepts a negative fee (a rebate) with a warning, not an error', () => {
    const r = parseProfitConfig({ cogs: { order_fees: [{ country_code: 'DZ', amount_usd: -2 }] } })
    expect(r.issues).toEqual([])
    expect(r.warnings.map(w => w.path)).toEqual(expect.arrayContaining(['cogs.order_fees[0].amount_usd']))
  })
})

describe('zero_cost_products', () => {
  it('dedupes ids, reads gids and makes the engine charge nothing for them', () => {
    const r = parseProfitConfig({ cogs: { zero_cost_products: ['gid://shopify/Product/9', '9', 10] } }, saved())
    expect(r.config.cogs.zero_cost_products).toEqual(['9', '10'])
    const cfg = r.config
    const cost = orderSupplierCost({ country_code: 'US', order_date: '2026-11-01', items: [{ product_id: '9', product_title: 'Warranty', units: 1 }] }, buildCogsLookups(cfg), cfg)
    expect(cost.cogs).toBe(0)
  })

  it('warns when a declared-free product also has a price', () => {
    const r = parseProfitConfig({ cogs: { zero_cost_products: ['111'] } }, saved())
    expect(r.warnings.map(w => w.path)).toContain('cogs.products[0].cost_usd')
  })

  it('refuses an empty id', () => {
    const r = parseProfitConfig({ cogs: { zero_cost_products: [''] } })
    expect(paths(r)).toEqual(['cogs.zero_cost_products[0]'])
  })
})

describe('extra costs', () => {
  it('drops blank rows and refuses bad ones by path', () => {
    const r = parseProfitConfig({ extra_costs: [
      { name: '', amount_usd: 0, frequency: 'monthly' },
      { name: 'App', amount_usd: 20, frequency: 'weekly' },
      { name: '', amount_usd: 5, frequency: 'monthly' },
      { name: 'Seguro', amount_usd: -5, frequency: 'annual' },
      { name: 'Brinde', amount_usd: '0,40', frequency: 'per_order' },
    ] })
    expect(paths(r)).toEqual(['extra_costs[1].frequency', 'extra_costs[2].name', 'extra_costs[3].amount_usd'])
    expect(r.config.extra_costs).toEqual([{ name: 'Brinde', amount_usd: 0.4, frequency: 'per_order' }])
  })
})

describe('saving guards', () => {
  it('an all-zero config is empty; any cost makes it not', () => {
    expect(isEmptyConfig(defaultProfitConfig())).toBe(true)
    expect(isEmptyConfig(saved())).toBe(false)
    const onlyFee = defaultProfitConfig()
    onlyFee.cogs.order_fees = [{ country_code: 'DZ', amount_usd: -1 }]
    expect(isEmptyConfig(onlyFee)).toBe(false)
  })

  it('needs the version the screen loaded, and refuses a stale one', () => {
    expect(saveDecision(undefined, 'abc')).toMatchObject({ ok: false, status: 400 })
    expect(saveDecision('old', 'abc')).toMatchObject({ ok: false, status: 409 })
    expect(saveDecision('abc', 'abc')).toEqual({ ok: true })
    expect(saveDecision(NO_CONFIG_VERSION, NO_CONFIG_VERSION)).toEqual({ ok: true })
  })

  it('canonical JSON ignores key order', () => {
    expect(canonicalJson({ b: 1, a: [{ y: 2, x: 1 }] })).toBe(canonicalJson({ a: [{ x: 1, y: 2 }], b: 1 }))
  })
})

describe('what each part of the config costs', () => {
  const lines: PnLLines = {
    revenue: 1000, orders: 10, units: 14, cogs: 300, packaging: 18, supplierFees: 7, unitSavings: 12,
    shipping: 40, shopifyFees: 29, paymentFees: 3, perOrderExtras: 4, fixedCosts: 13,
    metaSpend: 250, shopSpend: 20, metaPurchaseValue: 900, metaPurchases: 9,
    refundGross: 0, refundCount: 0, refunds: 0, chargebacks: 0, chargebackFees: 0, chargebackCount: 0,
  }

  it('cost lines add up to variable + fixed costs, ads excluded', () => {
    const t = derive(lines)
    const sum = costLines(t).reduce((s, l) => s + l.amount, 0)
    expect(sum).toBeCloseTo(t.variableCosts + t.fixedCosts, 10)
    const b = costBreakdown({ totals: t, daily: [], products: null, range: { from: '2026-11-01', to: '2026-11-10' } }, null)
    expect(b.totalCost).toBeCloseTo(sum, 10)
    expect(b.bySection.reduce((s, x) => s + x.amount, 0)).toBeCloseTo(sum, 10)
    expect(b.bySection.find(s => s.section === 'cogs')!.amount).toBeCloseTo(300 + 18 + 7 - 12, 10)
    expect(b.coverage).toBeNull()
  })

  it('extra cost shares add up to per-order extras + fixed costs', () => {
    const cfg = defaultProfitConfig()
    cfg.extra_costs = [
      { name: 'Plano', amount_usd: 30, frequency: 'monthly' },
      { name: 'Domínio', amount_usd: 365, frequency: 'annual' },
      { name: 'Brinde', amount_usd: 0.4, frequency: 'per_order' },
    ]
    // Two November days, the second half elapsed (as the engine charges a running today).
    const daily = [{ date: '2026-11-16', fixedCosts: 1 + 1 }, { date: '2026-11-17', fixedCosts: (1 + 1) / 2 }]
    const shares = extraCostShares(cfg, { ...lines, orders: 10 }, daily)
    expect(shares.map(s => s.amount)).toEqual([1.5, 1.5, 4])
  })

  it('names the rule that priced each product, in the engine order', () => {
    const cfg = normalizeSavedConfig(saved()).config
    const at = (id: string | null, title = 'x') => pricingSource({ productId: id, title }, cfg, '2026-11-10')
    expect(at('444')).toBe('product_card')
    expect(at('333')).toBe('free')
    expect(at('111')).toBe('country_price')
    expect(at('222')).toBe('default') // cost 0 = not priced yet
    expect(at(null, 'Capy')).toBe('title_price')
    expect(pricingSource({ productId: '444', title: 'x' }, cfg, '2026-11-01')).toBe('default')
    const whole = { ...cfg, cogs: { ...cfg.cogs, price_tiers: [{ effective_from: '2026-01-01', order_prices: { 1: 9 }, extra_unit_usd: 1 }] } }
    expect(pricingSource({ productId: '333', title: 'x' }, whole, '2026-11-10')).toBe('whole_order_card')
  })

  it('counts the units that fell to the default cost', () => {
    const cfg = normalizeSavedConfig(saved()).config
    const p = (productId: string, units: number): ProductPnL => ({ key: productId, productId, title: productId, units, orders: units, revenue: units * 20, variableCosts: 0, contribution: 0 })
    const cov = pricingCoverage([p('111', 5), p('222', 3), p('999', 2)], cfg, { from: '2026-11-01', to: '2026-11-10' })
    expect(cov.unpricedUnits).toBe(5)
    expect(cov.unpriced.map(u => u.productId)).toEqual(['222', '999'])
    expect(cov.cardChanges).toEqual([{ label: 'Hibachi', effectiveFrom: '2026-11-08' }])
  })
})

describe('parseWindow', () => {
  const now = new Date('2026-11-17T15:00:00Z') // 12:00 in São Paulo, 00:00 on the 18th in Tokyo
  it('resolves presets in the store timezone, rolling windows ending yesterday', () => {
    expect(parseWindow({ period: '7d' }, 'America/Sao_Paulo', '30d', now)).toEqual({ ok: true, period: '7d', range: { from: '2026-11-10', to: '2026-11-16' } })
    expect(parseWindow({}, 'Asia/Tokyo', '30d', now)).toEqual({ ok: true, period: '30d', range: { from: '2026-10-19', to: '2026-11-17' } })
  })
  it('dates without a period name are a custom window; null and "" are absent', () => {
    expect(parseWindow({ from: '2026-11-01', to: '2026-11-05', period: null }, 'UTC', '30d', now))
      .toEqual({ ok: true, period: 'custom', range: { from: '2026-11-01', to: '2026-11-05' } })
    expect(parseWindow({ period: '', from: '', to: null }, 'UTC', '7d', now)).toMatchObject({ ok: true, period: '7d' })
  })
  it('refuses bad input with the field it came from', () => {
    expect(parseWindow({ period: 'week' }, 'UTC', '30d', now)).toMatchObject({ ok: false, issue: { path: 'period' } })
    expect(parseWindow({ period: 'custom', from: '2026-13-01', to: '2026-11-05' }, 'UTC', '30d', now)).toMatchObject({ ok: false, issue: { path: 'from' } })
    expect(parseWindow({ from: '2026-11-05', to: '2026-11-01' }, 'UTC', '30d', now)).toMatchObject({ ok: false, issue: { path: 'from' } })
    // A long range is not refused (lib/period R9): it keeps its last 366 days.
    expect(parseWindow({ from: '2025-01-01', to: '2026-11-01' }, 'UTC', '30d', now)).toMatchObject({ ok: true, range: { from: '2025-11-01', to: '2026-11-01' } })
  })
})
