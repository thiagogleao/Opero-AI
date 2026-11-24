import { describe, expect, it } from 'vitest'
import { formatMoney, formatMoneyAxis, formatPct, formatPp, formatSignedMoney, MINUS, SIGN_JOIN } from '../format'

// Regression: at 390 px the EPOCH verdict (25 out – 23 nov) read "…16
// reembolsos e 10 chargebacks: −" with "$2.134 no caixa" on the next line. A
// sign and "$" are both numeric-prefix characters for line breaking (UAX #14
// class PR) and nothing keeps two of them together; a word joiner does.
const NEG = MINUS + SIGN_JOIN
const POS = '+' + SIGN_JOIN

/** Characters of line-break class PR that formatMoney can put side by side. */
const PREFIX = new Set([MINUS, '+', '$'])

/** True when two prefix characters touch with nothing gluing them. */
const breakableSign = (s: string) => [...s].some((c, i, a) => i > 0 && PREFIX.has(a[i - 1]) && PREFIX.has(c))

describe('formatMoney keeps the sign with the number', () => {
  it('glues the sign to the "$" with an invisible word joiner (U+2060)', () => {
    expect(SIGN_JOIN.codePointAt(0)).toBe(0x2060)
    expect(SIGN_JOIN.length).toBe(1)
    expect(formatMoney(-2134.4)).toBe(`${NEG}$2.134`)
    expect(formatMoney(-9.8)).toBe(`${NEG}$9,80`)
    expect(formatMoney(-201.18, { cents: 'always' })).toBe(`${NEG}$201,18`)
    expect(formatSignedMoney(1313.07)).toBe(`${POS}$1.313`)
    expect(formatMoney(35.65, { sign: true })).toBe(`${POS}$35,65`)
  })

  it('adds nothing where there is no sign', () => {
    expect(formatMoney(2203)).toBe('$2.203')
    expect(formatMoney(9.8)).toBe('$9,80')
    expect(formatMoney(0)).toBe('$0')
    expect(formatMoney(-0.004)).toBe('$0')
    expect(formatSignedMoney(0)).toBe('$0')
    expect(formatMoney(null)).toBe('—')
  })

  it('reads the same once the joiner is taken out (it draws nothing)', () => {
    expect(formatMoney(-2134.4).replace(SIGN_JOIN, '')).toBe('−$2.134')
    expect(formatSignedMoney(1313.07).replace(SIGN_JOIN, '')).toBe('+$1.313')
  })

  it('never leaves a sign and "$" breakable, at any size, sign or axis', () => {
    const values: number[] = [0]
    for (let m = 0.003; m < 300000; m *= 1.37) values.push(m, -m)
    for (const v of values) {
      for (const cents of ['auto', 'always', 'never'] as const) {
        expect(breakableSign(formatMoney(v, { cents })), `${v} ${cents}`).toBe(false)
        expect(breakableSign(formatSignedMoney(v, { cents })), `${v} ${cents} signed`).toBe(false)
      }
      expect(breakableSign(formatMoneyAxis(v, [v, v / 2, 0])), `${v} axis`).toBe(false)
    }
  })

  it('percentages need no joiner: a sign before a digit does not break', () => {
    expect(formatPct(-12)).toBe('−12,0%')
    expect(formatPct(12, { sign: true })).toBe('+12,0%')
    expect(formatPp(-2.3)).toBe('−2,3 p.p.')
  })
})
