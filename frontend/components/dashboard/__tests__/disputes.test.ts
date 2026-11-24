import { describe, expect, it } from 'vitest'
import { healthParts, rateWithoutPrevented, windowStatusText } from '../disputes'

describe('healthParts (regression: the 90-day breakdown left out the prevented disputes)', () => {
  it('names every status, so the parts add up to the count (CAMP HALLOW: 31)', () => {
    const parts = healthParts({ open: 7, lost: 5, won: 11, prevented: 8, other: 0 })
    expect(parts).toEqual(['7 em aberto', '5 perdidas', '11 ganhas', '8 evitadas'])
    expect(parts.reduce((a, p) => a + Number(p.split(' ')[0]), 0)).toBe(31)
  })

  it('keeps the three usual ones even at zero and adds the rest only when there are some', () => {
    expect(healthParts({ open: 0, lost: 1, won: 0 })).toEqual(['0 em aberto', '1 perdida', '0 ganhas'])
    expect(healthParts({ open: 1, lost: 0, won: 1, prevented: 1, other: 2 }))
      .toEqual(['1 em aberto', '0 perdidas', '1 ganha', '1 evitada', '2 em outra situação'])
  })

  it('counts of 1.000 or more get the separator', () => {
    expect(healthParts({ open: 1200, lost: 0, won: 0 })[0]).toBe('1.200 em aberto')
  })
})

describe('rateWithoutPrevented', () => {
  it('is the rate with the prevented ones left out (CAMP HALLOW 4,43% → 3,29%)', () => {
    expect(rateWithoutPrevented({ count: 31, orders: 700, prevented: 8 })).toBeCloseTo((23 / 700) * 100, 6)
  })
  it('says nothing when there are none, or no orders', () => {
    expect(rateWithoutPrevented({ count: 31, orders: 700, prevented: 0 })).toBeNull()
    expect(rateWithoutPrevented({ count: 31, orders: 700 })).toBeNull()
    expect(rateWithoutPrevented({ count: 3, orders: 0, prevented: 1 })).toBeNull()
  })
})

describe('windowStatusText (regression: "37 disputas abertas" over 14 lost, 7 prevented and 16 open)', () => {
  it('EPOCH, Mês passado: the costing parts add up to the 37 and the won ones are said apart', () => {
    expect(windowStatusText({ open: 16, lost: 14, won: 3, prevented: 7, other: 0 }))
      .toBe('Situação hoje: 16 em aberto · 14 perdidas · 7 evitadas. Mais 3 ganhas, que não custam nada.')
  })
  it('a recent window, all still open', () => {
    expect(windowStatusText({ open: 3, lost: 0, won: 0, prevented: 0, other: 0 })).toBe('Situação hoje: 3 em aberto.')
  })
  it('only won disputes arrived: nothing weighs, and it says why', () => {
    expect(windowStatusText({ open: 0, lost: 0, won: 1, prevented: 0, other: 0 })).toBe('1 disputa ganha no período: não custa nada.')
    expect(windowStatusText({ open: 0, lost: 0, won: 2, prevented: 0, other: 0 })).toBe('2 disputas ganhas no período: não custam nada.')
  })
  it('nothing arrived: no line', () => {
    expect(windowStatusText({ open: 0, lost: 0, won: 0, prevented: 0, other: 0 })).toBeNull()
  })
  it('REGRESSION: an archived store\'s status is the one read when it was archived, not "hoje"', () => {
    const sw = { on: '2026-11-10', today: '2026-11-24' }
    expect(windowStatusText({ open: 10, lost: 2, won: 1, prevented: 0, other: 0 }, sw))
      .toBe('Situação em 10 nov, quando a loja foi arquivada: 10 em aberto · 2 perdidas. Mais 1 ganha, que não custa nada. O estado das abertas pode ter mudado desde então.')
    expect(windowStatusText({ open: 1, lost: 0, won: 0, prevented: 0, other: 0 }, { on: null, today: '2026-11-24' }))
      .toBe('Situação quando a loja foi arquivada: 1 em aberto. O estado da aberta pode ter mudado desde então.')
    // Nothing open: nothing that may have moved.
    expect(windowStatusText({ open: 0, lost: 3, won: 0, prevented: 0, other: 0 }, sw)).toBe('Situação em 10 nov, quando a loja foi arquivada: 3 perdidas.')
  })
  it('one of each, singular', () => {
    expect(windowStatusText({ open: 1, lost: 1, won: 1, prevented: 1, other: 1 }))
      .toBe('Situação hoje: 1 em aberto · 1 perdida · 1 evitada · 1 em outra situação. Mais 1 ganha, que não custa nada.')
  })
})
