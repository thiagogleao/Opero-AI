import { describe, expect, it } from 'vitest'
import { metaCountriesEmpty, metaElsewhereText } from '../metaEmpty'

describe('metaCountriesEmpty', () => {
  it('blames a missing Meta report only when there was spend to break down', () => {
    // MOKOO 7d: $6.615 of Meta, 0% of it broken down by country.
    expect(metaCountriesEmpty({ metaSpend: 6614.85 })).toEqual({
      title: 'Sem divisão por país do Meta neste período',
      body: 'O Meta não entregou o detalhamento por país para estas datas.',
    })
  })

  it('says there was no Meta spend for a store that spent nothing', () => {
    // Glooty 17–23 nov and Hibikura in October: meta 0.00 in the engine.
    const e = metaCountriesEmpty({ metaSpend: 0 })
    expect(e.title).toBe('Sem gasto no Meta neste período')
    expect(e.body).not.toContain('não entregou')
  })

  it('says where the ads are paid when another store carries them', () => {
    // CAMP HALLOW 25 out – 23 nov: 4 orders came from ads in EPOCH's account.
    const elsewhere = metaElsewhereText([{ name: 'EPOCH ®️', orders: 4 }])
    expect(elsewhere).toBe('Os anúncios que trouxeram 4 pedidos daqui neste período rodam na conta da EPOCH ®️: o gasto deles, e a divisão por país, ficam na contabilidade da EPOCH ®️.')
    expect(metaCountriesEmpty({ metaSpend: 0, elsewhere })).toEqual({ title: 'Sem gasto no Meta neste período', body: elsewhere })
    expect(metaElsewhereText([])).toBeNull()
  })

  it('names spend left out as shared-account instead of calling it no spend', () => {
    const e = metaCountriesEmpty({ metaSpend: 0, sharedSpend: 120 })
    expect(e.title).toBe('Sem gasto próprio no Meta neste período')
    expect(e.body).toContain('conta compartilhada')
  })
})
