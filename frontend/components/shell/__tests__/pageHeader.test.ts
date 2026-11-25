import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PageContext } from '@/lib/views/page'
import { PageHeader, PeriodHeading, PeriodNote, periodName, periodNoteText, splitChipText } from '../PageHeader'

// Regression: with ?parte=50 the header said "sua parte (50%)" on every page,
// also right above Produtos' "$7.313 de contribuição dos produtos" — the
// whole store's figure, which a partner could read as their half. Pages that
// halve nothing (Produtos, Países, Atribuição, Campanhas · Todas, Ajustes)
// pass halved={false} and the chip says so; every chip explains the rule.

const MOKOO = 'user_3CVoVQYfnj1Ljnm3tf0iHP40fxX'

const MOKOO_OPTION = { id: MOKOO, name: 'MOKOO', shopName: 'MOKOO', code: '6k7fjw', timezone: 'America/Belem', city: 'Belém', dayLabel: null, archived: false }

function ctx(split: boolean): PageContext {
  return {
    scope: 'store', split, rangeNote: null, rangeLabel: '16–22 nov', periodLabel: 'Últimos 7 dias',
    scopeName: 'MOKOO', selected: [], store: { id: MOKOO, name: 'MOKOO', archived: false },
    storeOption: MOKOO_OPTION, storeOptions: [MOKOO_OPTION],
    resolution: { selection: { period: { kind: 'preset', preset: '7d' } }, label: { short: 'Últimos 7 dias', full: 'Últimos 7 dias · 16–22 nov' } },
    noteLine: null,
  } as unknown as PageContext
}

const render = (split: boolean, halved?: boolean) =>
  renderToStaticMarkup(createElement(PageHeader, { ctx: ctx(split), title: 'Produtos · MOKOO', ...(halved === undefined ? {} : { halved }) }))

describe('PageHeader partner-split chip', () => {
  it('is absent without the split', () => {
    expect(render(false)).not.toContain('sua parte')
    expect(render(false, false)).not.toContain('sua parte')
  })

  it('on a page that halves money results, says "sua parte (50%)" and explains what is halved', () => {
    const html = render(true)
    expect(html).toContain('>sua parte (50%)<')
    expect(html).toContain(`title="${splitChipText(true).title}"`)
    expect(splitChipText(true).title).toMatch(/margens, ROAS e empate ficam inteiros/)
  })

  it('on a page that halves nothing, says nothing here is halved', () => {
    const html = render(true, false)
    expect(html).toContain('sua parte (50%) · nada é dividido aqui')
    expect(html).not.toContain('>sua parte (50%)<')
    expect(html).toContain(`title="${splitChipText(false).title}"`)
    expect(splitChipText(false).title).toMatch(/contribuição/)
  })
})

// Regression: the header looked the store up in storeOptions, which leaves
// out an archived store opened for its history — its code pill and "dia de …"
// chip went missing while the sidebar card showed them.
describe('PageHeader of an archived store', () => {
  function archived(timezone: string, city: string, dayLabel: string | null): PageContext {
    const option = { id: 'old', name: 'Velha', shopName: 'Velha', code: '7ad04d', timezone, city, dayLabel, archived: true }
    return {
      scope: 'store', split: false, rangeNote: null, rangeLabel: '2 jun – 31 out', period: 'custom',
      scopeName: 'Velha', selected: [], store: { id: 'old', name: 'Velha', archived: true },
      storeOption: option, storeOptions: [MOKOO_OPTION],
    } as unknown as PageContext
  }
  const html = (c: PageContext) => renderToStaticMarkup(createElement(PageHeader, { ctx: c, sub: 'x' }))

  it('shows its code pill and says it is archived', () => {
    const out = html(archived('America/Sao_Paulo', 'São Paulo', null))
    expect(out).toContain('7ad04d')
    expect(out).toContain('arquivada')
    expect(out).not.toContain('dia de')
  })

  it('names its day when it is not Brazil\'s', () => {
    expect(html(archived('Asia/Tokyo', 'Tóquio', 'dia de Tóquio'))).toContain('dia de Tóquio')
  })
})

// Dates a Todas row (or Atribuição's link) read on another clock carry the
// preset they stand for (?volta, lib/views/page): the header said "Período
// escolhido" for dates the owner never picked.
// The period's name is lib/period's one naming function (Resolution.label,
// R7): no row dates exist any more, so no "Hoje de Todas as lojas".
describe('periodName', () => {
  const res = (period: unknown, short: string, full: string) =>
    ({ resolution: { selection: { period }, label: { short, full } } }) as unknown as PageContext
  it('a preset is named by its label; dates by themselves, as asked', () => {
    expect(periodName(res({ kind: 'preset', preset: '7d' }, 'Últimos 7 dias', 'Últimos 7 dias · 16–22 nov'))).toBe('Últimos 7 dias')
    expect(periodName(res({ kind: 'dates', from: '2026-11-24', to: '2026-11-24' }, '24 nov (hoje)', '24 nov (hoje)'))).toBe('24 nov (hoje)')
    expect(periodName(res({ kind: 'dates', from: '2026-11-25', to: '2026-11-25' }, '25 nov', '25 nov · ainda não começou em Brasília'))).toBe('25 nov · ainda não começou em Brasília')
  })
  it('the landing note reads under the header', () => {
    const c = { ...ctx(false), noteLine: 'Hoje na Hibikura é 25 nov (dia de Tóquio). Em Todas as lojas, Hoje é 24 nov.' } as unknown as PageContext
    expect(renderToStaticMarkup(createElement(PageHeader, { ctx: c }))).toContain('Hoje na Hibikura é 25 nov (dia de Tóquio).')
  })
})

// An archived store (lib/views/page archivedWindow): Squishy World, archived
// on 10 nov. Its "Este mês" said only "nada depois do arquivamento é lido"
// beside a chip comparing 1–24 out cut at the live hour; its "7 dias" said
// "Hoje (24 nov) ainda está em andamento" for a store that reads no day.
describe('PeriodNote of an archived store', () => {
  const base = {
    scope: 'store', store: { id: '75cb', name: 'Squishy World', archived: true }, timezone: 'America/Sao_Paulo',
    today: '2026-11-24', partial: false, rangeNote: null, selected: [], params: { loja: '75cb', periodo: 'mtd', de: null, ate: null, parte: false },
    archivedOn: '2026-11-10', readRange: null,
  }
  const note = (over: Record<string, unknown>, compared = false) =>
    periodNoteText({ ...base, ...over } as unknown as PageContext, { compared })
  const mtd = {
    period: 'mtd', range: { from: '2026-11-01', to: '2026-11-24' }, rangeLabel: '1–24 nov',
    readRange: { from: '2026-11-01', to: '2026-11-10' },
    comparison: { from: '2026-10-01', to: '2026-10-10', label: 'mesmos dias do mês passado', sameTimeOfDay: false },
    comparisonRangeLabel: '1–10 out',
  }

  it('Este mês past the archive day names the read days and, on the Resumo, what they are compared with', () => {
    expect(note(mtd, true)).toBe('1–24 nov no horário de São Paulo. A loja foi arquivada em 10 nov e não sincroniza mais: só 1–10 nov foram lidos, e estes números não mudam. A comparação usa os mesmos dias do mês passado: 1–10 out.')
    // Pages that compare nothing (Atribuição sets Meta against Shopify) say no comparison sentence.
    expect(note(mtd)).toBe('1–24 nov no horário de São Paulo. A loja foi arquivada em 10 nov e não sincroniza mais: só 1–10 nov foram lidos, e estes números não mudam.')
    const html = renderToStaticMarkup(createElement(PeriodNote, { ctx: { ...base, ...mtd } as unknown as PageContext, compared: true }))
    expect(html).toContain('A comparação usa os mesmos dias do mês passado: 1–10 out.')
  })

  it('one read day agrees in the singular', () => {
    expect(note({
      period: '7d', range: { from: '2026-11-10', to: '2026-11-16' }, rangeLabel: '10–16 nov',
      readRange: { from: '2026-11-10', to: '2026-11-10' },
      comparison: { from: '2026-11-09', to: '2026-11-09', label: 'dia anterior', sameTimeOfDay: false },
      comparisonRangeLabel: '9 nov',
    }, true)).toContain('só 10 nov foi lido, e estes números não mudam. A comparação usa o dia anterior: 9 nov.')
  })

  it('a window wholly after the archive day: nothing read, no day in progress', () => {
    const out = note({ period: '7d', range: { from: '2026-11-17', to: '2026-11-23' }, rangeLabel: '17–23 nov' })
    expect(out).toBe('17–23 nov no horário de São Paulo. A loja foi arquivada em 10 nov e não sincroniza mais: nada desses dias foi lido.')
    expect(note({ period: 'today', range: { from: '2026-11-24', to: '2026-11-24' }, rangeLabel: '24 nov' }))
      .toContain('nada desse dia foi lido.')
  })

  it('a window ending on the archive day was read whole', () => {
    expect(note({ period: 'custom', range: { from: '2026-11-01', to: '2026-11-10' }, rangeLabel: '1–10 nov' }))
      .toBe('1–10 nov no horário de São Paulo. A loja foi arquivada em 10 nov, o último dia lido, e estes números não mudam.')
  })

  it('a window before the archive day reads like any other, without a day in progress', () => {
    expect(note({ period: 'lastmonth', range: { from: '2026-10-01', to: '2026-10-31' }, rangeLabel: '1–31 out' }))
      .toBe('O mês passado inteiro, no horário de São Paulo.')
    expect(note({ archivedOn: '2026-11-24', period: '7d', range: { from: '2026-11-17', to: '2026-11-23' }, rangeLabel: '17–23 nov' }))
      .toBe('São 7 dias fechados no horário de São Paulo.')
  })

  it('without the archive day, a window reaching today keeps the general sentence', () => {
    expect(note({ archivedOn: null, period: 'mtd', range: { from: '2026-11-01', to: '2026-11-24' }, rangeLabel: '1–24 nov' }))
      .toBe('1–24 nov no horário de São Paulo. A loja está arquivada e não sincroniza mais: nada depois do arquivamento é lido, e estes números não mudam.')
  })

  it('an active store on 7 dias still says today is in progress', () => {
    expect(note({ store: { id: 'm', name: 'MOKOO', archived: false }, archivedOn: null, period: '7d', range: { from: '2026-11-17', to: '2026-11-23' }, rangeLabel: '17–23 nov' }))
      .toBe('São 7 dias fechados no horário de São Paulo. Hoje (24 nov) ainda está em andamento: fica fora da soma.')
  })
})

describe('PeriodHeading (R7: one name)', () => {
  it('r3 F7 · a custom range is said once ("Atribuição · 10–20 nov"), a preset with its dates', () => {
    const custom = {
      rangeLabel: '10–20 nov',
      resolution: { selection: { period: { kind: 'dates', from: '2026-11-10', to: '2026-11-20' } }, label: { short: '10–20 nov', full: '10–20 nov' } },
    } as unknown as PageContext
    const html = renderToStaticMarkup(createElement(PeriodHeading, { ctx: custom })).replace(/<!-- -->/g, '')
    expect(html.match(/10–20 nov/g)).toHaveLength(1)
    const preset = renderToStaticMarkup(createElement(PeriodHeading, { ctx: ctx(false) })).replace(/<!-- -->/g, '')
    expect(preset).toBe('<b>Últimos 7 dias</b> · <span class="num">16–22 nov</span>')
  })
})
