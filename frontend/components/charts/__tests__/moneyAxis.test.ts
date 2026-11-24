import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { formatMoneyAxis } from '@/lib/format'
import { DailyProfitBars } from '../DailyProfitBars'
import { IntradayCurve } from '../IntradayCurve'
import { niceStep, niceTicks } from '../scale'

// Regression: a small-spend ad (creative 120248861708030625, MOKOO, 7 days)
// drew ticks −2, −1,5, −1, −0,5, 0 and the axis read "−$2 | −$2 | −$1 | −$1
// | $0"; with ?parte=50 ticks every 0,2 read "−$1 | −$1 | −$1 | $0 | $0 | $0".
const labels = (lo: number, hi: number, count: number) => {
  const t = niceTicks(lo, hi, count)
  return t.map(v => formatMoneyAxis(v, t))
}
const allDistinct = (xs: string[]) => new Set(xs).size === xs.length

describe('formatMoneyAxis', () => {
  it('keeps whole dollars when every tick is a whole dollar', () => {
    const t = [-800, -400, 0, 400, 800, 1200]
    expect(t.map(v => formatMoneyAxis(v, t))).toEqual(['−\u2060$800', '−\u2060$400', '$0', '$400', '$800', '$1.200'])
  })

  it('shows cents on every tick once one tick has cents', () => {
    const t = [-2, -1.5, -1, -0.5, 0]
    expect(t.map(v => formatMoneyAxis(v, t))).toEqual(['−\u2060$2,00', '−\u2060$1,50', '−\u2060$1,00', '−\u2060$0,50', '$0'])
  })

  it('without the ticks, the value decides alone and never reads as its neighbour', () => {
    expect(formatMoneyAxis(-1.5)).toBe('−\u2060$1,50')
    expect(formatMoneyAxis(-2)).toBe('−\u2060$2')
    expect(formatMoneyAxis(-0.2)).toBe('−\u2060$0,20')
    expect(formatMoneyAxis(1200)).toBe('$1.200')
  })

  it('zero is "$0" either way (no "$0,00", no sign)', () => {
    expect(formatMoneyAxis(0, [-0.5, 0, 0.5])).toBe('$0')
    expect(formatMoneyAxis(-0, [-1, 0])).toBe('$0')
    expect(formatMoneyAxis(0.001)).toBe('$0')
  })
})

describe('niceTicks + formatMoneyAxis: each tick reads its own value', () => {
  it.each([
    [-1.77, 0, 5, ['−\u2060$2,00', '−\u2060$1,50', '−\u2060$1,00', '−\u2060$0,50', '$0']],
    [-0.89, 0, 5, ['−\u2060$1,00', '−\u2060$0,80', '−\u2060$0,60', '−\u2060$0,40', '−\u2060$0,20', '$0']],
    [-2.73, 0, 4, ['−\u2060$3', '−\u2060$2', '−\u2060$1', '$0']],
    [-3.5, 1.2, 5, ['−\u2060$4', '−\u2060$3', '−\u2060$2', '−\u2060$1', '$0', '$1', '$2']],
  ] as const)('range %d..%d (%d ticks)', (lo, hi, n, want) => {
    expect(labels(lo, hi, n)).toEqual(want)
  })

  it('never repeats a label, at any scale from a cent to thousands', () => {
    for (let span = 0.004; span < 50000; span *= 1.17) {
      for (const n of [4, 5]) {
        for (const lo of [-span, -span / 3, 0]) {
          const got = labels(lo, lo + span, n)
          expect(allDistinct(got), `${lo}..${lo + span} (${n}): ${got.join(' | ')}`).toBe(true)
        }
      }
    }
  })
})

describe('niceStep', () => {
  it('a step of a dollar or more is a whole number of dollars (no 2,5)', () => {
    for (let span = 1; span < 100000; span *= 1.07) {
      for (const n of [4, 5]) {
        const s = niceStep(span, n)
        if (s >= 1) expect(Number.isInteger(s), `${span}/${n} → ${s}`).toBe(true)
      }
    }
    expect(niceStep(11, 5)).toBe(2) // was 2,5: "$3 | $5 | $8" for 2,5 / 5 / 7,5
    expect(niceStep(110, 5)).toBe(25)
  })

  it('a smaller step is a whole number of cents, never under one', () => {
    for (let span = 0.0001; span < 1; span *= 1.13) {
      const s = niceStep(span, 5)
      expect(s).toBeGreaterThanOrEqual(0.01)
      expect(Math.abs(s * 100 - Math.round(s * 100))).toBeLessThan(1e-9)
    }
  })
})

// A y tick is a grid <line> followed by its end-anchored label, in one <g>.
const axisText = (html: string) =>
  [...html.matchAll(/<g><line[^>]*>(?:<\/line>)?<text[^>]*text-anchor="end"[^>]*>([^<]*)<\/text><\/g>/g)].map(m => m[1])

describe('the charts label their axes with one format', () => {
  it('DailyProfitBars: a small ad (worst day −$1,58) and its 50% share', () => {
    const days = [
      { date: '2026-11-16', profit: -0.42, revenue: 0, metaSpend: 0.42, orders: 0 },
      { date: '2026-11-17', profit: -1.58, revenue: 0, metaSpend: 1.58, orders: 0 },
      { date: '2026-11-18', profit: -0.9, revenue: 0, metaSpend: 0.9, orders: 0 },
    ]
    const whole = axisText(renderToStaticMarkup(createElement(DailyProfitBars, { days, ariaLabel: 'x' })))
    expect(whole).toEqual(['−\u2060$2,00', '−\u2060$1,50', '−\u2060$1,00', '−\u2060$0,50', '$0'])
    const half = axisText(renderToStaticMarkup(createElement(DailyProfitBars, { days, share: 0.5, ariaLabel: 'x' })))
    expect(allDistinct(half)).toBe(true)
    expect(half).toContain('−\u2060$0,20')
  })

  it('DailyProfitBars: a normal store keeps whole dollars', () => {
    const days = [
      { date: '2026-11-16', profit: 380, revenue: 1990, metaSpend: 894, orders: 23 },
      { date: '2026-11-17', profit: -120, revenue: 900, metaSpend: 700, orders: 9 },
    ]
    const t = axisText(renderToStaticMarkup(createElement(DailyProfitBars, { days, ariaLabel: 'x' })))
    expect(t.every(l => !l.includes(','))).toBe(true)
    expect(t).toContain('$0')
  })

  it('IntradayCurve early in the day ($1,30 so far)', () => {
    const points = [
      { hour: 0, cumProfit: 0.4 },
      { hour: 1, cumProfit: 1.3 },
    ]
    const t = axisText(renderToStaticMarkup(createElement(IntradayCurve, { points, nowMinutes: 110, ariaLabel: 'x', showOrders: false })))
    expect(allDistinct(t)).toBe(true)
    expect(t).toEqual(['$0', '$0,50', '$1,00', '$1,50'])
  })
})
