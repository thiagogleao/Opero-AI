import { describe, expect, it } from 'vitest'
import { kpiComparisonLabel } from '../comparisonLabel'

describe('kpiComparisonLabel', () => {
  const today = '2026-11-24'

  it('names the cut by its hour only in the pill, the whole sentence in the title (Este mês at 00h33)', () => {
    const r = kpiComparisonLabel({ from: '2026-10-01', to: '2026-10-24', label: 'mesmos dias do mês passado', sameTimeOfDay: true, cutoffMinutes: 33 }, today)
    // It read "vs 1–24 out até 00h33 de 24 out": the cut day twice, and the
    // pill ran past its card at 1440.
    expect(r.short).toBe('vs 1–24 out até 00h33')
    expect(r.short).not.toContain('de 24 out')
    expect(r.full).toBe('vs mesmos dias do mês passado (1–24 out, até 00h33 de 24 out)')
  })

  it('says "esta hora" when the minute of the cut is unknown', () => {
    const r = kpiComparisonLabel({ from: '2026-11-15', to: '2026-11-19', label: '5 dias anteriores', sameTimeOfDay: true }, today)
    expect(r.short).toBe('vs 15–19 nov até esta hora')
  })

  it('leaves a whole comparison alone (7 dias, Mês passado)', () => {
    const r = kpiComparisonLabel({ from: '2026-11-10', to: '2026-11-16', label: '7 dias anteriores', sameTimeOfDay: false }, today)
    expect(r.short).toBe('vs 10–16 nov')
    expect(r.full).toBe('vs 7 dias anteriores (10–16 nov)')
  })

  it('keeps "vs ontem até esta hora" for Hoje', () => {
    const r = kpiComparisonLabel({ from: '2026-11-23', to: '2026-11-23', label: 'ontem até esta hora', sameTimeOfDay: true, cutoffMinutes: 600 }, today)
    expect(r).toEqual({ short: 'vs ontem até esta hora', full: 'vs ontem até esta hora' })
  })
})
