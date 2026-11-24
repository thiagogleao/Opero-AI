import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import type { PageContext } from '@/lib/views/page'
import { PageHeader, splitChipText } from '../PageHeader'

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
