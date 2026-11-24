import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InsightsCard } from '../InsightsCard'
import { nothingToReadText, type NothingToRead } from '../insightsModel'

// Regression: the card refused only a window before the first sale, while the
// server refuses every window that, with the one before it, is empty. Squishy
// World's 17–23 nov (archived on 10 nov) and Glooty's 20–23 nov (last spend 15
// nov) offered "Gerar leitura" for a call that could only return no_data.

const req = { storeId: '75cbc00a-8877-434a-8c84-a07797ce31ed', from: '2026-11-17', to: '2026-11-23', split: false }
const render = (nothingToRead?: NothingToRead | null) =>
  renderToStaticMarkup(createElement(InsightsCard, { ...req, nothingToRead }))

describe('InsightsCard with nothing to read', () => {
  it('an archived store after its archive day: says so and offers no generation', () => {
    const html = render({ kind: 'frozen', storeName: 'Squishy World', archivedOn: '10 nov' })
    expect(html).toContain('Sem dados para a IA ler')
    expect(html).toContain('A Squishy World está arquivada desde 10 nov')
    expect(html).toContain('Escolha um período até 10 nov.')
    expect(html).not.toContain('Gerar leitura')
    expect(html).not.toContain('Procurando leitura guardada')
  })

  it('a quiet window and the one before it: names both, as the server would', () => {
    const html = render({ kind: 'quiet', window: '20–23 nov', previous: '16–19 nov' })
    expect(html).toContain('Nada para a IA ler neste período')
    expect(html).toContain('em 20–23 nov nem em 16–19 nov')
    expect(html).not.toContain('Gerar leitura')
  })

  it('without it, the live card (cache check first)', () => {
    expect(render(null)).toContain('Procurando leitura guardada')
    expect(render()).toContain('Procurando leitura guardada')
  })

  it('an archive day that is not known reads without a date', () => {
    const t = nothingToReadText({ kind: 'frozen', storeName: 'X', archivedOn: null })
    expect(t.text).toBe('A X está arquivada e não sincroniza mais: a IA não tem números deste período para ler.')
  })

  it('notStarted wins over nothingToRead (the store did not exist yet)', () => {
    const html = renderToStaticMarkup(createElement(InsightsCard, {
      ...req, notStarted: { storeName: 'Hibikura', firstSale: '7 nov' }, nothingToRead: { kind: 'quiet', window: 'a', previous: 'b' },
    }))
    expect(html).toContain('A loja ainda não vendia nesse período')
    expect(html).not.toContain('Nada para a IA ler')
  })
})
