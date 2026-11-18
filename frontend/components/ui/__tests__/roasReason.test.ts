import { describe, expect, it } from 'vitest'
import { breakEvenReason, reasonText, usableBreakEven } from '../roasReason'

describe('breakEvenReason', () => {
  it('is null when the break-even is usable', () => {
    expect(breakEvenReason({ breakEven: 1.53, configured: true, revenue: 10942 })).toBeNull()
    expect(breakEvenReason({ breakEven: 1.53 })).toBeNull()
    expect(usableBreakEven({ breakEven: 1.53, configured: true, revenue: 10942 })).toBe(1.53)
  })

  it('reads a store without cost settings as no_costs, whatever the engine break-even says', () => {
    // The engine gives an unconfigured store contribution = revenue, so 1×.
    expect(breakEvenReason({ breakEven: 1, configured: false, revenue: 156.3 })).toBe('no_costs')
    expect(usableBreakEven({ breakEven: 1, configured: false, revenue: 156.3 })).toBeNull()
    expect(breakEvenReason({ breakEven: null, configured: false })).toBe('no_costs')
  })

  it('tells a configured store with spend and no sales apart from missing costs (EPOCH at 03h)', () => {
    expect(breakEvenReason({ breakEven: null, configured: true, revenue: 0, contribution: 0 })).toBe('no_sales')
    // No sales wins over the settings: configuring costs would not help.
    expect(breakEvenReason({ breakEven: null, configured: false, revenue: 0 })).toBe('no_sales')
  })

  it('says no_margin when sales did not cover product, shipping and fees', () => {
    expect(breakEvenReason({ breakEven: null, configured: true, revenue: 812, contribution: -40 })).toBe('no_margin')
    expect(breakEvenReason({ breakEven: null, configured: true, revenue: 812 })).toBe('no_margin')
    expect(breakEvenReason({ breakEven: null, configured: true, contribution: -0.12 })).toBe('no_margin')
  })

  it('stays generic when only the settings are known', () => {
    expect(breakEvenReason({ breakEven: null, configured: true })).toBe('no_contribution')
    expect(breakEvenReason({ breakEven: null, configured: true, contribution: 0 })).toBe('no_contribution')
  })

  it('claims nothing when nothing is known or the facts disagree', () => {
    expect(breakEvenReason({ breakEven: null })).toBe('unknown')
    expect(breakEvenReason({ breakEven: null, revenue: 500 })).toBe('unknown')
    expect(breakEvenReason({ breakEven: null, configured: true, revenue: 500, contribution: 120 })).toBe('unknown')
  })

  it('lets the caller name the reason (a shared campaign), over a valid break-even', () => {
    expect(breakEvenReason({ breakEven: 1.53, configured: true, reason: 'other_store' })).toBe('other_store')
    expect(usableBreakEven({ breakEven: 1.53, reason: 'other_store' })).toBeNull()
  })
})

describe('reasonText', () => {
  it('words each case honestly', () => {
    expect(reasonText('no_costs')).toBe('empate desconhecido → custos não configurados')
    expect(reasonText('no_margin')).toBe('sem empate → produto, frete e taxas já passam da receita')
    expect(reasonText('no_sales')).toBe('sem empate → nenhuma venda no período: todo o gasto foi prejuízo')
    expect(reasonText('unknown')).toBe('empate desconhecido')
    expect(reasonText('no_sales', true)).toBe('sem empate → loja sem vendas')
  })
})
