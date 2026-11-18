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
