import { describe, expect, it } from 'vitest'
import { rollUpCountries, type CountryRow } from '@/lib/data/countries'
import type { PnL } from '@/lib/engine/pnl'
import { countryCounts, foldCountryRows } from '../fold'
import { buildCountriesVerdict, customerMixShares } from '../countriesVerdict'
import { coverageText } from '../CountryTables'

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
})
