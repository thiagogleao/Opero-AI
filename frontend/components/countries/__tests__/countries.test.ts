import { describe, expect, it } from 'vitest'
import type { CountryRow } from '@/lib/data/countries'
import type { PnL } from '@/lib/engine/pnl'
import { countryCounts, foldCountryRows, meaningfulCountries } from '../fold'
import { buildCountriesVerdict } from '../countriesVerdict'

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

  it('drops countries with nothing in them and names the "unknown" bucket', () => {
    const rows = meaningfulCountries([...ALL, row('unknown', 0, 0, 0), row('IS', 0, 0, 0), row('unknown', 0, 0, 0, 4)])
    expect(rows.map(r => r.country)).toEqual(['US', 'MX', 'GB', 'DE', 'FR', 'BR', 'unknown'])
    expect(rows[rows.length - 1].name).toBe('País não informado')
    const folded = foldCountryRows(rows, 2, 9185)
    expect(folded[2].name).toBe('Outros 2 países · +3 só com gasto do Meta')
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

  it('says there were no orders instead of a fake $0', () => {
    const v = buildCountriesVerdict({ ...base, rows: [], counts: { withOrders: 0, small: 0 }, customers: null, totals: { revenue: 0, orders: 0, contribution: 0 } as PnL })
    expect(v.amount).toBeNull()
    expect(v.headline).toBe('Nenhum pedido na MOKOO nos últimos 7 dias.')
  })
})
