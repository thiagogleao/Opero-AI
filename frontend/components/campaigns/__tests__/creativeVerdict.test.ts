import { describe, expect, it } from 'vitest'
import type { CreativeDay, CreativeDetail, CreativeRow } from '@/lib/data/creatives'
import type { PnL } from '@/lib/engine/pnl'
import { buildCreativeVerdict, noSpendWhen } from '../creativeVerdict'

const day = (date: string, spend: number, estimatedProfit: number | null): CreativeDay => ({
  date, spend, purchaseValue: 0, purchases: 0, impressions: 0, linkClicks: 0, roas: spend > 0 ? 1 : null, estimatedProfit,
})

function detail(over: Record<string, unknown> = {}): CreativeDetail {
  const best = day('2026-11-12', 40, 30.5)
  const worst = day('2026-11-15', 60, -54.58)
  const creative = {
    adId: '1', name: 'CRI2', known: true, status: 'ACTIVE', running: true, campaignId: 'c', campaignName: 'C',
    adsetId: null, adsetName: null, thumbnailUrl: null, creativeUrl: null, previewExpired: false, landingUrl: null, createdTime: null,
    shared: null, estimatedProfit: -24.08, daysWithSpend: 2, lastSpendDay: '2026-11-15', video: null, hookRate: null,
    frequency: null, verdict: { signal: 'ok', reason: 'Dentro dos limites' },
    spend: 100, purchaseValue: 120, purchases: 3, impressions: 1000, linkClicks: 20,
    roas: 1.2, cpa: 33.33, ctr: 2, cpm: 100, cpc: 5, aov: 40,
    ...over,
  } as unknown as CreativeRow
  return {
    storeId: 's', timezone: 'America/Sao_Paulo', range: { from: '2026-11-11', to: '2026-11-17' }, configured: true,
    contributionRate: 0.6, breakEvenRoas: 1.6, verdictWindow: { from: '2026-11-11', to: '2026-11-17' }, verdictBreakEvenRoas: 1.6,
    formula: 'f', creative, daily: [best, worst],
    bestDay: best, worstDay: worst, hasSpend: true, format: 'video', lastSpendDayEver: '2026-11-15', notes: { hookRate: 'h', frequency: 'f' },
  }
}

const input = (split: boolean) => ({
  detail: detail(), storeTotals: { revenue: 1000, contribution: 600 } as PnL, rangeLabel: '11–17 nov',
  periodPhrase: 'nos últimos 7 dias', partialLabel: null, today: '2026-11-18', split,
})

describe('buildCreativeVerdict', () => {
  it('shows the partner every estimated profit as their half: the amount and the best and worst days', () => {
    const whole = buildCreativeVerdict(input(false))
    const half = buildCreativeVerdict(input(true))
    expect(whole.amount).toBeCloseTo(-24.08, 6)
    expect(half.amount).toBeCloseTo(-12.04, 6)
    const days = (v: typeof whole) => v.details.find(d => d.text.startsWith('Melhor dia'))!.text
    expect(days(whole)).toBe('Melhor dia 12 nov ($30,50), pior dia 15 nov (−$54,58) — só dias com $10 ou mais de gasto.')
    // The same days, halved, and said so: the day table below shows the same half.
    expect(days(half)).toBe('Melhor dia 12 nov ($15,25), pior dia 15 nov (−$27,29) — só dias com $10 ou mais de gasto, sua parte do lucro estimado.')
  })

  it('says a shared-account note once, with one period', () => {
    const note = 'Rodou na conta antiga da EPOCH, que também veiculou anúncios da CAMP HALLOW: 100% dos 338 pedidos rastreados dela, desde sempre, caíram em CAMP HALLOW. Não é julgada com a margem desta loja.'
    const shared = { accountId: 'act_x', note, journeyStoreId: null, journeyOrdersHere: 0, journeyOrdersTotal: 338 }
    const d = detail({ shared, estimatedProfit: null, verdict: { signal: null, reason: note } })
    const v = buildCreativeVerdict({ ...input(false), detail: d })
    const all = [...v.details, ...v.notes].map(l => l.text)
    expect(all.filter(t => t.includes('Rodou na conta antiga'))).toHaveLength(1)
    expect(all.join(' ')).not.toMatch(/\.\./)
    expect(v.details[0].text.endsWith('desta loja.')).toBe(true)
  })

  it('adds the period a bare reason lacks', () => {
    const v = buildCreativeVerdict(input(false))
    expect(v.details[0].text).toBe('Dentro dos limites.')
  })

  it("takes the chip's word from the verdict (judged on the closed days), not from this window's ROAS", () => {
    // "Hoje": ROAS 0,00× on the day, kept over the 7 closed days.
    const d = detail({ roas: 0, purchaseValue: 0, purchases: 0, verdict: { signal: 'ok', label: 'Manter', reason: 'Acima do empate (1,65×) nos 7 dias fechados' } })
    const v = buildCreativeVerdict({ ...input(false), detail: d })
    expect(v.chips[0].label).toBe('Manter')
    expect(v.details[0].text).toBe('Acima do empate (1,65×) nos 7 dias fechados.')
  })
})

describe('a verdict judged on other days than the page', () => {
  // "Hoje" 24 nov (Tóquio): the page is the day, the verdict the 7 closed days before it.
  const today = (creative: Record<string, unknown>, page = { from: '2026-11-24', to: '2026-11-24' }) => ({
    ...input(false),
    detail: { ...detail(creative), range: page, verdictWindow: { from: '2026-11-17', to: '2026-11-23' }, breakEvenRoas: 1.34, bestDay: null, worstDay: null },
    rangeLabel: '24 nov', periodPhrase: 'hoje', partialLabel: 'parcial · até 12h16', today: '2026-11-24',
  })
  const kill = { signal: 'kill', label: 'Desligar', reason: 'ROAS 0,00× com $66,13 gastos nos 7 dias fechados — abaixo de 80% do empate (1,34×)' }

  it('names its days on the chip and keeps a profitable day green (Hibikura 52645047117420)', () => {
    const v = buildCreativeVerdict(today({ roas: 5.75, estimatedProfit: 50.3, spend: 15.25, purchaseValue: 87.67, purchases: 1, verdict: kill }))
    expect(v.chips[0]).toMatchObject({ label: 'Desligar · 17–23 nov', tone: 'neg' })
    expect(v.when).toBe('24 nov')
    expect(v.tone).toBe('pos')
    expect(v.amountTone).toBe('pos')
    expect(v.headline).toBe('Este anúncio deu lucro hoje, pela atribuição do Meta: ROAS 5,75× contra empate 1,34×. O veredito vem dos 7 dias fechados (17–23 nov): neles, ficou abaixo de 80% do empate.')
  })

  it('says a "below break-even" verdict is about other days than a profitable custom range (MOKOO 120249710934810625)', () => {
    const below = { signal: 'ok', label: 'Abaixo do empate', reason: 'Abaixo do empate (1,46×) nos 7 dias fechados, mas acima da linha de corte (1,17×)' }
    const v = buildCreativeVerdict({
      ...today({ roas: 3.32, estimatedProfit: 1919, verdict: below }, { from: '2026-10-25', to: '2026-11-05' }),
      rangeLabel: '25 out – 5 nov', periodPhrase: 'em 25 out – 5 nov', partialLabel: null,
    })
    expect(v.chips[0].label).toBe('Abaixo do empate · 17–23 nov')
    expect(v.tone).toBe('pos')
    expect(v.headline).toMatch(/^Este anúncio deu lucro em 25 out – 5 nov, .* O veredito vem dos 7 dias fechados \(17–23 nov\): neles, ficou abaixo do empate\.$/)
  })

  it('says a "keep" verdict is about other days than a window that lost money', () => {
    const keep = { signal: 'ok', label: 'Manter', reason: 'Acima do empate (1,65×) nos 7 dias fechados' }
    const v = buildCreativeVerdict(today({ roas: 0.4, estimatedProfit: -20, verdict: keep }))
    expect(v.chips[0].label).toBe('Manter · 17–23 nov')
    expect(v.tone).toBe('neg')
    expect(v.headline.endsWith('O veredito vem dos 7 dias fechados (17–23 nov): neles, ficou no empate ou acima.')).toBe(true)
  })

  it('adds nothing to the headline when the verdict agrees with the window', () => {
    const scale = { signal: 'scale', label: 'Escalar', reason: 'ROAS 3,10× nos 7 dias fechados — 40% ou mais acima do empate (1,34×) com 9 vendas' }
    const v = buildCreativeVerdict(today({ roas: 4, estimatedProfit: 30, verdict: scale }))
    expect(v.chips[0].label).toBe('Escalar · 17–23 nov')
    expect(v.headline).not.toMatch(/veredito/)
  })

  it('keeps a decided 7-day verdict on an early "Hoje": only the figures of today are early', () => {
    // MOKOO 120249881071720625 at 01h22: Criativos said "Desligar" while this
    // page said "Cedo demais para julgar" over the same kill reason.
    const killed = { signal: 'kill', label: 'Desligar', reason: 'ROAS 0,74× com $793 gastos nos 7 dias fechados — abaixo de 80% do empate desses dias (1,46×)' }
    const v = buildCreativeVerdict({ ...today({ roas: 0, estimatedProfit: -4.1, spend: 4.1, purchaseValue: 0, purchases: 0, verdict: killed }), partialLabel: 'parcial · até 01h22', early: true })
    expect(v.chips[0]).toMatchObject({ label: 'Desligar · 17–23 nov', tone: 'neg' })
    expect(v.chips.some(c => c.label === 'Cedo demais para julgar')).toBe(false)
    expect(v.headline).toBe('Os números de hoje ainda são cedo: o Meta está atribuindo as vendas do dia. O veredito dos 7 dias fechados (17–23 nov) continua valendo: Desligar.')
    expect(v.details[0].text).toBe('ROAS 0,74× com $793 gastos nos 7 dias fechados — abaixo de 80% do empate desses dias (1,46×).')
    // Today's amount is still early: neutral.
    expect(v.amountTone).toBe('neu')
  })

  it('says "Cedo demais" when there is no decided verdict, or when the verdict is the running day itself', () => {
    const none = { signal: null, reason: 'Pouco gasto para julgar nos 7 dias fechados' }
    const a = buildCreativeVerdict({ ...today({ roas: 0, estimatedProfit: -2, spend: 2, verdict: none }), early: true })
    expect(a.chips[0].label).toBe('Cedo demais para julgar')
    expect(a.headline).toBe('Cedo demais para julgar este anúncio hoje: o Meta ainda está atribuindo as vendas do dia.')
    const sameDay = buildCreativeVerdict({
      ...today({ roas: 0, estimatedProfit: -60, spend: 60, verdict: kill }),
      detail: { ...today({ roas: 0, estimatedProfit: -60, spend: 60, verdict: kill }).detail, verdictWindow: { from: '2026-11-24', to: '2026-11-24' } },
      early: true,
    })
    expect(sameDay.chips[0].label).toBe('Cedo demais para julgar')
  })

  it('keeps the bare chip when the verdict window is the page (7 dias)', () => {
    const v = buildCreativeVerdict({ ...input(false), detail: detail({ estimatedProfit: -80, verdict: { ...kill, reason: 'ROAS 0,50× com $100 gastos — abaixo de 80% do empate (1,60×)' } }) })
    expect(v.chips[0].label).toBe('Desligar')
    expect(v.tone).toBe('neg')
    expect(v.headline).not.toMatch(/veredito/)
  })
})

describe('an ad without spend in the window', () => {
  it("points to the ad's last spend on record, not to the empty window", () => {
    const d = { ...detail({ spend: 0, lastSpendDay: null, estimatedProfit: null }), hasSpend: false, lastSpendDayEver: '2026-11-23', range: { from: '2026-11-24', to: '2026-11-24' } }
    const v = buildCreativeVerdict({ ...input(false), detail: d, periodPhrase: 'hoje', today: '2026-11-24' })
    expect(v.headline).toBe('Este anúncio não gastou hoje.')
    expect(v.details[0].text).toBe('Último dia com gasto: 23 nov.')
    const never = buildCreativeVerdict({ ...input(false), detail: { ...d, lastSpendDayEver: null }, periodPhrase: 'hoje', today: '2026-11-24' })
    expect(never.details[0].text).toBe('Nenhum gasto registrado para este anúncio.')
  })
})

describe('noSpendWhen', () => {
  it('says one day once, and a range as a range', () => {
    expect(noSpendWhen({ from: '2026-11-24', to: '2026-11-24' }, '2026-11-24')).toBe('hoje')
    expect(noSpendWhen({ from: '2026-10-01', to: '2026-10-01' }, '2026-11-24')).toBe('em 1 out')
    expect(noSpendWhen({ from: '2026-11-10', to: '2026-11-16' }, '2026-11-24')).toBe('em 10–16 nov')
    expect(noSpendWhen({ from: '2026-10-25', to: '2026-11-05' }, '2026-11-24')).toBe('em 25 out – 5 nov')
  })
})
