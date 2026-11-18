import { describe, expect, it } from 'vitest'
import type { PnL } from '@/lib/engine/pnl'
import type { OwnAttribution } from '@/lib/data/campaigns'
import { buildPortfolioAdsVerdict, metaBasis, storeAdsRow, type PortfolioAdsStore } from '../portfolioAdsModel'

function pnl(over: Partial<PnL>): PnL {
  const base = {
    revenue: 0, orders: 0, units: 0, cogs: 0, packaging: 0, supplierFees: 0, unitSavings: 0, shipping: 0,
    shopifyFees: 0, paymentFees: 0, perOrderExtras: 0, fixedCosts: 0, metaSpend: 0, shopSpend: 0,
    metaPurchaseValue: 0, metaPurchases: 0, refundGross: 0, refundCount: 0, refunds: 0, chargebacks: 0,
    chargebackFees: 0, chargebackCount: 0, productCost: 0, fees: 0, variableCosts: 0, contribution: 0,
    adSpend: 0, operatingProfit: 0, adjustments: 0, cashResult: 0, margin: null, contributionMargin: null,
    breakEvenRoas: null, roas: null, metaRoas: null, profitPerOrder: null,
  }
  return { ...base, ...over }
}

/** A store from engine totals: revenue, Meta, Shopify ads, break-even. */
function st(id: string, revenue: number, meta: number, shop: number, be: number | null, configured = true, metaValue = 0): PortfolioAdsStore {
  const contribution = be ? revenue / be : configured ? 0 : revenue
  return {
    id, name: id, configured,
    totals: pnl({
      revenue, contribution, metaSpend: meta, shopSpend: shop, adSpend: meta + shop, metaPurchaseValue: metaValue,
      breakEvenRoas: configured ? be : 1, roas: meta > 0 ? revenue / meta : null, metaRoas: meta > 0 ? metaValue / meta : null,
      operatingProfit: contribution - meta - shop,
    }),
  }
}

// Todas, 11–17 nov (engine, read-only): the stores of the finding.
const WEEK = [
  st('EPOCH ®️', 12838, 8357, 0, 1.29),
  st('MOKOO', 11058, 5930, 194, 1.51),
  st('Hibikura', 6118, 3636, 0, 1.34),
  st('Glooty', 0, 545, 0, null, false),
  st('Dumpling Squishy · 8jcp3a', 19095.52, 59.84, 6436, 1.46, true, 54.11),
  st('Dumpling Squishy · hzsjyp', 2099, 0, 0, 1.67),
  st('CAMP HALLOW', 0, 0, 0, 1.4),
]
const WIN = { rangeLabel: '11–17 nov', periodPhrase: 'nos últimos 7 dias', partialLabel: null }

describe('storeAdsRow', () => {
  it('measures a store that advertises on Shopify on its Shopify ads, as the Resumo does', () => {
    const d = storeAdsRow(WEEK[4], null)
    expect(d.channel).toBe('shop')
    expect(d.roas?.roas).toBeCloseTo(19095.52 / 6436, 6) // 2,97×, not 319×
    expect(d.roas?.breakEven).toBe(1.46)
    expect(d.covers).toBe(true)
    expect(d.sideSpend).toEqual({ label: 'Meta', spend: 59.84 })
    // A Meta store keeps the Meta ROAS, with its small Shopify spend aside.
    const m = storeAdsRow(WEEK[1], null)
    expect(m.channel).toBe('meta')
    expect(m.roas?.roas).toBeCloseTo(11058 / 5930, 6)
    expect(m.sideSpend).toEqual({ label: 'Shopify', spend: 194 })
  })

  it('uses the store page\'s own-campaign rule for ROAS atribuído and Crédito Meta', () => {
    // EPOCH, October: own $33.910 on $25.162; shared $39.638 on $22.058.
    const epoch = st('EPOCH ®️', 42058.56, 47220, 366.68, 1.27, true, 73547.56)
    const a: OwnAttribution = { own: { spend: 25161.83, purchaseValue: 33909.66 }, shared: { spend: 22058.17, purchaseValue: 39637.9, campaigns: 5 } }
    const r = storeAdsRow(epoch, a)
    expect(r.own?.roas).toBeCloseTo(1.3477, 4) // 1,35× as on its own page, not 1,56×
    expect(r.own?.creditPct).toBeCloseTo(80.6, 1) // not 175%
    expect(r.shared).toEqual(a.shared)
    expect(storeAdsRow(epoch, null).own).toBeNull()
  })
})

describe('metaBasis', () => {
  it('counts only revenue that rode on Meta spend', () => {
    const b = metaBasis(WEEK, [])
    expect(b.stores.map(s => s.id)).toEqual(['EPOCH ®️', 'MOKOO', 'Hibikura', 'Glooty'])
    expect(b.revenue).toBeCloseTo(30014, 6)
    expect(b.metaSpend).toBeCloseTo(18468, 6)
    expect(b.roas).toBeCloseTo(1.625, 3)
  })

  it('adds a store that sells only through another store\'s Meta account', () => {
    const camp = st('CAMP HALLOW', 44157, 0, 0, 1.4)
    const b = metaBasis([WEEK[0], camp], [{ adStoreId: 'EPOCH ®️', salesStoreId: 'CAMP HALLOW' }])
    expect(b.stores.map(s => s.id)).toEqual(['EPOCH ®️', 'CAMP HALLOW'])
    expect(b.viaShared.get('CAMP HALLOW')).toEqual(['EPOCH ®️'])
    expect(b.revenue).toBeCloseTo(12838 + 44157, 6)
  })
})

describe('buildPortfolioAdsVerdict', () => {
  it('judges each store on its own channel and names the basis of "ROAS das lojas"', () => {
    const v = buildPortfolioAdsVerdict({ stores: WEEK, attribution: null, pairs: [], ...WIN })
    expect(v.headline).toBe('Todas as lojas com custos cobriram o gasto com anúncios nos últimos 7 dias.')
    expect(v.chips[0].label).toBe('4 cobriram os anúncios')
    const text = v.details.map(d => d.text).join(' ')
    expect(text).toContain('As lojas que anunciam no Meta — EPOCH ®️, MOKOO, Hibikura e Glooty — venderam $30.014 contra $18.468 de Meta: ROAS das lojas 1,63×.')
    expect(text).not.toContain('2,76×')
    expect(v.notes.map(n => n.text).join(' ')).toContain('Dumpling Squishy · 8jcp3a ($6.436 em Anúncios Shopify, $59,84 no Meta) anuncia sobretudo fora do Meta')
  })

  it('credits Meta on the own campaigns and names the shared part', () => {
    const epoch = st('EPOCH ®️', 42058.56, 47220, 366.68, 1.27, true, 73547.56)
    const attribution = new Map<string, OwnAttribution>([
      ['EPOCH ®️', { own: { spend: 25161.83, purchaseValue: 33909.66 }, shared: { spend: 22058.17, purchaseValue: 39637.9, campaigns: 5 } }],
    ])
    const v = buildPortfolioAdsVerdict({ stores: [epoch], attribution, pairs: [], ...WIN, periodPhrase: 'no mês passado' })
    expect(v.details[0].text).toBe('O Meta credita $33.910 em vendas às campanhas das próprias lojas (ROAS atribuído 1,35×); $22.058 em 5 campanhas de conta compartilhada ficam fora, com $39.638 creditados a vendas que caem sobretudo em outra loja.')
  })

  it('does not count a store whose Meta is a side cost as covering Meta on a 319× ratio', () => {
    // Dumpling alone, below its break-even on Shopify ads: it must read below,
    // whatever revenue ÷ $59,84 of Meta says.
    const weak = st('Dumpling', 9000, 59.84, 6436, 1.46)
    const v = buildPortfolioAdsVerdict({ stores: [weak], attribution: null, pairs: [], ...WIN })
    expect(storeAdsRow(weak, null).roas?.roas).toBeCloseTo(9000 / 6436, 6)
    expect(v.headline).toBe('Nenhuma loja cobriu o gasto com anúncios nos últimos 7 dias.')
    expect(v.chips[0].label).toBe('1 abaixo do empate')
  })
})
