import { describe, expect, it } from 'vitest'
import { metaSpendSplitText, partsSummingTo } from '../metaSpendSplit'

const CAMP = 'ae929078-camp'
const names = (id: string) => (id === CAMP ? 'CAMP HALLOW' : null)

describe('metaSpendSplitText', () => {
  it('names the own spend whose orders landed in another store, so the parts add up to the books', () => {
    // EPOCH, 1–31 out (getProductReport, read-only): Meta $47.220 in the engine.
    const text = metaSpendSplitText({
      attributedSpend: 6670.91, billedElsewhere: 0, ownSpendCreditedElsewhere: 15202.58,
      ownSpendCreditedElsewhereByStore: [{ storeId: CAMP, spend: 15202.58 }], unlinkedSpend: 25346.51,
    }, 47220, names)
    expect(text).toBe(
      'Meta ligado = gasto dos anúncios que a jornada da Shopify liga aos pedidos de cada produto ($6.671). '
      + 'Do gasto no Meta desta loja ($47.220): $6.671 ligado aos produtos daqui, $15.203 em anúncios cujos pedidos caíram em outra loja (CAMP HALLOW) '
      + 'e $25.346 sem nenhum pedido do período ligado.',
    )
  })

  it('keeps a store with nothing credited elsewhere to linked + unlinked', () => {
    const text = metaSpendSplitText({
      attributedSpend: 2000, billedElsewhere: 0, ownSpendCreditedElsewhere: 0, ownSpendCreditedElsewhereByStore: [], unlinkedSpend: 3925.22,
    }, 5925.22, names)
    expect(text).toContain('Do gasto no Meta desta loja ($5.925): $2.000 ligado aos produtos daqui e $3.925 sem nenhum pedido do período ligado.')
    expect(text).not.toContain('outra loja')
  })

  it('says linked spend billed in another store, and skips the split without Meta spend of its own', () => {
    const text = metaSpendSplitText({
      attributedSpend: 2954, billedElsewhere: 2954, ownSpendCreditedElsewhere: 0, ownSpendCreditedElsewhereByStore: [], unlinkedSpend: 0,
    }, 0, names)
    expect(text).toBe('Meta ligado = gasto dos anúncios que a jornada da Shopify liga aos pedidos de cada produto ($2.954); $2.954 disso foi pago na conta de outra loja.')
  })

  it('never names a store the viewer cannot see', () => {
    const text = metaSpendSplitText({
      attributedSpend: 100, billedElsewhere: 0, ownSpendCreditedElsewhere: 50, ownSpendCreditedElsewhereByStore: [{ storeId: 'x', spend: 50 }], unlinkedSpend: 50,
    }, 200, names)
    expect(text).toContain('caíram em outra loja e ')
    expect(text).not.toContain('outra loja (')
  })
})

describe('partsSummingTo', () => {
  it('rounds whole dollars so the parts read as their total', () => {
    expect(partsSummingTo([6670.91, 15202.58, 25346.51], 47220)).toEqual(['$6.671', '$15.203', '$25.346'])
    expect(partsSummingTo([10.5, 20.25], 30.75)).toEqual(['$10,50', '$20,25'])
  })
})
