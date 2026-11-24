import { describe, expect, it } from 'vitest'
import { bandLabelFits } from '../ProfitChartBlock'
import { formatMoney } from '@/lib/format'

// 31 bars on 936 units: the band of the last bar starts at x 975,8.
const series = (n: number, windowFrom: number) =>
  Array.from({ length: n }, (_, i) => ({ inWindow: i >= windowFrom }))

describe('bandLabelFits', () => {
  it('a label past the right edge does not fit; one well inside does', () => {
    expect(bandLabelFits(series(31, 30), '16 nov · $239')).toBe(false)
    expect(bandLabelFits(series(31, 0), '1–31 out · $12.345')).toBe(true)
  })

  it('no window bar: nothing to place, so it fits', () => {
    expect(bandLabelFits(series(5, 99), 'qualquer coisa')).toBe(true)
  })

  // formatMoney glues a negative sign to its "$" with an invisible word
  // joiner (U+2060). Counted as a character, it cost 6 units and hid a label
  // that still fit.
  it('the word joiner of a negative sum takes no room', () => {
    const negative = `16 nov · ${formatMoney(-239)}`
    expect(negative).toContain('⁠')
    const visible = negative.replace(/⁠/g, '')
    // A band whose visible label fits by less than one character (6 units).
    let found: { n: number; first: number } | null = null
    for (let n = 10; n <= 200 && !found; n++) {
      const bar = (1000 - 56 - 8) / n
      for (let first = 0; first < n; first++) {
        const end = 56 + first * bar + 8 + visible.length * 6
        if (end <= 992 && end + 6 > 992) { found = { n, first }; break }
      }
    }
    expect(found).not.toBeNull()
    expect(bandLabelFits(series(found!.n, found!.first), visible)).toBe(true)
    expect(bandLabelFits(series(found!.n, found!.first), negative)).toBe(true)
    // One more visible character does not fit there.
    expect(bandLabelFits(series(found!.n, found!.first), `${visible}0`)).toBe(false)
  })
})
