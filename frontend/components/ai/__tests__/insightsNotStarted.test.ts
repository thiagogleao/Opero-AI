import { createElement } from 'react'
import { renderToStaticMarkup } from 'react-dom/server'
import { describe, expect, it } from 'vitest'
import { InsightsCard } from '../InsightsCard'
import { describeAiError } from '../errors'
import { notStartedText } from '../insightsModel'

// Regression: Hibikura on 28 out – 3 nov (first sale 7 nov). The verdict, the
// ledger, the KPIs and every block said the store did not sell yet, while the
// "Leitura da IA" card offered "Gerar leitura de 28 out – 3 nov · Leva até 1
// minuto" — a paid model call over an empty fact sheet. Glooty in October
// (first sale 6 nov) got the same card.

const req = { storeId: '0344f31b-bd37-4674-8696-7555f3d98417', from: '2026-10-28', to: '2026-11-03', split: false }
const render = (notStarted?: { storeName: string; firstSale: string } | null) =>
  renderToStaticMarkup(createElement(InsightsCard, { ...req, notStarted }))

describe('InsightsCard before the store\'s first sale', () => {
  it('says the store did not sell yet, with the first sale, and offers no generation', () => {
    const html = render({ storeName: 'Hibikura', firstSale: '7 nov' })
    expect(html).toContain('Leitura da IA')
    expect(html).toContain('A loja ainda não vendia nesse período')
    expect(html).toContain('A Hibikura começou a vender em 7 nov')
    expect(html).toContain('Escolha um período a partir de 7 nov.')
    expect(html).not.toContain('Gerar leitura')
    expect(html).not.toContain('Leva até 1 minuto')
    // Not the live card waiting on the server's cache check: it never asks.
    expect(html).not.toContain('Procurando leitura guardada')
    expect(html).not.toContain('aria-busy')
  })

  it('a store that already sold keeps the live card (cache check first, then the button)', () => {
    for (const html of [render(), render(null)]) {
      expect(html).toContain('Procurando leitura guardada')
      expect(html).not.toContain('A loja ainda não vendia')
    }
  })

  it('words match the ledger and verdict ("começou a vender em …", "a partir de …")', () => {
    const t = notStartedText({ storeName: 'Glooty', firstSale: '6 nov' })
    expect(t.title).toBe('A loja ainda não vendia nesse período')
    expect(t.text).toMatch(/^A Glooty começou a vender em 6 nov: /)
    expect(t.text).toMatch(/a partir de 6 nov\.$/)
  })
})

describe('no_data (the server refused an empty fact sheet)', () => {
  it('is final, not a retry', () => {
    const e = describeAiError({ code: 'no_data', serverMessage: 'x' }, 'insights')
    expect(e.code).toBe('no_data')
    expect(e.retry).toBe(false)
    expect(e.title).toBe('Nada para ler neste período')
  })
})
