import { describe, expect, it } from 'vitest'
import { campaignFilterText } from '../campaignFilter'
import { noSpendWhen } from '../creativeVerdict'

describe('campaignFilterText', () => {
  it('keeps the filter line when the campaign has ads in the window', () => {
    expect(campaignFilterText({ name: 'CBO - CHRISTMAS CAPY', inWindow: true, storeName: 'MOKOO', when: 'em 25 out – 23 nov' }))
      .toEqual({ title: 'Só os anúncios de "CBO - CHRISTMAS CAPY".', note: null })
  })

  it('says the campaign had nothing in the window instead of listing every ad', () => {
    // MOKOO, ?campanha=120248112744190625 after "7 dias": the tab listed all
    // 362 ads of the store with no word about the filter.
    const when = noSpendWhen({ from: '2026-11-17', to: '2026-11-23' }, '2026-11-24')
    expect(campaignFilterText({ name: 'CBO - HAPPY CAPY HALLOWEEN - USA', inWindow: false, storeName: 'MOKOO', when })).toEqual({
      title: 'Só os anúncios de "CBO - HAPPY CAPY HALLOWEEN - USA".',
      note: 'A campanha não teve gasto nem venda em 17–23 nov.',
    })
    expect(campaignFilterText({ name: 'X', inWindow: false, storeName: 'MOKOO', when: noSpendWhen({ from: '2026-11-24', to: '2026-11-24' }, '2026-11-24') }).note)
      .toBe('A campanha não teve gasto nem venda hoje.')
  })

  it('never names another store\'s campaign and says why the list is empty', () => {
    // A MOKOO campaign id carried to EPOCH by the store picker.
    const t = campaignFilterText({ name: null, inWindow: false, storeName: 'EPOCH ®️', when: 'em 25 out – 23 nov' })
    expect(t.title).toBe('Filtro de campanha de outra loja.')
    expect(t.note).toBe('A campanha deste link não é da EPOCH ®️: nenhum anúncio dela aparece aqui.')
  })
})
