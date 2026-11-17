import { describe, expect, it } from 'vitest'
import fs from 'node:fs'
import path from 'node:path'
import { geoCountry, localDay, mapLineItems, mapOrder, MissingRate, parseTs } from '../orderMapping'

// The same fixture app/tests/test_mapping.py asserts for the Python collector:
// the webhook and the collector must write the same row.
const FIX = path.resolve(__dirname, '../../../../app/tests/fixtures')
const order = JSON.parse(fs.readFileSync(path.join(FIX, 'order_jpy.json'), 'utf8'))
const expected = JSON.parse(fs.readFileSync(path.join(FIX, 'order_jpy_expected.json'), 'utf8'))
const rateFor = (d: string | null) => (d === expected.rate_day ? expected.rate : null)

describe('mapOrder (twin of shopify_mapping.map_order)', () => {
  it('matches the shared fixture', () => {
    const row = mapOrder(order, rateFor) as unknown as Record<string, unknown>
    expect(Object.keys(row).sort()).toEqual(Object.keys(expected.order).sort())
    for (const [k, v] of Object.entries(expected.order)) {
      if (typeof v === 'number' && typeof row[k] === 'number') expect(row[k] as number).toBeCloseTo(v, 6)
      else expect(row[k], k).toEqual(v)
    }
  })

  it('maps line items like the collector', () => {
    const rows = mapLineItems(order, rateFor) as unknown as Record<string, unknown>[]
    expect(rows).toHaveLength(expected.items.length)
    rows.forEach((r, i) => {
      for (const [k, v] of Object.entries(expected.items[i])) {
        if (typeof v === 'number') expect(r[k] as number).toBeCloseTo(v as number, 6)
        else expect(r[k], k).toEqual(v)
      }
    })
  })

  it('refuses a foreign-currency order without a rate', () => {
    expect(() => mapOrder(order, () => null)).toThrow(MissingRate)
  })

  it('leaves a USD order unconverted and keeps billing as country_code', () => {
    const row = mapOrder({ ...order, currency: 'USD' }, () => null)
    expect(row.total_price).toBe(12750)
    expect(row.fx_rate).toBeNull()
    expect(row.country_code).toBe('JP')
    expect(row.geo_country_code).toBe('PR')
  })

  it('falls back to billing when there is no shipping address', () => {
    const row = mapOrder({ ...order, shipping_address: null }, rateFor)
    expect(row.geo_country_code).toBe('JP')
    expect(row.province_code).toBe('JP-13')
  })
})

describe('helpers', () => {
  it('splits US territories out of US', () => {
    for (const p of ['PR', 'VI', 'GU', 'AS', 'MP', 'UM']) expect(geoCountry('US', p)).toBe(p)
    expect(geoCountry('US', 'NY')).toBe('US')
    expect(geoCountry('de', null)).toBe('DE')
    expect(geoCountry(null, 'PR')).toBeNull()
  })
  it('reads the shop-local day off the timestamp', () => {
    expect(localDay('2026-11-10T23:30:00-03:00')).toBe('2026-11-10')
    expect(localDay('nope')).toBeNull()
  })
  it('normalises timestamps to UTC', () => {
    expect(parseTs('2026-11-10T08:15:00+09:00')).toBe('2026-11-09T23:15:00+00:00')
    expect(parseTs(null)).toBeNull()
  })
})
