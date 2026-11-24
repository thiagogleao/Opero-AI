import { describe, expect, it } from 'vitest'
import { sumPnL, type DayPnL, type PnLLines } from '../../engine/pnl'
import { activeDayIn, dayActive } from '../insights/readable'
import { nothingToRead } from '../insights/facts'
import { totalsView } from '../views'

// The Resumo asks up front whether the AI reading would be refused (Glooty
// 20–23 nov, Squishy World after archiving: "Gerar leitura" could only come
// back as no_data). The cheap test on the page's own days must agree with the
// server's activity rule (facts nothingToRead).

const day = (date: string, over: Partial<PnLLines> = {}): DayPnL => ({ date, ...sumPnL([{ ...sumPnL([]), ...over }]) })

describe('dayActive', () => {
  it('counts orders, sales, ad spend of either channel, refunds and chargebacks — not fixed costs', () => {
    expect(dayActive(day('2026-11-20'))).toBe(false)
    expect(dayActive(day('2026-11-20', { fixedCosts: 30 }))).toBe(false)
    expect(dayActive(day('2026-11-20', { revenue: 25, orders: 1 }))).toBe(true)
    expect(dayActive(day('2026-11-20', { metaSpend: 4 }))).toBe(true)
    expect(dayActive(day('2026-11-20', { shopSpend: 1 }))).toBe(true)
    expect(dayActive(day('2026-11-20', { refundCount: 1 }))).toBe(true)
    expect(dayActive(day('2026-11-20', { chargebackCount: 1 }))).toBe(true)
    expect(dayActive(day('2026-11-20', { metaSpend: 0.004 }))).toBe(false)
  })

  it('agrees with the server rule on the same totals', () => {
    for (const over of [{}, { fixedCosts: 30 }, { metaSpend: 4 }, { refundCount: 1 }, { revenue: 9, orders: 1 }] as Partial<PnLLines>[]) {
      const d = day('2026-11-20', over)
      expect(dayActive(d)).toBe(!nothingToRead({ totals: totalsView(d, true), previousTotals: null }))
    }
  })
})

describe('activeDayIn', () => {
  const days = [day('2026-11-19', { revenue: 50, orders: 1 }), day('2026-11-20'), day('2026-11-21'), day('2026-11-24', { metaSpend: 9 })]
  it('looks only at the days inside the AI window', () => {
    // Glooty: the page shows 20–24 nov, the AI reads 20–23 (closed days).
    expect(activeDayIn(days, { from: '2026-11-20', to: '2026-11-23' })).toBe(false)
    expect(activeDayIn(days, { from: '2026-11-19', to: '2026-11-23' })).toBe(true)
    expect(activeDayIn(days, { from: '2026-11-20', to: '2026-11-24' })).toBe(true)
    expect(activeDayIn([], { from: '2026-11-20', to: '2026-11-23' })).toBe(false)
  })
})
