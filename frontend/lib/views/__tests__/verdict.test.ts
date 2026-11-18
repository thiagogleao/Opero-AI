import { describe, expect, it } from 'vitest'
import { sumPnL, type PnL, type PnLLines } from '../../engine/pnl'
import {
  buildVerdict, comparisonPhrase, comparisonText, periodPhrase, roasSummary, storeStatus, sumTotals,
  type VerdictInput, type VerdictStore,
} from '../verdict'

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
    expect(v.when).toBe('5 lojas na soma · hoje · vs ontem até esta hora')
    expect(v.amountCaption).toBe('de lucro real até agora, depois de todos os custos')
    expect(v.roas).toBeNull() // ROAS only means something per store
  })

  it("puts the clock and Tokyo's closed day in the fine print", () => {
    expect(v.notes.map(n => n.text)).toEqual([
      'Faltam 10h22 para o dia fechar.',
      'A Hibikura entra com o dia de Tóquio, que já fechou.',
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
