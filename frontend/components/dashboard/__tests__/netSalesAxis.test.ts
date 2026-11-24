import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { textWidth } from '@/components/charts'
import { NetSalesBars, type NetDay } from '../NetSalesBars'

// A y tick is a grid <line> followed by its end-anchored label, in one <g>
// (the day columns are <g>s that open with a hit <rect>, never a <line>).
// The text is compared as read: lib/format may glue a sign to its "$" with an
// invisible word joiner (U+2060), which draws nothing.
const ticks = (html: string) =>
  [...html.matchAll(/<g><line[^>]*>(?:<\/line>)?<text x="([^"]+)"[^>]*text-anchor="end"[^>]*>([^<]*)<\/text><\/g>/g)]
    .map(m => ({ x: Number(m[1]), text: m[2].replace(/⁠/g, '') }))
const render = (days: NetDay[], share?: number) =>
  ticks(renderToStaticMarkup(createElement(NetSalesBars, { days, share, ariaLabel: 'x' })))
const day = (date: string, value: number): NetDay => ({ date, value, revenue: Math.max(0, value), adSpend: Math.max(0, -value), orders: 0 })

describe('NetSalesBars y axis', () => {
  it('labels every tick of a small-value axis in one format (cents on all of them)', () => {
    // Ticks −2, −1,5, −1, −0,5, 0 used to read "−$2 | −$1,50 | −$1 | −$0,50 | $0".
    const t = render([day('2026-11-16', -0.42), day('2026-11-17', -1.58), day('2026-11-18', -0.9)])
    expect(t.map(l => l.text)).toEqual(['−$2,00', '−$1,50', '−$1,00', '−$0,50', '$0'])
  })

  it('keeps whole dollars on a normal axis, with "$0" at zero', () => {
    const t = render([day('2026-11-16', 380), day('2026-11-17', -120)]).map(l => l.text)
    expect(t.every(l => !l.includes(','))).toBe(true)
    expect(t).toContain('$0')
    expect(new Set(t).size).toBe(t.length)
  })

  it('the partner share keeps one format and distinct labels', () => {
    const t = render([day('2026-11-16', -0.42), day('2026-11-17', -1.58)], 0.5).map(l => l.text)
    expect(new Set(t).size).toBe(t.length)
    expect(t.filter(l => l !== '$0').every(l => l.includes(','))).toBe(true)
  })

  it('makes room for the widest label instead of hanging it past the left edge', () => {
    // "−$20.000" is ~53 units wide: from a fixed 56 margin (label ending at
    // x = 46) it started at about −7.
    const t = render([day('2026-11-16', -9500), day('2026-11-17', 21000)])
    expect(t.some(l => l.text === '−$20.000')).toBe(true)
    for (const l of t) expect(l.x - textWidth(l.text, 11), l.text).toBeGreaterThanOrEqual(0)
    // A small axis keeps the usual 56 (label at 46).
    expect(render([day('2026-11-16', 80), day('2026-11-17', -40)])[0].x).toBe(46)
  })
})
