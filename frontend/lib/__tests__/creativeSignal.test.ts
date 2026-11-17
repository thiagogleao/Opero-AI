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
    expect(v.reason).toMatch(/acima da linha de corte \(1\.20x\)/)
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
