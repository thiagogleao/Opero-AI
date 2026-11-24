import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { textWidth } from '@/components/charts'
import { NetBars, type NetDay } from '../NetBars'

// A y tick is a grid <line> followed by its end-anchored label, in one <g>.
const ticks = (html: string) =>
  [...html.matchAll(/<g><line[^>]*>(?:<\/line>)?<text x="([^"]+)"[^>]*text-anchor="end"[^>]*>([^<]*)<\/text><\/g>/g)]
    .map(m => ({ x: Number(m[1]), text: m[2] }))
const render = (days: NetDay[]) => ticks(renderToStaticMarkup(createElement(NetBars, { days, ariaLabel: 'x' })))
const day = (date: string, value: number): NetDay => ({
  date, value, revenue: Math.max(0, value), metaSpend: Math.max(0, -value), shopSpend: 0, orders: 0,
})

describe('NetBars (phone) y axis', () => {
  it('labels every tick of a small-value axis in one format (cents on all of them)', () => {
    // Ticks −2, −1,5, −1, −0,5, 0 used to read "−$2 | −$1,50 | −$1 | −$0,50 | $0".
    const t = render([day('2026-11-16', -0.42), day('2026-11-17', -1.58), day('2026-11-18', -0.9)])
    expect(t.map(l => l.text)).toEqual(['−$2,00', '−$1,50', '−$1,00', '−$0,50', '$0'])
  })

  it('keeps whole dollars on a normal axis and fits every label in the margin', () => {
    const t = render([day('2026-11-16', 380), day('2026-11-17', -1120)])
    expect(t.every(l => !l.text.includes(','))).toBe(true)
    expect(t.map(l => l.text)).toContain('$0')
    for (const l of t) expect(l.x - textWidth(l.text, 11), l.text).toBeGreaterThanOrEqual(0)
  })
})
