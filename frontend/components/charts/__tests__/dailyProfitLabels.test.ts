import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { DailyProfitBars, type DailyProfitBarsProps } from '../DailyProfitBars'
import type { ChartTip } from '../scale'

// The creative page plots an estimate over Meta-attributed sales and Meta's
// credited purchases. With the store-profit words its tooltip called the
// estimate "lucro", the attributed sales "receita" and Meta's purchases
// "pedidos" (they are not the store's orders).
const days = [
  { date: '2026-11-12', profit: 40, revenue: 300, metaSpend: 90, orders: 4 },
  { date: '2026-11-13', profit: -25, revenue: 120, metaSpend: 110, orders: 2 },
]

const CREATIVE = { profit: 'lucro estimado', wholeProfit: 'lucro estimado do dia', revenue: 'vendas atribuídas', orders: 'compras (Meta)' }

const unescape = (v: string) => v.replace(/&quot;/g, '"').replace(/&amp;/g, '&').replace(/&#x27;/g, "'").replace(/&lt;/g, '<').replace(/&gt;/g, '>')

function render(props: Partial<DailyProfitBarsProps>): { tips: ChartTip[]; aria: string[] } {
  const html = renderToStaticMarkup(createElement(DailyProfitBars, { days, today: '2026-11-18', ariaLabel: 'x', ...props }))
  return {
    tips: [...html.matchAll(/data-tip="([^"]*)"/g)].map(m => JSON.parse(unescape(m[1])) as ChartTip),
    aria: [...html.matchAll(/<g[^>]*aria-label="([^"]*)"/g)].map(m => unescape(m[1])),
  }
}

const names = (t: ChartTip) => (t.rows ?? []).map(r => r[0])
const row = (t: ChartTip, name: string) => t.rows?.find(r => r[0] === name)?.[1]

describe('DailyProfitBars labels', () => {
  it('defaults to the store-profit words', () => {
    const { tips, aria } = render({})
    expect(names(tips[0])).toEqual(['lucro', 'receita', 'Anúncios Meta', 'pedidos', 'margem'])
    expect(aria[0]).toContain(': lucro $40,00')
  })

  it('names an estimate over attributed sales honestly, in the tooltip and the aria label', () => {
    const { tips, aria } = render({ labels: CREATIVE })
    expect(names(tips[0])).toEqual(['lucro estimado', 'vendas atribuídas', 'Anúncios Meta', 'compras (Meta)', 'margem'])
    expect(row(tips[0], 'compras (Meta)')).toBe('4')
    expect(row(tips[1], 'lucro estimado')).toBe('−$25,00')
    expect(tips.flatMap(names)).not.toContain('pedidos')
    expect(tips.flatMap(names)).not.toContain('receita')
    expect(aria[0]).toContain(': lucro estimado $40,00')
  })

  it('uses the whole-day word next to the partner share', () => {
    const { tips, aria } = render({ labels: CREATIVE, share: 0.5 })
    expect(row(tips[0], 'sua parte (50%)')).toBe('$20,00')
    expect(row(tips[0], 'lucro estimado do dia')).toBe('$40,00')
    expect(row(tips[0], 'lucro estimado')).toBeUndefined()
    expect(aria[0]).toContain('sua parte (50%) $20,00, lucro estimado do dia $40,00')
  })

  it('a partial set of labels keeps the defaults for the rest', () => {
    const { tips } = render({ labels: { revenue: 'vendas atribuídas' } })
    expect(names(tips[0])).toEqual(['lucro', 'vendas atribuídas', 'Anúncios Meta', 'pedidos', 'margem'])
  })
})
