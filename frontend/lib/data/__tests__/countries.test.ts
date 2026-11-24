import { describe, expect, it } from 'vitest'
import { captureDays, countryName, metaSplitCoverage, outrosLabel, rollUpCountries } from '../countries'

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

describe('capture on the days Meta split by country', () => {
  it('leaves out days with Meta spend and no split, or only part of one; keeps days without spend', () => {
    // MOKOO, October: 1 and 2 out had no split, 9 out had 2% of the spend in it.
    const daily = [
      { date: '2026-10-01', metaSpend: 1560.13 }, { date: '2026-10-03', metaSpend: 1517.26 },
      { date: '2026-10-09', metaSpend: 1002.4 }, { date: '2026-10-08', metaSpend: 2656.51 }, { date: '2026-10-10', metaSpend: 0 },
    ]
    const split = new Map([['2026-10-03', 1516.8], ['2026-10-09', 16.59], ['2026-10-08', 2650.38]])
    expect(captureDays(daily, split)).toEqual({
      comparable: ['2026-10-03', '2026-10-08', '2026-10-10'], partial: ['2026-10-09'], missing: ['2026-10-01'], comparableSpendDays: 2,
    })
  })

  it('divides the purchases of the comparable days by the orders of the same days', () => {
    // US, MOKOO October: 179 purchases over 373 orders read "Captura 48%" with
    // the split covering 52% of the spend; on the comparable days it is 154 of 177.
    const us = { ...c('US', 373, 30000, 12000, 9000, 179), captureOrders: 177, capturePurchases: 154 }
    const gb = { ...c('GB', 63, 4000, 1500, 1000, 26), captureOrders: 28, capturePurchases: 22 }
    const de = { ...c('DE', 41, 2500, 900, 300, 21), captureOrders: 21, capturePurchases: 19 }
    const rows = rollUpCountries([us, gb, de], 36500, 1)
    expect(rows[0].meta).toMatchObject({ purchases: 179, captureOrders: 177, capturePurchases: 154 })
    expect(rows[0].meta.capturePct).toBeCloseTo((154 / 177) * 100)
    // "outros" sums the capture's own figures, not the window's.
    expect(rows[1].meta).toMatchObject({ purchases: 47, captureOrders: 49, capturePurchases: 41 })
    expect(rows[1].meta.capturePct).toBeCloseTo((41 / 49) * 100)
    // No comparable day with spend: both sides 0, so no capture rather than 0%.
    expect(rollUpCountries([{ ...c('US', 10, 900, 300, 50, 4), captureOrders: 0, capturePurchases: 0 }], 900, 5)[0].meta.capturePct).toBeNull()
  })
})

describe('metaSplitCoverage', () => {
  it('sums the split over the window and names the days it misses or only partly holds', () => {
    const daily = [
      { date: '2026-11-17', metaSpend: 100 }, { date: '2026-11-18', metaSpend: 100 },
      { date: '2026-11-19', metaSpend: 0 }, { date: '2026-11-20', metaSpend: 80 },
    ]
    // 18 nov has no split; 20 nov only half; a day outside the window is ignored.
    const split = new Map([['2026-11-17', 99.5], ['2026-11-20', 40], ['2026-11-25', 999]])
    const c = metaSplitCoverage(daily, split, 280)
    expect(c).toEqual({ coveredSpend: 139.5, totalSpend: 280, coveragePct: (139.5 / 280) * 100, missingDays: ['2026-11-18'], partialDays: ['2026-11-20'] })
    // MOKOO, 17–23 nov: no split at all.
    expect(metaSplitCoverage(daily, new Map(), 280)).toMatchObject({ coveredSpend: 0, missingDays: ['2026-11-17', '2026-11-18', '2026-11-20'] })
  })
})
