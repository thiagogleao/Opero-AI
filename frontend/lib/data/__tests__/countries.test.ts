import { describe, expect, it } from 'vitest'
import { countryName, outrosLabel, rollUpCountries } from '../countries'

const c = (country: string, orders: number, revenue: number, contribution: number, metaSpend = 0, purchases = 0) => ({
  country, orders, revenue, variableCosts: revenue - contribution, contribution, metaSpend, metaPurchaseValue: 0, purchases,
})

describe('rollUpCountries', () => {
  const countries = [
    c('US', 300, 30000, 12000, 9000, 250),
    c('GB', 40, 4000, 1500, 1000, 50),
    c('DE', 20, 2500, 900, 300, 5),
    c('IT', 5, 600, 200),
    c('??', 1, 50, 20),
    c('CD', 0, 0, 0, 120, 3),
  ]
  const storeRevenue = countries.reduce((s, x) => s + x.revenue, 0)

  it('keeps the top countries and sums the rest into "outros", so the table adds up to the store', () => {
    const rows = rollUpCountries(countries, storeRevenue, 3)
    expect(rows.map(r => r.country)).toEqual(['US', 'GB', 'DE', 'outros'])
    const sum = (k: 'orders' | 'revenue' | 'contribution' | 'variableCosts') => rows.reduce((s, r) => s + r[k], 0)
    expect(sum('orders')).toBe(366)
    expect(sum('revenue')).toBe(storeRevenue)
    expect(sum('contribution')).toBe(14620)
    expect(rows[3].mergedCountries).toBe(3)
    expect(rows[3].name).toBe('Outros 2 países · +1 só com gasto do Meta')
    expect(rows[3].meta.spend).toBe(120)
  })

  it('reports Meta capture as purchases over real orders, never derived ROAS', () => {
    const rows = rollUpCountries(countries, storeRevenue, 10)
    const us = rows.find(r => r.country === 'US')!
    expect(us.meta.capturePct).toBeCloseTo((250 / 300) * 100)
    expect(rows.find(r => r.country === 'CD')!.meta.capturePct).toBeNull()
    expect(us).not.toHaveProperty('roas')
  })

  it('flags small samples and names countries in Portuguese', () => {
    const rows = rollUpCountries(countries, storeRevenue, 10)
    expect(rows.find(r => r.country === 'GB')!.smallSample).toBe(false)
    expect(rows.find(r => r.country === 'DE')!.smallSample).toBe(true)
    expect(rows.find(r => r.country === 'US')!.name).toBe('Estados Unidos')
    expect(countryName('??')).toBe('País desconhecido')
  })

  it('never throws or echoes a raw code: anything Intl cannot name is "País desconhecido"', () => {
    // Intl.DisplayNames.of('UNKNOWN') throws; the raw code used to come back as the name.
    for (const code of ['unknown', 'UNKNOWN', '??', 'XX', 'ZZ', 'AA', 'A1', '', '  ']) {
      expect(countryName(code), code).toBe('País desconhecido')
    }
    expect(countryName('us')).toBe('Estados Unidos')
    expect(countryName(' de ')).toBe('Alemanha')
    expect(countryName('PR')).toBe('Porto Rico')
  })

  it('drops a country with nothing in it and keeps one Meta spent on', () => {
    // Hibikura 7 dias: Meta's "unknown" bucket came back all zeros and showed
    // as "País desconhecido · 0 pedidos · $0" with a "poucos pedidos" chip.
    const rows = rollUpCountries([c('JP', 77, 6118, 4561, 3339, 70), c('unknown', 0, 0, 0, 0), c('CD', 0, 0, 0, 50)], 6118, 5)
    expect(rows.map(r => r.country)).toEqual(['JP', 'CD'])
    // A row with only purchases, purchase value or a cost still counts: dropping it would break the sum.
    expect(rollUpCountries([c('BR', 0, 0, -3), c('AR', 0, 0, 0, 0, 1)], 0, 5).map(r => r.country).sort()).toEqual(['AR', 'BR'])
  })

  it('names "outros" after the countries that had orders, not the ones where only Meta spent', () => {
    // MOKOO 7 dias: "Outros 223 países · 14 pedidos" summed 9 countries with orders and 214 Meta-only ones.
    const tail = [
      ...Array.from({ length: 9 }, (_, i) => c(`O${i}`, i < 5 ? 2 : 1, 50, 20, 5)),
      ...Array.from({ length: 214 }, (_, i) => c(`M${i}`, 0, 0, 0, 1)),
    ]
    const rows = rollUpCountries([c('US', 95, 7573, 5000, 1710, 24), ...tail], 8000, 1)
    const outros = rows[1]
    expect(outros.orders).toBe(14)
    expect(outros.name).toBe('Outros 9 países · +214 só com gasto do Meta')
    expect(outros).toMatchObject({ mergedCountries: 223, mergedWithOrders: 9 })
    expect(outrosLabel(3, 0)).toBe('Outros 3 países')
    expect(outrosLabel(1, 0)).toBe('Outros 1 país')
    expect(outrosLabel(0, 4)).toBe('4 países só com gasto do Meta')
  })
})
