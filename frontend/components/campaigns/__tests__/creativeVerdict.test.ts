import { describe, expect, it } from 'vitest'
import type { CreativeDay, CreativeDetail, CreativeRow } from '@/lib/data/creatives'
import type { PnL } from '@/lib/engine/pnl'
import { buildCreativeVerdict } from '../creativeVerdict'

const day = (date: string, spend: number, estimatedProfit: number | null): CreativeDay => ({
  date, spend, purchaseValue: 0, purchases: 0, impressions: 0, linkClicks: 0, roas: spend > 0 ? 1 : null, estimatedProfit,
})

function detail(over: Record<string, unknown> = {}): CreativeDetail {
  const best = day('2026-11-12', 40, 30.5)
  const worst = day('2026-11-15', 60, -54.58)
  const creative = {
    adId: '1', name: 'CRI2', known: true, status: 'ACTIVE', running: true, campaignId: 'c', campaignName: 'C',
    adsetId: null, adsetName: null, thumbnailUrl: null, creativeUrl: null, previewExpired: false, landingUrl: null, createdTime: null,
    shared: null, estimatedProfit: -24.08, daysWithSpend: 2, lastSpendDay: '2026-11-15', video: null, hookRate: null,
    frequency: null, verdict: { signal: 'ok', reason: 'Dentro dos limites' },
    spend: 100, purchaseValue: 120, purchases: 3, impressions: 1000, linkClicks: 20,
    roas: 1.2, cpa: 33.33, ctr: 2, cpm: 100, cpc: 5, aov: 40,
    ...over,
  } as unknown as CreativeRow
  return {
    storeId: 's', timezone: 'America/Sao_Paulo', range: { from: '2026-11-11', to: '2026-11-17' }, configured: true,
    contributionRate: 0.6, breakEvenRoas: 1.6, formula: 'f', creative, daily: [best, worst],
    bestDay: best, worstDay: worst, hasSpend: true, notes: { hookRate: 'h', frequency: 'f' },
  }
}

const input = (split: boolean) => ({
  detail: detail(), storeTotals: { revenue: 1000, contribution: 600 } as PnL, rangeLabel: '11–17 nov',
  periodPhrase: 'nos últimos 7 dias', partialLabel: null, today: '2026-11-18', split,
})

describe('buildCreativeVerdict', () => {
  it('shows the partner every estimated profit as their half: the amount and the best and worst days', () => {
    const whole = buildCreativeVerdict(input(false))
    const half = buildCreativeVerdict(input(true))
    expect(whole.amount).toBeCloseTo(-24.08, 6)
    expect(half.amount).toBeCloseTo(-12.04, 6)
    const days = (v: typeof whole) => v.details.find(d => d.text.startsWith('Melhor dia'))!.text
    expect(days(whole)).toBe('Melhor dia 12 nov ($30,50), pior dia 15 nov (−$54,58) — só dias com $10 ou mais de gasto.')
    // The same days, halved, and said so: the day table below shows the same half.
    expect(days(half)).toBe('Melhor dia 12 nov ($15,25), pior dia 15 nov (−$27,29) — só dias com $10 ou mais de gasto, sua parte do lucro estimado.')
  })

  it('says a shared-account note once, with one period', () => {
    const note = 'Rodou na conta antiga da EPOCH, que também veiculou anúncios da CAMP HALLOW: 100% dos 338 pedidos rastreados dela, desde sempre, caíram em CAMP HALLOW. Não é julgada com a margem desta loja.'
    const shared = { accountId: 'act_x', note, journeyStoreId: null, journeyOrdersHere: 0, journeyOrdersTotal: 338 }
    const d = detail({ shared, estimatedProfit: null, verdict: { signal: null, reason: note } })
    const v = buildCreativeVerdict({ ...input(false), detail: d })
    const all = [...v.details, ...v.notes].map(l => l.text)
    expect(all.filter(t => t.includes('Rodou na conta antiga'))).toHaveLength(1)
    expect(all.join(' ')).not.toMatch(/\.\./)
    expect(v.details[0].text.endsWith('desta loja.')).toBe(true)
  })

  it('adds the period a bare reason lacks', () => {
    const v = buildCreativeVerdict(input(false))
    expect(v.details[0].text).toBe('Dentro dos limites.')
  })
})
