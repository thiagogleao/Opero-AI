import { describe, expect, it } from 'vitest'
import { sumPnL, type PnL, type PnLLines } from '../../engine/pnl'
import {
  buildVerdict, comparisonPhrase, comparisonText, isIdle, judgedStores, perDollarLine, periodPhrase, roasSummary, storeStatus, sumTotals,
  type VerdictInput, type VerdictStore,
} from '../verdict'
import { formatRoas } from '../../format'

// Real figures from the 17/11/2026 13h38 snapshot (design proposals), built
// through the engine's own derive() so every ratio is the engine's.
const pnl = (over: Partial<PnLLines> = {}): PnL => sumPnL([{ ...sumPnL([]), ...over }])

function store(over: Partial<VerdictStore> & Pick<VerdictStore, 'id' | 'name' | 'totals'>): VerdictStore {
  return {
    timezone: 'America/Sao_Paulo', configured: true, comparison: null,
    partial: false, minutesCovered: 1440, dayState: 'complete', ...over,
  }
}

const SEVEN_DAYS = { from: '2026-11-03', to: '2026-11-09', label: '7 dias anteriores', sameTimeOfDay: false }
const TODAY_CMP = { from: '2026-11-16', to: '2026-11-16', label: 'ontem até esta hora', sameTimeOfDay: true }

// MOKOO 10–16 nov: $10.942,09 of sales, $1.313,07 of profit (12,0%).
const MOKOO_7D = pnl({
  revenue: 10942.09, orders: 134, units: 380, cogs: 3461.20, shopifyFees: 317.32,
  metaSpend: 5624.20, shopSpend: 226.30,
})
// MOKOO 3–9 nov: $19.281,42 of sales, $1.869,40 of profit.
const MOKOO_PREV = pnl({
  revenue: 19281.42, orders: 230, cogs: 6429.70, shopifyFees: 600, metaSpend: 10289, shopSpend: 93.32,
})

function mokooWeek(over: Partial<VerdictInput> = {}): VerdictInput {
  return {
    stores: [store({
      id: 'user_3CV', name: 'MOKOO', timezone: 'America/Belem', totals: MOKOO_7D,
      comparison: { included: true, totals: MOKOO_PREV },
    })],
    period: '7d', range: { from: '2026-11-10', to: '2026-11-16' }, today: '2026-11-17',
    anchorTimezone: 'America/Belem', comparison: SEVEN_DAYS, ...over,
  }
}

describe('MOKOO, últimos 7 dias', () => {
  const v = buildVerdict(mokooWeek())

  it('is in profit with a thin margin, and says it fell against the 7 days before', () => {
    expect(v.chips.map(c => c.code)).toEqual(['lucro', 'margem_fina'])
    expect(v.chips.map(c => c.label)).toEqual(['No lucro', 'Margem fina'])
    expect(v.tone).toBe('warn')
    expect(v.headline).toBe('A MOKOO lucrou nos últimos 7 dias — mas menos do que nos 7 dias anteriores.')
    expect(v.when).toBe('10–16 nov · vs 7 dias anteriores (3–9 nov)')
  })

  it('shows the engine profit as the big number', () => {
    expect(v.amount).toBeCloseTo(1313.07, 2)
    expect(v.amountTone).toBe('pos')
    expect(v.amountCaption).toBe('de lucro real, depois de todos os custos')
    expect(v.basis).toBe('profit')
    expect(v.totals.operatingProfit).toBeCloseTo(MOKOO_7D.operatingProfit, 6)
  })

  it('explains in plain lines: cents per dollar, the comparison, the drivers', () => {
    expect(v.details.map(d => d.text)).toEqual([
      'Sobraram 12 centavos de cada dólar vendido.',
      'O lucro era $1.869 em 3–9 nov: 30% a menos.',
      'As vendas caíram 43% e o gasto em anúncios caiu 44%.',
    ])
    expect(v.details[0].parts.find(p => p.strong)?.text).toBe('12 centavos de cada dólar vendido')
    expect(v.notes).toEqual([])
  })

  it('puts ROAS against its own break-even', () => {
    expect(v.roas?.text).toBe('ROAS 1,95× · empate 1,53× → no lucro')
    expect(v.roas?.state).toBe('pos')
  })

  it('halves only the money in the partner view', () => {
    const s = buildVerdict(mokooWeek({ split: true }))
    expect(s.amount).toBeCloseTo(656.535, 3)
    expect(s.amountCaption).toBe('de lucro real, depois de todos os custos · sua parte (50%)')
    expect(s.chips.map(c => c.code)).toEqual(['lucro', 'margem_fina']) // margin untouched
    expect(s.details[0].text).toBe('Sobraram 12 centavos de cada dólar vendido.')
    expect(s.details[1].text).toBe('O lucro era $935 em 3–9 nov: 30% a menos.')
    expect(s.roas?.text).toBe('ROAS 1,95× · empate 1,53× → no lucro')
    expect(s.totals.operatingProfit).toBeCloseTo(1313.07, 2) // totals stay whole for the ledger
  })
})

describe('Todas, hoje às 13h38', () => {
  const minutes = 13 * 60 + 38
  const running = { partial: true, minutesCovered: minutes, dayState: 'running' as const }
  const input: VerdictInput = {
    stores: [
      store({ id: 'mokoo', name: 'MOKOO', timezone: 'America/Belem', ...running,
        totals: pnl({ revenue: 987.56, orders: 14, cogs: 300, shopifyFees: 29.24, metaSpend: 397.79 }),
        comparison: { included: true, totals: pnl({ revenue: 700, orders: 10, cogs: 220, metaSpend: 330 }) } }),
      store({ id: 'd8', name: 'Dumpling Squishy · 8jcp3a', ...running,
        totals: pnl({ revenue: 3868.79, orders: 53, cogs: 700, shopifyFees: 87.09, metaSpend: 18.26, shopSpend: 1066.54 }),
        comparison: { included: true, totals: pnl({ revenue: 2500, orders: 35, cogs: 500, shopSpend: 900 }) } }),
      store({ id: 'epoch', name: 'EPOCH ®️', ...running,
        totals: pnl({ revenue: 565.55, orders: 5, cogs: 100, shopifyFees: 15.90, metaSpend: 650.83 }),
        comparison: { included: true, totals: pnl({ revenue: 600, orders: 6, cogs: 110, metaSpend: 400 }) } }),
      // Tokyo's 17/11 already closed: whole day, compared whole against whole.
      store({ id: 'hib', name: 'Hibikura', timezone: 'Asia/Tokyo', partial: false, minutesCovered: 1440, dayState: 'closed',
        totals: pnl({ revenue: 1596.21, orders: 18, cogs: 316.04, shopifyFees: 91.46, metaSpend: 599.23 }),
        comparison: { included: true, totals: pnl({ revenue: 743.94, orders: 9, cogs: 160, shopifyFees: 22, metaSpend: 517.86 }) } }),
      store({ id: 'glooty', name: 'Glooty', timezone: 'America/Belem', configured: false, ...running,
        totals: pnl({ metaSpend: 41.20 }), comparison: { included: true, totals: pnl({ metaSpend: 30 }) } }),
      store({ id: 'camp', name: 'CAMP HALLOW', ...running, totals: pnl({}), comparison: { included: true, totals: pnl({}) } }),
    ],
    period: 'today', range: { from: '2026-11-17', to: '2026-11-17' }, today: '2026-11-17',
    anchorTimezone: 'America/Sao_Paulo', anchorMinutes: minutes, comparison: TODAY_CMP, subject: 'Suas lojas',
  }
  const v = buildVerdict(input)

  it('sums only the stores with costs and names the one left out', () => {
    const expected = ['mokoo', 'd8', 'epoch', 'hib', 'camp']
      .map(id => input.stores.find(s => s.id === id)!.totals.operatingProfit)
      .reduce((a, b) => a + b, 0)
    expect(v.amount).toBeCloseTo(expected, 6)
    expect(v.excluded).toEqual([{ id: 'glooty', name: 'Glooty', revenue: 0, adSpend: 41.2, revenueMinusAds: -41.2 }])
    expect(v.details[0].text).toBe('Glooty fica fora da soma: sem custos configurados (receita − anúncios: −$41,20).')
  })

  it('is present tense, partial, and compared with yesterday at this hour', () => {
    expect(v.headline).toBe('Suas lojas estão no lucro hoje — e mais do que ontem até esta hora.')
    expect(v.chips.map(c => c.label)).toEqual(['No lucro', '1 loja sem custos', 'parcial · até 13h38'])
    // CAMP HALLOW did nothing today: it is not one of the stores in the sum.
    expect(v.when).toBe('4 lojas na soma · hoje · vs ontem até esta hora')
    expect(v.amountCaption).toBe('de lucro real até agora, depois de todos os custos')
    expect(v.roas).toBeNull() // ROAS only means something per store
  })

  it("puts the clock, Tokyo's closed day and the idle store in the fine print", () => {
    expect(v.notes.map(n => n.text)).toEqual([
      'Faltam 10h22 para o dia fechar.',
      'A Hibikura entra com o dia de Tóquio, que já fechou.',
      'CAMP HALLOW ainda não teve vendas, anúncios nem reembolsos hoje: fica fora da contagem de lojas.',
    ])
  })

  it('gives each store row its own chip', () => {
    const chips = Object.fromEntries(input.stores.map(s => [s.id, storeStatus(s).label]))
    expect(chips).toEqual({
      mokoo: 'no lucro', d8: 'no lucro', epoch: 'no prejuízo', hib: 'no lucro',
      glooty: 'no prejuízo', camp: 'sem vendas',
    })
  })
})

describe('Glooty (sem custos configurados)', () => {
  const glooty = (totals: PnL, cmp: PnL | null) => store({
    id: '5071', name: 'Glooty', timezone: 'America/Belem', configured: false, totals,
    comparison: cmp ? { included: true, totals: cmp } : null,
  })

  it('7 dias: judged on revenue − ads, a certain loss, few orders', () => {
    const v = buildVerdict({
      stores: [glooty(pnl({ revenue: 156.30, orders: 2, metaSpend: 374.42 }), pnl({ revenue: 80, orders: 1, metaSpend: 200 }))],
      period: '7d', range: { from: '2026-11-10', to: '2026-11-16' }, today: '2026-11-17',
      anchorTimezone: 'America/Belem', comparison: SEVEN_DAYS,
    })
    expect(v.basis).toBe('revenue_minus_ads')
    expect(v.chips.map(c => c.code)).toEqual(['prejuizo', 'sem_custos', 'poucos_pedidos'])
    expect(v.tone).toBe('neg')
    expect(v.headline).toBe('A Glooty gastou mais em anúncios do que vendeu nos últimos 7 dias.')
    expect(v.amount).toBeCloseTo(-218.12, 2)
    expect(v.amountCaption).toBe('de receita menos anúncios, sem o custo dos produtos')
    expect(v.details[0].text).toBe('Vendas $156 − anúncios $374. Configure o custo dos produtos, o frete e as taxas para ver o lucro real.')
    expect(v.roas?.text).toBe('ROAS 0,42× · empate desconhecido → custos não configurados')
  })

  it('sales above ads: no profit claim', () => {
    const v = buildVerdict({
      stores: [glooty(pnl({ revenue: 900, orders: 12, metaSpend: 300 }), null)],
      period: '30d', range: { from: '2026-10-18', to: '2026-11-16' }, today: '2026-11-17',
      anchorTimezone: 'America/Belem', comparison: null,
    })
    expect(v.chips.map(c => c.code)).toEqual(['sem_custos'])
    expect(v.tone).toBe('warn')
    expect(v.amountTone).toBe('neu')
    expect(v.headline).toBe('A Glooty vendeu $900 nos últimos 30 dias, mas sem o custo dos produtos não dá para dizer se lucrou.')
  })

  it('no sales and no spend: "sem vendas", no fake $0', () => {
    const v = buildVerdict({
      stores: [glooty(pnl({}), null)],
      period: 'yesterday', range: { from: '2026-11-16', to: '2026-11-16' }, today: '2026-11-17',
      anchorTimezone: 'America/Belem', comparison: null,
    })
    expect(v.amount).toBeNull()
    expect(v.chips.map(c => c.label)).toEqual(['Sem vendas no período', 'Custos não configurados'])
    expect(v.headline).toBe('A Glooty não teve vendas ontem.')
    expect(v.amountCaption).toBe('nenhum pedido no período')
  })
})

describe('Hibikura, dia de Tóquio às 01h38', () => {
  const v = buildVerdict({
    stores: [store({
      id: '0344', name: 'Hibikura', timezone: 'Asia/Tokyo', partial: true, minutesCovered: 98, dayState: 'running',
      totals: pnl({ revenue: 66.86, orders: 1, cogs: 25, shopifyFees: 4.83, metaSpend: 24.57 }),
      comparison: { included: true, totals: pnl({ revenue: 120, orders: 2, cogs: 40, metaSpend: 30 }) },
    })],
    period: 'today', range: { from: '2026-11-18', to: '2026-11-18' }, today: '2026-11-18',
    anchorTimezone: 'Asia/Tokyo', comparison: { ...TODAY_CMP, from: '2026-11-17', to: '2026-11-17' },
  })

  it('is too early to judge, on Tokyo time', () => {
    expect(v.early).toBe(true)
    expect(v.tone).toBe('neu')
    expect(v.chips.map(c => c.label)).toEqual(['Cedo demais para julgar', 'parcial · até 01h38', 'dia de Tóquio'])
    expect(v.headline).toBe('Em Tóquio o dia acabou de começar. Por enquanto, 1 pedido e $12,46 de lucro.')
    expect(v.amount).toBeCloseTo(12.46, 2)
    expect(v.amountTone).toBe('neu')
  })

  it('says what to look at instead, and how long the day still runs', () => {
    expect(v.details.map(d => d.text)).toEqual([
      'Com 1 pedido, o resultado de hoje ainda não diz nada. Para decidir, olhe ontem e os últimos 7 dias.',
    ])
    expect(v.notes.map(n => n.text)).toEqual([
      'Faltam 22h22 para o dia fechar em Tóquio.',
      'Dia de Tóquio: a loja fecha o dia no fuso dela, que pode não bater com o de Brasília.',
    ])
  })
})

describe('other honest states', () => {
  const base = { range: { from: '2026-11-10', to: '2026-11-16' }, today: '2026-11-17', anchorTimezone: 'America/Sao_Paulo', period: '7d' as const }

  it('a loss after a profitable week', () => {
    const v = buildVerdict({
      ...base, comparison: SEVEN_DAYS,
      stores: [store({ id: 'e', name: 'EPOCH', totals: pnl({ revenue: 5000, orders: 50, cogs: 1500, metaSpend: 3800 }),
        comparison: { included: true, totals: pnl({ revenue: 6000, orders: 60, cogs: 1800, metaSpend: 3000 }) } })],
    })
    expect(v.chips.map(c => c.code)).toEqual(['prejuizo'])
    expect(v.headline).toBe('A EPOCH teve prejuízo nos últimos 7 dias — depois de lucrar nos 7 dias anteriores.')
    expect(v.amountCaption).toBe('de prejuízo real, depois de todos os custos')
    expect(v.details[0].text).toBe('Faltaram 6 centavos em cada dólar vendido para empatar.')
    expect(v.roas?.state).toBe('neg')
  })

  it('ads spent and no sales in a closed window is a loss', () => {
    const v = buildVerdict({ ...base, comparison: null, stores: [store({ id: 'x', name: 'X', totals: pnl({ metaSpend: 120 }) })] })
    expect(v.chips.map(c => c.code)).toEqual(['prejuizo'])
    expect(v.headline).toBe('A X gastou $120 em anúncios e não vendeu nada nos últimos 7 dias.')
    expect(v.amount).toBe(-120)
  })

  it('a young day with orders but few of them', () => {
    const v = buildVerdict({
      ...base, period: 'today', range: { from: '2026-11-17', to: '2026-11-17' }, comparison: TODAY_CMP,
      stores: [store({ id: 'x', name: 'X', partial: true, minutesCovered: 600, dayState: 'running',
        totals: pnl({ revenue: 200, orders: 3, cogs: 60, metaSpend: 90 }) })],
    })
    expect(v.chips[0].code).toBe('cedo')
    expect(v.headline).toBe('Ainda é pouco para julgar hoje: por enquanto, 3 pedidos e $50,00 de lucro.')
  })

  it('a store with nothing to compare (new store) says so', () => {
    const v = buildVerdict({
      ...base, comparison: SEVEN_DAYS,
      stores: [store({ id: 'n', name: 'Nova', totals: pnl({ revenue: 3000, orders: 40, cogs: 900, metaSpend: 1200 }),
        comparison: { included: true, totals: pnl({}) } })],
    })
    expect(v.headline).toBe('A Nova lucrou nos últimos 7 dias.')
    expect(v.details.map(d => d.text)).toContain('Sem vendas para comparar em 3–9 nov.')
  })
})

describe('phrases', () => {
  it('period phrases', () => {
    const today = '2026-11-17'
    expect(periodPhrase('mtd', { from: '2026-11-01', to: today }, today)).toBe('neste mês')
    expect(periodPhrase('lastmonth', { from: '2026-10-01', to: '2026-10-31' }, today)).toBe('no mês passado')
    expect(periodPhrase('custom', { from: '2026-11-12', to: '2026-11-12' }, today)).toBe('em 12 nov')
    expect(periodPhrase('custom', { from: today, to: today }, today)).toBe('hoje')
  })

  it('comparison phrases keep the exact label', () => {
    expect(comparisonPhrase('30 dias anteriores')).toBe('nos 30 dias anteriores')
    expect(comparisonPhrase('dia anterior')).toBe('no dia anterior')
    expect(comparisonPhrase('mesmos dias do mês passado')).toBe('nos mesmos dias do mês passado')
    expect(comparisonPhrase('mês anterior')).toBe('no mês anterior')
    expect(comparisonText({ from: '2026-10-01', to: '2026-10-17', label: 'mesmos dias do mês passado', sameTimeOfDay: true }, '2026-11-17'))
      .toBe('vs mesmos dias do mês passado (1–17 out)')
  })

  it('ROAS summary', () => {
    expect(roasSummary(0.87, 1.26).text).toBe('ROAS 0,87× · empate 1,26× → no prejuízo')
  })

  it('sumTotals recomputes the ratios like the engine', () => {
    const a = pnl({ revenue: 1000, orders: 10, cogs: 400, metaSpend: 300 })
    const b = pnl({ revenue: 500, orders: 5, cogs: 100, metaSpend: 300 })
    const mine = sumTotals([a, b])
    const engine = sumPnL([a, b])
    for (const k of ['operatingProfit', 'margin', 'breakEvenRoas', 'roas', 'contribution', 'profitPerOrder'] as const) {
      expect(mine[k]).toBeCloseTo(engine[k] as number, 9)
    }
  })
})

describe('details wording', () => {
  it('a store without costs and without activity is named without a fake $0', () => {
    const v = buildVerdict({
      stores: [
        store({ id: 'a', name: 'MOKOO', totals: pnl({ revenue: 1000, orders: 10, cogs: 300, metaSpend: 400 }) }),
        store({ id: 'g', name: 'Glooty', configured: false, totals: pnl({}) }),
      ],
      period: '7d', range: { from: '2026-11-10', to: '2026-11-16' }, today: '2026-11-17',
      anchorTimezone: 'America/Sao_Paulo', comparison: null,
    })
    expect(v.details[0].text).toBe('Glooty fica fora da soma: sem custos configurados (sem vendas nem anúncios no período).')
    expect(v.headline).toBe('As lojas lucraram juntas nos últimos 7 dias.')
    expect(v.amountCaption).toBe('de lucro real somando 1 loja')
  })

  it('a running day says "até agora" in the comparison line', () => {
    const v = buildVerdict({
      stores: [store({ id: 'm', name: 'MOKOO', partial: true, minutesCovered: 818, dayState: 'running',
        totals: pnl({ revenue: 987.56, orders: 14, cogs: 300, metaSpend: 397.79 }),
        comparison: { included: true, totals: pnl({ revenue: 700, orders: 10, cogs: 220, metaSpend: 330 }) } })],
      period: 'today', range: { from: '2026-11-17', to: '2026-11-17' }, today: '2026-11-17',
      anchorTimezone: 'America/Belem', comparison: TODAY_CMP,
    })
    expect(v.details[1].text).toBe('O lucro era $150 ontem até esta hora: 93% a mais até agora.')
  })

  it('no percentage across a profit-to-loss flip, and a past loss is called a loss', () => {
    const flip = buildVerdict(mokooWeek({
      stores: [store({ id: 'e', name: 'EPOCH', totals: pnl({ revenue: 4000, orders: 50, cogs: 1500, metaSpend: 3000 }),
        comparison: { included: true, totals: pnl({ revenue: 5000, orders: 60, cogs: 1000, metaSpend: 1500 }) } })],
    }))
    expect(flip.details.map(d => d.text)).toContain('O lucro era $2.500 em 3–9 nov.')
    const fromLoss = buildVerdict(mokooWeek({
      stores: [store({ id: 'e', name: 'EPOCH', totals: pnl({ revenue: 5000, orders: 60, cogs: 1000, metaSpend: 1500 }),
        comparison: { included: true, totals: pnl({ revenue: 4000, orders: 50, cogs: 1500, metaSpend: 3000 }) } })],
    }))
    expect(fromLoss.details.map(d => d.text)).toContain('O prejuízo foi de $500 em 3–9 nov.')
  })
})

describe('a running window longer than a day', () => {
  const MTD = { from: '2026-10-01', to: '2026-10-17', label: 'mesmos dias do mês passado', sameTimeOfDay: true }
  const mtd = (totals: PnL, minutes: number): VerdictInput => ({
    stores: [store({ id: 'm', name: 'MOKOO', timezone: 'America/Belem', partial: true, minutesCovered: minutes, dayState: 'running',
      totals, comparison: { included: true, totals: MOKOO_PREV } })],
    period: 'mtd', range: { from: '2026-11-01', to: '2026-11-17' }, today: '2026-11-17',
    anchorTimezone: 'America/Belem', comparison: MTD,
  })

  it('"Este mês" at 02h00 is judged on the month, not "o dia acabou de começar"', () => {
    const v = buildVerdict(mtd(MOKOO_7D, 120))
    expect(v.early).toBe(false)
    expect(v.chips.map(c => c.code)).toEqual(['lucro', 'margem_fina', 'parcial'])
    expect(v.headline).toBe('A MOKOO está no lucro neste mês — mas menos do que nos mesmos dias do mês passado.')
    expect(v.amountCaption).toBe('de lucro real até agora, depois de todos os custos')
    expect(v.notes).toEqual([]) // no "faltam … para o dia fechar" on a month
  })

  it('few orders in a running month keep the verdict and get the chip', () => {
    const v = buildVerdict(mtd(pnl({ revenue: 200, orders: 3, cogs: 60, metaSpend: 90 }), 800))
    expect(v.early).toBe(false)
    expect(v.fewOrders).toBe(true)
    expect(v.chips.map(c => c.code)).toEqual(['lucro', 'poucos_pedidos', 'parcial'])
  })

  it('a store row is "começando" only when the window is the running day', () => {
    const row = { configured: true, totals: MOKOO_7D, partial: true, minutesCovered: 120 }
    expect(storeStatus(row).code).toBe('comecando')
    expect(storeStatus(row, { singleDay: false }).code).toBe('margem_fina')
  })
})

describe('stores in the sum (regression: idle stores were counted)', () => {
  const week = { period: '7d' as const, range: { from: '2026-11-10', to: '2026-11-16' }, today: '2026-11-17', anchorTimezone: 'America/Sao_Paulo', comparison: null }
  const active = (id: string) => store({ id, name: id, totals: pnl({ revenue: 1000, orders: 10, cogs: 300, metaSpend: 400 }) })

  it('counts only the stores that moved, and names the idle ones', () => {
    const v = buildVerdict({ ...week, stores: [active('MOKOO'), active('EPOCH'), store({ id: 'c', name: 'CAMP HALLOW', totals: pnl({}) })] })
    expect(v.when).toBe('2 lojas na soma · 10–16 nov')
    expect(v.amountCaption).toBe('de lucro real somando 2 lojas')
    expect(v.notes.map(n => n.text)).toEqual(['CAMP HALLOW não teve vendas, anúncios nem reembolsos nos últimos 7 dias: fica fora da contagem de lojas.'])
    expect(v.storeCount).toBe(3)
  })

  it('says how many were idle when there are several', () => {
    const v = buildVerdict({ ...week, stores: [active('MOKOO'), store({ id: 'c', name: 'CAMP HALLOW', totals: pnl({}) }), store({ id: 'd', name: 'Dumpling', totals: pnl({}) })] })
    expect(v.when).toBe('1 loja na soma · 10–16 nov')
    expect(v.notes.map(n => n.text)).toEqual(['2 lojas paradas, fora da contagem: CAMP HALLOW e Dumpling não tiveram vendas, anúncios nem reembolsos nos últimos 7 dias.'])
  })

  it('a store with only a refund, only ads or only fixed costs is in the sum', () => {
    const refundOnly = store({ id: 'r', name: 'R', totals: pnl({ refunds: 30, refundCount: 1 }) })
    const adsOnly = store({ id: 'a', name: 'A', totals: pnl({ metaSpend: 12 }) })
    const fixedOnly = store({ id: 'f', name: 'F', totals: pnl({ fixedCosts: 50 }) })
    const v = buildVerdict({ ...week, stores: [active('MOKOO'), refundOnly, adsOnly, fixedOnly] })
    expect(v.when).toBe('4 lojas na soma · 10–16 nov')
    expect(v.notes).toEqual([])
    expect(isIdle(refundOnly.totals) || isIdle(adsOnly.totals) || isIdle(fixedOnly.totals)).toBe(false)
  })

  it('nothing moved anywhere: no "0 lojas na soma"', () => {
    const v = buildVerdict({ ...week, stores: [store({ id: 'c', name: 'CAMP HALLOW', totals: pnl({}) }), store({ id: 'd', name: 'Dumpling', totals: pnl({}) })] })
    expect(v.when).toBe('nenhuma loja com movimento · 10–16 nov')
    expect(v.amount).toBeNull()
    expect(v.notes).toEqual([])
  })

  it('judgedStores leaves unconfigured stores out of a mixed sum only', () => {
    const s = [{ id: 'a', configured: true }, { id: 'g', configured: false }]
    expect(judgedStores(s)).toEqual({ judged: [s[0]], excluded: [s[1]] })
    expect(judgedStores([s[1]])).toEqual({ judged: [s[1]], excluded: [] })
    expect(judgedStores([s[1], { id: 'h', configured: false }]).excluded).toEqual([])
  })
})

describe('ROAS box: why a break-even is missing (regression: always "custos não configurados")', () => {
  const week = { period: '7d' as const, range: { from: '2026-11-10', to: '2026-11-16' }, today: '2026-11-17', anchorTimezone: 'America/Sao_Paulo', comparison: null }
  const one = (totals: PnL, configured = true) => buildVerdict({ ...week, stores: [store({ id: 'x', name: 'EPOCH', configured, totals })] }).roas!

  it('configured, no sales: every ad dollar was a loss', () => {
    const r = one(pnl({ metaSpend: 137 }))
    expect(r.reason).toBe('no_sales')
    expect(r.state).toBe('neg')
    expect(r.text).toBe('ROAS 0,00× · sem empate → nenhuma venda no período: todo o gasto foi prejuízo')
    expect(r.explain).toMatch(/não vendeu nada/)
    expect(r.text).not.toMatch(/custos não configurados/)
  })

  it('configured, sales that did not cover product, shipping and fees', () => {
    const r = one(pnl({ revenue: 812, orders: 9, cogs: 900, metaSpend: 400 }))
    expect(r.reason).toBe('no_margin')
    expect(r.state).toBe('neg')
    expect(r.breakEven).toBeNull()
    expect(r.text).toBe('ROAS 2,03× · sem empate → produto, frete e taxas já passam da receita')
    expect(r.text).not.toMatch(/custos não configurados/)
  })

  it('not configured: the only case that says so', () => {
    const r = one(pnl({ revenue: 900, orders: 12, metaSpend: 300 }), false)
    expect(r.reason).toBe('no_costs')
    expect(r.state).toBe('unknown')
    expect(r.text).toBe('ROAS 3,00× · empate desconhecido → custos não configurados')
    expect(r.explain).toBe('Sem o custo dos produtos não dá para saber em que ROAS esta loja empata.')
  })

  it('roasSummary without facts claims no cause', () => {
    expect(roasSummary(1.2, null).text).toBe('ROAS 1,20× · empate desconhecido')
    // No cause known: no reason to forward (it would override a gauge that has the facts).
    expect(roasSummary(1.2, null).reason).toBeNull()
    expect(roasSummary(1.2, null).breakEven).toBeNull()
    expect(roasSummary(1.2, null, { configured: false, revenue: 50 }).text).toBe('ROAS 1,20× · empate desconhecido → custos não configurados')
    expect(roasSummary(1.95, 1.53).reason).toBeNull()
  })
})

describe('ROAS box: the ad channel (regression: Meta-only spend next to Shopify ads)', () => {
  const week = { period: '7d' as const, range: { from: '2026-11-10', to: '2026-11-16' }, today: '2026-11-17', anchorTimezone: 'America/Sao_Paulo', comparison: null }
  const one = (totals: PnL) => buildVerdict({ ...week, stores: [store({ id: 'x', name: 'Dumpling Squishy · 8jcp3a', totals })] }).roas

  it('a store selling through Shopify ads is measured on them, not on $56 of Meta', () => {
    // Dumpling 8jcp3a-like: $55,81 of Meta beside $1.796 of Shopify ads.
    const t = pnl({ revenue: 5330, orders: 70, cogs: 1500, shopifyFees: 160, metaSpend: 55.81, shopSpend: 1796 })
    const r = one(t)!
    expect(t.roas).toBeCloseTo(95.5, 1) // what the box used to show
    expect(r.channel).toBe('shop')
    expect(r.label).toBe('ROAS dos Anúncios Shopify')
    expect(r.roas).toBeCloseTo(5330 / 1796, 6)
    expect(r.spend).toBe(1796)
    expect(r.text).toBe(`ROAS ${formatRoas(5330 / 1796)} · empate ${formatRoas(t.breakEvenRoas)} → no lucro`)
    expect(r.explain).toMatch(/^Cada \$1 em Anúncios Shopify trouxe \$2,97 em vendas da loja/)
    expect(r.explain).toMatch(/Os \$55,81 de Meta ficam fora deste ROAS/)
  })

  it('both channels carrying the spend: measured on both, and labelled so', () => {
    const r = one(pnl({ revenue: 4000, orders: 40, cogs: 1200, metaSpend: 1000, shopSpend: 800 }))!
    expect(r.channel).toBe('both')
    expect(r.label).toBe('ROAS dos anúncios (Meta + Shopify)')
    expect(r.roas).toBeCloseTo(4000 / 1800, 6)
    expect(r.explain).toMatch(/^Cada \$1 em anúncios \(Meta e Shopify somados\)/)
  })

  it('Shopify ads only: the box exists (it used to need Meta spend)', () => {
    const r = one(pnl({ revenue: 600, orders: 6, cogs: 200, shopSpend: 150 }))!
    expect(r.channel).toBe('shop')
    expect(r.roas).toBeCloseTo(4, 6)
  })

  it('MOKOO: Meta carries the spend; the minor Shopify ads are named outside the ratio', () => {
    const v = buildVerdict(mokooWeek())
    expect(v.roas?.channel).toBe('meta')
    expect(v.roas?.label).toBe('ROAS do Meta')
    expect(v.roas?.text).toBe('ROAS 1,95× · empate 1,53× → no lucro')
    expect(v.roas?.explain).toBe('Cada $1 no Meta trouxe $1,95 em vendas da loja (todas as vendas, não só as que o Meta atribui a si). Abaixo de $1,53 a loja passa a perder dinheiro com os anúncios. Os $226 de Anúncios Shopify ficam fora deste ROAS (menos de 10% do gasto em anúncios), mas entram no lucro.')
  })

  it('no ad spend: no box', () => {
    expect(one(pnl({ revenue: 600, orders: 6, cogs: 200 }))).toBeNull()
  })
})

describe('comparison over a tiny base (regression: "13.123% a mais")', () => {
  const minutes = 6 * 60 + 11
  const running = { partial: true, minutesCovered: minutes, dayState: 'running' as const }
  const today = (cur: PnL, prev: PnL, split = false): VerdictInput => ({
    stores: [store({ id: 'm', name: 'MOKOO', ...running, totals: cur, comparison: { included: true, totals: prev } })],
    period: 'today', range: { from: '2026-11-18', to: '2026-11-18' }, today: '2026-11-18',
    anchorTimezone: 'America/Sao_Paulo', comparison: { from: '2026-11-17', to: '2026-11-17', label: 'ontem até esta hora', sameTimeOfDay: true },
    split,
  })
  // $250,00 of profit now; $1,89 yesterday at this hour.
  const NOW = pnl({ revenue: 1000, orders: 10, cogs: 400, metaSpend: 350 })
  const YDAY = pnl({ revenue: 400, orders: 4, cogs: 200, metaSpend: 198.11 })

  it('says the difference in dollars, not a five-digit percentage', () => {
    const v = buildVerdict(today(NOW, YDAY))
    const cmp = v.details.find(d => d.text.startsWith('O lucro era'))!
    expect(cmp.text).toBe('O lucro era $1,89 ontem até esta hora: $248 a mais até agora.')
    expect(v.details.map(d => d.text).join(' ')).not.toMatch(/\d\.\d{3}%/)
  })

  it('halves the difference in the partner view', () => {
    const v = buildVerdict(today(NOW, YDAY, true))
    expect(v.details.find(d => d.text.startsWith('O lucro era'))!.text).toBe('O lucro era $0,94 ontem até esta hora: $124 a mais até agora.')
  })

  it('a change past 300% on a real base is said in dollars too; a sane one stays in percent', () => {
    const big = buildVerdict(today(pnl({ revenue: 1000, orders: 10, cogs: 400, metaSpend: 300 }), pnl({ revenue: 300, orders: 5, cogs: 100, metaSpend: 140 })))
    expect(big.details.find(d => d.text.startsWith('O lucro era'))!.text).toBe('O lucro era $60,00 ontem até esta hora: $240 a mais até agora.')
    const sane = buildVerdict(today(NOW, pnl({ revenue: 800, orders: 8, cogs: 300, metaSpend: 300 })))
    expect(sane.details.find(d => d.text.startsWith('O lucro era'))!.text).toBe('O lucro era $200 ontem até esta hora: 25% a mais até agora.')
  })

  it('revenue over a tiny base moves in dollars as well', () => {
    const v = buildVerdict(today(NOW, pnl({ revenue: 20, orders: 1, cogs: 5, metaSpend: 10 })))
    expect(v.details.map(d => d.text)).toContain('As vendas subiram $980 e o gasto em anúncios subiu $340.')
  })
})

describe('no sales, but money left (regression: CAMP HALLOW −$343 hidden)', () => {
  const base = {
    period: '7d' as const, range: { from: '2026-11-11', to: '2026-11-17' }, today: '2026-11-18',
    anchorTimezone: 'America/Sao_Paulo', comparison: { from: '2026-11-04', to: '2026-11-10', label: '7 dias anteriores', sameTimeOfDay: false },
  }
  const camp = (totals: PnL, split = false) => buildVerdict({ ...base, split, stores: [store({ id: 'c', name: 'CAMP HALLOW', totals })] })

  it('keeps "sem vendas" and no fake $0, and says what left the cash', () => {
    // Engine, 11–17 nov: 2 chargebacks $312,63 + $30 of fees, cashResult −342,63.
    const v = camp(pnl({ chargebacks: 312.63, chargebackFees: 30, chargebackCount: 2 }))
    expect(v.headline).toBe('A CAMP HALLOW não teve vendas nos últimos 7 dias.')
    expect(v.amount).toBeNull()
    expect(v.totals.cashResult).toBeCloseTo(-342.63, 2)
    expect(v.details.map(d => d.text)).toEqual(['Mas chegaram 2 chargebacks: −$343 no caixa.'])
    expect(v.details[0].parts.find(p => p.strong)).toEqual({ text: '−$343 no caixa', strong: true, tone: 'neg' })
  })

  it('names refunds and chargebacks together, in the singular when it is one', () => {
    expect(camp(pnl({ refunds: 20, refundCount: 1 })).details[0].text).toBe('Mas chegou 1 reembolso: −$20,00 no caixa.')
    expect(camp(pnl({ refunds: 20, refundCount: 1, chargebacks: 40, chargebackCount: 1 })).details[0].text)
      .toBe('Mas chegaram 1 reembolso e 1 chargeback: −$60,00 no caixa.')
  })

  it('halves the cash in the partner view', () => {
    expect(camp(pnl({ chargebacks: 312.63, chargebackFees: 30, chargebackCount: 2 }), true).details[0].text).toBe('Mas chegaram 2 chargebacks: −$171 no caixa.')
  })

  it('after ads with no sales it reads "E chegaram…"', () => {
    const v = camp(pnl({ metaSpend: 50, chargebacks: 30, chargebackCount: 1 }))
    expect(v.details.map(d => d.text)).toContain('E chegou 1 chargeback: −$30,00 no caixa.')
  })
})

describe('a window before the store existed (regression: "não teve vendas no mês passado")', () => {
  const OCT = { from: '2026-10-01', to: '2026-10-31' }
  const SEP = { from: '2026-09-01', to: '2026-09-30', label: 'mês anterior', sameTimeOfDay: false }
  const hib = (over: Partial<VerdictStore> = {}) =>
    store({ id: 'h', name: 'Hibikura', timezone: 'Asia/Tokyo', totals: pnl({}), comparison: { included: true, totals: pnl({}) }, ...over })

  it('says when the store started instead of a dead month', () => {
    const v = buildVerdict({
      period: 'lastmonth', range: OCT, today: '2026-11-18', anchorTimezone: 'Asia/Tokyo', comparison: SEP,
      stores: [hib({ firstOrderDate: '2026-11-07' })],
    })
    expect(v.headline).toBe('A Hibikura começou a vender em 7 nov — não há dados de outubro.')
    expect(v.chips.map(c => c.label)).toEqual(['Vende desde 7 nov', 'dia de Tóquio'])
    expect(v.chips[0].code).toBe('comecando')
    expect(v.amount).toBeNull()
    expect(v.amountCaption).toBe('a loja ainda não vendia nesse período')
    expect(v.tone).toBe('neu')
    expect(v.details.map(d => d.text)).toEqual(['Escolha um período a partir de 7 nov para ver o resultado.'])
  })

  it('without a known first order it reads as before', () => {
    const v = buildVerdict({ period: 'lastmonth', range: OCT, today: '2026-11-18', anchorTimezone: 'Asia/Tokyo', comparison: SEP, stores: [hib()] })
    expect(v.headline).toBe('A Hibikura não teve vendas no mês passado.')
  })

  it('a window that starts before the first order says so in the fine print and in the comparison', () => {
    const v = buildVerdict({
      period: '30d', range: { from: '2026-10-19', to: '2026-11-17' }, today: '2026-11-18', anchorTimezone: 'Asia/Tokyo',
      comparison: { from: '2026-09-19', to: '2026-10-18', label: '30 dias anteriores', sameTimeOfDay: false },
      stores: [hib({ firstOrderDate: '2026-11-07', totals: pnl({ revenue: 3000, orders: 40, cogs: 900, metaSpend: 1200 }) })],
    })
    expect(v.headline).toBe('A Hibikura lucrou nos últimos 30 dias.')
    expect(v.notes.map(n => n.text)).toContain('A Hibikura só começou a vender em 7 nov: o período tem dias antes disso.')
    expect(v.details.map(d => d.text)).toContain('Sem vendas para comparar em 19 set – 18 out: a loja começou a vender em 7 nov.')
  })

  it('in a sum, a store that had not started is not called "parada"', () => {
    const v = buildVerdict({
      period: 'lastmonth', range: OCT, today: '2026-11-18', anchorTimezone: 'America/Sao_Paulo',
      comparison: SEP, subject: 'Suas lojas',
      stores: [
        store({ id: 'm', name: 'MOKOO', totals: pnl({ revenue: 30000, orders: 400, cogs: 9000, metaSpend: 15000 }) }),
        hib({ firstOrderDate: '2026-11-07' }),
      ],
    })
    expect(v.notes.map(n => n.text)).toEqual(['Hibikura ainda não vendia no mês passado: fica fora da contagem de lojas.'])
  })
})

// ─── A few orders do not hide a certain loss (regression) ─────────────────────
// EPOCH 18 nov at 14h15: 2 orders, $226,80 sold, $697,69 of Meta (engine,
// read-only). The row chip said "começando" and the verdict "Cedo demais para
// julgar" while the same spend with no order at all read "no prejuízo".
describe('a running day whose ads already passed its sales', () => {
  const EPOCH_TODAY = pnl({ revenue: 226.80, orders: 2, units: 2, cogs: 30, shopifyFees: 10, metaSpend: 697.69 })
  const day = (totals: PnL, minutes: number): VerdictInput => ({
    stores: [store({ id: 'e', name: 'EPOCH', partial: true, minutesCovered: minutes, dayState: 'running', totals,
      comparison: { included: true, totals: pnl({ revenue: 900, orders: 9, cogs: 200, metaSpend: 500 }) } })],
    period: 'today', range: { from: '2026-11-18', to: '2026-11-18' }, today: '2026-11-18',
    anchorTimezone: 'America/Sao_Paulo', comparison: { from: '2026-11-17', to: '2026-11-17', label: 'ontem até esta hora', sameTimeOfDay: true },
  })

  it('the row chip is "no prejuízo" past 04h, like the zero-order row', () => {
    expect(storeStatus({ configured: true, totals: EPOCH_TODAY, partial: true, minutesCovered: 855 }).code).toBe('prejuizo')
    expect(storeStatus({ configured: true, totals: pnl({ metaSpend: 697.69 }), partial: true, minutesCovered: 855 }).code).toBe('prejuizo')
  })

  it('before 04h it is still "começando", and a few orders that cover the ads still are', () => {
    expect(storeStatus({ configured: true, totals: EPOCH_TODAY, partial: true, minutesCovered: 200 }).code).toBe('comecando')
    const covered = pnl({ revenue: 600, orders: 3, cogs: 380, metaSpend: 300 }) // a loss, but ROAS 2×: money still in play
    expect(storeStatus({ configured: true, totals: covered, partial: true, minutesCovered: 855 }).code).toBe('comecando')
  })

  it('the verdict says "no prejuízo" with the spend and the sales, not "ainda não diz nada"', () => {
    const v = buildVerdict(day(EPOCH_TODAY, 855))
    expect(v.early).toBe(false)
    expect(v.tone).toBe('neg')
    expect(v.chips.map(c => c.code)).toEqual(['prejuizo', 'parcial'])
    expect(v.headline).toBe('A EPOCH está no prejuízo hoje — depois de lucrar ontem até esta hora.')
    expect(v.amountTone).toBe('neg')
    expect(v.details[0].text).toBe('Os anúncios já custaram $698 e as vendas somam $227 até agora: mesmo com só 2 pedidos, o gasto já passou das vendas.')
    expect(v.details.map(d => d.text).join(' ')).not.toContain('ainda não diz nada')
    expect(v.roas?.state).toBe('neg')
  })

  it('the split halves the loss, never the spend or the sales', () => {
    const v = buildVerdict({ ...day(EPOCH_TODAY, 855), split: true })
    expect(v.amount).toBeCloseTo(EPOCH_TODAY.operatingProfit / 2, 6)
    expect(v.details[0].text).toContain('$698')
    expect(v.details[0].text).toContain('$227')
  })

  it('before 04h the verdict is still "cedo demais"', () => {
    const v = buildVerdict(day(EPOCH_TODAY, 200))
    expect(v.early).toBe(true)
    expect(v.chips[0].code).toBe('cedo')
  })
})

// "Sobraram 1 centavo" / "Sobraram 0 centavos" (Dumpling 8jcp3a, mês passado,
// margin 0,62% then 0,32%).
describe('perDollarLine', () => {
  it('agrees the verb with the amount', () => {
    expect(perDollarLine(12.0, true).text).toBe('Sobraram 12 centavos de cada dólar vendido.')
    expect(perDollarLine(0.62, true).text).toBe('Sobrou 1 centavo de cada dólar vendido.')
    expect(perDollarLine(-1.2, false).text).toBe('Faltou 1 centavo em cada dólar vendido para empatar.')
    expect(perDollarLine(-6, false).text).toBe('Faltaram 6 centavos em cada dólar vendido para empatar.')
  })

  it('says "menos de 1 centavo" instead of 0 centavos', () => {
    expect(perDollarLine(0.32, true).text).toBe('Sobrou menos de 1 centavo de cada dólar vendido.')
    expect(perDollarLine(-0.3, false).text).toBe('Faltou menos de 1 centavo em cada dólar vendido para empatar.')
  })

  it('past a dollar it says dollars, not hundreds of cents', () => {
    expect(perDollarLine(-225.34, false).text).toBe('Faltaram $2,25 em cada dólar vendido para empatar.')
    expect(perDollarLine(-140, false).text).toBe('Faltou $1,40 em cada dólar vendido para empatar.')
  })

  it('in the verdict of a thin month', () => {
    const v = buildVerdict({
      stores: [store({ id: 'd', name: 'Dumpling', totals: pnl({ revenue: 47601.65, orders: 549, cogs: 17000, shopifyFees: 268.03, metaSpend: 30182.44 }) })],
      period: 'lastmonth', range: { from: '2026-10-01', to: '2026-10-31' }, today: '2026-11-18', anchorTimezone: 'America/Sao_Paulo', comparison: null,
    })
    expect(v.details[0].text).toBe('Sobrou menos de 1 centavo de cada dólar vendido.')
  })
})
