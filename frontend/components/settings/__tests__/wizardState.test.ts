import { describe, expect, it } from 'vitest'
import { clampStart, dateBounds, withState } from '../wizardState'

describe('dateBounds — the onboarding date input', () => {
  it('22h in Brasília is already tomorrow in UTC (Railway): the bound stays on Brazil\'s day', () => {
    // 2026-11-18 22:30 BRT = 2026-11-19 01:30 UTC
    const b = dateBounds('2026-11-19T01:30:00.000Z', 'America/Sao_Paulo')
    expect(b.max).toBe('2026-11-18')
    expect(b.min).toBe('2025-10-15') // 399 days back, accepted by the import (400 max)
  })

  it('a Tokyo store\'s day is used once the store is known', () => {
    expect(dateBounds('2026-11-18T16:00:00.000Z', 'Asia/Tokyo').max).toBe('2026-11-19')
  })

  it('is a pure function of the server time: the same on the server and in the browser', () => {
    const now = '2026-11-18T12:00:00.000Z'
    expect(dateBounds(now, 'America/Sao_Paulo')).toEqual(dateBounds(now, 'America/Sao_Paulo'))
  })
})

describe('clampStart', () => {
  const b = { min: '2025-10-15', max: '2026-11-18' }
  it('keeps empty, clamps past and future', () => {
    expect(clampStart('', b)).toBe('')
    expect(clampStart('2024-01-01', b)).toBe('2025-10-15')
    expect(clampStart('2026-11-19', b)).toBe('2026-11-18')
    expect(clampStart('2026-03-01', b)).toBe('2026-03-01')
  })
})

describe('withState — links out of the wizard keep the period', () => {
  it('adds the period to the flow\'s own keys', () => {
    expect(withState('/profit', 'periodo=custom&de=2026-10-27&ate=2026-11-04', { loja: 'abc' }))
      .toBe('/profit?periodo=custom&de=2026-10-27&ate=2026-11-04&loja=abc')
    expect(withState('/onboarding', '')).toBe('/onboarding')
    expect(withState('/', '', { loja: 'a b' })).toBe('/?loja=a+b')
  })
})
