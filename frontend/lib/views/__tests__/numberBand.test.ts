import { describe, expect, it } from 'vitest'
import { sumPnL, type PnL, type PnLLines } from '../../engine/pnl'
import { buildVerdict, type ComparisonWindow, type VerdictInput, type VerdictStore } from '../verdict'
import { bandDelta, buildNumberBand, chipRank, FEW_ORDERS_INFO, followBand, roasChannelTag, tagged, ticketOf, type BandTile, type NumberBand } from '../numberBand'
import { MIN_ORDERS } from '../verdict'
import { roasGapPct } from '../../../components/ui/roasReason'

// The engine's own derive(), so every ratio is the engine's.
const pnl = (over: Partial<PnLLines> = {}): PnL => sumPnL([{ ...sumPnL([]), ...over }])

function store(over: Partial<VerdictStore> & Pick<VerdictStore, 'id' | 'name' | 'totals'>): VerdictStore {
  return {
    timezone: 'America/Sao_Paulo', configured: true, comparison: null,
    partial: false, minutesCovered: 1440, dayState: 'complete', ...over,
  }
}

const MTD_CMP: ComparisonWindow = {
  from: '2026-10-01', to: '2026-10-25', label: 'mesmos dias do mês passado', sameTimeOfDay: true, cutoffMinutes: 13 * 60 + 52,
  short: 'vs 1–25 out até 13h52', full: 'vs mesmos dias do mês passado (1–25 out, até 13h52)', rangeText: '1–25 out (até 13h52)',
}
const SEVEN: ComparisonWindow = { from: '2026-11-03', to: '2026-11-09', label: '7 dias anteriores', sameTimeOfDay: false }

const NOW = pnl({ revenue: 46350, orders: 571, cogs: 12000, shopifyFees: 1500, shipping: 2514, metaSpend: 25906, shopSpend: 554, chargebacks: 900, chargebackFees: 21, chargebackCount: 8 })
const LOSS = pnl({ revenue: 35283, orders: 565, cogs: 11000, shopifyFees: 1100, shipping: 1000, metaSpend: 26800, shopSpend: 0 })

function band(input: VerdictInput, scope: 'store' | 'all' = input.stores.length > 1 ? 'all' : 'store', extra: Partial<Parameters<typeof buildNumberBand>[0]> = {}): NumberBand {
  return buildNumberBand({ input, verdict: buildVerdict(input), scope, ...extra })
}
const tile = (b: NumberBand, key: BandTile['key']) => b.tiles.find(t => t.key === key)!

function mtd(over: Partial<VerdictInput> = {}, st: Partial<VerdictStore> = {}): VerdictInput {
  return {
    stores: [store({ id: 'm', name: 'MOKOO', timezone: 'America/Belem', totals: NOW, partial: true, minutesCovered: 13 * 60 + 52, dayState: 'running',
      comparison: { included: true, totals: LOSS }, ...st })],
    period: 'mtd', range: { from: '2026-11-01', to: '2026-11-25' }, today: '2026-11-25',
    anchorTimezone: 'America/Belem', comparison: MTD_CMP, ...over,
  }
}

describe('MOKOO · Este mês: profit after a loss', () => {
  const b = band(mtd())

  it('has six tiles in the fixed order, lucro and margem xl', () => {
    expect(b.tiles.map(t => t.key)).toEqual(['lucro', 'margem', 'receita', 'pedidos', 'anuncios', 'roas'])
    expect(b.tiles.map(t => t.size)).toEqual(['xl', 'xl', 'md', 'md', 'md', 'md'])
  })

  it('reads lucro from the verdict and compares it with "era" over a loss base', () => {
    const l = tile(b, 'lucro')
    expect(l.label).toBe('Lucro real')
    expect(l.raw).toBeCloseTo(NOW.operatingProfit, 6)
    expect(l.tone).toBe('pos')
    expect(l.delta?.kind).toBe('was')
    expect(l.delta?.dir).toBe('up')
    expect(l.delta?.text).toMatch(/^era −⁠\$/)
    expect(l.subs.some(s => /por pedido$/.test(s.text))).toBe(true)
  })

  it('margem is the engine margin, compared in points', () => {
    const m = tile(b, 'margem')
    expect(m.raw).toBeCloseTo(NOW.margin!, 6)
    expect(m.delta?.kind).toBe('pp')
    expect(m.delta?.text).toMatch(/p\.p\.$/)
  })

  it('receita and anúncios move in percent, in neutral colour', () => {
    expect(tile(b, 'receita').delta).toMatchObject({ kind: 'pct', dir: 'up', good: 'neutral', text: '31%' })
    expect(tile(b, 'anuncios').delta).toMatchObject({ kind: 'pct', dir: 'down', good: 'neutral' })
    expect(tile(b, 'anuncios').subs.map(s => s.text)).toEqual(['Meta $25.906', 'Shopify $554'])
    expect(tile(b, 'anuncios').phoneSub?.text).toBe('Meta $25.906 · Shopify $554')
  })

  it('pedidos carries the ticket (receita ÷ pedidos)', () => {
    expect(tile(b, 'pedidos').value).toBe('571')
    expect(tile(b, 'pedidos').subs[0].text).toBe(`ticket $${(46350 / 571).toFixed(2).replace('.', ',')}`)
    expect(ticketOf(NOW)).toBeCloseTo(46350 / 571, 9)
  })

  it('the ROAS tile is the Meta ROAS, tagged "só Meta", with the gauge gap and "era"', () => {
    const r = tile(b, 'roas')
    expect(r.label).toBe('ROAS do Meta × empate')
    expect(r.value).toBe('1,79×')
    expect(r.tags.map(t => t.label)).toContain('só Meta')
    expect(r.tags.find(t => t.label === 'só Meta')?.info).toContain('$554 de Anúncios Shopify')
    const be = NOW.breakEvenRoas!
    const gap = roasGapPct(46350 / 25906, be)!
    expect(r.subs[0].text).toBe(`empate ${be.toFixed(2).replace('.', ',')}× · ${Math.abs(gap)}% ${gap >= 0 ? 'acima' : 'abaixo'}`)
    expect(r.delta).toMatchObject({ kind: 'was', text: 'era 1,32×' })
    expect(r.gauge?.roas).toBeCloseTo(46350 / 25906, 9)
  })

  it('says the comparison once, in lib/period\'s words', () => {
    expect(b.comparison).toEqual({ short: 'vs 1–25 out até 13h52', full: 'vs mesmos dias do mês passado (1–25 out, até 13h52)', kind: 'ok' })
    expect(tile(b, 'receita').delta?.aria).toContain('vs mesmos dias do mês passado')
  })

  it('status line: the verdict chips with their infos; the prose goes to Detalhes', () => {
    expect(b.status.map(c => c.label)).toEqual(['No lucro', 'Margem fina', 'parcial · até 13h52'])
    expect(b.status[2].info).toContain('Os números mudam até o dia fechar.')
    expect(b.details.headline).toMatch(/^A MOKOO está no lucro neste mês/)
    expect(b.details.lines.length).toBeGreaterThan(0)
    expect(b.details.roasExplain).toContain('Cada $1 no Meta')
    expect(b.details.count).toBe(1 + b.details.lines.length + 1 + b.details.notes.length + 1)
    expect(b.empty).toBeNull()
  })
})

describe('deltas', () => {
  const vs = { short: 'vs 3–9 nov', full: 'vs 7 dias anteriores (3–9 nov)' }
  it('plain percent between two profits', () => {
    expect(bandDelta('money_result', 1313.07, 1869.4, vs)).toMatchObject({ kind: 'pct', dir: 'down', good: 'down', text: '30%' })
  })
  it('dollars over a tiny base', () => {
    expect(bandDelta('money_result', 250, 20, vs)).toMatchObject({ kind: 'diff', dir: 'up', text: '$230 a mais' })
  })
  it('"era" across zero, coloured by the direction', () => {
    expect(bandDelta('money_result', -163, 400, vs)).toMatchObject({ kind: 'was', dir: 'down', good: 'down', text: 'era $400' })
  })
  it('flat inside half a percent', () => {
    expect(bandDelta('money', 1000, 1003, vs)).toMatchObject({ kind: 'pct', dir: 'flat', text: '0%' })
  })
  it('nothing on either side is no news, but keeps its row', () => {
    expect(bandDelta('count', 0, 0, vs)).toMatchObject({ kind: 'none', text: '' })
  })
  it('ROAS never becomes a percentage', () => {
    expect(bandDelta('roas', 1.79, 1.3, vs)).toMatchObject({ kind: 'was', dir: 'up', text: 'era 1,30×' })
  })
})

describe('Glooty · revenue − ads, no base', () => {
  const g = pnl({ revenue: 1118, orders: 14, metaSpend: 2925 })
  const input = mtd(
    { comparison: { ...MTD_CMP, none: 'sem base: a loja começou em 4 nov' } },
    { id: 'g', name: 'Glooty', configured: false, totals: g, comparison: { included: false, totals: pnl({}) }, firstOrderDate: '2026-11-06' },
  )
  const b = band(input)

  it('labels the number for what it is and tags the missing costs', () => {
    const l = tile(b, 'lucro')
    expect(l.label).toBe('Receita − anúncios')
    expect(l.value).toBe('−⁠$1.807')
    expect(l.tags.map(t => t.label)).toContain('sem custos')
    expect(tile(b, 'margem').value).toBe('—')
    expect(tile(b, 'margem').tags.map(t => t.label)).toEqual(['custos não configurados'])
    expect(tile(b, 'roas').subs[0].text).toBe('empate desconhecido → custos não configurados')
  })

  it('every delta row reads "sem base", and the comparison text is R6\'s', () => {
    for (const t of b.tiles) expect(t.delta?.text).toBe('sem base')
    expect(b.comparison).toEqual({
      short: 'sem base: a loja começou em 4 nov',
      // r2: the ⓘ says this is the first activity day, not the first sale.
      full: 'sem base: a loja começou em 4 nov (começou = o primeiro dia com venda ou anúncio; a primeira venda pode ter vindo depois)',
      kind: 'none',
    })
  })

  it('the costs chip links to the settings', () => {
    const c = b.status.find(x => x.label === 'Custos não configurados')
    expect(c?.action).toBe('configure_costs')
  })
})

describe('CAMP HALLOW · no sales, chargebacks', () => {
  const input = mtd({}, {
    id: 'c', name: 'CAMP HALLOW', totals: pnl({ chargebacks: 900, chargebackFees: 21, chargebackCount: 8 }),
    comparison: { included: true, totals: pnl({ revenue: 43472, orders: 500, cogs: 6000, metaSpend: 993 }) },
  })
  const b = band(input)
  it('lucro is "—" with the verdict\'s cash words and its previous profit (not revenue)', () => {
    const l = tile(b, 'lucro')
    expect(l.value).toBe('—')
    expect(l.subs[0]).toEqual({ text: '−⁠$921 no caixa · 8 chargebacks', tone: 'neg' })
    expect(l.delta).toMatchObject({ kind: 'was', dir: null, good: null })
    expect(l.delta?.text).toBe(`era $${Math.round(43472 - 6000 - 993).toLocaleString('pt-BR')}`)
  })
  it('receita falls 100%', () => {
    expect(tile(b, 'receita').delta).toMatchObject({ kind: 'pct', dir: 'down', text: '100%' })
  })
  it('page tags land on their tiles', () => {
    const tagged = band(input, 'store', { tileTags: { anuncios: [{ code: 'conta_compartilhada', label: 'anúncios na conta da EPOCH ®️', tone: 'info' }] } })
    expect(tile(tagged, 'anuncios').tags.map(t => t.label)).toEqual(['anúncios na conta da EPOCH ®️'])
  })
})

describe('empty windows', () => {
  it('frozen archived store: every tile "—", no delta rows, no comparison', () => {
    const input: VerdictInput = {
      stores: [store({ id: 's', name: 'Squishy World', archived: true, archivedOn: '2026-11-10', totals: pnl({}) })],
      period: '7d', range: { from: '2026-11-18', to: '2026-11-24' }, today: '2026-11-25',
      anchorTimezone: 'America/Sao_Paulo', comparison: null,
    }
    const b = band(input)
    expect(b.empty?.kind).toBe('frozen')
    expect(b.tiles.every(t => t.value === '—' && t.delta === null)).toBe(true)
    expect(b.comparison).toBeNull()
    expect(b.status.map(c => c.label)).toEqual(['Sem sincronização'])
  })
  it('before the first sale: not_yet, "Vende desde"', () => {
    const input: VerdictInput = {
      stores: [store({ id: 'h', name: 'Hibikura', timezone: 'Asia/Tokyo', totals: pnl({}), firstOrderDate: '2026-11-07', comparison: { included: true, totals: pnl({}) } })],
      period: 'lastmonth', range: { from: '2026-10-01', to: '2026-10-31' }, today: '2026-11-25',
      anchorTimezone: 'Asia/Tokyo', comparison: { from: '2026-09-01', to: '2026-09-30', label: 'mês anterior', sameTimeOfDay: false },
    }
    const b = band(input)
    expect(b.empty?.kind).toBe('not_yet')
    expect(b.tiles.every(t => t.value === '—' && t.delta === null)).toBe(true)
    expect(b.status[0].label).toBe('Vende desde 7 nov')
  })
  it('a store with no sales and no spend: lucro "—" with the caption', () => {
    const input = mtd({ comparison: SEVEN, period: '7d', range: { from: '2026-11-10', to: '2026-11-16' }, today: '2026-11-17' },
      { totals: pnl({}), partial: false, minutesCovered: 1440, dayState: 'complete', comparison: { included: true, totals: pnl({}) } })
    const b = band(input)
    expect(tile(b, 'lucro').value).toBe('—')
    expect(tile(b, 'lucro').subs).toEqual([{ text: 'nenhum pedido no período', tone: 'mut' }])
    expect(tile(b, 'margem').value).toBe('—')
    expect(tile(b, 'roas').subs[0].text).toBe('sem gasto em anúncios')
    expect(b.comparison?.kind).toBe('empty_base')
    expect(tile(b, 'receita').delta?.text).toBe('sem comparação')
  })
})

describe('partial base', () => {
  it('reads "base incompleta" on every tile', () => {
    const b = band(mtd({ comparison: { ...MTD_CMP, partialBase: 'a Hibikura começou a vender em 7 out' } }))
    for (const t of b.tiles) expect(t.delta?.text).toBe('base incompleta')
    expect(b.comparison).toMatchObject({ kind: 'partial', short: 'a Hibikura começou a vender em 7 out · a variação não é medida' })
  })
})

describe('partner view (parte=50)', () => {
  const whole = band(mtd())
  const half = band(mtd({ split: true }))
  it('halves lucro only, tags it and keeps the whole store in a sub line', () => {
    expect(tile(half, 'lucro').raw).toBeCloseTo(tile(whole, 'lucro').raw! / 2, 6)
    expect(tile(half, 'lucro').tags.map(t => t.label)).toContain('sua parte (50%)')
    expect(tile(half, 'lucro').subs[0].text).toBe(`loja inteira ${tile(whole, 'lucro').value}`)
    expect(tile(half, 'lucro').info).toContain('só o lucro é dividido')
    for (const k of ['margem', 'receita', 'pedidos', 'anuncios', 'roas'] as const) {
      expect(tile(half, k).value).toBe(tile(whole, k).value)
    }
  })
  it('halves a "was" on both sides', () => {
    expect(tile(half, 'lucro').delta?.previousText).toBe(`−⁠$${Math.round(-LOSS.operatingProfit / 2).toLocaleString('pt-BR')}`)
  })
})

describe('Todas · excluded store and a store new since the base', () => {
  const mk = (id: string, name: string, totals: PnL, prev: PnL | null, over: Partial<VerdictStore> = {}) =>
    store({ id, name, totals, comparison: prev ? { included: true, totals: prev } : { included: false, totals: pnl({}) }, ...over })
  const input: VerdictInput = {
    stores: [
      mk('m', 'MOKOO', pnl({ revenue: 20000, orders: 250, cogs: 6000, metaSpend: 9000 }), pnl({ revenue: 15000, orders: 200, cogs: 5000, metaSpend: 9000 })),
      mk('d', 'Dumpling', pnl({ revenue: 10000, orders: 120, cogs: 3000, metaSpend: 2000, shopSpend: 2000 }), pnl({ revenue: 9000, orders: 110, cogs: 3000, metaSpend: 1500, shopSpend: 1500 })),
      mk('h', 'Hibikura', pnl({ revenue: 2000, orders: 20, cogs: 500, metaSpend: 900 }), null, { firstOrderDate: '2026-11-07' }),
      mk('g', 'Glooty', pnl({ revenue: 1118, orders: 14, metaSpend: 2925 }), null, { configured: false, firstOrderDate: '2026-11-06' }),
    ],
    period: 'mtd', range: { from: '2026-11-01', to: '2026-11-25' }, today: '2026-11-25', anchorTimezone: 'America/Sao_Paulo',
    comparison: { ...MTD_CMP, leftOut: ['Hibikura'] }, subject: 'Suas lojas',
  }
  const v = buildVerdict(input)
  const b = buildNumberBand({ input, verdict: v, scope: 'all' })

  it('sums only the stores with costs, and says who is out', () => {
    expect(tile(b, 'receita').raw).toBe(32000)
    expect(tile(b, 'receita').info).toContain('sem Glooty (receita $1.118, anúncios $2.925)')
    const chip = b.status.find(c => c.label === '1 loja sem custos')
    expect(chip?.info).toBe('Glooty fica fora da soma: sem custos configurados (receita − anúncios: −⁠$1.807).')
    expect(b.status.find(c => c.code === 'lojas_na_soma')?.label).toBe('3 lojas na soma')
  })

  it('compares like for like and names the store left out', () => {
    expect(b.comparison?.short).toBe('vs 1–25 out até 13h52 · sem Hibikura')
    // Like for like: 30.000 now (without Hibikura) vs 24.000 before = 25%.
    expect(tile(b, 'receita').delta?.text).toBe('25%')
  })

  it('ROAS of the judged sum, tagged as such', () => {
    const r = tile(b, 'roas')
    expect(r.tags.map(t => t.label)).toEqual(['Meta + Shopify', 'soma das lojas'])
    expect(r.tags[1].info).toContain('Não é a média dos ROAS das lojas. Glooty (sem custos) fica fora.')
  })
})

describe('ROAS channel change', () => {
  it('no ROAS delta when the base was measured on another channel', () => {
    const input = mtd({}, { comparison: { included: true, totals: pnl({ revenue: 30000, orders: 400, cogs: 9000, metaSpend: 9000, shopSpend: 9000 }) } })
    const b = band(input)
    expect(tile(b, 'roas').delta).toMatchObject({ kind: 'none', text: 'outro canal' })
  })
})

describe('JPY store and the Tokyo clock', () => {
  it('carries the page tag on receita and merges the phone clock chip', () => {
    const input = mtd({ clockDiffers: true, anchorTimezone: 'Asia/Tokyo' }, { id: 'h', name: 'Hibikura', timezone: 'Asia/Tokyo' })
    const b = band(input, 'store', {
      tileTags: { receita: [{ code: 'moeda', label: 'vende em JPY', tone: 'info' }] },
      extraChips: [{ code: 'fuso', label: 'dia de Tóquio · 02h00', tone: 'info', info: 'Tóquio está 12 h à frente deste aparelho.' }],
    })
    expect(tile(b, 'receita').tags.map(t => t.label)).toEqual(['vende em JPY'])
    const fuso = b.status.filter(c => c.code === 'dia_fuso')
    expect(fuso.map(c => c.label)).toEqual(['dia de Tóquio · 02h00'])
  })
})

describe('chip fold priority', () => {
  it('keeps the status chip and the costs chip over the quiet store', () => {
    expect(chipRank({ code: 'lucro', label: '', tone: 'pos' })).toBeLessThan(chipRank({ code: 'quieta', label: '', tone: 'neu' }))
    expect(chipRank({ code: 'conta_compartilhada', label: '', tone: 'warn' })).toBeLessThan(chipRank({ code: 'margem_fina', label: '', tone: 'warn' }))
  })
})

// ─── Review round 1 ──────────────────────────────────────────────────────────

describe('r1 · the "Cedo demais" chip drives C4 even when verdict.early is false', () => {
  it('neutral deltas and a "cedo" tag on lucro (Hibikura Hoje at 03h: no sales, spend)', () => {
    const input = mtd()
    const v0 = buildVerdict(input)
    const v = { ...v0, early: false, chips: [{ code: 'cedo' as const, label: 'Cedo demais para julgar', tone: 'neu' as const, icon: 'clock' as const }, ...v0.chips.filter(c => c.code !== 'lucro')] }
    const b = buildNumberBand({ input, verdict: v, scope: 'store' })
    for (const t of b.tiles) if (t.delta && t.delta.good !== null) expect(t.delta.good).toBe('neutral')
    expect(tile(b, 'lucro').tags.map(t => t.code)).toContain('cedo')
  })
})

describe('r1 · Todas "era" deltas with stores left out', () => {
  const mk = (id: string, name: string, totals: PnL, prev: PnL | null, over: Partial<VerdictStore> = {}) =>
    store({ id, name, totals, comparison: prev ? { included: true, totals: prev } : { included: false, totals: pnl({}) }, ...over })
  const input: VerdictInput = {
    stores: [
      mk('m', 'MOKOO', pnl({ revenue: 20000, orders: 250, cogs: 6000, metaSpend: 9000 }), pnl({ revenue: 15000, orders: 200, cogs: 5000, metaSpend: 9000 })),
      mk('d', 'Dumpling', pnl({ revenue: 10000, orders: 120, cogs: 3000, metaSpend: 2000, shopSpend: 2000 }), pnl({ revenue: 9000, orders: 110, cogs: 3000, metaSpend: 1500, shopSpend: 1500 })),
      mk('h', 'Hibikura', pnl({ revenue: 2000, orders: 20, cogs: 500, metaSpend: 900 }), null, { firstOrderDate: '2026-11-07' }),
    ],
    period: 'mtd', range: { from: '2026-11-01', to: '2026-11-25' }, today: '2026-11-25', anchorTimezone: 'America/Sao_Paulo',
    comparison: { ...MTD_CMP, leftOut: ['Hibikura'] }, subject: 'Suas lojas',
  }
  const b = band(input, 'all')
  it('drops the arrow of an "era" (it compared the like-for-like sum) and says that value in the aria', () => {
    const r = tile(b, 'roas').delta!
    expect(r.kind).toBe('was')
    expect(r.dir).toBeNull()
    expect(r.aria).toMatch(/^sem Hibikura: .+ agora; era /)
  })
  it('keeps percentages as they are', () => {
    expect(tile(b, 'receita').delta).toMatchObject({ kind: 'pct', dir: 'up' })
  })
})

describe('r1 · ROAS "outro canal" keeps the previous value', () => {
  it('previousText and an aria that says why it is not compared', () => {
    const input = mtd({}, { comparison: { included: true, totals: pnl({ revenue: 30000, orders: 400, cogs: 9000, metaSpend: 9000, shopSpend: 9000 }) } })
    const d = tile(band(input), 'roas').delta!
    expect(d.previousText).toBe('1,67×')
    expect(d.aria).toMatch(/^outro canal: o ROAS de antes \(1,67×\) foi medido em .+, o de agora em .+: a variação não se compara/)
  })
  it('a "subiu; era" aria reads as two clauses', () => {
    expect(tile(band(mtd()), 'lucro').delta?.aria).toMatch(/^subiu; era /)
  })
})

describe('r1 · roasChannelTag is the band\'s one rule', () => {
  it('só Meta / Meta / Meta + Shopify / só Shopify', () => {
    expect(roasChannelTag(NOW, 'meta')?.label).toBe('só Meta')
    expect(roasChannelTag(LOSS, 'meta')?.label).toBe('Meta')
    expect(roasChannelTag(NOW, 'both')?.label).toBe('Meta + Shopify')
    expect(roasChannelTag(NOW, 'shop')?.label).toBe('só Shopify')
    expect(roasChannelTag(NOW, null)).toBeNull()
  })
})

describe('r2 · a thin comparison base (Hibikura · Este mês: 16 orders, no ads)', () => {
  const BASE = pnl({ revenue: 652, orders: 16, cogs: 200, shopifyFees: 20, shipping: 106, metaSpend: 0, shopSpend: 0 })
  const b = band(mtd({}, { comparison: { included: true, totals: BASE } }))

  it('says the base size once, beside the comparison words', () => {
    expect(b.comparison?.short).toBe('vs 1–25 out até 13h52 · base: 16 pedidos, sem anúncios')
    expect(b.comparison?.full).toContain('Na base, 16 pedidos e nenhum gasto em anúncios')
  })
  it('keeps the margin delta but drops its colour; lucro keeps its own', () => {
    const m = tile(b, 'margem').delta!
    expect(m.kind).toBe('pp')
    expect(m.good).toBe('neutral')
    expect(m.aria).toContain('(base de 16 pedidos, sem anúncios)')
    expect(tile(b, 'lucro').delta?.good).not.toBe('neutral')
  })
  it('the ROAS row says why there is no delta', () => {
    expect(tile(b, 'roas').delta).toMatchObject({ kind: 'none', text: 'sem gasto antes' })
    expect(tile(b, 'roas').delta?.aria).toContain('1–25 out')
  })
  it('a normal base changes nothing', () => {
    const plain = band(mtd())
    expect(plain.comparison?.short).toBe('vs 1–25 out até 13h52')
    expect(tile(plain, 'margem').delta?.good).not.toBe('neutral')
  })
})

// ─── Review round 3 ──────────────────────────────────────────────────────────

describe('r3 · the no-delta reason says its tag once', () => {
  it('"sem base: a loja começou em 4 nov", not "sem base: sem base: …"', () => {
    const input = mtd(
      { comparison: { ...MTD_CMP, none: 'sem base: a loja começou em 4 nov' } },
      { comparison: { included: false, totals: pnl({}) } },
    )
    for (const t of band(input).tiles) expect(t.delta?.aria).toBe('sem base: a loja começou em 4 nov')
  })
  it('a reason that does not open with the tag still gets it', () => {
    const b = band(mtd({ comparison: { ...MTD_CMP, partialBase: 'a Hibikura começou a vender em 7 out' } }))
    expect(tile(b, 'lucro').delta?.aria).toBe('base incompleta: a Hibikura começou a vender em 7 out · a variação não é medida')
    expect(tagged('sem base', 'sem base de comparação')).toBe('sem base de comparação')
  })
})

describe('r3 · partner view on Todas: the ⓘ names the sum, not one store', () => {
  const mk = (id: string, name: string, totals: PnL, prev: PnL) => store({ id, name, totals, comparison: { included: true, totals: prev } })
  const input: VerdictInput = {
    stores: [mk('m', 'MOKOO', NOW, LOSS), mk('d', 'Dumpling', NOW, LOSS)],
    period: 'mtd', range: { from: '2026-11-01', to: '2026-11-25' }, today: '2026-11-25', anchorTimezone: 'America/Sao_Paulo',
    comparison: MTD_CMP, subject: 'Suas lojas', split: true,
  }
  it('says "soma inteira das lojas" on Todas and "loja inteira" on one store', () => {
    expect(tile(band(input, 'all'), 'lucro').info).toContain('são da soma inteira das lojas, antes da divisão')
    expect(tile(band(input, 'all'), 'lucro').info).not.toContain('loja inteira.')
    expect(tile(band(mtd({ split: true })), 'lucro').info).toContain('são da loja inteira')
  })
})

describe('r3 · the "poucos pedidos" text follows MIN_ORDERS', () => {
  it('builds the number from the threshold', () => {
    expect(FEW_ORDERS_INFO).toBe(`Menos de ${MIN_ORDERS} pedidos no período: pouca amostra para cravar uma tendência.`)
  })
})

describe('r3 · followBand: deltas outside the band obey its comparison state', () => {
  it('measures under a measured comparison, with the band words', () => {
    const b = band(mtd())
    const d = followBand(b, 'money', 120, 100)!
    expect(d).toMatchObject({ kind: 'pct', text: '20%', good: 'neutral' })
    expect(d.aria).toContain(b.comparison!.full)
  })
  it('no row under base incompleta, sem base or an empty base', () => {
    expect(followBand(band(mtd({ comparison: { ...MTD_CMP, partialBase: 'a Hibikura começou a vender em 7 out' } })), 'money', 120, 100)).toBeNull()
    expect(followBand(band(mtd({ comparison: { ...MTD_CMP, none: 'sem base: a loja começou em 4 nov' } }, { comparison: { included: false, totals: pnl({}) } })), 'money_result', 12, 10)).toBeNull()
    expect(followBand({ comparison: null }, 'money', 120, 100)).toBeNull()
  })
  it('uncoloured while the day is too young to judge', () => {
    expect(followBand({ ...band(mtd()), early: true }, 'money_result', 12, 10)?.good).toBe('neutral')
    expect(followBand({ ...band(mtd()), early: false }, 'money_result', 12, 10)?.good).toBe('up')
  })
  it('judges a halved money result on the whole numbers (k)', () => {
    const b = band(mtd())
    // $40 → $60 is the viewer's half of $80 → $120: a 50% rise on a base the
    // percentage rule reads (≥ $50), not "$20 a mais" on a halved base.
    expect(followBand(b, 'money_result', 60, 40, 0.5)).toMatchObject({ kind: 'pct', text: '50%' })
    expect(followBand(b, 'money_result', 60, 40)).toMatchObject({ kind: 'diff' })
  })
})
