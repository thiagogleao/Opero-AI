import { describe, expect, it } from 'vitest'
import { restLine, topBars, unpricedLine, TOP_BARS } from '../topBars'

const list = (n: number) => Array.from({ length: n }, (_, i) => i)

describe('topBars', () => {
  it('draws the first eight, or all nine when only one would be left', () => {
    expect(topBars(list(3))).toEqual([0, 1, 2])
    expect(topBars(list(TOP_BARS))).toHaveLength(8)
    // Dumpling Squishy · hzsjyp, 11–17 nov: nine products.
    expect(topBars(list(9))).toHaveLength(9)
    expect(topBars(list(10))).toHaveLength(8)
  })
})

describe('restLine', () => {
  it('agrees in number with what is left', () => {
    expect(restLine(0, 0)).toBeNull()
    // A product with no contribution (not in the bars) can still be the only one left.
    expect(restLine(1, 9.83)).toBe('O outro produto soma $9,83.')
    expect(restLine(2, 1313)).toBe('Os outros 2 produtos somam $1.313.')
    expect(restLine(1234, 5000)).toBe('Os outros 1.234 produtos somam $5.000.')
  })
})

describe('unpricedLine', () => {
  it('names the products of stores without costs apart from the rest line', () => {
    // Todas · Este mês: 192 products, 8 bars, 5 Glooty rows without costs —
    // the rest line counts the 179 priced ones, these 5 are said apart.
    expect(unpricedLine(5, ['Glooty'])).toBe('Fora das barras: 5 produtos da Glooty, sem custos configurados.')
    expect(unpricedLine(1, ['Glooty'])).toBe('Fora das barras: 1 produto da Glooty, sem custos configurados.')
    expect(unpricedLine(2, [])).toBe('Fora das barras: 2 produtos, sem custos configurados.')
    expect(unpricedLine(0, ['Glooty'])).toBeNull()
  })
})
