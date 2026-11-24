import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { ProfitPreviewResponse } from '@/lib/data/profitConfig'
import { sumPnL } from '@/lib/engine/pnl'
import { emptyPreviewText, emptyPreviewWhy, type EmptyPreviewInput } from '../emptyPreview'
import { PreviewPanel } from '../PreviewPanel'

// Regression: Custos' preview for Squishy World's 17–23 nov (archived on 10
// nov) read "Sem vendas … Escolha um período maior", while every block of the
// Resumo for the same window says "sem dados: loja arquivada desde 10 nov" —
// and no longer window ending on 23 nov has data either. Its "Hoje" also
// carried "inclui hoje, parcial" although an archived store has no running day.

const SW: EmptyPreviewInput = {
  range: { from: '2026-11-17', to: '2026-11-23' }, today: '2026-11-24',
  firstSale: '2026-09-02', archived: true, archivedOn: '2026-11-10',
}
const text = (i: EmptyPreviewInput) => {
  const t = emptyPreviewText(emptyPreviewWhy(i))
  return { title: t.title, line: t.parts.map(p => p.text).join(''), strong: t.parts.filter(p => p.strong).map(p => p.text) }
}

describe('emptyPreviewWhy / emptyPreviewText', () => {
  it('an archived store after its archive day: sem dados, pick a window up to that day', () => {
    expect(emptyPreviewWhy(SW)).toEqual({ kind: 'frozen', archivedOn: '10 nov' })
    const t = text(SW)
    expect(t.title).toBe('Sem dados')
    expect(t.line).toBe('A loja está arquivada desde 10 nov: nada é lido depois disso, não há o que precificar. Para ver o histórico, escolha um período até 10 nov no topo da página.')
    expect(t.strong).toEqual(['10 nov', '10 nov'])
    expect(t.line).not.toContain('maior')
  })

  it('its current day too (the running day of an archived store is never read)', () => {
    expect(emptyPreviewWhy({ ...SW, range: { from: '2026-11-24', to: '2026-11-24' } })).toEqual({ kind: 'frozen', archivedOn: '10 nov' })
    // Archive day unknown: only the current day is known to be unread.
    const unknown = { ...SW, archivedOn: null, range: { from: '2026-11-24', to: '2026-11-24' } }
    expect(emptyPreviewWhy(unknown)).toEqual({ kind: 'frozen', archivedOn: null })
    expect(text(unknown).line).toContain('escolha no topo da página um período de quando a loja ainda sincronizava')
    expect(emptyPreviewWhy({ ...SW, archivedOn: null })).toBeNull()
  })

  it('a window that reaches the archive day was read up to it: an ordinary empty window', () => {
    expect(emptyPreviewWhy({ ...SW, range: { from: '2026-11-01', to: '2026-11-10' } })).toBeNull()
    expect(emptyPreviewWhy({ ...SW, range: { from: '2026-11-10', to: '2026-11-16' } })).toBeNull()
    expect(text({ ...SW, range: { from: '2026-11-01', to: '2026-11-10' } }).line).toContain('Escolha um período maior no topo da página.')
  })

  it('an active store is never frozen', () => {
    expect(emptyPreviewWhy({ ...SW, archived: false, archivedOn: null })).toBeNull()
    expect(emptyPreviewWhy({ ...SW, archived: false, archivedOn: null, range: { from: '2026-11-24', to: '2026-11-24' } })).toBeNull()
  })

  it('before the first sale (unchanged wording), and it wins over archived', () => {
    const hib = { range: { from: '2026-10-25', to: '2026-11-05' }, today: '2026-11-24', firstSale: '2026-11-07', archived: false, archivedOn: null }
    expect(emptyPreviewWhy(hib)).toEqual({ kind: 'before_start', firstSale: '7 nov' })
    const t = text(hib)
    expect(t.title).toBe('Sem vendas')
    expect(t.line).toBe('Nenhum pedido e nenhum anúncio neste período: não há o que precificar. Escolha um período a partir de 7 nov no topo da página.')
    expect(emptyPreviewWhy({ ...hib, archived: true, archivedOn: '2026-11-01' })).toEqual({ kind: 'before_start', firstSale: '7 nov' })
  })

  it('dates carry the year when the window is in another year', () => {
    const old = { ...SW, range: { from: '2025-12-01', to: '2025-12-07' }, firstSale: '2025-09-02', archivedOn: '2025-11-10' }
    expect(emptyPreviewWhy(old)).toEqual({ kind: 'frozen', archivedOn: '10 nov 2025' })
  })
})

const empty = sumPnL([])
const preview = (partial: boolean, range = SW.range, label = '17–23 nov'): ProfitPreviewResponse => ({
  store: { id: '75cbc00a-8877-434a-8c84-a07797ce31ed', name: 'Squishy World', timezone: 'America/Sao_Paulo', archived: true },
  period: '7d', range, label, partial, source: 'saved', configured: true, version: 'v1',
  totals: empty, daily: [],
  breakdown: { totalCost: 0, lines: [], bySection: [], extraCosts: [], coverage: null },
  saved: null, changed: false, issues: [], warnings: [],
})
const render = (p: Partial<Parameters<typeof PreviewPanel>[0]>) => renderToStaticMarkup(createElement(PreviewPanel, {
  preview: preview(false), busy: false, error: null, onRetry: () => {}, dirty: false,
  periodLabel: 'Últimos 7 dias', partialLabel: null, split: false, ...p,
}))

describe('PreviewPanel empty window', () => {
  it('archived after the archive day: "Sem dados", the archive day, no "maior"', () => {
    const html = render({ emptyWhy: emptyPreviewWhy(SW), archived: true })
    expect(html).toContain('Sem dados')
    expect(html).toContain('A loja está arquivada desde ')
    expect(html).toContain('<b class="num">10 nov</b>')
    expect(html).not.toContain('Sem vendas')
    expect(html).not.toContain('período maior')
  })

  it('without a reason (the window shown is not the page\'s): the plain wording', () => {
    const html = render({ emptyWhy: null })
    expect(html).toContain('Sem vendas')
    expect(html).toContain('Escolha um período maior no topo da página.')
  })

  it('an archived store\'s Hoje carries no "parcial" chip; an active store\'s does', () => {
    const today = { from: '2026-11-24', to: '2026-11-24' }
    const archived = render({ preview: preview(true, today, '24 nov'), periodLabel: 'Hoje', archived: true, emptyWhy: emptyPreviewWhy({ ...SW, range: today }) })
    expect(archived).not.toContain('parcial')
    expect(archived).toContain('Sem dados')
    const active = render({ preview: preview(true, today, '24 nov'), periodLabel: 'Hoje', partialLabel: 'parcial · até 13h38' })
    expect(active).toContain('parcial · até 13h38')
  })
})
