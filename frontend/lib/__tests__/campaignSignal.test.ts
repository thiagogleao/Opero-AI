import { describe, expect, it } from 'vitest'
import {
  breakEvenRoas, campaignTrend, decideCampaign, estimateProfit, marginPct,
  type DecisionDay, type DecisionInput,
} from '../campaignSignal'
import { eachDay } from '../engine/dates'

const WINDOW = { from: '2026-11-10', to: '2026-11-16' }
const PREVIOUS = { from: '2026-11-03', to: '2026-11-09' }

/** Same spend/revenue/purchases on every day of a range. */
function flat(range: { from: string; to: string }, spend: number, revenue: number, purchases: number): DecisionDay[] {
  return eachDay(range.from, range.to).map(date => ({ date, spend, revenue, purchases }))
}

function input(over: Partial<DecisionInput> = {}): DecisionInput {
  return {
    // 7 days × $50 = $350 spend, $1,000 revenue, 14 orders: ROAS 2.86.
    days: flat(WINDOW, 50, 1000 / 7, 2),
    window: WINDOW,
    contributionRate: 0.6,
    status: 'ACTIVE',
    ...over,
  }
}

describe('money helpers', () => {
  it('estimated profit = Meta purchase value × contribution rate − spend', () => {
    expect(estimateProfit(1000, 350, 0.6)).toBe(250)
    expect(marginPct(1000, 350, 0.6)).toBe(25)
    expect(marginPct(0, 350, 0.6)).toBeNull()
  })
  it('break-even is 1 ÷ contribution rate, null when no ROAS can break even', () => {
    expect(breakEvenRoas(0.5)).toBe(2)
    expect(breakEvenRoas(0)).toBeNull()
    expect(breakEvenRoas(-0.1)).toBeNull()
    expect(breakEvenRoas(null)).toBeNull()
  })
})

describe('decideCampaign', () => {
  it('scales a campaign above the threshold with enough volume', () => {
    const d = decideCampaign(input())
    expect(d.action).toBe('escalar')
    expect(d.margin).toBeCloseTo(25)
    expect(d.estimatedProfit).toBeCloseTo(250)
    expect(d.days).toHaveLength(7)
  })

  it('uses the store threshold it is given', () => {
    expect(decideCampaign(input({ thresholds: { minMargin: 30 } })).action).toBe('manter')
  })

  it('never gives a paused campaign an action', () => {
    const d = decideCampaign(input({ status: 'PAUSED' }))
    expect(d.action).toBeNull()
    expect(d.basis).toBe('pausada')
  })

  it('a shared-account campaign gets no action and no money priced with this store', () => {
    const d = decideCampaign(input({ sharedAccount: 'Rodou na conta antiga da EPOCH…' }))
    expect(d.action).toBeNull()
    expect(d.basis).toBe('conta_compartilhada')
    expect(d.estimatedProfit).toBeNull()
    expect(d.margin).toBeNull()
    expect(d.days.every(x => x.estimatedProfit === null)).toBe(true)
  })

  it('tells "no cost settings" apart from "no sales to measure a margin"', () => {
    const noCosts = decideCampaign(input({ contributionRate: null, costsConfigured: false }))
    expect(noCosts.basis).toBe('sem_custos')
    const noSales = decideCampaign(input({ contributionRate: null, costsConfigured: true }))
    expect(noSales.basis).toBe('sem_margem')
    expect(noSales.action).toBeNull()
  })

  it('no spend in the window: no action', () => {
    expect(decideCampaign(input({ days: [] })).basis).toBe('sem_gasto')
  })

  it('cuts a campaign burning money with volume', () => {
    // $350 spend, $490 revenue at 60%: profit −56, margin −11.4%.
    const d = decideCampaign(input({ days: flat(WINDOW, 50, 490 / 7, 2) }))
    expect(d.margin).toBeCloseTo(-11.43, 1)
    expect(d.action).toBe('cortar')
  })

  it('cuts a campaign with few orders when the loss survives 50% more sales', () => {
    // $300 spent, 2 orders worth $120.
    const days = flat(WINDOW, 300 / 7, 0, 0)
    days[2] = { ...days[2], revenue: 120, purchases: 2 }
    expect(decideCampaign(input({ days })).action).toBe('cortar')
  })

  it('only watches a campaign with too little volume', () => {
    const d = decideCampaign(input({ days: flat(WINDOW, 10, 30, 1) }))
    expect(d.action).toBe('observar')
    expect(d.basis).toBe('volume')
  })

  it('holds back a scale when the last 3 days collapsed', () => {
    // First 4 days ROAS 4, last 3 days ROAS 1.6 (−60%); window margin still ≥ 20%.
    const days = [
      ...flat({ from: '2026-11-10', to: '2026-11-13' }, 50, 200, 3),
      ...flat({ from: '2026-11-14', to: '2026-11-16' }, 50, 80, 1),
    ]
    const d = decideCampaign(input({ days }))
    expect(d.margin).toBeGreaterThan(20)
    expect(d.action).toBe('manter')
    expect(d.basis).toBe('tendencia')
  })

  it('shows no trend arrow without a real previous period (the 7-day view)', () => {
    const d = decideCampaign(input())
    expect(d.trend).toBeNull()
    expect(d.trendChange).toBeNull()
  })

  it('shows a trend arrow when both periods had real spend', () => {
    const better = decideCampaign(input({ days: [...flat(PREVIOUS, 50, 100, 1), ...flat(WINDOW, 50, 150, 2)] }))
    expect(better.trend).toBe('melhorando')
    const worse = decideCampaign(input({ days: [...flat(PREVIOUS, 50, 200, 2), ...flat(WINDOW, 50, 150, 2)] }))
    expect(worse.trend).toBe('piorando')
  })

  it('reads the calendar, not row positions: days outside the window are ignored', () => {
    const d = decideCampaign(input({ days: [...flat({ from: '2026-10-01', to: '2026-10-07' }, 500, 5000, 50)] }))
    expect(d.spend).toBe(0)
    expect(d.basis).toBe('sem_gasto')
    expect(d.days.map(x => x.date)).toEqual(eachDay(WINDOW.from, WINDOW.to))
  })

  it('unknown status: running only when it spent on the last day', () => {
    const days = flat(WINDOW, 50, 1000 / 7, 2)
    days[6] = { ...days[6], spend: 0 }
    expect(decideCampaign(input({ status: null, days })).basis).toBe('pausada')
  })
})

describe('legacy campaignTrend', () => {
  it('never says "escalar" when the window has no earlier days (H2)', () => {
    const series = eachDay('2026-11-11', '2026-11-17').map(date => ({ date, spend: 50, revenue: 200 }))
    expect(campaignTrend(series, '2026-11-17', 0.6).trend).toBe('curto')
  })
})
