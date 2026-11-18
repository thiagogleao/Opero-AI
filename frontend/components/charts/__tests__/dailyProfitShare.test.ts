import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DailyProfitBars } from '../DailyProfitBars'
import type { ChartTip } from '../scale'

// MOKOO, sex 13 nov: $380 of profit on $1.990 of sales (19,1%). With
// ?parte=50 the callers passed a halved profit and the tooltip read
// "margem 9,5%": the split halves money, never margins.
const days = [
  { date: '2026-11-12', profit: 120, revenue: 1500, metaSpend: 700, orders: 18 },
  { date: '2026-11-13', profit: 380, revenue: 1990, metaSpend: 894, shopSpend: 97.78, orders: 23 },
]

const unescape = (v: string) => v.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')

function tips(share?: number): { tips: ChartTip[]; labels: string[] } {
  const html = renderToStaticMarkup(createElement(DailyProfitBars, { days, share, today: '2026-11-18', ariaLabel: 'Lucro por dia' }))
  return {
    tips: [...html.matchAll(/data-tip="([^"]*)"/g)].map(m => JSON.parse(unescape(m[1])) as ChartTip),
    labels: [...html.matchAll(/<g[^>]*aria-label="([^"]*)"/g)].map(m => unescape(m[1])),
  }
}

const row = (t: ChartTip, name: string) => t.rows?.find(r => r[0] === name)?.[1]

describe('DailyProfitBars in the partner split', () => {
  it('without the split: the whole profit and its margin', () => {
    const { tips: t } = tips()
    expect(row(t[1], 'lucro')).toBe('$380')
    expect(row(t[1], 'margem')).toBe('19,1%')
    expect(row(t[1], 'sua parte (50%)')).toBeUndefined()
  })

  it('with share 0,5: the share is labelled, the whole day stays, the margin is not halved', () => {
    const { tips: t, labels } = tips(0.5)
    expect(row(t[1], 'sua parte (50%)')).toBe('$190')
    expect(row(t[1], 'lucro do dia')).toBe('$380')
    expect(row(t[1], 'receita')).toBe('$1.990')
    expect(row(t[1], 'margem')).toBe('19,1%')
    expect(row(t[1], 'lucro')).toBeUndefined()
    expect(labels.some(l => l.includes('sua parte (50%) $190, lucro do dia $380'))).toBe(true)
  })

  it('draws the share: the printed best-day value is halved', () => {
    const whole = renderToStaticMarkup(createElement(DailyProfitBars, { days, ariaLabel: 'x' }))
    const half = renderToStaticMarkup(createElement(DailyProfitBars, { days, share: 0.5, ariaLabel: 'x' }))
    expect(whole).toContain('>$380<')
    expect(half).toContain('>$190<')
    expect(half).not.toContain('>$380<')
  })
})
