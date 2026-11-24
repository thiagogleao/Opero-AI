import { describe, expect, it } from 'vitest'
import { rollUpCountries, type CountryRow } from '@/lib/data/countries'
import type { PnL } from '@/lib/engine/pnl'
import { countryCounts, foldCountryRows, shopifyCountryRows } from '../fold'
import { buildCountriesVerdict, customerMixShares } from '../countriesVerdict'
import { allStoresCoverageText, captureSub, captureTitle, coverageText } from '../CountryTables'

function row(country: string, orders: number, revenue: number, contribution: number, spend = 0): CountryRow {
  return {
    country, name: country, orders, revenue, revenueShare: null, variableCosts: revenue - contribution, contribution,
    contributionMargin: revenue > 0 ? (contribution / revenue) * 100 : null, contributionPerOrder: orders ? contribution / orders : null,
    smallSample: orders < 30, meta: { spend, purchases: 0, purchaseValue: 0, capturePct: null },
  }
}

const ALL = [
  row('US', 92, 7800, 5500, 2300), row('MX', 6, 700, 470, 17), row('GB', 10, 500, 340, 55),
  row('DE', 3, 185, 122, 30), row('FR', 0, 0, 0, 12), row('BR', 0, 0, 0, 3),
]

describe('foldCountryRows', () => {
  it('keeps the biggest countries and sums the rest so the table adds up', () => {
    const rows = foldCountryRows(ALL, 2, 9185)
    expect(rows.map(r => r.country)).toEqual(['US', 'MX', 'outros'])
    const sum = (k: 'orders' | 'revenue' | 'contribution') => rows.reduce((t, r) => t + r[k], 0)
    expect(sum('orders')).toBe(111)
    expect(sum('revenue')).toBe(9185)
    expect(sum('contribution')).toBe(6432)
    const outros = rows[2]
    expect(outros.meta.spend).toBe(100)
    expect(outros.mergedCountries).toBe(4)
    // two countries with orders, two where only Meta spent
    expect(outros.name).toBe('Outros 2 países · +2 só com gasto do Meta')
  })

  it('does not add an "outros" row when everything fits', () => {
    expect(foldCountryRows(ALL, 10, 9185).some(r => r.country === 'outros')).toBe(false)
  })

  it('keeps the counts of an "outros" row it folds again (Todas: rollUpCountries, then the fold)', () => {
    // 2 countries with orders and 3 Meta-only, already summed into "outros" upstream.
    const pnl = (country: string, orders: number, revenue: number, metaSpend = 0) =>
      ({ country, orders, revenue, variableCosts: revenue / 2, contribution: revenue / 2, metaSpend, metaPurchaseValue: 0, purchases: 0 })
    const upstream = rollUpCountries([
      pnl('US', 90, 7800, 2300), pnl('MX', 6, 700, 17), pnl('GB', 10, 500, 55),
      pnl('DE', 3, 185, 30), pnl('FR', 0, 0, 12), pnl('BR', 0, 0, 3), pnl('CD', 0, 0, 1),
      // Meta's "unknown" bucket with nothing in it: never a row, never counted.
      pnl('unknown', 0, 0, 0),
    ], 9185, 2)
    expect(upstream[2]).toMatchObject({ country: 'outros', mergedCountries: 5, mergedWithOrders: 2 })
    const folded = foldCountryRows(upstream, 1, 9185)
    expect(folded.map(r => r.country)).toEqual(['US', 'outros'])
    expect(folded[1].name).toBe('Outros 3 países · +3 só com gasto do Meta')
    expect(folded[1]).toMatchObject({ mergedCountries: 6, mergedWithOrders: 3, orders: 19 })
  })

  it('counts only countries with orders', () => {
    expect(countryCounts(ALL)).toEqual({ withOrders: 4, small: 3 })
  })
})

describe('buildCountriesVerdict', () => {
  const totals = { revenue: 9185, orders: 111, contribution: 6432 } as PnL
  const base = {
    subjectOf: 'da MOKOO', subjectIn: 'na MOKOO', totals, configured: true, rangeLabel: '10–16 nov',
    periodPhrase: 'nos últimos 7 dias', partialLabel: null, dayLabel: null,
  }

  it('names the biggest market with its share of sales and contribution', () => {
    const rows = foldCountryRows(ALL, 15, 9185).map(r => ({ ...r, revenueShare: (r.revenue / 9185) * 100 }))
    const v = buildCountriesVerdict({ ...base, rows, counts: countryCounts(ALL), customers: { orders: 111, newOrders: 90, returningOrders: 21, guestOrders: 0 } })
    expect(v.headline).toBe('Maior mercado da MOKOO nos últimos 7 dias: US, com 85% das vendas e 86% da contribuição.')
    expect(v.amount).toBe(6432)
    expect(v.details[0].text).toBe('Vendeu para 4 países; 3 deles com menos de 30 pedidos — amostra pequena para decidir por país.')
    expect(v.details[1].text).toBe('19% dos pedidos foram recompra, 81% de clientes novos.')
    expect(v.chips[0].label).toBe('US: 85% das vendas')
  })

  it('says "todos" only of several countries (Hibikura sells to Japan alone)', () => {
    const jp = [row('JP', 6, 600, 400)].map(r => ({ ...r, revenueShare: 100 }))
    const v = buildCountriesVerdict({ ...base, rows: jp, counts: { withOrders: 1, small: 1 }, customers: null, totals: { revenue: 600, orders: 6, contribution: 400 } as PnL })
    expect(v.chips.map(c => c.label)).toContain('Menos de 30 pedidos')
    expect(v.chips.map(c => c.label).join(' ')).not.toMatch(/Todos/)
    expect(v.details[0].text).toBe('Vendeu para 1 país, com menos de 30 pedidos — amostra pequena para decidir por país.')
    // Several small countries keep "todos".
    const two = [row('US', 5, 500, 300), row('CA', 2, 200, 120)].map(r => ({ ...r, revenueShare: r.revenue / 7 }))
    const w = buildCountriesVerdict({ ...base, rows: two, counts: { withOrders: 2, small: 2 }, customers: null, totals: { revenue: 700, orders: 7, contribution: 420 } as PnL })
    expect(w.chips.map(c => c.label)).toContain('Todos com menos de 30 pedidos')
    expect(w.details[0].text).toBe('Vendeu para 2 países; todos com menos de 30 pedidos — amostra pequena para decidir por país.')
    // One big country: no sample warning at all.
    const big = buildCountriesVerdict({ ...base, rows: [row('JP', 40, 4000, 2600)].map(r => ({ ...r, revenueShare: 100 })), counts: { withOrders: 1, small: 0 }, customers: null, totals: { revenue: 4000, orders: 40, contribution: 2600 } as PnL })
    expect(big.details[0].text).toBe('Vendeu para 1 país.')
  })

  it('says there were no orders instead of a fake $0', () => {
    const v = buildCountriesVerdict({ ...base, rows: [], counts: { withOrders: 0, small: 0 }, customers: null, totals: { revenue: 0, orders: 0, contribution: 0 } as PnL })
    expect(v.amount).toBeNull()
    expect(v.headline).toBe('Nenhum pedido na MOKOO nos últimos 7 dias.')
  })
})

describe('customer mix and coverage wording', () => {
  it('never prints 0% for a part that has orders (MOKOO 30 dias: 2 guests in 630)', () => {
    const mix = customerMixShares({ orders: 630, newOrders: 462, returningOrders: 166, guestOrders: 2 })
    expect(mix).toEqual({ returning: '26%', new: '73%', guest: '2 pedidos sem cadastro (menos de 1%)' })
    expect(customerMixShares({ orders: 300, newOrders: 290, returningOrders: 1, guestOrders: 9 }))
      .toEqual({ returning: 'menos de 1%', new: '97%', guest: '3% sem cadastro' })
    expect(customerMixShares({ orders: 4, newOrders: 3, returningOrders: 1, guestOrders: 0 }).guest).toBeNull()
    expect(customerMixShares({ orders: 300, newOrders: 299, returningOrders: 0, guestOrders: 1 }).guest).toBe('1 pedido sem cadastro (menos de 1%)')
  })

  it('puts the guest count in the verdict line', () => {
    const totals = { revenue: 9185, orders: 630, contribution: 6432 } as PnL
    const rows = foldCountryRows(ALL, 15, 9185).map(r => ({ ...r, revenueShare: (r.revenue / 9185) * 100 }))
    const v = buildCountriesVerdict({
      subjectOf: 'da MOKOO', subjectIn: 'na MOKOO', totals, configured: true, rangeLabel: '19 out – 17 nov',
      periodPhrase: 'nos últimos 30 dias', partialLabel: null, dayLabel: null, rows, counts: countryCounts(ALL),
      customers: { orders: 630, newOrders: 462, returningOrders: 166, guestOrders: 2 },
    })
    expect(v.details[1].text).toBe('26% dos pedidos foram recompra, 73% de clientes novos e 2 pedidos sem cadastro (menos de 1%).')
  })

  it('agrees the verb with the count of missing days', () => {
    const one = coverageText({ coveredSpend: 0, totalSpend: 216, coveragePct: 0, missingDays: ['2026-11-18'] })
    expect(one).toBe('A divisão por país do Meta cobre 0% do gasto ($0 de $216). Falta 1 dia com gasto sem divisão por país.')
    const many = coverageText({ coveredSpend: 17771, totalSpend: 25491, coveragePct: 69.7, missingDays: Array.from({ length: 12 }, (_, i) => `d${i}`) })
    expect(many).toContain('Faltam 12 dias com gasto sem divisão por país.')
  })

  it('says the capture counts only the days the split covers whole', () => {
    const text = coverageText({
      coveredSpend: 15557, totalSpend: 30080, coveragePct: 51.7, missingDays: Array.from({ length: 17 }, (_, i) => `d${i}`),
      partialDays: ['2026-10-05', '2026-10-09', '2026-10-13'], captureSpendDays: 11,
    })
    expect(text).toBe('A divisão por país do Meta cobre 52% do gasto ($15.557 de $30.080). Faltam 17 dias com gasto sem divisão por país.'
      + ' Em 3 dias, ela cobre só parte do gasto. Por isso a captura compara compras e pedidos só nos dias em que a divisão cobre todo o gasto (11 dias com gasto).')
    expect(coverageText({ coveredSpend: 0, totalSpend: 216, coveragePct: 0, missingDays: ['2026-11-18'], partialDays: [], captureSpendDays: 0 }))
      .toContain('Nenhum dia com gasto tem a divisão inteira')
    // Whole split: nothing about the capture.
    expect(coverageText({ coveredSpend: 500, totalSpend: 500, coveragePct: 100, missingDays: [], partialDays: [], captureSpendDays: 7 }))
      .toBe('A divisão por país do Meta cobre 100% do gasto ($500 de $500).')
  })

  it('shows the capture figures only when they differ from the columns', () => {
    const r = row('US', 373, 30000, 12000, 9000)
    expect(captureTitle({ ...r, meta: { ...r.meta, purchases: 179, captureOrders: 177, capturePurchases: 154 } }))
      .toBe('154 compras ÷ 177 pedidos nos dias com divisão inteira')
    expect(captureTitle({ ...r, meta: { ...r.meta, purchases: 179, captureOrders: 373, capturePurchases: 179 } })).toBeNull()
    expect(captureTitle(r)).toBeNull()
    expect(captureSub({ ...r, meta: { ...r.meta, purchases: 179, captureOrders: 177, capturePurchases: 154 } })).toBe('154 ÷ 177')
    expect(captureSub(r)).toBeNull()
  })

  it('folds the capture over the comparable days of the folded rows', () => {
    const a = { ...row('US', 100, 9000, 4000, 900), meta: { spend: 900, purchases: 50, purchaseValue: 0, capturePct: 80, captureOrders: 50, capturePurchases: 40 } }
    const b = { ...row('GB', 20, 900, 400, 90), meta: { spend: 90, purchases: 8, purchaseValue: 0, capturePct: 50, captureOrders: 10, capturePurchases: 5 } }
    const c = { ...row('DE', 10, 800, 300, 80), meta: { spend: 80, purchases: 4, purchaseValue: 0, capturePct: null, captureOrders: 0, capturePurchases: 0 } }
    const folded = foldCountryRows([a, b, c], 1, 10700)
    expect(folded[1].meta).toMatchObject({ purchases: 12, captureOrders: 10, capturePurchases: 5, capturePct: 50 })
  })
})

// Glooty 4–5 nov: "Nenhum pedido na Glooty" over a Shopify table of
// "US 0 · $0 · — das vendas", "MX 0 · $0" … — countries where only Meta spent.
describe('shopifyCountryRows', () => {
  it('keeps countries with orders only; the Meta-only ones stay for the Meta table', () => {
    const shop = shopifyCountryRows(ALL)
    expect(shop.map(r => r.country)).toEqual(['US', 'MX', 'GB', 'DE'])
    // Nothing with money is dropped: the table still adds up to the store.
    expect(shop.reduce((t, r) => t + r.revenue, 0)).toBe(9185)
    expect(shopifyCountryRows([row('US', 0, 0, 0, 87), row('MX', 0, 0, 0, 34)])).toEqual([])
    // Folded, its "outros" names only countries with orders.
    const folded = foldCountryRows(shop, 2, 9185)
    expect(folded[2].name).toBe('Outros 2 países')
  })

  it('renames an "outros" row already in the list to its countries with orders', () => {
    const outros = { ...row('outros', 19, 1385, 900, 70), name: 'Outros 3 países · +3 só com gasto do Meta', mergedCountries: 6, mergedWithOrders: 3 }
    const [r] = shopifyCountryRows([outros])
    expect(r).toMatchObject({ name: 'Outros 3 países', mergedCountries: 3, mergedWithOrders: 3, orders: 19 })
  })
})

// Países · Todas, 17–23 nov: the Meta rows added up to $13,7 mil of $20.737,
// MOKOO's $6.618 missing without a word.
describe('allStoresCoverageText', () => {
  it('names the stores without a split and the ones only partly covered', () => {
    const text = allStoresCoverageText([
      { name: 'MOKOO', coveredSpend: 0, totalSpend: 6618.66, missingDays: ['1', '2', '3', '4', '5', '6', '7'] },
      { name: 'Dumpling Squishy · 8jcp3a', coveredSpend: 96.32, totalSpend: 474.33, missingDays: ['1', '2', '3', '4', '5'] },
      { name: 'EPOCH ®️', coveredSpend: 7918.65, totalSpend: 7925.03, missingDays: [] },
      { name: 'Hibikura', coveredSpend: 5720.13, totalSpend: 5720.28, missingDays: [] },
      { name: 'CAMP HALLOW', coveredSpend: 0, totalSpend: 0, missingDays: [] },
    ])
    expect(text).toBe('A divisão por país do Meta cobre 66% do gasto ($13.735 de $20.738); a MOKOO não tem divisão por país neste período; na Dumpling Squishy · 8jcp3a ela cobre só 20%, com 5 dias sem divisão.')
  })

  it('says only the share when every store is covered, a missing day when the share rounds up, and nothing without spend', () => {
    expect(allStoresCoverageText([{ name: 'EPOCH ®️', coveredSpend: 500, totalSpend: 500, missingDays: [] }]))
      .toBe('A divisão por país do Meta cobre 100% do gasto ($500 de $500).')
    expect(allStoresCoverageText([{ name: 'EPOCH ®️', coveredSpend: 990, totalSpend: 1000, missingDays: ['2026-11-18'] }]))
      .toBe('A divisão por país do Meta cobre 99% do gasto ($990 de $1.000); na EPOCH ®️ falta 1 dia com gasto sem divisão.')
    expect(allStoresCoverageText([
      { name: 'MOKOO', coveredSpend: 0, totalSpend: 100, missingDays: ['a'] },
      { name: 'Glooty', coveredSpend: 0, totalSpend: 50, missingDays: ['a'] },
    ])).toBe('A divisão por país do Meta cobre 0% do gasto ($0 de $150); a MOKOO e a Glooty não têm divisão por país neste período.')
    expect(allStoresCoverageText([{ name: 'CAMP HALLOW', coveredSpend: 0, totalSpend: 0, missingDays: [] }])).toBeNull()
  })
})
