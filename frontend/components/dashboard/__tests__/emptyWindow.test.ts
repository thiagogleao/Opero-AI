import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { sumPnL } from '@/lib/engine/pnl'
import { archivedEmptyVerdict, emptyWindowOf, emptyWindowText, frozenTailNote, frozenTailOf, frozenVerdict, isFrozenWindow } from '../emptyWindow'
import { StoreKpis } from '../StoreKpis'
import type { PageContext } from '@/lib/views/page'
import type { StoreSummary } from '@/lib/views/store'

// Regressions on the desktop Resumo:
// - Hibikura, Mês passado (1–31 out, first sale 7 nov): the verdict and the
//   ledger said the store started on 7 nov, while the KPI grid read "Receita
//   $0 · nenhum pedido no período" and the lists "Nenhum pedido no período".
// - Squishy World, 7 dias (17–23 nov, archived on 10 nov): the verdict said
//   "arquivada desde 10 nov … não há dados", every block beside it "$0",
//   "nenhum reembolso chegou no período", a chart with "hoje, parcial".

describe('emptyWindowOf', () => {
  it('follows the verdict: before the first sale, frozen, or nothing', () => {
    expect(emptyWindowOf({ beforeStart: { date: '2026-11-07', text: '7 nov' }, frozen: null }))
      .toEqual({ kind: 'before_start', firstSale: '7 nov' })
    expect(emptyWindowOf({ beforeStart: null, frozen: { date: '2026-11-10', text: '10 nov' } }))
      .toEqual({ kind: 'frozen', archivedOn: '10 nov' })
    expect(emptyWindowOf({ beforeStart: null, frozen: { date: null, text: null } }))
      .toEqual({ kind: 'frozen', archivedOn: null })
    expect(emptyWindowOf({})).toBeNull()
    expect(emptyWindowOf({ beforeStart: null, frozen: null })).toBeNull()
  })
})

describe('emptyWindowText', () => {
  it('says the store did not sell yet, with its first sale — never "nenhum pedido no período"', () => {
    const t = emptyWindowText({ kind: 'before_start', firstSale: '7 nov' }, '1–31 out')
    expect(t.note).toBe('a loja ainda não vendia (1ª venda em 7 nov)')
    expect(t.title).toBe('A loja ainda não vendia')
    expect(t.text).toBe('A 1ª venda foi em 7 nov: escolha um período a partir dessa data.')
  })

  it('says an archived store\'s window has no data, as the phone does', () => {
    const t = emptyWindowText({ kind: 'frozen', archivedOn: '10 nov' }, '17–23 nov')
    expect(t.note).toBe('sem dados: loja arquivada desde 10 nov')
    // Word for word the phone's block title (app/m/_components/Home.tsx).
    expect(t.title).toBe('Sem dados de 17–23 nov: a loja está arquivada desde 10 nov')
    expect(t.text).toContain('escolha um período até 10 nov')
    const unknown = emptyWindowText({ kind: 'frozen', archivedOn: null }, '17–23 nov')
    expect(unknown.note).toBe('sem dados: loja arquivada')
    expect(unknown.title).toBe('Sem dados de 17–23 nov: a loja está arquivada')
  })
})

describe('isFrozenWindow (the verdict\'s frozen rule, for pages without the Resumo verdict)', () => {
  const sw = { archived: true, archivedOn: '2026-11-10' }
  const none = { orders: 0, revenue: 0, spend: 0 }
  it('is a window after the archive day, or the running day, with nothing in it', () => {
    expect(isFrozenWindow(sw, { from: '2026-11-17', to: '2026-11-23' }, '2026-11-24', none)).toBe(true)
    expect(isFrozenWindow(sw, { from: '2026-11-24', to: '2026-11-24' }, '2026-11-24', none)).toBe(true)
    expect(isFrozenWindow({ archived: true, archivedOn: null }, { from: '2026-11-24', to: '2026-11-24' }, '2026-11-24', none)).toBe(true)
  })
  it('is not a window that reaches back to when the store synced, or one with activity', () => {
    expect(isFrozenWindow(sw, { from: '2026-11-01', to: '2026-11-20' }, '2026-11-24', none)).toBe(false)
    expect(isFrozenWindow(sw, { from: '2026-11-10', to: '2026-11-16' }, '2026-11-24', none)).toBe(false)
    expect(isFrozenWindow(sw, { from: '2026-11-17', to: '2026-11-23' }, '2026-11-24', { ...none, orders: 1 })).toBe(false)
    expect(isFrozenWindow({ archived: false, archivedOn: null }, { from: '2026-11-17', to: '2026-11-23' }, '2026-11-24', none)).toBe(false)
    // Unknown archive day and a closed window: cannot tell, so not frozen.
    expect(isFrozenWindow({ archived: true, archivedOn: null }, { from: '2026-11-17', to: '2026-11-23' }, '2026-11-24', none)).toBe(false)
  })
  it('REGRESSION: a running window that reaches back to the archive day is not frozen (Squishy World, Este mês)', () => {
    // 1–24 nov, archived on 10 nov: Campanhas, Produtos, Países and Atribuição
    // read "não há dados neste mês" while the Resumo said "não teve vendas em 1–10 nov".
    expect(isFrozenWindow(sw, { from: '2026-11-01', to: '2026-11-24' }, '2026-11-24', none)).toBe(false)
    expect(isFrozenWindow(sw, { from: '2026-11-10', to: '2026-11-24' }, '2026-11-24', none)).toBe(false)
    expect(isFrozenWindow(sw, { from: '2026-11-11', to: '2026-11-24' }, '2026-11-24', none)).toBe(true)
  })
})

describe('frozenTailOf / archivedEmptyVerdict (the Resumo\'s frozenTail, for the other pages)', () => {
  const base = {
    storeName: 'Squishy World', archivedOn: '2026-11-10', period: 'mtd' as const,
    range: { from: '2026-11-01', to: '2026-11-24' }, today: '2026-11-24', rangeLabel: '1–24 nov', dayLabel: null, totals: sumPnL([]),
  }
  const none = { orders: 0, revenue: 0, spend: 0 }
  it('finds the archive day inside a window that runs past it', () => {
    expect(frozenTailOf('2026-11-10', { from: '2026-11-01', to: '2026-11-24' })).toBe('2026-11-10')
    expect(frozenTailOf('2026-11-10', { from: '2026-11-10', to: '2026-11-16' })).toBe('2026-11-10')
    expect(frozenTailOf('2026-11-10', { from: '2026-10-01', to: '2026-10-31' })).toBeNull()
    expect(frozenTailOf('2026-11-10', { from: '2026-11-11', to: '2026-11-24' })).toBeNull()
    expect(frozenTailOf('2026-11-10', { from: '2026-11-01', to: '2026-11-10' })).toBeNull()
    expect(frozenTailOf(null, { from: '2026-11-01', to: '2026-11-24' })).toBeNull()
  })
  it('Este mês reads like the Resumo: no sales in 1–10 nov, nothing read after', () => {
    const v = archivedEmptyVerdict(base, none)!
    expect(v.headline).toBe('A Squishy World não teve vendas em 1–10 nov.')
    expect(v.chips.map(c => c.label)).toEqual(['Sem vendas no período'])
    expect(v.notes.map(n => n.text)).toEqual(['A Squishy World foi arquivada em 10 nov e não sincroniza mais: não há dados dos dias seguintes.'])
    expect(v.frozen).toBeNull()
    expect(v.amount).toBeNull()
  })
  it('a window after the archive day is still the frozen verdict, and a window with activity gets the page\'s own', () => {
    expect(archivedEmptyVerdict({ ...base, period: '7d', range: { from: '2026-11-17', to: '2026-11-23' } }, none)?.frozen?.date).toBe('2026-11-10')
    expect(archivedEmptyVerdict(base, { ...none, orders: 2, revenue: 80 })).toBeNull()
    expect(archivedEmptyVerdict({ ...base, period: 'lastmonth', range: { from: '2026-10-01', to: '2026-10-31' } }, none)).toBeNull()
  })
  it('the note for a page with activity in the days read', () => {
    expect(frozenTailNote({ storeName: 'Squishy World', archivedOn: '2026-11-10', range: base.range, today: base.today }).text)
      .toBe('A Squishy World foi arquivada em 10 nov e não sincroniza mais: não há dados dos dias seguintes.')
  })
})

describe('frozenVerdict', () => {
  it('reads like the Resumo\'s frozen verdict', () => {
    const v = frozenVerdict({
      storeName: 'Squishy World', archivedOn: '2026-11-10', period: '7d',
      range: { from: '2026-11-17', to: '2026-11-23' }, today: '2026-11-24',
      rangeLabel: '17–23 nov', dayLabel: null, totals: sumPnL([]),
    })
    expect(v.headline).toBe('A Squishy World está arquivada desde 10 nov e não sincroniza mais: não há dados nos últimos 7 dias.')
    expect(v.chips.map(c => c.label)).toEqual(['Sem sincronização'])
    expect(v.amount).toBeNull()
    expect(v.amountCaption).toBe('loja arquivada: nada é lido depois disso')
    expect(v.details[0].text).toBe('Para ver o histórico, escolha um período até 10 nov, quando a loja ainda sincronizava.')
    expect(v.frozen).toEqual({ date: '2026-11-10', text: '10 nov' })
    // The year joins the date when the window is in another year.
    const old = frozenVerdict({
      storeName: 'X', archivedOn: '2025-12-20', period: 'custom', range: { from: '2026-01-05', to: '2026-01-10' },
      today: '2026-11-24', rangeLabel: '5–10 jan', dayLabel: null, totals: sumPnL([]), configured: false,
    })
    expect(old.headline).toContain('desde 20 dez 2025')
    expect(old.chips.map(c => c.code)).toEqual(['sem_vendas', 'sem_custos'])
  })
})

describe('StoreKpis with an empty window', () => {
  const ctx = { rangeLabel: '1–31 out' } as unknown as PageContext
  const html = renderToStaticMarkup(createElement(StoreKpis, {
    ctx, summary: {} as unknown as StoreSummary, empty: { kind: 'before_start', firstSale: '7 nov' },
  }))
  it('shows "—" and the reason on every card, with no $0 and no "nenhum pedido"', () => {
    expect(html.match(/a loja ainda não vendia \(1ª venda em 7 nov\)/g)).toHaveLength(7)
    expect(html).not.toContain('$0')
    expect(html).not.toContain('nenhum pedido no período')
    expect(html).toContain('Receita')
    expect(html).toContain('Margem e lucro por pedido')
  })
})
