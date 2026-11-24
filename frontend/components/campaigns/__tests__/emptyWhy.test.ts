import { describe, expect, it } from 'vitest'
import type { PnL } from '@/lib/engine/pnl'
import { sumTotals } from '@/lib/views/verdict'
import { beforeStartAllVerdict, beforeStartVerdict, firstSaleOfAll } from '../storeStart'
import { emptyWhy, windowWhy } from '../emptyWhy'
import { buildAdsVerdict, frozenTailOf, type ReportForVerdict } from '../adsVerdict'
import { buildProductsVerdict } from '@/components/products/productsVerdict'
import { buildCountriesVerdict } from '@/components/countries/countriesVerdict'
import { metaCountriesEmpty } from '@/components/countries/metaEmpty'
import { buildAttributionVerdict } from '@/components/attribution/verdict'
import type { AttributionTotals } from '@/lib/attributionModels'

// A store's P&L with nothing in it (sumTotals keeps the keys of its input).
const ZERO = sumTotals([{
  revenue: 0, orders: 0, units: 0, adSpend: 0, metaSpend: 0, shopSpend: 0, adjustments: 0, fixedCosts: 0,
  variableCosts: 0, contribution: 0, operatingProfit: 0, metaPurchaseValue: 0,
} as unknown as PnL])
const JAN25 = { from: '2025-01-01', to: '2025-01-31' }
const TODAY = '2026-11-24'

describe('firstSaleOfAll', () => {
  const idle = (firstOrderDate: string | null) => ({ totals: ZERO, firstOrderDate })
  it('is the earliest first sale when no store had started', () => {
    expect(firstSaleOfAll([idle('2026-11-07'), idle('2026-04-11'), idle('2026-09-01')], JAN25)).toBe('2026-04-11')
  })
  it('is null when one store had started, had activity, or has no known first sale', () => {
    expect(firstSaleOfAll([idle('2026-11-07'), idle('2024-12-01')], JAN25)).toBeNull()
    expect(firstSaleOfAll([idle('2026-11-07'), { totals: { ...ZERO, adSpend: 40 }, firstOrderDate: '2026-04-11' }], JAN25)).toBeNull()
    expect(firstSaleOfAll([idle('2026-11-07'), idle(null)], JAN25)).toBeNull()
    expect(firstSaleOfAll([], JAN25)).toBeNull()
  })
})

describe('the verdicts carry their empty-window reason', () => {
  it('a store before its first sale (Hibikura, outubro)', () => {
    const v = beforeStartVerdict({
      storeName: 'Hibikura', firstOrderDate: '2026-11-07', period: 'lastmonth', range: { from: '2026-10-01', to: '2026-10-31' },
      today: TODAY, rangeLabel: '1–31 out', dayLabel: 'dia de Tóquio', totals: ZERO,
    })
    expect(v.beforeStart).toEqual({ date: '2026-11-07', text: '7 nov' })
    const why = emptyWhy(v, '1–31 out')!
    expect(why.title).toBe('A loja ainda não vendia')
    expect(why.text).toBe('A 1ª venda foi em 7 nov: escolha um período a partir dessa data.')
  })

  it('every store before its first sale (Todas, jan 2025): the Overview\'s words, in the plural', () => {
    const v = beforeStartAllVerdict({
      firstOrderDate: '2026-04-11', range: JAN25, today: TODAY, storeCount: 7,
      periodPhrase: 'em 1–31 jan 2025', rangeLabel: '1–31 jan 2025', totals: ZERO,
    })
    expect(v.headline).toBe('Nenhuma das lojas vendia ainda em 1–31 jan 2025: a primeira venda foi em 11 abr 2026.')
    expect(v.chips.map(c => c.label)).toEqual(['1ª venda em 11 abr 2026'])
    expect(v.chips.some(c => c.code === 'sem_vendas')).toBe(false)
    const why = emptyWhy(v, '1–31 jan 2025')!
    expect(why.title).toBe('Nenhuma das lojas vendia ainda')
    expect(why.text).toContain('11 abr 2026')
  })

  it('a window that was read has no reason', () => {
    expect(emptyWhy({ beforeStart: null, frozen: null, storeCount: 1 }, '17–23 nov')).toBeNull()
  })
})

describe('Todas · Produtos and Países before every first sale', () => {
  const all = { firstOrderDate: '2026-04-11', range: JAN25, today: TODAY, storeCount: 7 }
  const common = { rangeLabel: '1–31 jan 2025', periodPhrase: 'em 1–31 jan 2025', partialLabel: null, dayLabel: null }

  it('Produtos says no store had started, not "Nenhuma venda nas suas lojas"', () => {
    const v = buildProductsVerdict({
      ...common, subject: 'suas lojas', subjectOf: 'das suas lojas', subjectIn: 'nas suas lojas',
      products: [], totals: ZERO, configured: true, firstSaleAll: all,
    })
    expect(v.headline).toBe('Nenhuma das lojas vendia ainda em 1–31 jan 2025: a primeira venda foi em 11 abr 2026.')
    expect(v.chips.map(c => c.label)).not.toContain('Sem vendas no período')
  })

  it('Países says the same, not "Nenhum pedido nas suas lojas"', () => {
    const v = buildCountriesVerdict({
      ...common, subjectOf: 'das suas lojas', subjectIn: 'nas suas lojas', rows: [], counts: { withOrders: 0, small: 0 },
      totals: ZERO, configured: true, customers: null, firstSaleAll: all,
    })
    expect(v.headline).toBe('Nenhuma das lojas vendia ainda em 1–31 jan 2025: a primeira venda foi em 11 abr 2026.')
    expect(v.beforeStart?.date).toBe('2026-04-11')
  })

  it('without the input the ordinary empty verdict stays', () => {
    const v = buildCountriesVerdict({
      ...common, subjectOf: 'das suas lojas', subjectIn: 'nas suas lojas', rows: [], counts: { withOrders: 0, small: 0 },
      totals: ZERO, configured: true, customers: null,
    })
    expect(v.headline).toBe('Nenhum pedido nas suas lojas em 1–31 jan 2025.')
  })
})

describe('metaCountriesEmpty on Todas', () => {
  it('speaks of the stores, not "A loja"', () => {
    expect(metaCountriesEmpty({ metaSpend: 0, many: true }).body).toMatch(/^As lojas não tiveram gasto/)
    expect(metaCountriesEmpty({ metaSpend: 0 }).body).toMatch(/^A loja não teve gasto/)
  })
})

describe('windowWhy (a window that is not the verdict\'s)', () => {
  const base = { rangeLabel: '17–23 nov', today: TODAY, spend: 0, firstOrderDate: '2026-04-11' as string | null }
  it('an archived store\'s last closed days after its archive day', () => {
    const w = windowWhy({ ...base, range: { from: '2026-11-17', to: '2026-11-23' }, archived: { archivedOn: '2026-11-10' } })!
    expect(w.title).toBe('Sem dados de 17–23 nov: a loja está arquivada desde 10 nov')
  })
  it('a window before the first sale', () => {
    const w = windowWhy({ ...base, firstOrderDate: '2026-11-07', range: { from: '2026-10-01', to: '2026-10-31' }, archived: null })!
    expect(w.title).toBe('A loja ainda não vendia')
  })
  it('null for a read window, and for spend before the first sale', () => {
    expect(windowWhy({ ...base, range: { from: '2026-11-17', to: '2026-11-23' }, archived: null })).toBeNull()
    expect(windowWhy({ ...base, firstOrderDate: '2026-11-07', spend: 120, range: { from: '2026-10-01', to: '2026-10-31' }, archived: null })).toBeNull()
    // The window holds the archive day: read up to it.
    expect(windowWhy({ ...base, range: { from: '2026-11-05', to: '2026-11-15' }, archived: { archivedOn: '2026-11-10' } })).toBeNull()
  })
})

describe('Campanhas: a window that runs past the archive day', () => {
  const ar = { storeName: 'Squishy World', archivedOn: '2026-11-10', period: 'custom' as const, range: { from: '2026-11-05', to: '2026-11-15' }, today: TODAY }
  it('frozenTailOf names the archive day and the days read', () => {
    expect(frozenTailOf(ar)).toEqual({ day: '10 nov', readSpan: '5–10 nov' })
    expect(frozenTailOf({ ...ar, range: { from: '2026-11-17', to: '2026-11-23' } })).toBeNull()
    expect(frozenTailOf({ ...ar, range: { from: '2026-11-01', to: '2026-11-09' } })).toBeNull()
    expect(frozenTailOf(null)).toBeNull()
  })

  it('the no-spend verdict describes only the days read and adds the Resumo\'s note', () => {
    const report = {
      configured: true, contributionRate: 0.6, breakEvenRoas: 1.6, campaigns: [], storeRevenue: 0,
      totals: { spend: 0, purchases: 0, purchaseValue: 0, campaigns: 0, unpricedSpend: 0, estimatedProfit: null },
      reconciliation: { listedSpend: 0, engineMetaSpend: 0, gap: 0, phantomValueDropped: 0, unsyncedSpend: 0 },
      thresholds: { minOrders: 10, windowDays: 7 },
    } as unknown as ReportForVerdict
    const { verdict } = buildAdsVerdict({
      storeName: 'Squishy World', report, pnl: ZERO as PnL,
      window: { period: 'custom', rangeLabel: '5–15 nov', periodPhrase: 'em 5–15 nov', partial: false, partialLabel: null, minutesIntoDay: 1440, dayLabel: null },
      decision: null, archived: ar,
    })
    expect(verdict.headline).toBe('A Squishy World não gastou no Meta em 5–10 nov.')
    expect(verdict.notes.map(n => n.text)).toContain('A Squishy World foi arquivada em 10 nov e não sincroniza mais: não há dados dos dias seguintes.')
  })
})

describe('Atribuição: the verdict carries the reason for its blocks', () => {
  const totals = {
    spend: 0, metaRevenue: 0, metaPurchases: 0, sharedSpend: 0, orders: 0, revenue: 0, siblingOrders: 0,
    journeyRevenueOwnAds: 0, journeyOrdersOwnAds: 0,
  } as unknown as AttributionTotals
  const input = {
    storeId: 'h', storeName: 'Hibikura', periodPhrase: 'no mês passado', rangeLabel: '1–31 out', model: 'first' as const,
    partialLabel: null, sales: { revenue: 0, orders: 0 }, totals,
    coverage: { orders: 0, withJourney: 0, pct: 100, journeysUpdatedAt: null }, phantom: { count: 0, value: 0 }, shared: [],
  } as unknown as Parameters<typeof buildAttributionVerdict>[0]
  it('before the first sale', () => {
    const v = buildAttributionVerdict({
      ...input,
      firstSale: { storeName: 'Hibikura', firstOrderDate: '2026-11-07', period: 'lastmonth', range: { from: '2026-10-01', to: '2026-10-31' }, today: TODAY },
    })
    expect(v.empty).toEqual({ kind: 'before_start', firstSale: '7 nov' })
  })
  it('after the archive day', () => {
    const v = buildAttributionVerdict({
      ...input, storeName: 'Squishy World', rangeLabel: '17–23 nov',
      archived: { storeName: 'Squishy World', archivedOn: '2026-11-10', period: '7d', range: { from: '2026-11-17', to: '2026-11-23' }, today: TODAY },
    })
    expect(v.empty).toEqual({ kind: 'frozen', archivedOn: '10 nov' })
  })
})
