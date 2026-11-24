import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { CreativeRow } from '@/lib/data/creatives'
import { groupAdsets } from '../CampaignTable'
import { RoasCell } from '../RoasCell'

const ad = (adId: string, adsetId: string, spend: number, estimatedProfit: number | null): CreativeRow =>
  ({ adId, adsetId, adsetName: `Conjunto ${adsetId}`, spend, purchaseValue: 0, purchases: 0, estimatedProfit } as unknown as CreativeRow)

describe('groupAdsets', () => {
  it('sums its ads\' estimates', () => {
    const [g] = groupAdsets([ad('a', 's1', 7.75, -7.75), ad('b', 's1', 4, -4)])
    expect(g.estimatedProfit).toBeCloseTo(-11.75, 6)
    expect(g.ads.map(a => a.adId)).toEqual(['a', 'b'])
  })

  it('is unpriced as soon as one of its ads is: a partial sum is not the ad set\'s estimate', () => {
    // A day without sales: the ad Meta credited has no estimate, the others
    // are −spend; their sum alone would pass for the ad set's.
    const [g] = groupAdsets([ad('a', 's1', 7.75, -7.75), ad('credited', 's1', 5, null)])
    expect(g.estimatedProfit).toBeNull()
    // Every ad unpriced (no costs, shared account): still null, never $0.
    expect(groupAdsets([ad('x', 's2', 3, null)])[0].estimatedProfit).toBeNull()
  })
})

describe('RoasCell', () => {
  it('says why there is no break-even in the gauge\'s tooltip', () => {
    // MOKOO "Hoje" with no order yet: the cell's gauge said "empate desconhecido".
    const html = renderToStaticMarkup(createElement(RoasCell, { roas: 0, breakEven: null, configured: true, revenue: 0, contribution: 0 }))
    expect(html).toContain('sem empate')
    expect(html).toContain('nenhuma venda no período')
    expect(html).not.toContain('empate desconhecido')
    const noCosts = renderToStaticMarkup(createElement(RoasCell, { roas: 1.2, breakEven: null, configured: false, revenue: 500 }))
    expect(noCosts).toContain('custos não configurados')
  })
})
