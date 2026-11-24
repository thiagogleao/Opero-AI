import { describe, expect, it } from 'vitest'
import { clampLabel, dailyAxis, textWidth } from '../axis'

/** Every date from `from`, n days. */
function dates(from: string, n: number): string[] {
  const out: string[] = []
  const d = new Date(`${from}T12:00:00Z`)
  for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return out
}

/** The boxes of placed labels never overlap and never leave [left, right]. */
function assertClean(labels: { x: number; anchor: string; text: string }[], fs: number, left: number, right: number, font: 'mono' | 'sans' = 'mono') {
  const boxes = labels.map(l => {
    const w = textWidth(l.text, fs, font)
    const from = l.anchor === 'start' ? l.x : l.anchor === 'end' ? l.x - w : l.x - w / 2
    return { from, to: from + w }
  }).sort((a, b) => a.from - b.from)
  for (const b of boxes) {
    expect(b.from).toBeGreaterThanOrEqual(left - 0.001)
    expect(b.to).toBeLessThanOrEqual(right + 0.001)
  }
  for (let i = 1; i < boxes.length; i++) expect(boxes[i].from).toBeGreaterThanOrEqual(boxes[i - 1].to)
}

const W = 1000, L = 56, R = 992

describe('dailyAxis', () => {
  it('labels every day when there is room (7 days)', () => {
    const ds = dates('2026-11-11', 7)
    const ax = dailyAxis(ds, { x0: L, band: (R - L) / 7, right: R })
    expect(ax.days.map(l => l.text)).toEqual(['11', '12', '13', '14', '15', '16', '17'])
    expect(ax.months.map(l => l.text)).toEqual(['nov'])
  })

  it('thins 30–90 days without overlaps, keeps day 1 and names each month once', () => {
    for (const n of [31, 37, 60, 90, 120, 321]) {
      const ds = dates(shift('2026-11-18', -(n - 1)), n)
      const band = (R - L) / n
      const ax = dailyAxis(ds, { x0: L, band, right: R, partialIdx: n - 1 })
      assertClean(ax.days, 11, L, R)
      assertClean(ax.months, 10.5, L, R, 'sans')
      // "hoje" is always there, and inside the plot.
      expect(ax.days.find(l => l.i === n - 1)?.text).toBe('hoje')
      // Every month change is named exactly once, and its day 1 is labelled.
      for (const b of ax.boundaries) {
        expect(ax.months.filter(l => l.i === b)).toHaveLength(1)
        expect(ax.days.some(l => l.i === b) || b === n - 1).toBe(true)
      }
      expect(ax.months.every(l => l.i === 0 || ax.boundaries.includes(l.i))).toBe(true)
    }
  })

  it('keeps the phone chart clean too (30 days in 340 units)', () => {
    const ds = dates('2026-10-20', 30)
    const band = (332 - 44) / 30
    const ax = dailyAxis(ds, { x0: 44, band, right: 332, partialIdx: 29 })
    assertClean(ax.days, 11, 44, 332)
    assertClean(ax.months, 10.5, 44, 332, 'sans')
    expect(ax.days.some(l => l.text === '1')).toBe(true)
  })

  it('drops the first month name when the next month starts right after it', () => {
    const ds = dates('2026-10-30', 10) // 30 out, 31 out, 1 nov …
    const ax = dailyAxis(ds, { x0: L, band: 8, right: L + 80 })
    expect(ax.months.map(l => l.text)).toEqual(['nov'])
  })
})

// The two geometries the charts use: the desktop chart (1000 wide, 56 left and
// 8 right margins) and the phone column (340 wide, 44 and 8).
const GEOMETRIES = [
  { name: '1000', x0: 56, right: 992 },
  { name: '340', x0: 44, right: 332 },
] as const

describe('dailyAxis at long ranges (regression: 366 days read "1 dez 1 1 fev 1 1 abr")', () => {
  const month = (d: string) => Number(d.slice(5, 7)) - 1

  for (const g of GEOMETRIES) {
    for (const n of [30, 90, 180, 366, 730]) {
      // The Resumo draws the window plus up to 30 days before it.
      for (const len of [n, n + 30]) {
        it(`${len} days in ${g.name} units: clean rows, every month name regular, no bare day 1`, () => {
          const ds = dates(shift('2026-11-18', -(len - 1)), len)
          const band = (g.right - g.x0) / len
          const ax = dailyAxis(ds, { x0: g.x0, band, right: g.right, partialIdx: len - 1 })
          assertClean(ax.days, 11, g.x0, g.right)
          assertClean(ax.months, 10.5, g.x0, g.right, 'sans')
          expect(ax.days.find(l => l.i === len - 1)?.text).toBe('hoje')
          // Month names sit on month starts (or the first day), on one calendar step.
          for (const l of ax.months) {
            expect(l.i === 0 || ax.boundaries.includes(l.i)).toBe(true)
            if (l.i !== 0) expect(month(ds[l.i]) % ax.monthStep).toBe(0)
          }
          // Every month start on that step is named, except one pushed out at the right edge.
          const due = ax.boundaries.filter(i => month(ds[i]) % ax.monthStep === 0)
          const named = ax.months.filter(l => l.i !== 0).length
          expect(named === due.length || named === due.length - 1).toBe(true)
          // A day label "1" always has its month under it.
          for (const l of ax.days) {
            if (l.text === '1' && l.i !== 0) expect(ax.months.some(m => m.i === l.i)).toBe(true)
          }
          // The axis still says when: at least two month names from three months on.
          if (len >= 90) expect(ax.months.length).toBeGreaterThanOrEqual(2)
        })
      }
    }
  }

  it('a year on the desktop chart: every month named, no day numbers but "hoje"', () => {
    const len = 366 + 30
    const ds = dates(shift('2026-11-18', -(len - 1)), len)
    const ax = dailyAxis(ds, { x0: 56, band: 936 / len, right: 992, partialIdx: len - 1 })
    expect(ax.stride).toBe(0)
    expect(ax.monthStep).toBe(1)
    expect(ax.days.map(l => l.text)).toEqual(['hoje'])
    expect(ax.months.map(l => l.text)).toEqual(
      ['out', 'nov', 'dez', 'jan 2026', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov'])
  })

  it('a year in the phone column: one name per quarter, January with its year', () => {
    const len = 366 + 30
    const ds = dates(shift('2026-11-18', -(len - 1)), len)
    const ax = dailyAxis(ds, { x0: 44, band: 288 / len, right: 332, partialIdx: len - 1 })
    expect(ax.monthStep).toBe(3)
    expect(ax.days.map(l => l.text)).toEqual(['hoje'])
    expect(ax.months.map(l => l.text)).toEqual(['out', 'jan 2026', 'abr', 'jul', 'out'])
  })

  it('two years: every other month on the desktop, every half-year on the phone', () => {
    const len = 730
    const ds = dates(shift('2026-11-18', -(len - 1)), len)
    expect(dailyAxis(ds, { x0: 56, band: 936 / len, right: 992 }).monthStep).toBe(2)
    expect(dailyAxis(ds, { x0: 44, band: 288 / len, right: 332 }).monthStep).toBe(6)
  })

  it('short ranges keep their day numbers and every month name', () => {
    for (const [len, g] of [[37, GEOMETRIES[0]], [120, GEOMETRIES[0]], [210, GEOMETRIES[0]], [30, GEOMETRIES[1]], [90, GEOMETRIES[1]]] as const) {
      const ds = dates(shift('2026-11-18', -(len - 1)), len)
      const ax = dailyAxis(ds, { x0: g.x0, band: (g.right - g.x0) / len, right: g.right, partialIdx: len - 1 })
      expect(ax.stride).toBeGreaterThan(0)
      expect(ax.monthStep).toBe(1)
      expect(ax.days.filter(l => l.text !== 'hoje').length).toBeGreaterThan(ax.boundaries.length)
    }
  })
})

describe('clampLabel', () => {
  it('anchors a label at the right edge instead of spilling past it', () => {
    expect(clampLabel(W - 10, 40, L, R)).toMatchObject({ x: R, anchor: 'end' })
    expect(clampLabel(L + 2, 40, L, R)).toMatchObject({ x: L, anchor: 'start' })
    expect(clampLabel(500, 40, L, R)).toMatchObject({ x: 500, anchor: 'middle' })
  })
})

function shift(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`)
  d.setUTCDate(d.getUTCDate() + n)
  return d.toISOString().slice(0, 10)
}
