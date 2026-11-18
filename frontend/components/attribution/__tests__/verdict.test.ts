import { describe, expect, it } from 'vitest'
import type { AttributionTotals, Coverage } from '@/lib/attributionModels'
import { buildAttributionVerdict, type AttributionVerdictInput } from '../verdict'

const ZERO: AttributionTotals = {
  orders: 0, revenue: 0, spend: 0, metaPurchases: 0, metaRevenue: 0,
  journeyRevenueOwnAds: 0, journeyOrdersOwnAds: 0, siblingRevenue: 0, siblingOrders: 0,
  sharedSpend: 0, unknownAdRevenue: 0, roasJourney: null, roasMeta: null, metaGapPct: null, adsWithActivity: 0,
}
const FULL: Coverage = { orders: 300, withJourney: 300, withAd: 193, pct: 100, attributablePct: 64, pending: 0 }
const EPOCH = 'epoch'
const CAMP = 'camp'

function input(over: Partial<Omit<AttributionVerdictInput, 'totals'>> & { totals?: Partial<AttributionTotals> } = {}): AttributionVerdictInput {
  const { totals, ...rest } = over
  return {
    storeId: EPOCH, storeName: 'EPOCH', periodPhrase: 'nos últimos 30 dias', rangeLabel: '18 out – 16 nov',
    model: 'first', partialLabel: null,
    sales: { revenue: 33623.74, orders: 300 },
    totals: { ...ZERO, ...totals },
    coverage: FULL, phantom: { rows: 0, value: 0 }, shared: [],
    ...rest,
  }
}

// EPOCH, 18 out – 16 nov, from production (first click): Meta claims
// $38.852,21 against $25.902,59 of journey revenue on its own ads.
const EPOCH_30D: Partial<AttributionTotals> = {
  orders: 193, revenue: 22069.16, spend: 24212, metaPurchases: 362, metaRevenue: 38852.21,
  journeyRevenueOwnAds: 25902.59, journeyOrdersOwnAds: 229, siblingRevenue: 6401.03, siblingOrders: 59,
  unknownAdRevenue: 2567.6,
}
const SHARED = [{ adStoreId: EPOCH, adStoreName: 'EPOCH', salesStoreId: CAMP, salesStoreName: 'CAMP HALLOW', orders: 66, revenue: 7035.94 }]

describe('buildAttributionVerdict', () => {
  it('states an overclaim with the like-for-like gap, siblings and the phantom row', () => {
    const v = buildAttributionVerdict(input({ totals: EPOCH_30D, shared: SHARED, phantom: { rows: 1, value: 183000 } }))
    expect(v.state).toBe('over')
    expect(v.gapPct).toBeCloseTo(49.99, 1)
    expect(v.hero.value).toBe('+50%')
    expect(v.hero.tone).toBe('warn')
    expect(v.hero.caption).toContain('$12.950')
    expect(v.headline).toBe('O Meta diz que vendeu $38.852 pela EPOCH nos últimos 30 dias — mais do que a Shopify liga aos anúncios dele ($25.903).')
    expect(v.chips.map(c => c.key)).toEqual(['over', 'shared'])
    expect(v.details[0].text).toBe('A loja vendeu $33.624 em 300 pedidos nos últimos 30 dias; 193 (64%) passaram por algum anúncio no caminho, pela jornada da Shopify.')
    expect(v.details[1].text).toContain('59 pedidos ($6.401) para a CAMP HALLOW pelo primeiro clique')
    expect(v.notes.map(n => n.text).join(' ')).toContain('$183.000')
    expect(v.notes.map(n => n.text).join(' ')).toContain('$2.568')
    expect(v.withoutAd).toBeCloseTo(33623.74 - 22069.16, 2)
  })

  it('calls a gap within ±10% a match (Hibikura)', () => {
    const v = buildAttributionVerdict(input({
      storeName: 'Hibikura', sales: { revenue: 5014.69, orders: 65 },
      totals: { orders: 64, revenue: 4961.75, spend: 3318.51, metaPurchases: 65, metaRevenue: 4921.49, journeyRevenueOwnAds: 4873.5, journeyOrdersOwnAds: 63 },
    }))
    expect(v.state).toBe('match')
    expect(v.hero.value).toBe('+1%')
    expect(v.hero.tone).toBe('pos')
    expect(v.chips[0].label).toBe('Meta e Shopify batem')
  })

  it('says it is too early with a handful of orders (Glooty, 1 order)', () => {
    const v = buildAttributionVerdict(input({
      storeName: 'Glooty', periodPhrase: 'nos últimos 7 dias', sales: { revenue: 156.3, orders: 2 },
      totals: { orders: 1, revenue: 55.9, spend: 819.5, metaPurchases: 1, metaRevenue: 55.9, journeyRevenueOwnAds: 55.9, journeyOrdersOwnAds: 1 },
    }))
    expect(v.fewOrders).toBe(true)
    expect(v.headline).toBe('Com 1 pedido ligado aos anúncios, ainda é cedo para comparar o Meta com a Shopify na Glooty nos últimos 7 dias.')
    // No "Meta e Shopify batem" on one order: the "too few" chip replaces it.
    expect(v.chips.map(c => c.key)).toEqual(['few'])
    expect(v.hero.tone).toBe('neu')
    expect(v.hero.caption).not.toContain('quase o mesmo')
    expect(v.hero.caption).toContain('pouco para tirar conclusão')
  })

  it('names the other store when the ads run in its account (CAMP HALLOW)', () => {
    const v = buildAttributionVerdict(input({
      storeId: CAMP, storeName: 'CAMP HALLOW', sales: { revenue: 13431.67, orders: 141 }, shared: SHARED,
      totals: { orders: 85, revenue: 8698.04, sharedSpend: 3948.03, unknownAdRevenue: 2297.01 },
    }))
    expect(v.state).toBe('shared_account')
    expect(v.hero.value).toBe('$6.401')
    expect(v.headline).toContain('conta da EPOCH')
    // $2.297 of CAMP's ad sales came from an account no store reads: the
    // headline must not say every ad sale went through EPOCH's account.
    expect(v.headline).not.toContain('as vendas que vieram de anúncios')
    expect(v.hero.caption).toContain('pelo primeiro clique')
    expect(v.details[1].text).toBe('O gasto desses anúncios ($3.948) está nos livros da EPOCH: some as duas lojas para julgar o resultado.')
    // No duplicated "conta compartilhada" chip: the state already says it.
    expect(v.chips.map(c => c.key)).toEqual(['shared_account'])
    expect(v.gapPct).toBeNull()
  })

  it('never shows a −100% gap for a store without Meta spend (Dumpling, old clicks)', () => {
    const v = buildAttributionVerdict(input({
      storeName: 'Dumpling Squishy', sales: { revenue: 16514.28, orders: 228 },
      // The data layer reports metaGapPct −100 here; the screen must not.
      totals: { orders: 2, revenue: 125.58, journeyRevenueOwnAds: 125.58, journeyOrdersOwnAds: 2, metaGapPct: -100 },
    }))
    expect(v.state).toBe('no_spend')
    expect(v.gapPct).toBeNull()
    expect(v.hero.value).toBe('$16.514')
    expect(v.details[1].text).toContain('cliques antigos')
  })

  it('says the ads belong to an unconnected account when every credited sale does', () => {
    const v = buildAttributionVerdict(input({
      storeName: 'Dumpling Squishy', sales: { revenue: 5709.9, orders: 124 },
      totals: { orders: 68, revenue: 2498.88, unknownAdRevenue: 2498.88 },
    }))
    expect(v.state).toBe('no_spend')
    expect(v.details[1].text).toContain('nenhuma loja conectada')
    expect(v.notes.every(n => !n.text.includes('ficam fora da comparação'))).toBe(true)
  })

  it('has no number at all without sales or spend', () => {
    const v = buildAttributionVerdict(input({ storeName: 'CAMP HALLOW', sales: { revenue: 0, orders: 0 }, coverage: { ...FULL, orders: 0, withJourney: 0, withAd: 0, pct: 0 } }))
    expect(v.state).toBe('no_sales')
    expect(v.hero.value).toBe('—')
    expect(v.details).toHaveLength(0)
    expect(v.notes).toHaveLength(0)
    const today = buildAttributionVerdict(input({ storeName: 'Glooty', periodPhrase: 'hoje', partialLabel: 'parcial · até 09h10', sales: { revenue: 0, orders: 0 }, coverage: { ...FULL, orders: 0, withJourney: 0, withAd: 0, pct: 0 } }))
    expect(today.headline).toBe('A Glooty ainda não teve vendas nem gasto no Meta hoje.')
  })

  it('separates Meta-only claims, journey-only sales and spend with nothing back', () => {
    expect(buildAttributionVerdict(input({ totals: { spend: 100, metaPurchases: 2, metaRevenue: 180 } })).state).toBe('only_meta')
    expect(buildAttributionVerdict(input({ totals: { spend: 100, orders: 3, revenue: 200, journeyRevenueOwnAds: 200, journeyOrdersOwnAds: 3 } })).state).toBe('only_journey')
    const none = buildAttributionVerdict(input({ totals: { spend: 277.35 } }))
    expect(none.state).toBe('no_return')
    expect(none.hero.value).toBe('$277')
  })

  it('flags partial journeys, the running day and the under-claim', () => {
    const v = buildAttributionVerdict(input({
      partialLabel: 'parcial · até 13h38',
      coverage: { ...FULL, pct: 72, pending: 4 },
      journeysAge: 'há 12 min',
      totals: { orders: 40, revenue: 4000, spend: 1000, metaPurchases: 30, metaRevenue: 3000, journeyRevenueOwnAds: 4000, journeyOrdersOwnAds: 40 },
    }))
    expect(v.state).toBe('under')
    expect(v.hero.value).toBe('−25%')
    expect(v.chips.map(c => c.key)).toEqual(['under', 'coverage', 'partial'])
    expect(v.chips[1].label).toBe('Jornada em 72% dos pedidos')
    expect(v.notes.at(-1)?.text).toBe('Jornada coletada em 72% dos 300 pedidos · 4 ainda sem resposta da Shopify · atualizada há 12 min.')
  })

  it('names the model in the "when" line', () => {
    expect(buildAttributionVerdict(input({ model: 'linear' })).when).toBe('18 out – 16 nov · Dividido')
  })
})
