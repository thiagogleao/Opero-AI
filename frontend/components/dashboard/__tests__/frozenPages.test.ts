import { describe, expect, it } from 'vitest'
import type { PnL } from '@/lib/engine/pnl'
import type { AttributionTotals } from '@/lib/attributionModels'
import type { PageContext } from '@/lib/views/page'
import type { ArchivedStoreInput } from '../archivedStore'
import { buildAdsVerdict, type ReportForVerdict } from '@/components/campaigns/adsVerdict'
import { buildProductsVerdict } from '@/components/products/productsVerdict'
import { buildCountriesVerdict } from '@/components/countries/countriesVerdict'
import { buildAttributionVerdict } from '@/components/attribution/verdict'
import { periodNoteText } from '@/components/shell/PageHeader'

// Squishy World, archived on 10 nov, 7 dias = 17–23 nov: the Resumo said
// "arquivada desde 10 nov … não há dados", while Produtos said "Nenhuma venda",
// Países "Nenhum pedido", Campanhas "não gastou no Meta" and Atribuição "não
// teve vendas nem gasto" — for days that were never read.

const RANGE = { from: '2026-11-17', to: '2026-11-23' }
const SW: ArchivedStoreInput = { storeName: 'Squishy World', archivedOn: '2026-11-10', period: '7d', range: RANGE, today: '2026-11-24' }
const HEADLINE = 'A Squishy World está arquivada desde 10 nov e não sincroniza mais: não há dados nos últimos 7 dias.'
const DETAIL = 'Para ver o histórico, escolha um período até 10 nov, quando a loja ainda sincronizava.'
const empty = { revenue: 0, orders: 0, units: 0, contribution: 0, adSpend: 0, metaSpend: 0, shopSpend: 0, operatingProfit: 0, fixedCosts: 0 } as PnL
const common = { rangeLabel: '17–23 nov', periodPhrase: 'nos últimos 7 dias', partialLabel: null, dayLabel: null }

describe('the per-page verdicts of an archived store after its archive day', () => {
  it('Produtos', () => {
    const args = { ...common, subject: 'a Squishy World', subjectOf: 'da Squishy World', subjectIn: 'na Squishy World', products: [], totals: empty, configured: false }
    const v = buildProductsVerdict({ ...args, archived: SW })
    expect(v.headline).toBe(HEADLINE)
    expect(v.details[0].text).toBe(DETAIL)
    expect(v.chips.map(c => c.label)).toEqual(['Sem sincronização', 'Custos não configurados'])
    expect(v.amount).toBeNull()
    // Not archived: the plain empty state.
    expect(buildProductsVerdict(args).headline).toBe('Nenhuma venda na Squishy World nos últimos 7 dias.')
    // A window that reaches back before the archive day is read: not frozen.
    expect(buildProductsVerdict({ ...args, archived: { ...SW, range: { from: '2026-11-04', to: '2026-11-10' } } }).headline)
      .toBe('Nenhuma venda na Squishy World nos últimos 7 dias.')
  })

  it('Países e clientes', () => {
    const args = { ...common, subjectOf: 'da Squishy World', subjectIn: 'na Squishy World', rows: [], counts: { withOrders: 0, small: 0 }, totals: empty, configured: true, customers: null }
    const v = buildCountriesVerdict({ ...args, archived: SW })
    expect(v.headline).toBe(HEADLINE)
    expect(v.chips.map(c => c.label)).toEqual(['Sem sincronização'])
    expect(buildCountriesVerdict(args).headline).toBe('Nenhum pedido na Squishy World nos últimos 7 dias.')
  })

  it('Campanhas', () => {
    const report = {
      configured: true, contributionRate: 0.7, breakEvenRoas: 1.4, storeRevenue: 0, campaigns: [],
      totals: { spend: 0, purchaseValue: 0, purchases: 0, roas: null, estimatedProfit: null, unpricedSpend: 0, campaigns: 0, actions: { escalar: 0, manter: 0, cortar: 0, observar: 0 }, trends: { melhorando: 0, piorando: 0 } },
      reconciliation: { engineMetaSpend: 0, listedSpend: 0, gap: 0, unsyncedSpend: 0, phantomAdDays: 0, phantomValueDropped: 0 },
      thresholds: { minMargin: 20, cutMargin: -10, minOrders: 10, minSpend: 150, windowDays: 7 },
    } as unknown as ReportForVerdict
    const window = { period: '7d' as const, rangeLabel: '17–23 nov', periodPhrase: 'nos últimos 7 dias', partial: false, partialLabel: null, minutesIntoDay: 1440, dayLabel: null }
    const { verdict } = buildAdsVerdict({ storeName: 'Squishy World', report, pnl: empty, window, decision: null, archived: SW })
    expect(verdict.headline).toBe(HEADLINE)
    expect(verdict.chips[0].label).toBe('Sem sincronização')
    expect(buildAdsVerdict({ storeName: 'Squishy World', report, pnl: empty, window, decision: null }).verdict.chips[0].label).toBe('Sem gasto no Meta')
  })

  it('Atribuição', () => {
    const zero = {
      orders: 0, revenue: 0, spend: 0, metaPurchases: 0, metaRevenue: 0, journeyRevenueOwnAds: 0, journeyOrdersOwnAds: 0,
      siblingRevenue: 0, siblingOrders: 0, sharedSpend: 0, unknownAdRevenue: 0, roasJourney: null, roasMeta: null, metaGapPct: null, adsWithActivity: 0,
    } as AttributionTotals
    const base = {
      storeId: 'sw', storeName: 'Squishy World', periodPhrase: 'nos últimos 7 dias', rangeLabel: '17–23 nov', model: 'first' as const,
      partialLabel: null, sales: { revenue: 0, orders: 0 }, totals: zero,
      coverage: { orders: 0, withJourney: 0, withAd: 0, pct: 0, attributablePct: 0, pending: 0 }, phantom: { rows: 0, value: 0 }, shared: [],
    }
    const v = buildAttributionVerdict({ ...base, archived: SW })
    expect(v.headline).toBe(HEADLINE)
    expect(v.details[0].text).toBe(DETAIL)
    expect(v.chips.map(c => c.label)).toEqual(['Sem sincronização'])
    expect(v.hero).toEqual({ value: '—', tone: 'mut', caption: 'loja arquivada: nada é lido depois disso' })
    expect(buildAttributionVerdict(base).headline).toBe('A Squishy World não teve vendas nem gasto no Meta nos últimos 7 dias.')
  })
})

describe('periodNoteText of an archived store', () => {
  const ctx = (period: string, range: { from: string; to: string }, archived: boolean) => ({
    scope: 'store', period, range, today: '2026-11-24', rangeLabel: range.from === range.to ? '24 nov' : '1–24 nov',
    timezone: 'America/Sao_Paulo', selected: [], params: {}, rangeNote: null, partial: !archived,
    store: { id: 'sw', name: 'Squishy World', archived },
  }) as unknown as PageContext

  it('on Hoje and Este mês, says nothing is read and the numbers do not move', () => {
    const today = periodNoteText(ctx('today', { from: '2026-11-24', to: '2026-11-24' }, true))
    expect(today).toBe('24 nov no horário de São Paulo. A loja está arquivada e não sincroniza mais: nada depois do arquivamento é lido, e estes números não mudam.')
    expect(today).not.toMatch(/andamento|parcial/)
    expect(periodNoteText(ctx('mtd', { from: '2026-11-01', to: '2026-11-24' }, true))).not.toMatch(/hoje entra parcial/)
  })

  it('a store that syncs keeps the running-day sentence', () => {
    expect(periodNoteText(ctx('today', { from: '2026-11-24', to: '2026-11-24' }, false))).toMatch(/^Dia em andamento no horário de São Paulo/)
  })
})
