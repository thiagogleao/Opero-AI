import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { IntradayCurve } from '../IntradayCurve'
import type { ChartTip } from '../scale'

// MOKOO, Hoje with ?parte=50: the 23 nov bar read "sua parte (50%) $130 ·
// lucro do dia $261" while the curve under it read "lucro acumulado $130"
// for the same day — the halved value under the whole day's name.
const points = [
  { hour: 0, cumProfit: -40, cumRevenue: 0, orders: 0 },
  { hour: 1, cumProfit: 260, cumRevenue: 1340, orders: 3 },
]

const unescape = (v: string) => v.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')

function render(share?: number) {
  const html = renderToStaticMarkup(createElement(IntradayCurve, { points, share, ariaLabel: 'Curva do dia' }))
  return {
    html,
    tips: [...html.matchAll(/data-tip="([^"]*)"/g)].map(m => JSON.parse(unescape(m[1])) as ChartTip),
    labels: [...html.matchAll(/<g[^>]*aria-label="([^"]*)"/g)].map(m => unescape(m[1])),
  }
}
const row = (t: ChartTip, name: string) => t.rows?.find(r => r[0] === name)?.[1]

describe('IntradayCurve in the partner split', () => {
  it('without the split: the whole running total, as before', () => {
    const { tips, html } = render()
    expect(row(tips[1], 'lucro acumulado')).toBe('$260')
    expect(row(tips[1], 'sua parte (50%)')).toBeUndefined()
    expect(html).toContain('>$260<')
  })

  it('with share 0,5: draws and names the share, keeps the whole day beside it', () => {
    const { tips, labels, html } = render(0.5)
    expect(row(tips[1], 'sua parte (50%)')).toBe('$130')
    expect(row(tips[1], 'lucro acumulado do dia')).toBe('$260')
    expect(row(tips[1], 'lucro acumulado')).toBeUndefined()
    expect(row(tips[1], 'receita acumulada')).toBe('$1.340')
    expect(labels.some(l => l.includes('sua parte (50%) $130, lucro acumulado do dia $260'))).toBe(true)
    // The end label prints the drawn share.
    expect(html).toContain('>$130<')
    expect(html).not.toContain('>$260<')
  })
})
