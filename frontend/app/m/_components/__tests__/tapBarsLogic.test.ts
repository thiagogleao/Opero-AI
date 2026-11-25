import { describe, expect, it } from 'vitest'
import {
  aggregateWeeks, chartColumns, daysToColumns, defaultHourPin, defaultPin, defaultWeekPin, hoursToColumns, indexFromX, isTap, layoutFor,
  daySentence, mondayOf, readoutChars, resolvePin, scaleOf, summaryLine, tapResult, type TapDay,
} from '../tapBarsLogic'
import { eachDay } from '@/lib/engine/dates'

// The phone's tap-to-pin charts (spec §4.2–§4.3): the pure rules behind the
// gestures, the layout and the readout.

const row = (date: string, profit: number, revenue = Math.max(0, profit * 3), orders = revenue > 0 ? 2 : 0) => ({
  date, operatingProfit: profit, revenue, orders, adSpend: 10, metaSpend: 8, shopSpend: 2,
  margin: revenue > 0 ? (profit / revenue) * 100 : null,
})

describe('layoutFor (fit vs strip, C15b)', () => {
  it('fits when every column gets ≥ 24 px: 7 dias at 326 px is 46-px columns, bars 60% of them (≤ 28)', () => {
    const l = layoutFor(7, 326)
    expect(l.mode).toBe('fit')
    expect(l.col).toBeCloseTo(46.57, 1)
    expect(l.bar).toBeCloseTo(27.94, 1)
  })
  it('13 columns still fit at 326 px; 14 (23,3 px, under the 24-px target) go to the 28-px strip', () => {
    expect(layoutFor(13, 326).mode).toBe('fit')
    expect(layoutFor(14, 326)).toEqual({ mode: 'strip', col: 28, bar: 16 })
    expect(layoutFor(15, 326)).toEqual({ mode: 'strip', col: 28, bar: 16 })
    expect(layoutFor(25, 326).mode).toBe('strip')
  })
  it('a lone column fills the width with a capped bar', () => {
    expect(layoutFor(1, 326)).toMatchObject({ mode: 'fit', bar: 28 })
  })
})

describe('indexFromX (the column under the finger)', () => {
  it('maps x to its column, edges included', () => {
    expect(indexFromX(0, 28, 25)).toBe(0)
    expect(indexFromX(27.9, 28, 25)).toBe(0)
    expect(indexFromX(28, 28, 25)).toBe(1)
    // 2 px inside column 17's left edge
    expect(indexFromX(17 * 28 + 2, 28, 25)).toBe(17)
  })
  it('clamps outside the track, and has nothing to hit in an empty series', () => {
    expect(indexFromX(-5, 28, 25)).toBe(0)
    expect(indexFromX(10_000, 28, 25)).toBe(24)
    expect(indexFromX(10, 28, 0)).toBe(-1)
  })
})

describe('isTap (a pan never pins)', () => {
  const g = { downIndex: 3, upIndex: 3, dx: 2, dy: 3, ms: 120, cancelled: false }
  it('a short still touch on one column is a tap', () => expect(isTap(g)).toBe(true))
  it('a still press held for a while is a tap too (never a silent no-op)', () => {
    expect(isTap({ ...g, ms: 650 })).toBe(true)
    expect(isTap({ ...g, ms: 3000 })).toBe(true)
  })
  it('movement of 8 px or more, a long press, another column or a pointercancel is not', () => {
    expect(isTap({ ...g, dx: 8 })).toBe(false)
    expect(isTap({ ...g, dy: -9 })).toBe(false)
    expect(isTap({ ...g, upIndex: 4 })).toBe(false)
    expect(isTap({ ...g, cancelled: true })).toBe(false)
  })
})

describe('default pin and the pin key (C17)', () => {
  const cols = (n: number, lastPartial: boolean) => Array.from({ length: n }, (_, i) => ({ key: `k${i}`, partial: lastPartial && i === n - 1 }))
  it('a window ending today: yesterday; a closed window: its last day; one column: that column', () => {
    expect(defaultPin(cols(25, true))).toBe(23)
    expect(defaultPin(cols(7, false))).toBe(6)
    expect(defaultPin(cols(1, true))).toBe(0)
    expect(defaultPin([])).toBe(-1)
  })
  it('the stored key survives a refresh while it exists, else the default', () => {
    expect(resolvePin(cols(25, true), 'k10')).toBe(10)
    expect(resolvePin(cols(25, true), 'gone')).toBe(23)
    expect(resolvePin(cols(25, true), null)).toBe(23)
  })
  it('tapping a column pins it; tapping the pinned one goes back to the default', () => {
    const c = cols(25, true)
    expect(tapResult(c, 23, 10)).toBe('k10')
    expect(tapResult(c, 10, 10)).toBeNull()
  })
  it('weeks: the latest whole week, not the running week nor a short tail', () => {
    expect(defaultWeekPin([{ key: '2026-11-09/2026-11-15', partial: false }, { key: '2026-11-16/2026-11-22', partial: false }, { key: '2026-11-23/2026-11-24', partial: false }])).toBe(1)
    expect(defaultWeekPin([{ key: '2026-11-16/2026-11-22', partial: false }, { key: '2026-11-23/2026-11-29', partial: true }])).toBe(0)
    expect(defaultWeekPin([{ key: '2026-11-16/2026-11-22', partial: false }])).toBe(0)
  })
  it('hours: the latest hour', () => expect(defaultHourPin([1, 2, 3])).toBe(2))
})

describe('daysToColumns', () => {
  it('profit mode keeps the engine margin; net mode is revenue − ads with no margin', () => {
    const rows = [row('2026-11-18', 50, 200), row('2026-11-19', -101, 1192)]
    const p = daysToColumns(rows, { mode: 'profit', partialDate: '2026-11-19', today: '2026-11-19' })
    expect(p[0]).toMatchObject({ key: '2026-11-18', label: 'qua, 18 nov', axis: '18', monthStart: 'nov', value: 50, margin: 25, partial: false })
    expect(p[1]).toMatchObject({ value: -101, partial: true, monthStart: undefined })
    const n = daysToColumns(rows, { mode: 'net' })
    expect(n[0]).toMatchObject({ value: 190, margin: null })
  })
  it('a day before the store\'s first sale is marked (C18)', () => {
    const empty = { ...row('2026-11-02', 0), adSpend: 0, metaSpend: 0, shopSpend: 0 }
    const c = daysToColumns([empty, row('2026-11-03', 0), row('2026-11-04', 10)], { mode: 'profit', firstOrderDate: '2026-11-04' })
    expect(c.map(x => !!x.notYet)).toEqual([true, false, false])
    // r1: ad spend ahead of the first order (Glooty 4–5 nov) keeps its numbers, tagged.
    expect(c.map(x => !!x.beforeFirst)).toEqual([false, true, false])
    expect(daySentence(c[1], 'profit')).toMatch(/antes da 1ª venda.*anúncios \$10/)
    expect(summaryLine(c, 'profit')).toMatch(/de 2 dias/)
  })
  it('names the month under the first column of each month', () => {
    const c = daysToColumns([row('2026-10-30', 1), row('2026-10-31', 1), row('2026-11-01', 1)], { mode: 'profit' })
    expect(c.map(x => x.monthStart)).toEqual(['out', undefined, 'nov'])
  })
})

describe('aggregateWeeks (90 dias and longer)', () => {
  const days: TapDay[] = daysToColumns(eachDay('2026-08-27', '2026-11-24').map((d, i) => row(d, i % 3 === 0 ? -20 : 40, 200)), { mode: 'profit', partialDate: '2026-11-24' })
  it('folds Monday–Sunday weeks, partial first and last weeks labelled by their real dates', () => {
    expect(mondayOf('2026-11-22')).toBe('2026-11-16') // a Sunday
    expect(mondayOf('2026-11-16')).toBe('2026-11-16')
    const w = aggregateWeeks(days, 'profit', '2026-11-24')
    expect(w[0].key).toBe('2026-08-27/2026-08-30') // Thu–Sun
    expect(w.find(x => x.key === '2026-11-16/2026-11-22')?.label).toBe('16–22 nov')
    expect(w[w.length - 1]).toMatchObject({ key: '2026-11-23/2026-11-24', partial: true })
  })
  it('adds money and orders; the margin is sumTotals\' Σprofit ÷ Σrevenue', () => {
    const w = aggregateWeeks(days, 'profit').find(x => x.key === '2026-11-16/2026-11-22')!
    const inWeek = days.filter(d => d.key >= '2026-11-16' && d.key <= '2026-11-22')
    const profit = inWeek.reduce((s, d) => s + d.value, 0)
    expect(w.value).toBe(profit)
    expect(w.revenue).toBe(1400)
    expect(w.orders).toBe(14)
    expect(w.adSpend).toBe(70)
    expect(w.margin).toBeCloseTo((profit / 1400) * 100, 10)
    expect(aggregateWeeks(days, 'net')[0].margin).toBeNull()
  })
  it('only past 62 days: 30 dias stays per day, 90 dias goes to 14 weeks (a 28-px strip: 23 px is under the target)', () => {
    expect(chartColumns(days.slice(-31), 'profit').unit).toBe('day')
    const w = chartColumns(days, 'profit')
    expect(w.unit).toBe('week')
    expect(w.cols.length).toBe(14)
    expect(layoutFor(w.cols.length, 326).mode).toBe('strip')
  })
})

describe('scaleOf (zero line)', () => {
  it('mixed signs place zero proportionally; all negative puts it at the top; zeros at the bottom', () => {
    expect(scaleOf([300, -100]).zero).toBeCloseTo(0.75)
    expect(scaleOf([-5, -10]).zero).toBe(0)
    expect(scaleOf([0, 0]).zero).toBe(1)
    expect(scaleOf([300, -100]).h(-100)).toBeCloseTo(0.25)
  })
})

describe('summaryLine (the numbers line under the bars)', () => {
  it('counts complete days in profit and names the best and worst', () => {
    const c = daysToColumns([row('2026-11-05', 1126), row('2026-11-08', -678), row('2026-11-09', 10), row('2026-11-10', 900)], { mode: 'profit', partialDate: '2026-11-10' })
    expect(summaryLine(c, 'profit')?.replace(/⁠/g, '')).toBe('2 de 3 dias no lucro · melhor qui, 5 nov $1.126 · pior dom, 8 nov −$678')
  })
  it('net mode says "acima de zero"', () => {
    const c = daysToColumns([row('2026-11-05', 1, 100), row('2026-11-06', 1, 0)], { mode: 'net' })
    expect(summaryLine(c, 'net')).toMatch(/^1 de 2 dias acima de zero/)
  })
})

describe('hoursToColumns (TapHours)', () => {
  it('one column per hour up to the last point, gaps carry the running totals, the last hour runs', () => {
    const h = hoursToColumns([
      { hour: 0, cumProfit: -5, cumRevenue: 0, revenue: 0, orders: 0 },
      { hour: 2, cumProfit: 20, cumRevenue: 80, revenue: 80, orders: 1 },
    ], true)
    expect(h.map(x => x.value)).toEqual([-5, -5, 20])
    expect(h[1]).toMatchObject({ revenue: 0, orders: 0, partial: false })
    expect(h[2].partial).toBe(true)
    expect(hoursToColumns([], true)).toEqual([])
  })
})

it('readout cells size their font from the longest value (at least 4 characters)', () => {
  expect(readoutChars(['$496', '28,8%'])).toBe(5)
  expect(readoutChars(['$11.171', '$4.692'])).toBe(7)
  expect(readoutChars(['−$12.345'])).toBe(8)
  expect(readoutChars(['7', '—'])).toBe(4)
})
