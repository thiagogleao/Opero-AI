import { describe, expect, it } from 'vitest'
import type { PnL } from '@/lib/engine/pnl'
import type { AttributionTotals } from '@/lib/attributionModels'
import type { ArchivedStoreInput } from '../archivedStore'
import { buildAdsVerdict, type ReportForVerdict } from '@/components/campaigns/adsVerdict'
import { buildProductsVerdict } from '@/components/products/productsVerdict'
import { buildCountriesVerdict } from '@/components/countries/countriesVerdict'
import { buildAttributionVerdict } from '@/components/attribution/verdict'

// Squishy World, archived on 10 nov, Este mês = 1–24 nov: 1–10 nov were read
// and had nothing, 11–24 nov were never read. The Resumo says "não teve vendas
// em 1–10 nov" with the archive note (lib/views/verdict frozenTail). Produtos
// read "Nenhuma venda na Squishy World neste mês.", Países "Nenhum pedido na
// Squishy World neste mês.", Atribuição "não teve vendas nem gasto no Meta
// neste mês." — each claiming the days after the archive.

const RANGE = { from: '2026-11-01', to: '2026-11-24' }
const SW: ArchivedStoreInput = { storeName: 'Squishy World', archivedOn: '2026-11-10', period: 'mtd', range: RANGE, today: '2026-11-24' }
const HEADLINE = 'A Squishy World não teve vendas em 1–10 nov.'
const NOTE = 'A Squishy World foi arquivada em 10 nov e não sincroniza mais: não há dados dos dias seguintes.'
const empty = { revenue: 0, orders: 0, units: 0, contribution: 0, adSpend: 0, metaSpend: 0, shopSpend: 0, operatingProfit: 0, fixedCosts: 0 } as PnL
const common = { rangeLabel: '1–24 nov', periodPhrase: 'neste mês', partialLabel: null, dayLabel: null }

describe('an archived store\'s window that runs past its archive day, with nothing in the days read', () => {
  it('Produtos reads the Resumo\'s frozenTail, not "Nenhuma venda neste mês"', () => {
    const args = { ...common, subject: 'a Squishy World', subjectOf: 'da Squishy World', subjectIn: 'na Squishy World', products: [], totals: empty, configured: false }
    const v = buildProductsVerdict({ ...args, archived: SW })
    expect(v.headline).toBe(HEADLINE)
    expect(v.notes.map(n => n.text)).toEqual([NOTE])
    expect(v.chips.map(c => c.label)).toEqual(['Sem vendas no período', 'Custos não configurados'])
    expect(v.frozen).toBeNull()
    expect(v.amount).toBeNull()
  })

  it('Países e clientes', () => {
    const args = { ...common, subjectOf: 'da Squishy World', subjectIn: 'na Squishy World', rows: [], counts: { withOrders: 0, small: 0 }, totals: empty, configured: true, customers: null }
    const v = buildCountriesVerdict({ ...args, archived: SW })
    expect(v.headline).toBe(HEADLINE)
    expect(v.notes.map(n => n.text)).toEqual([NOTE])
    expect(v.chips.map(c => c.label)).toEqual(['Sem vendas no período'])
  })

  it('Campanhas: its own sentence on the days read, with the same note', () => {
    const report = {
      configured: true, contributionRate: 0.7, breakEvenRoas: 1.4, storeRevenue: 0, campaigns: [],
      totals: { spend: 0, purchaseValue: 0, purchases: 0, roas: null, estimatedProfit: null, unpricedSpend: 0, campaigns: 0, actions: { escalar: 0, manter: 0, cortar: 0, observar: 0 }, trends: { melhorando: 0, piorando: 0 } },
      reconciliation: { engineMetaSpend: 0, listedSpend: 0, gap: 0, unsyncedSpend: 0, phantomAdDays: 0, phantomValueDropped: 0 },
      thresholds: { minMargin: 20, cutMargin: -10, minOrders: 10, minSpend: 150, windowDays: 7 },
    } as unknown as ReportForVerdict
    const window = { period: 'mtd' as const, rangeLabel: '1–24 nov', periodPhrase: 'neste mês', partial: false, partialLabel: null, minutesIntoDay: 1440, dayLabel: null }
    const { verdict } = buildAdsVerdict({ storeName: 'Squishy World', report, pnl: empty, window, decision: null, archived: SW })
    // Campanhas speaks of Meta spend and already names only the days read
    // (components/campaigns/__tests__/emptyWhy.test.ts pins this wording).
    expect(verdict.headline).toBe('A Squishy World não gastou no Meta em 1–10 nov.')
    expect(verdict.notes.map(n => n.text)).toEqual([NOTE])
  })

  it('Atribuição: the frozenTail words, without marking the window as never read', () => {
    const zero = {
      orders: 0, revenue: 0, spend: 0, metaPurchases: 0, metaRevenue: 0, journeyRevenueOwnAds: 0, journeyOrdersOwnAds: 0,
      siblingRevenue: 0, siblingOrders: 0, sharedSpend: 0, unknownAdRevenue: 0, roasJourney: null, roasMeta: null, metaGapPct: null, adsWithActivity: 0,
    } as AttributionTotals
    const base = {
      storeId: 'sw', storeName: 'Squishy World', periodPhrase: 'neste mês', rangeLabel: '1–24 nov', model: 'first' as const,
      partialLabel: null, sales: { revenue: 0, orders: 0 }, totals: zero,
      coverage: { orders: 0, withJourney: 0, withAd: 0, pct: 0, attributablePct: 0, pending: 0 }, phantom: { rows: 0, value: 0 }, shared: [],
    }
    const v = buildAttributionVerdict({ ...base, archived: SW })
    expect(v.headline).toBe(HEADLINE)
    expect(v.notes.map(n => n.text)).toEqual([NOTE])
    expect(v.chips.map(c => c.label)).toEqual(['Sem vendas no período'])
    expect(v.hero).toEqual({ value: '—', tone: 'mut', caption: 'nenhum pedido no período' })
    // 1–10 nov were read: the blocks below keep their own empty states.
    expect(v.empty ?? null).toBeNull()
    // A window wholly after the archive day still is "never read".
    const after = buildAttributionVerdict({ ...base, rangeLabel: '17–23 nov', archived: { ...SW, period: '7d', range: { from: '2026-11-17', to: '2026-11-23' } } })
    expect(after.empty).toEqual({ kind: 'frozen', archivedOn: '10 nov' })
  })

  it('a window with activity in the days read keeps the page\'s own verdict', () => {
    const sold = { ...empty, revenue: 80, orders: 2 } as PnL
    const v = buildCountriesVerdict({
      ...common, subjectOf: 'da Squishy World', subjectIn: 'na Squishy World', rows: [], counts: { withOrders: 0, small: 0 },
      totals: sold, configured: true, customers: null, archived: SW,
    })
    expect(v.headline).not.toBe(HEADLINE)
  })
})
