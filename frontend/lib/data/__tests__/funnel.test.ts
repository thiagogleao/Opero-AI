import { describe, expect, it } from 'vitest'
import { buildMetaSteps } from '../funnel'

describe('buildMetaSteps', () => {
  it('leaves out a step the pixel never measures, and says so', () => {
    const m = buildMetaSteps(
      { impressions: 1000000, link_clicks: 20000, landing_page_views: 0, add_to_cart: 1000, initiate_checkout: 400, purchases: 200 },
      5000,
    )
    expect(m.steps.map(s => s.key)).toEqual(['impressions', 'link_clicks', 'add_to_cart', 'initiate_checkout', 'purchases'])
    expect(m.omitted.map(s => s.key)).toEqual(['landing_page_views'])
    expect(m.steps[2].ratePct).toBeCloseTo(5)
    expect(m.steps[4].costPer).toBeCloseTo(25)
    expect(m.cpm).toBeCloseTo(5)
  })

  it('never prints a step-to-step rate above 100%', () => {
    // Hibikura counted more checkouts than add-to-carts.
    const m = buildMetaSteps(
      { impressions: 50000, link_clicks: 13340, landing_page_views: 0, add_to_cart: 345, initiate_checkout: 350, purchases: 85 },
      900,
    )
    const ic = m.steps.find(s => s.key === 'initiate_checkout')!
    expect(ic.exceedsPrevious).toBe(true)
    expect(ic.ratePct).toBeNull()
    expect(m.steps.find(s => s.key === 'purchases')!.ratePct).toBeCloseTo((85 / 350) * 100)
  })

  it('keeps trailing zeros: no purchases is a real result', () => {
    const m = buildMetaSteps(
      { impressions: 1000, link_clicks: 10, landing_page_views: 0, add_to_cart: 0, initiate_checkout: 0, purchases: 0 },
      10,
    )
    expect(m.steps.map(s => s.key)).toContain('purchases')
    expect(m.omitted).toEqual([])
    expect(m.steps.find(s => s.key === 'purchases')!.costPer).toBeNull()
  })
})

describe('buildMetaSteps without ads', () => {
  it('has no funnel when Meta measured nothing', () => {
    const m = buildMetaSteps(
      { impressions: 0, link_clicks: 0, landing_page_views: 0, add_to_cart: 0, initiate_checkout: 0, purchases: 0 },
      0,
    )
    expect(m).toEqual({ steps: [], omitted: [], cpm: null })
  })
})
