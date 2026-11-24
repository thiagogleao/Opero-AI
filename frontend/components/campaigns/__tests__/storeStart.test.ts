import { describe, expect, it } from 'vitest'
import type { PnL } from '@/lib/engine/pnl'
import type { AttributionTotals } from '@/lib/attributionModels'
import { beforeStartText, dateBeside, isBeforeStart, type BeforeStartInput } from '../storeStart'
import { buildAdsVerdict, type ReportForVerdict } from '../adsVerdict'
import { buildProductsVerdict } from '@/components/products/productsVerdict'
import { buildCountriesVerdict } from '@/components/countries/countriesVerdict'
import { buildAttributionVerdict } from '@/components/attribution/verdict'

// Hibikura sold first on 7 nov (Tokyo). The window 28 out – 3 nov crosses a
// month boundary and ends before that day: the Resumo says "Vende desde 7 nov",
// and so must Produtos, Países e clientes, Campanhas and Atribuição.
const RANGE = { from: '2026-10-28', to: '2026-11-03' }
const HIB: BeforeStartInput = { storeName: 'Hibikura', firstOrderDate: '2026-11-07', period: 'custom', range: RANGE, today: '2026-11-18' }
const HEADLINE = 'A Hibikura começou a vender em 7 nov — não há dados de 28 out – 3 nov.'
const DETAIL = 'Escolha um período a partir de 7 nov para ver o resultado.'

const empty = { revenue: 0, orders: 0, units: 0, contribution: 0, adSpend: 0, metaSpend: 0, shopSpend: 0, operatingProfit: 0, fixedCosts: 0 } as PnL

describe('isBeforeStart', () => {
  const none = { orders: 0, revenue: 0, spend: 0 }
  it('needs a known first sale, a window ending before it, and nothing in the window', () => {
    expect(isBeforeStart('2026-11-07', RANGE, none)).toBe(true)
    expect(isBeforeStart(null, RANGE, none)).toBe(false)
    // Ends on the first day: the store already sold in it.
    expect(isBeforeStart('2026-11-03', RANGE, none)).toBe(false)
    // Money spent before the launch was really spent: keep the page's verdict.
    expect(isBeforeStart('2026-11-07', RANGE, { ...none, spend: 40 })).toBe(false)
    expect(isBeforeStart('2026-11-07', RANGE, { ...none, orders: 1, revenue: 30 })).toBe(false)
  })
})

describe('beforeStartText', () => {
  it('says what the Resumo says', () => {
    const t = beforeStartText(HIB)
    expect(t.chip).toBe('Vende desde 7 nov')
    expect(t.headline).toBe(HEADLINE)
    expect(t.detail.text).toBe(DETAIL)
  })
  it('names the month for "Mês passado"', () => {
    expect(beforeStartText({ ...HIB, period: 'lastmonth', range: { from: '2026-10-01', to: '2026-10-31' } }).headline)
      .toBe('A Hibikura começou a vender em 7 nov — não há dados de outubro.')
  })
  it('puts the year on the first sale when the window is printed with years', () => {
    // MOKOO, 15 dez 2025 – 15 jan 2026: "começou a vender em 11 abr" read as 11 abr 2025.
    const mokoo: BeforeStartInput = { storeName: 'MOKOO', firstOrderDate: '2026-04-11', period: 'custom', range: { from: '2025-12-15', to: '2026-01-15' }, today: '2026-11-24' }
    const t = beforeStartText(mokoo)
    expect(t.chip).toBe('Vende desde 11 abr 2026')
    expect(t.headline).toBe('A MOKOO começou a vender em 11 abr 2026 — não há dados de 15 dez 2025 – 15 jan 2026.')
    expect(t.detail.text).toBe('Escolha um período a partir de 11 abr 2026 para ver o resultado.')
    // A window of this year stays short; a comparison in another year counts (the Resumo).
    expect(beforeStartText({ ...mokoo, range: { from: '2026-01-01', to: '2026-01-31' } }).chip).toBe('Vende desde 11 abr')
    expect(beforeStartText({ ...mokoo, range: { from: '2026-01-01', to: '2026-01-10' }, alsoShown: ['2025-12-22', '2025-12-31'] }).chip).toBe('Vende desde 11 abr 2026')
  })
})

describe('dateBeside', () => {
  it('follows the Resumo verdict rule (lib/views/verdict dayText)', () => {
    expect(dateBeside('2026-02-18', ['2025-11-23', '2026-11-23'], '2026-11-24')).toBe('18 fev 2026')
    expect(dateBeside('2026-02-18', ['2026-01-01', '2026-11-23', null, undefined], '2026-11-24')).toBe('18 fev')
    // A date of another year carries it anyway.
    expect(dateBeside('2025-02-18', ['2026-01-01'], '2026-11-24')).toBe('18 fev 2025')
  })
})

describe('the per-page verdicts before the first sale', () => {
  const common = { rangeLabel: '28 out – 3 nov', periodPhrase: 'em 28 out – 3 nov', partialLabel: null, dayLabel: 'dia de Tóquio' }

  it('Produtos', () => {
    const v = buildProductsVerdict({ ...common, subject: 'a Hibikura', subjectOf: 'da Hibikura', subjectIn: 'na Hibikura', products: [], totals: empty, configured: true, firstSale: HIB })
    expect(v.chips.map(c => c.label)).toEqual(['Vende desde 7 nov', 'dia de Tóquio'])
    expect(v.headline).toBe(HEADLINE)
    expect(v.details[0].text).toBe(DETAIL)
    expect(v.amount).toBeNull()
    // Without the first sale it stays the plain empty state.
    expect(buildProductsVerdict({ ...common, subject: 'a Hibikura', subjectOf: 'da Hibikura', subjectIn: 'na Hibikura', products: [], totals: empty, configured: true }).chips[0].label)
      .toBe('Sem vendas no período')
  })

  it('Países e clientes, with the cost-settings chip of a store without costs', () => {
    const v = buildCountriesVerdict({ ...common, subjectOf: 'da Glooty', subjectIn: 'na Glooty', rows: [], counts: { withOrders: 0, small: 0 }, totals: empty, configured: false, customers: null, firstSale: { ...HIB, storeName: 'Glooty', firstOrderDate: '2026-11-06' } })
    expect(v.chips.map(c => c.label)).toEqual(['Vende desde 6 nov', 'Custos não configurados', 'dia de Tóquio'])
    expect(v.headline).toBe('A Glooty começou a vender em 6 nov — não há dados de 28 out – 3 nov.')
  })

  it('Campanhas', () => {
    const report = {
      configured: true, contributionRate: 0.7, breakEvenRoas: 1.4, storeRevenue: 0, campaigns: [],
      totals: { spend: 0, purchaseValue: 0, purchases: 0, roas: null, estimatedProfit: null, unpricedSpend: 0, campaigns: 0, actions: { escalar: 0, manter: 0, cortar: 0, observar: 0 }, trends: { melhorando: 0, piorando: 0 } },
      reconciliation: { engineMetaSpend: 0, listedSpend: 0, gap: 0, unsyncedSpend: 0, phantomAdDays: 0, phantomValueDropped: 0 },
      thresholds: { minMargin: 20, cutMargin: -10, minOrders: 10, minSpend: 150, windowDays: 7 },
    } as unknown as ReportForVerdict
    const window = { period: 'custom' as const, rangeLabel: '28 out – 3 nov', periodPhrase: 'em 28 out – 3 nov', partial: false, partialLabel: null, minutesIntoDay: 1440, dayLabel: 'dia de Tóquio' }
    const { verdict } = buildAdsVerdict({ storeName: 'Hibikura', report, pnl: empty, window, decision: null, firstSale: HIB })
    expect(verdict.chips[0].label).toBe('Vende desde 7 nov')
    expect(verdict.headline).toBe(HEADLINE)
    expect(buildAdsVerdict({ storeName: 'Hibikura', report, pnl: empty, window, decision: null }).verdict.chips[0].label).toBe('Sem gasto no Meta')
  })

  it('Atribuição', () => {
    const zero = {
      orders: 0, revenue: 0, spend: 0, metaPurchases: 0, metaRevenue: 0, journeyRevenueOwnAds: 0, journeyOrdersOwnAds: 0,
      siblingRevenue: 0, siblingOrders: 0, sharedSpend: 0, unknownAdRevenue: 0, roasJourney: null, roasMeta: null, metaGapPct: null, adsWithActivity: 0,
    } as AttributionTotals
    const base = {
      storeId: 'glooty', storeName: 'Glooty', periodPhrase: 'em 28 out – 3 nov', rangeLabel: '28 out – 3 nov', model: 'first' as const,
      partialLabel: null, sales: { revenue: 0, orders: 0 }, totals: zero,
      coverage: { orders: 0, withJourney: 0, withAd: 0, pct: 0, attributablePct: 0, pending: 0 }, phantom: { rows: 0, value: 0 }, shared: [],
    }
    const v = buildAttributionVerdict({ ...base, firstSale: { ...HIB, storeName: 'Glooty', firstOrderDate: '2026-11-06' } })
    expect(v.chips.map(c => c.label)).toEqual(['Vende desde 6 nov'])
    expect(v.headline).toBe('A Glooty começou a vender em 6 nov — não há dados de 28 out – 3 nov.')
    expect(v.details[0].text).toBe('Escolha um período a partir de 6 nov para ver o resultado.')
    expect(buildAttributionVerdict(base).chips[0].label).toBe('Sem vendas no período')
  })
})
