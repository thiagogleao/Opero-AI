import { describe, expect, it } from 'vitest'
import { pairNotes, pairCountIn, type SharedAds } from '../sharedAds'

// EPOCH pays the ads that sold for CAMP HALLOW (CLAUDE.md).
const SHARED: SharedAds = {
  pairs: [{ adStoreId: 'e', adStoreName: 'EPOCH', salesStoreId: 'c', salesStoreName: 'CAMP HALLOW', orders: 409, revenue: 43000 }],
  badges: {}, lookbackDays: 90,
}
const known = (now: number | null, base: number | null) => ({
  now: now === null ? null : [{ adStoreId: 'e', salesStoreId: 'c', orders: now }],
  base: base === null ? null : [{ adStoreId: 'e', salesStoreId: 'c', orders: base }],
  baseRange: '1–25 out',
})
const orders = () => null

describe('r3 · phone pair notes with the comparison base (desktop R2-1)', () => {
  it('without a read, the cautious wording and no base', () => {
    const [n] = pairNotes(SHARED, { all: false, storeId: 'e' }, '1–25 nov', orders)
    expect(n).toMatchObject({ tone: 'warn', chip: 'paga anúncios da CAMP HALLOW', tag: 'paga CAMP HALLOW', now: null, base: 0 })
    expect(n.body).toContain('se parte do gasto deste período vendeu')
  })
  it('EPOCH · Este mês: a clean window over a mixed base names the base', () => {
    const [n] = pairNotes(SHARED, { all: false, storeId: 'e' }, '1–25 nov', orders, undefined, { known: known(0, 409), deltas: true })
    expect(n).toMatchObject({ tone: 'warn', chip: 'base misturada com a CAMP HALLOW', now: 0, base: 409 })
    expect(n.body).toContain('nenhum pedido rastreado da CAMP HALLOW veio de anúncios da EPOCH')
    expect(n.body).toContain('Na base da comparação (1–25 out), 409 pedidos da CAMP HALLOW vieram de anúncios pagos pela EPOCH')
  })
  it('CAMP HALLOW · Este mês: the chip says its base had ads on EPOCH', () => {
    const [n] = pairNotes(SHARED, { all: false, storeId: 'c' }, '1–25 nov', () => 0, undefined, { known: known(0, 409), deltas: true })
    expect(n.chip).toBe('base com anúncios na EPOCH')
    expect(n.body).not.toMatch(/não está misturado\.$/)
    expect(n.body).toContain('Na base da comparação')
  })
  it('no deltas on screen: the base is said in the ⓘ, the chip keeps the pair words', () => {
    const [n] = pairNotes(SHARED, { all: false, storeId: 'e' }, '1–25 nov', orders, undefined, { known: known(0, 3), deltas: false })
    expect(n).toMatchObject({ tone: 'info', chip: 'paga anúncios da CAMP HALLOW' })
    expect(n.body).toContain('3 pedidos da CAMP HALLOW vieram')
  })
  it('a mixed window read exactly uses the definite wording', () => {
    const [n] = pairNotes(SHARED, { all: false, storeId: 'e' }, '1–25 out', orders, undefined, { known: known(12, null), deltas: true })
    expect(n).toMatchObject({ tone: 'warn', title: 'A EPOCH paga anúncios que vendem na CAMP HALLOW', base: 0 })
    expect(n.body).toMatch(/^Em 1–25 out, 12 pedidos da CAMP HALLOW vieram de anúncios pagos pela EPOCH\. O gasto está aqui e a venda lá/)
  })
  it('pairCountIn: 0 when the pair is absent, null when the read failed', () => {
    expect(pairCountIn([], { adStoreId: 'e', salesStoreId: 'c' })).toBe(0)
    expect(pairCountIn(null, { adStoreId: 'e', salesStoreId: 'c' })).toBeNull()
  })
})
