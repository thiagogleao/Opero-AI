import { describe, expect, it, vi } from 'vitest'
import { INSIGHTS_MAX_ITEMS } from '../config'
import { insightsKey, TtlCache } from '../insights/cache'
import { nothingToRead, type InsightsFacts } from '../insights/facts'
import { generateInsights, InsightsFailure } from '../insights/run'
import type { TotalsView } from '../views'
import { INSIGHTS_SCHEMA, insightsSystemPrompt } from '../insights/prompt'
import { numberIndex, parseInsights, valueVerified } from '../insights/result'

const SHEET = [
  '- Receita: $34,073.10 · 312 pedidos · ticket médio $109.21',
  '- Lucro operacional: -$274.00 (margem 12.3%)',
  '- ROAS de empate: 1.55x',
  '- [anúncio 120249] "video — Cópia" · gasto $558.36 · ROAS do Meta 0.97x',
].join('\n')

const card = (over: Record<string, unknown> = {}) => ({
  kind: 'parar', title: 'Desligue o vídeo', detail: 'Gastou $558.36 com ROAS 0.97x, abaixo do empate 1.55x.',
  action: 'Pausar no Gerenciador de Anúncios', confidence: 'alta', sample: '$558.36 em 21 dias',
  evidence: [{ label: 'gasto', value: '$558.36' }, { label: 'ROAS do Meta', value: '0.97x' }],
  target: { type: 'anuncio', id: '120249', name: 'video — Cópia' },
  ...over,
})

describe('evidence verification', () => {
  const idx = numberIndex(SHEET)
  it('accepts numbers printed on the sheet, rounded or not', () => {
    expect(valueVerified('$558.36', idx)).toBe(true)
    expect(valueVerified('$558', idx)).toBe(true)
    expect(valueVerified('$34,073.10', idx)).toBe(true)
    expect(valueVerified('12%', idx)).toBe(true)
    expect(valueVerified('prejuízo de $274.00', idx)).toBe(true)
    expect(valueVerified('1.55x', idx)).toBe(true)
    expect(valueVerified('sem número', idx)).toBe(true)
  })
  it('flags numbers that are not on the sheet', () => {
    expect(valueVerified('$600.00', idx)).toBe(false)
    expect(valueVerified('2.41x', idx)).toBe(false)
    expect(valueVerified('35%', idx)).toBe(false)
  })
})

describe('parseInsights', () => {
  const idx = numberIndex(SHEET)
  it('keeps valid cards and marks unverified evidence', () => {
    const out = parseInsights(JSON.stringify({
      summary: 'Lucro de -$274.00.',
      insights: [card(), card({ evidence: [{ label: 'gasto', value: '$999.99' }] })],
      dataGaps: ['Sem frequência'],
    }), idx)
    expect(out?.insights).toHaveLength(2)
    expect(out?.insights[0].verified).toBe(true)
    expect(out?.insights[1].verified).toBe(false)
    expect(out?.insights[1].evidence[0].verified).toBe(false)
    expect(out?.dataGaps).toEqual(['Sem frequência'])
  })
  it('accepts zero cards and caps the count', () => {
    expect(parseInsights(JSON.stringify({ summary: 'Nada se destaca.', insights: [], dataGaps: [] }), idx)?.insights).toEqual([])
    const many = parseInsights(JSON.stringify({ summary: 's', insights: Array.from({ length: 10 }, () => card()), dataGaps: [] }), idx)
    expect(many?.insights).toHaveLength(INSIGHTS_MAX_ITEMS)
  })
  it('drops malformed cards and rejects non-JSON', () => {
    const out = parseInsights(JSON.stringify({ summary: 's', insights: [card({ kind: 'mágica' }), card({ title: '' }), 3], dataGaps: 'x' }), idx)
    expect(out?.insights).toEqual([])
    expect(out?.dataGaps).toEqual([])
    expect(parseInsights('[{"a":1}] nota final ]', idx)).toBeNull()
    expect(parseInsights('{"insights":[]}', idx)).toBeNull()
  })
})

describe('INSIGHTS_SCHEMA', () => {
  // Structured outputs need additionalProperties:false and every property
  // required on every object, and reject numeric/length constraints.
  function walk(node: unknown, path = '$'): string[] {
    if (!node || typeof node !== 'object') return []
    const n = node as Record<string, unknown>
    const errs: string[] = []
    if (n.type === 'object') {
      if (n.additionalProperties !== false) errs.push(`${path}: additionalProperties`)
      const props = Object.keys((n.properties ?? {}) as object)
      const req = (n.required ?? []) as string[]
      for (const p of props) if (!req.includes(p)) errs.push(`${path}.${p}: not required`)
    }
    for (const k of ['minItems', 'maxItems', 'minimum', 'maximum', 'minLength', 'maxLength']) if (k in n) errs.push(`${path}: ${k}`)
    for (const [k, v] of Object.entries(n)) {
      if (Array.isArray(v)) v.forEach((x, i) => errs.push(...walk(x, `${path}.${k}[${i}]`)))
      else if (v && typeof v === 'object') errs.push(...walk(v, `${path}.${k}`))
    }
    return errs
  }
  it('is valid for structured outputs', () => {
    expect(walk(INSIGHTS_SCHEMA)).toEqual([])
  })
})

describe('insights prompt', () => {
  it('allows uncertainty, requires evidence, and adds the partner rule only with the split', () => {
    const p = insightsSystemPrompt(false)
    expect(p).toMatch(/Incerteza é permitida/)
    expect(p).toMatch(/evidence/)
    expect(p).toMatch(/menos de 30 pedidos/)
    expect(p).not.toMatch(/EXATAMENTE/)
    expect(p).not.toContain('sua parte (50%)')
    expect(insightsSystemPrompt(true)).toContain('sua parte (50%)')
  })
})

describe('insights cache', () => {
  it('expires entries and evicts the oldest when full', () => {
    const c = new TtlCache<number>(1_000, 2)
    c.set('a', 1, 0)
    expect(c.get('a', 999)?.value).toBe(1)
    expect(c.get('a', 1_000)).toBeNull()
    c.set('a', 1, 0); c.set('b', 2, 0); c.set('c', 3, 0)
    expect(c.get('a', 1)).toBeNull()
    expect(c.get('c', 1)?.value).toBe(3)
    expect(c.size).toBe(2)
  })
  it('keys by store, window and split', () => {
    const w = { from: '2026-10-18', to: '2026-11-16' }
    expect(insightsKey('s1', w, true)).not.toBe(insightsKey('s1', w, false))
    expect(insightsKey('s1', w, false)).not.toBe(insightsKey('s2', w, false))
    expect(insightsKey('s1', w, false)).not.toBe(insightsKey('s1', { ...w, from: '2026-10-19' }, false))
  })
})

describe('empty fact sheet (nothingToRead)', () => {
  // A window before the store's first sale (Hibikura 28 out – 3 nov, first
  // sale 7 nov): every total is zero, here and in the window before. The model
  // call is paid; generateInsights refuses before making it.
  const zero = {
    revenue: 0, orders: 0, units: 0, aov: null, productCost: 0, shipping: 0, fees: 0, perOrderExtras: 0,
    variableCosts: 0, contribution: 0, contributionMargin: null, metaSpend: 0, shopSpend: 0, fixedCosts: 0,
    operatingProfit: 0, margin: null, profitPerOrder: null, refundGross: 0, refundCount: 0, refunds: 0,
    chargebacks: 0, chargebackFees: 0, chargebackCount: 0, cashResult: 0, breakEvenRoas: null, roas: null,
    metaRoas: null, metaPurchaseValue: 0, metaPurchases: 0, cac: null,
  } satisfies TotalsView
  const facts = (totals: TotalsView, previousTotals: TotalsView | null) => ({ totals, previousTotals })

  it('is true only when the window and the one before are both empty', () => {
    expect(nothingToRead(facts(zero, zero))).toBe(true)
    expect(nothingToRead(facts(zero, null))).toBe(true)
    // Fixed costs run by the calendar: not activity.
    expect(nothingToRead(facts({ ...zero, fixedCosts: 120, operatingProfit: -120 }, null))).toBe(true)
    // A quiet window after a busy one still goes to the model.
    expect(nothingToRead(facts(zero, { ...zero, revenue: 980, orders: 12 }))).toBe(false)
    // Ad spend before launch was really spent.
    expect(nothingToRead(facts({ ...zero, metaSpend: 41.2 }, null))).toBe(false)
    expect(nothingToRead(facts({ ...zero, shopSpend: 5 }, null))).toBe(false)
    expect(nothingToRead(facts({ ...zero, refundCount: 1 }, null))).toBe(false)
    expect(nothingToRead(facts({ ...zero, chargebackCount: 1 }, null))).toBe(false)
    expect(nothingToRead(facts({ ...zero, revenue: null }, null))).toBe(true)
  })

  it('generateInsights refuses with no_data without opening a model stream', async () => {
    const open = vi.fn()
    const send = vi.fn()
    const f = { ...facts(zero, null), ctx: { id: 's', name: 'Hibikura' } } as unknown as InsightsFacts
    const err = await generateInsights(f, send, new AbortController().signal, open, { viewerKey: 'v', ttlMs: 1 })
      .then(() => null, (e: unknown) => e)
    expect(err).toBeInstanceOf(InsightsFailure)
    expect((err as InsightsFailure).code).toBe('no_data')
    expect(open).not.toHaveBeenCalled()
    expect(send).not.toHaveBeenCalled()
  })
})
