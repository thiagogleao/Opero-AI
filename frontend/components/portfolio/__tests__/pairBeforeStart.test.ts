import { describe, expect, it } from 'vitest'
import { pairBeforeSalesStart, pairBeforeStartText } from '../model'

// Regression: Todas, 1 dez 2025 – 30 abr 2026. CAMP HALLOW (first sale 24 jul
// 2026) read "sem gasto em anúncio · antes vendia com anúncios pagos pela
// EPOCH", and the pair note "o resultado deste período não está misturado.
// Para períodos anteriores, some as duas lojas" — a past in the window's future.

describe('pairBeforeSalesStart', () => {
  it('is a window that ends before the sales store\'s first sale', () => {
    expect(pairBeforeSalesStart('2026-07-24', { from: '2025-12-01', to: '2026-04-30' })).toBe(true)
    expect(pairBeforeSalesStart('2026-07-24', { from: '2026-07-01', to: '2026-07-23' })).toBe(true)
  })
  it('is not a window that reaches the first sale, nor an unknown one', () => {
    expect(pairBeforeSalesStart('2026-07-24', { from: '2026-07-01', to: '2026-07-24' })).toBe(false)
    expect(pairBeforeSalesStart('2026-07-24', { from: '2026-11-17', to: '2026-11-23' })).toBe(false)
    expect(pairBeforeSalesStart(null, { from: '2025-12-01', to: '2026-04-30' })).toBe(false)
    expect(pairBeforeSalesStart(undefined, { from: '2025-12-01', to: '2026-04-30' })).toBe(false)
  })
})

describe('pairBeforeStartText', () => {
  it('says the store did not sell yet, with no "antes" and no "períodos anteriores"', () => {
    const t = pairBeforeStartText('CAMP HALLOW', '24 jul 2026', '1 dez 2025 – 30 abr 2026')
    expect(t).toBe('Em 1 dez 2025 – 30 abr 2026, a CAMP HALLOW ainda não vendia (1ª venda em 24 jul 2026): nada deste período está misturado.')
    expect(t).not.toMatch(/antes vendia|períodos anteriores/)
  })
})
