import { describe, expect, it } from 'vitest'
import { creativeSignal, creativeVerdict, isVideoAd, type CreativeVerdictInput } from '../creativeSignal'

const base: CreativeVerdictInput = {
  spend: 100, roas: 2, purchases: 5, breakEven: 1.5, frequency: null, running: true,
}

describe('creativeVerdict', () => {
  it('kills below 80% of break-even with real spend', () => {
    expect(creativeVerdict({ ...base, roas: 1.1 }).signal).toBe('kill')
    expect(creativeVerdict({ ...base, roas: 1.1, spend: 40 }).reason).toMatch(/pouco gasto/)
  })
  it('says why a big spender below break-even is not cut yet', () => {
    const v = creativeVerdict({ ...base, spend: 2484, roas: 1.3 })
    expect(v.signal).toBe('ok')
    expect(v.reason).toBe('Abaixo do empate (1,50×), mas acima da linha de corte (1,20×)')
  })
  it('writes every number the pt-BR way (shown next to lib/format numbers)', () => {
    expect(creativeVerdict({ ...base, roas: 0.96, spend: 1419.4, breakEven: 1.29 }).reason)
      .toBe('ROAS 0,96× com $1.419 gastos — abaixo de 80% do empate (1,29×)')
    expect(creativeVerdict({ ...base, roas: 1.1, spend: 45.5 }).reason)
      .toBe('Abaixo do empate (1,50×), ainda com pouco gasto para cortar ($45,50 de $50)')
    expect(creativeVerdict({ ...base, roas: 2.2, purchases: 1234 }).reason)
      .toBe('ROAS 2,20× — 40% ou mais acima do empate (1,50×) com 1.234 vendas')
    expect(creativeVerdict({ ...base, frequency: 3.62 }).reason).toBe('Frequência 3,6 no período — o público já viu demais')
    for (const r of [0.5, 1.3, 1.6, 2.4].map(roas => creativeVerdict({ ...base, roas, frequency: 4 }).reason)) {
      expect(r).not.toMatch(/\d\.\d(?!\d{2})|\dx\b|\$\d{1,3},\d{3}|(^|\s)-\d/)
    }
  })
  it('scales 40% above break-even with enough sales', () => {
    expect(creativeVerdict({ ...base, roas: 2.2 }).signal).toBe('scale')
    expect(creativeVerdict({ ...base, roas: 2.2, purchases: 1 }).signal).toBe('ok')
  })
  it('gives no verdict to paused ads, shared-account ads, or without a break-even', () => {
    expect(creativeVerdict({ ...base, running: false }).signal).toBeNull()
    expect(creativeVerdict({ ...base, sharedNote: 'outra loja' })).toEqual({ signal: null, reason: 'outra loja' })
    expect(creativeVerdict({ ...base, breakEven: null, costsConfigured: false }).reason).toMatch(/não configurados/)
    expect(creativeVerdict({ ...base, breakEven: null, costsConfigured: true }).signal).toBeNull()
    expect(creativeVerdict({ ...base, spend: 0, roas: null }).signal).toBeNull()
  })
  it('flags fatigue only from a real period frequency', () => {
    expect(creativeVerdict({ ...base, frequency: 4.2 }).signal).toBe('refresh')
    expect(creativeVerdict({ ...base, frequency: null }).signal).toBe('ok')
  })
  it('names the window its figures cover when it is not the screen\'s', () => {
    const w = { ...base, window: 'nos 7 dias fechados' }
    expect(creativeVerdict({ ...w, roas: 0.96, spend: 1419.4, breakEven: 1.29 }).reason)
      .toBe('ROAS 0,96× com $1.419 gastos nos 7 dias fechados — abaixo de 80% do empate desses dias (1,29×)')
    expect(creativeVerdict({ ...w, roas: 2.2 }).reason).toBe('ROAS 2,20× nos 7 dias fechados — 40% ou mais acima do empate desses dias (1,50×) com 5 vendas')
    expect(creativeVerdict({ ...w, spend: 0, roas: null })).toEqual({ signal: null, reason: 'Sem gasto nos 7 dias fechados' })
    expect(creativeVerdict({ ...w, frequency: 4.2 }).reason).toBe('Frequência 4,2 nos 7 dias fechados — o público já viu demais')
    // Without a window, the reasons are the screen's own (unchanged).
    expect(creativeVerdict({ ...base, spend: 0, roas: null }).reason).toBe('Sem gasto no período')
    expect(creativeVerdict({ ...base, roas: 0.96, spend: 1419.4, breakEven: 1.29 }).reason)
      .toBe('ROAS 0,96× com $1.419 gastos — abaixo de 80% do empate (1,29×)')
  })
  it('leads a "no action" reason with the window\'s ROAS, so the row\'s own ROAS and break-even are not read against it', () => {
    // Phone row: "ROAS 0,80× · empate do período 1,58×" under a reason that
    // judged the 7 closed days: the reason gives its own ROAS and names its
    // break-even as those days'.
    const w = { ...base, window: 'nos 7 dias fechados' }
    expect(creativeVerdict({ ...w, roas: 1.6 })).toEqual({
      signal: 'ok', label: 'Manter', reason: 'ROAS 1,60× nos 7 dias fechados — acima do empate desses dias (1,50×)',
    })
    expect(creativeVerdict({ ...w, roas: 1.5 }).reason).toBe('ROAS 1,50× nos 7 dias fechados — acima do empate desses dias (1,50×)')
    expect(creativeVerdict({ ...w, roas: 1.3 })).toEqual({
      signal: 'ok', label: 'Abaixo do empate',
      reason: 'ROAS 1,30× nos 7 dias fechados — abaixo do empate desses dias (1,50×), mas acima da linha de corte (1,20×)',
    })
    expect(creativeVerdict({ ...w, roas: 1.1, spend: 45.5 }).reason)
      .toBe('ROAS 1,10× nos 7 dias fechados — abaixo do empate desses dias (1,50×), ainda com pouco gasto para cortar ($45,50 de $50)')
    // Without a window the "no action" reasons stay as they were.
    expect(creativeVerdict({ ...base, roas: 1.6 }).reason).toBe('Acima do empate (1,50×)')
    expect(creativeVerdict({ ...base, roas: 1.1, spend: 45.5 }).reason)
      .toBe('Abaixo do empate (1,50×), ainda com pouco gasto para cortar ($45,50 de $50)')
  })
  it('says "desse dia" when the window is a single closed day', () => {
    const one = { ...base, window: 'no último dia fechado' }
    expect(creativeVerdict({ ...one, roas: 0.96, spend: 1419.4, breakEven: 1.29 }).reason)
      .toBe('ROAS 0,96× com $1.419 gastos no último dia fechado — abaixo de 80% do empate desse dia (1,29×)')
    expect(creativeVerdict({ ...one, roas: 2.2 }).reason).toBe('ROAS 2,20× no último dia fechado — 40% ou mais acima do empate desse dia (1,50×) com 5 vendas')
    expect(creativeVerdict({ ...one, roas: 1.6 }).reason).toBe('ROAS 1,60× no último dia fechado — acima do empate desse dia (1,50×)')
  })
})

describe('legacy creativeSignal', () => {
  it('ignores the fake hook rate and summed-reach frequency', () => {
    // An image ad with stray plays used to read "refresh" (hook 0.03% < 25%).
    expect(creativeSignal({ spend: 100, roas: 2, frequency: 9, hookRate: 0.03, breakEven: 1.5 })).toBe('ok')
  })
  it('gives no kill/scale when there is no break-even (profitCalc reports 0)', () => {
    expect(creativeSignal({ spend: 100, roas: 2, frequency: 1, hookRate: null, breakEven: 0 })).toBe('ok')
  })
})

describe('isVideoAd', () => {
  it('separates real videos from image ads with stray plays', () => {
    expect(isVideoAd(9000, 10000)).toBe(true)
    expect(isVideoAd(31, 118000)).toBe(false)
    expect(isVideoAd(0, 0)).toBe(false)
  })
})
