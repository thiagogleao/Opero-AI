import { describe, expect, it } from 'vitest'
import { monthLong, pctChange, readablePctChange } from '../format'

describe('readablePctChange (regression: "13.123% a mais" over a $1,89 base)', () => {
  it('is the plain percentage over a real base and a sane change', () => {
    expect(readablePctChange(250, 200)).toBeCloseTo(25, 9)
    expect(readablePctChange(1313.07, 1869.4)).toBeCloseTo(pctChange(1313.07, 1869.4)!, 9)
  })

  it('is null over a tiny base, a huge change or no base at all', () => {
    expect(pctChange(250, 1.89)).toBeGreaterThan(13000)
    expect(readablePctChange(250, 1.89)).toBeNull()
    expect(readablePctChange(300, 60)).toBeNull() // +400%
    expect(readablePctChange(100, 0)).toBeNull()
    expect(readablePctChange(100, -40)).toBeNull()
  })

  it('takes its own limits (a per-unit figure has no dollar floor)', () => {
    expect(readablePctChange(10, 8, { minBase: 0 })).toBeCloseTo(25, 9)
    expect(readablePctChange(40, 8, { minBase: 0 })).toBeNull() // +400%
  })
})

describe('monthLong', () => {
  it('names the month in full', () => {
    expect(monthLong('2026-10-01')).toBe('outubro')
    expect(monthLong('2026-03-31')).toBe('março')
  })
})
