import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DailyProfitBars } from '../DailyProfitBars'
import { IntradayCurve } from '../IntradayCurve'
import { rovingStop, rovingTarget } from '../roving'

describe('rovingTarget', () => {
  it('moves one point with ←/→ and clamps at the ends (no wrap)', () => {
    expect(rovingTarget('ArrowRight', 3, 10)).toBe(4)
    expect(rovingTarget('ArrowLeft', 3, 10)).toBe(2)
    expect(rovingTarget('ArrowRight', 9, 10)).toBe(9)
    expect(rovingTarget('ArrowLeft', 0, 10)).toBe(0)
  })

  it('jumps with Home/End', () => {
    expect(rovingTarget('Home', 5, 10)).toBe(0)
    expect(rovingTarget('End', 5, 10)).toBe(9)
  })

  it('leaves every other key alone (↑/↓ keep scrolling the page, Tab leaves)', () => {
    for (const k of ['ArrowUp', 'ArrowDown', 'Tab', 'Enter', ' ', 'a']) expect(rovingTarget(k, 2, 10)).toBeNull()
    expect(rovingTarget('ArrowRight', 0, 0)).toBeNull()
  })
})

describe('rovingStop', () => {
  it('prefers the focused point, then the one the chart marked, then the first', () => {
    expect(rovingStop(['-1', '0', '-1'], 2)).toBe(2)
    expect(rovingStop(['-1', '0', '-1'], -1)).toBe(1)
    expect(rovingStop(['0', '0', '0'], -1)).toBe(0)
    expect(rovingStop(['-1', '-1'], -1)).toBe(0)
  })
})

/** Every date from `from`, n days. */
function dates(from: string, n: number): string[] {
  const out: string[] = []
  const d = new Date(`${from}T12:00:00Z`)
  for (let i = 0; i < n; i++) { out.push(d.toISOString().slice(0, 10)); d.setUTCDate(d.getUTCDate() + 1) }
  return out
}

const tabIndexes = (html: string) => [...html.matchAll(/tabindex="(-?\d+)"/g)].map(m => m[1])

describe('charts render ONE tab stop', () => {
  // Regression: the Resumo's daily chart had tabindex=0 on all 38 bars.
  const days = dates('2026-10-12', 38).map((date, i) => ({ date, profit: (i % 5) * 100 - 150 }))

  it('DailyProfitBars: the first day of the chosen window holds the stop', () => {
    const html = renderToStaticMarkup(createElement(DailyProfitBars, {
      days, selected: { from: '2026-11-12', to: '2026-11-18' }, partialDate: '2026-11-18', ariaLabel: 'Lucro por dia',
    }))
    const t = tabIndexes(html)
    expect(t).toHaveLength(38)
    expect(t.filter(v => v === '0')).toHaveLength(1)
    expect(t.indexOf('0')).toBe(days.findIndex(d => d.date === '2026-11-12'))
  })

  it('DailyProfitBars without a window: the latest day holds the stop', () => {
    const t = tabIndexes(renderToStaticMarkup(createElement(DailyProfitBars, { days, ariaLabel: 'Lucro por dia' })))
    expect(t.filter(v => v === '0')).toHaveLength(1)
    expect(t.lastIndexOf('0')).toBe(37)
  })

  it('IntradayCurve: the latest hour holds the stop', () => {
    const points = Array.from({ length: 14 }, (_, hour) => ({ hour, cumProfit: hour * 10 - 40 }))
    const t = tabIndexes(renderToStaticMarkup(createElement(IntradayCurve, { points, ariaLabel: 'Curva do dia' })))
    expect(t).toHaveLength(14)
    expect(t.filter(v => v === '0')).toHaveLength(1)
    expect(t.indexOf('0')).toBe(13)
  })
})
