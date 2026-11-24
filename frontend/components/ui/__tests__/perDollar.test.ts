import { describe, expect, it } from 'vitest'
import { formatPerDollar, perDollarPhrase } from '../perDollar'

describe('formatPerDollar', () => {
  it('reads cents up to a dollar', () => {
    expect(formatPerDollar(40)).toBe('40¢')
    expect(formatPerDollar(0)).toBe('0¢')
    expect(formatPerDollar(-12)).toBe('−12¢')
    expect(formatPerDollar(99.4)).toBe('99¢')
  })

  it('reads dollars from a dollar on (Glooty: ads above sales)', () => {
    expect(formatPerDollar(99.6)).toBe('$1,00')
    expect(formatPerDollar(262)).toBe('$2,62')
    // The sign is glued to the "$" by a word joiner (lib/format SIGN_JOIN).
    expect(formatPerDollar(-162)).toBe('−\u2060$1,62')
    expect(formatPerDollar(524)).toBe('$5,24')
  })

  it('says per dollar sold in words', () => {
    expect(perDollarPhrase(40)).toBe('40¢ de cada $1 vendido')
    expect(perDollarPhrase(262)).toBe('$2,62 para cada $1 vendido')
  })
})
