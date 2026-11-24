import { describe, expect, it } from 'vitest'
import type { PnL } from '@/lib/engine/pnl'
import type { OwnAttribution } from '@/lib/data/campaigns'
import { allJudgedSentence, buildPortfolioAdsVerdict, metaBasis, storeAdsRow, type PortfolioAdsStore } from '../portfolioAdsModel'

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
    // 4 of the 6 stores with costs spent on Meta: the headline names those 4,
    // the same count as the chip, never "Todas as lojas com custos".
    expect(v.headline).toBe('As 4 lojas com custos que anunciaram no Meta cobriram o gasto com anúncios nos últimos 7 dias.')
    expect(v.chips[0].label).toBe('4 cobriram os anúncios')
    const text = v.details.map(d => d.text).join(' ')
    expect(text).toContain('As lojas que anunciam no Meta — EPOCH ®️, MOKOO, Hibikura e Glooty — venderam $30.014 contra $18.468 de Meta: ROAS das lojas 1,63×.')
    expect(text).not.toContain('2,76×')
    expect(v.notes.map(n => n.text).join(' ')).toContain('Dumpling Squishy · 8jcp3a ($6.436 em Anúncios Shopify, $59,84 no Meta) anuncia sobretudo fora do Meta')
  })

  it('says "sobretudo fora do Meta" only of a store whose Meta is a side cost, and puts every Meta dollar somewhere', () => {
    const v = buildPortfolioAdsVerdict({ stores: WEEK, attribution: null, pairs: [], ...WIN })
    expect(v.notes[0].text).toBe('Dumpling Squishy · 8jcp3a ($6.436 em Anúncios Shopify, $59,84 no Meta) anuncia sobretudo fora do Meta: o ROAS da tabela é medido em Anúncios Shopify, como no Resumo. Por isso ela fica fora do ROAS das lojas acima: os $59,84 de Meta dela estão nos $18.528 gastos no Meta, não nos $18.468.')
  })

  it("names a store on both channels as such, and says its Meta spend is outside 'ROAS das lojas'", () => {
    // Todas, 25 out – 5 nov (engine, read-only): Dumpling 8jcp3a spent
    // $2.641,91 on Meta and $1.031,43 on Shopify ads (72% Meta → 'both').
    const stores = [
      st('MOKOO', 9000, 4200, 0, 1.51),
      st('EPOCH ®️', 12000, 5800, 0, 1.29),
      st('Glooty', 900, 478, 0, null, false),
      st('Dumpling Squishy · 8jcp3a', 9500, 2641.91, 1031.43, 1.46),
    ]
    const v = buildPortfolioAdsVerdict({ stores, attribution: null, pairs: [], ...WIN })
    expect(storeAdsRow(stores[3], null).channel).toBe('both')
    const notes = v.notes.map(n => n.text).join(' ')
    expect(notes).not.toContain('sobretudo fora do Meta')
    expect(notes).toContain('Dumpling Squishy · 8jcp3a ($2.642 no Meta + $1.031 em Anúncios Shopify) anuncia no Meta e em Anúncios Shopify: o ROAS da tabela soma os dois canais, como no Resumo, porque as vendas não se separam por canal. Por isso ela fica fora do ROAS das lojas acima: os $2.642 de Meta dela estão nos $13.120 gastos no Meta, não nos $10.478.')
    // The headline's total is every store's Meta spend; the basis, the Meta stores'.
    expect(v.amount).toBeCloseTo(13119.91, 2)
    expect(v.details.map(d => d.text).join(' ')).toContain('contra $10.478 de Meta')
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
    expect(v.headline).toBe('A única loja com gasto no Meta, Dumpling, não cobriu o gasto com anúncios nos últimos 7 dias.')
    expect(v.chips[0].label).toBe('1 abaixo do empate')
  })
})

describe('the headline names the stores that were judged', () => {
  it('Hoje at 00h12 in Brasília: only the Tokyo store has spent', () => {
    const stores = [
      st('MOKOO', 0, 0, 0, 1.51), st('EPOCH ®️', 0, 0, 0, 1.29), st('Hibikura', 900, 300, 0, 1.34),
      st('Glooty', 0, 0, 0, null, false), st('Dumpling Squishy · 8jcp3a', 0, 0, 0, 1.46),
    ]
    const v = buildPortfolioAdsVerdict({ stores, attribution: null, pairs: [], ...WIN, periodPhrase: 'hoje' })
    expect(v.chips[0].label).toBe('1 cobriu os anúncios')
    expect(v.headline).toBe('A única loja com gasto no Meta, Hibikura, cobriu o gasto com anúncios hoje.')
  })

  it('one store with costs judged while a store without costs also spent', () => {
    expect(allJudgedSentence([{ name: 'Hibikura' }], 2, 6, true, 'hoje'))
      .toBe('A única loja com custos que anunciou no Meta, Hibikura, cobriu o gasto com anúncios hoje.')
  })

  it('says "Todas" only when every store with costs spent on Meta', () => {
    const two = [{ name: 'MOKOO' }, { name: 'EPOCH ®️' }]
    expect(allJudgedSentence(two, 2, 2, true, 'ontem')).toBe('Todas as 2 lojas com custos cobriram o gasto com anúncios ontem.')
    expect(allJudgedSentence(two, 3, 6, true, 'ontem')).toBe('As 2 lojas com custos que anunciaram no Meta cobriram o gasto com anúncios ontem.')
    expect(allJudgedSentence(two, 3, 6, false, 'ontem')).toBe('Nenhuma das 2 lojas com custos que anunciaram no Meta cobriu o gasto com anúncios ontem.')
    expect(allJudgedSentence(two, 2, 2, false, 'ontem')).toBe('Nenhuma das 2 lojas com custos cobriu o gasto com anúncios ontem.')
  })
})

// Todas · Hoje at 09h41: "cobriram o gasto com anúncios hoje" beside the chip
// "parcial · até 09h41" — the store page already says "está cobrindo … até agora".
describe('a running window is told in the present', () => {
  const TODAY = { rangeLabel: '24 nov', periodPhrase: 'hoje', partialLabel: 'parcial · até 09h41' }

  it('all judged stores covering', () => {
    const stores = [st('EPOCH ®️', 900, 300, 0, 1.29), st('MOKOO', 800, 300, 0, 1.51), st('Hibikura', 600, 200, 0, 1.34), st('Dumpling', 300, 100, 0, 1.46), st('Glooty', 0, 0, 0, null, false), st('CAMP HALLOW', 0, 0, 0, 1.4)]
    const v = buildPortfolioAdsVerdict({ stores, attribution: null, pairs: [], ...TODAY })
    expect(v.headline).toBe('As 4 lojas com custos que anunciam no Meta estão cobrindo o gasto com anúncios hoje, até agora.')
    expect(v.chips[0].label).toBe('4 estão cobrindo os anúncios')
    expect(v.chips.map(c => c.label)).toContain('parcial · até 09h41')
  })

  it('one store, none covering, and a mixed day', () => {
    expect(allJudgedSentence([{ name: 'Hibikura' }], 1, 6, true, 'hoje', true)).toBe('A única loja com gasto no Meta, Hibikura, está cobrindo o gasto com anúncios hoje, até agora.')
    expect(allJudgedSentence([{ name: 'Hibikura' }], 2, 6, false, 'hoje', true)).toBe('A única loja com custos que anuncia no Meta, Hibikura, não está cobrindo o gasto com anúncios hoje, até agora.')
    expect(allJudgedSentence([{ name: 'A' }, { name: 'B' }], 2, 2, false, 'hoje', true)).toBe('Nenhuma das 2 lojas com custos está cobrindo o gasto com anúncios hoje, até agora.')
    const mixed = buildPortfolioAdsVerdict({ stores: [st('EPOCH ®️', 900, 300, 0, 1.29), st('MOKOO', 300, 300, 0, 1.51)], attribution: null, pairs: [], ...TODAY })
    expect(mixed.headline).toBe('1 de 2 lojas está cobrindo o gasto com anúncios hoje, até agora — MOKOO está abaixo do empate.')
    expect(mixed.chips[0].label).toBe('1 está cobrindo os anúncios')
    // A closed window keeps the past tense.
    const closed = buildPortfolioAdsVerdict({ stores: [st('EPOCH ®️', 900, 300, 0, 1.29), st('MOKOO', 300, 300, 0, 1.51)], attribution: null, pairs: [], ...WIN })
    expect(closed.headline).toBe('1 de 2 lojas cobriram o gasto com anúncios nos últimos 7 dias — MOKOO ficou abaixo do empate.')
  })
})

// Campanhas · Todas, 15 dez 2025 – 15 jan 2026: "As lojas venderam $0" while
// not one store had made its first sale yet.
describe('no Meta spend and no sale (regression: "As lojas venderam $0")', () => {
  const range = { from: '2025-12-15', to: '2026-01-15' }
  const WINTER = { rangeLabel: '15 dez 2025 – 15 jan 2026', periodPhrase: 'em 15 dez 2025 – 15 jan 2026', partialLabel: null }
  const started = (s: PortfolioAdsStore, firstOrderDate: string | null): PortfolioAdsStore => ({ ...s, firstOrderDate })

  it('every store started after the window: says none was selling yet', () => {
    const stores = [started(st('MOKOO', 0, 0, 0, 1.51), '2026-04-11'), started(st('Glooty', 0, 0, 0, null, false), '2026-11-06')]
    const v = buildPortfolioAdsVerdict({ stores, attribution: null, pairs: [], ...WINTER, range })
    expect(v.headline).toBe('Nenhuma loja gastou no Meta em 15 dez 2025 – 15 jan 2026.')
    expect(v.details.map(d => d.text)).toEqual(['Nenhuma das lojas vendia ainda em 15 dez 2025 – 15 jan 2026.'])
  })

  it('one store already existed (or its start is unknown): no sale and no Meta spend, never "$0"', () => {
    const stores = [started(st('MOKOO', 0, 0, 0, 1.51), '2025-06-01'), started(st('Glooty', 0, 0, 0, null, false), '2026-11-06')]
    const v = buildPortfolioAdsVerdict({ stores, attribution: null, pairs: [], ...WINTER, range })
    expect(v.details.map(d => d.text)).toEqual(['Nenhuma venda e nenhum gasto no Meta em 15 dez 2025 – 15 jan 2026.'])
    // Without the window the start cannot be judged: the same plain line.
    const noRange = buildPortfolioAdsVerdict({ stores: stores.map(s => started(s, '2026-11-06')), attribution: null, pairs: [], ...WINTER })
    expect(noRange.details[0].text).toBe('Nenhuma venda e nenhum gasto no Meta em 15 dez 2025 – 15 jan 2026.')
  })

  it('sales without Meta spend keep their amount', () => {
    const v = buildPortfolioAdsVerdict({ stores: [st('Dumpling Squishy · hzsjyp', 2099, 0, 0, 1.67)], attribution: null, pairs: [], ...WIN, range: { from: '2026-11-11', to: '2026-11-17' } })
    expect(v.details[0].text).toBe('As lojas venderam $2.099 nos últimos 7 dias sem gasto no Meta.')
  })
})
