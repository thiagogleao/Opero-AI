import { describe, expect, it } from 'vitest'
import { perDayRangeText } from '../StoreKpis'
import type { PageContext } from '@/lib/views/page'

// /?loja=<MOKOO>&de=2025-12-01&ate=2026-04-30 read "Receita $280 por dia em
// 11–30 abr" and "$185/dia em 18 fev – 30 abr" under the header
// "1 dez 2025 – 30 abr 2026"; today is 24 nov 2026.

type Ctx = Pick<PageContext, 'today' | 'range' | 'comparison'>
const cmp = (from: string, to: string) => ({
  from, to, label: '', sameTimeOfDay: false, cutoffMinutes: null, noBase: false,
  full: '', short: '', phrase: '', rangeText: '', cutText: null, none: null, partialBase: null, leftOut: [], fullBase: '', leftOutWhy: [],
})

describe('perDayRangeText', () => {
  const crossYear: Ctx = {
    today: '2026-11-24',
    range: { from: '2025-12-01', to: '2026-04-30' },
    comparison: cmp('2025-07-04', '2025-11-30'),
  }

  it('prints the year beside a cross-year window', () => {
    expect(perDayRangeText({ from: '2026-04-11', to: '2026-04-30' }, crossYear)).toBe('11–30 abr 2026')
    expect(perDayRangeText({ from: '2026-02-18', to: '2026-04-30' }, crossYear)).toBe('18 fev – 30 abr 2026')
  })

  it('does not print the year twice', () => {
    // formatRange already names both years when they differ…
    expect(perDayRangeText({ from: '2025-12-10', to: '2026-04-30' }, crossYear)).toBe('10 dez 2025 – 30 abr 2026')
    // …and a range wholly in another year than today's.
    expect(perDayRangeText({ from: '2025-12-10', to: '2025-12-31' }, crossYear)).toBe('10–31 dez 2025')
  })

  it('adds the year when only the comparison is in another year', () => {
    const jan: Ctx = { today: '2026-11-24', range: { from: '2026-01-01', to: '2026-01-31' }, comparison: cmp('2025-12-01', '2025-12-31') }
    expect(perDayRangeText({ from: '2026-01-07', to: '2026-01-31' }, jan)).toBe('7–31 jan 2026')
  })

  it('keeps the short form inside this year, and null for the whole window', () => {
    const nov: Ctx = { today: '2026-11-24', range: { from: '2026-11-01', to: '2026-11-24' }, comparison: cmp('2026-10-01', '2026-10-24') }
    expect(perDayRangeText({ from: '2026-11-07', to: '2026-11-23' }, nov)).toBe('7–23 nov')
    expect(perDayRangeText(null, nov)).toBeNull()
  })
})
