import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { RoasGauge } from '../RoasGauge'

const text = (html: string) => html.replace(/<!-- -->/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()

// Regression: the gap to break-even bypassed lib/format and printed
// "· 4521% acima" (Dumpling Squishy · hzsjyp, Mês passado: ROAS 77,29× · empate 1,67×).
describe('RoasGauge gap to break-even', () => {
  it('uses the pt-BR thousands separator', () => {
    const out = text(renderToStaticMarkup(createElement(RoasGauge, { roas: 77.29, breakEven: 1.67, configured: true })))
    expect(out).toContain('ROAS 77,29× · empate 1,67× → no lucro · 4.528% acima')
  })

  it('reads as before for a small gap, above or below', () => {
    expect(text(renderToStaticMarkup(createElement(RoasGauge, { roas: 1.95, breakEven: 1.58, configured: true })))).toContain('· 23% acima')
    expect(text(renderToStaticMarkup(createElement(RoasGauge, { roas: 1.2, breakEven: 1.5, configured: true })))).toContain('no prejuízo · 20% abaixo')
  })
})
