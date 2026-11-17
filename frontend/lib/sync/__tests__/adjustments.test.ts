import { describe, expect, it } from 'vitest'
import { localDate, toUsd } from '../../adjustments'

const noRate = async () => null
const rate = (r: Record<string, number>) => async (c: string) => r[c] ?? null

describe('adjustment dates', () => {
  it('uses the store calendar, not UTC', () => {
    // 22:30 in São Paulo is already the next day in UTC.
    expect(localDate('2026-11-10T22:30:00-03:00', 'America/Sao_Paulo')).toBe('2026-11-10')
    // 08:00 in Tokyo is still the previous day in UTC.
    expect(localDate('2026-11-10T08:00:00+09:00', 'Asia/Tokyo')).toBe('2026-11-10')
    expect(localDate('2026-11-09T23:00:00Z', 'Asia/Tokyo')).toBe('2026-11-10')
    expect(localDate(null, 'UTC')).toBeNull()
  })
})

describe('toUsd', () => {
  const day = '2026-11-10'
  it('keeps dollars as they are', async () => {
    expect(await toUsd({ amount: 49.9, currency: 'USD', kind: 'refund', day, order: null, rateFor: noRate })).toBe(49.9)
  })
  it('converts a yen refund with the rate its order used', async () => {
    const order = { totalUsd: 82.88, currency: 'JPY', fxRate: 0.0065 }
    expect(await toUsd({ amount: 12750, currency: 'JPY', kind: 'refund', day, order, rateFor: noRate })).toBe(82.88)
  })
  it('converts a yen refund of an unknown order with the day rate, and refuses without one', async () => {
    expect(await toUsd({ amount: 10000, currency: 'JPY', kind: 'refund', day, order: null, rateFor: rate({ JPY: 0.0065 }) })).toBe(65)
    expect(await toUsd({ amount: 10000, currency: 'JPY', kind: 'refund', day, order: null, rateFor: noRate })).toBeNull()
  })
  it('values a foreign-currency dispute at its order total, as before', async () => {
    const order = { totalUsd: 65.77, currency: 'USD', fxRate: null }
    expect(await toUsd({ amount: 5886900, currency: 'LBP', kind: 'chargeback', day, order, rateFor: noRate })).toBe(65.77)
  })
  it('converts a dispute whose order we never imported instead of reading rupees as dollars', async () => {
    expect(await toUsd({ amount: 3600, currency: 'INR', kind: 'chargeback', day, order: null, rateFor: rate({ INR: 0.0119 }) })).toBe(42.84)
    expect(await toUsd({ amount: 3600, currency: 'INR', kind: 'chargeback', day, order: null, rateFor: noRate })).toBeNull()
  })
  it('a yen dispute on the yen store uses the order rate, not the order total', async () => {
    const order = { totalUsd: 82.88, currency: 'JPY', fxRate: 0.0065 }
    expect(await toUsd({ amount: 5000, currency: 'JPY', kind: 'chargeback', day, order, rateFor: noRate })).toBe(32.5)
  })
})
