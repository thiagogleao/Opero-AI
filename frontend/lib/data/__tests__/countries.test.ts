import { describe, expect, it } from 'vitest'
import { countryName, rollUpCountries } from '../countries'

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
    expect(rows[3].name).toBe('Outros 3 países')
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
    expect(countryName('??')).toBe('Desconhecido')
  })

  it('ranks a country Meta spends on without sales above one with neither', () => {
    const rows = rollUpCountries([c('AA', 0, 0, 0, 0), c('CD', 0, 0, 0, 50)], 0, 5)
    expect(rows[0].country).toBe('CD')
  })
})
