import { describe, expect, it } from 'vitest'
import { sumPnL, type PnL, type PnLLines } from '../engine/pnl'
import {
  DEFAULT_CONFIG, evaluateStoreAlerts, scalePushText, summaryText,
  type AlertConfig, type StoreAlertInput,
} from '../alerts'

// Push titles are stored and shown again in the phone's alerts sheet, so they
// must read like every screen: pt-BR separators, true minus sign, no "K".

const pnl = (over: Partial<PnLLines> = {}): PnL => sumPnL([{ ...sumPnL([]), ...over }])
// Break-even 2.5× (contribution $4,000 on $10,000), $500 of Meta a day.
const WEEK = { revenue: 10000, orders: 100, cogs: 6000, metaSpend: 3500 }

function fire(today: Partial<PnLLines>, cfg: AlertConfig = DEFAULT_CONFIG, over: Partial<StoreAlertInput> = {}) {
  return evaluateStoreAlerts({
    storeId: 's1', name: 'EPOCH ®️', day: '2026-11-17', minutesIntoDay: 15 * 60, configured: true,
    today: pnl(today), trailing: pnl(WEEK), ...over,
  }, cfg)
}

/** English decimals ("0.62", "12.4K"), a hyphen used as minus, or "K". */
function expectPtBr(text: string) {
  expect(text).not.toMatch(/\d\.\d{1,2}(?!\d)/)
  expect(text).not.toMatch(/-\$|-\d/)
  expect(text).not.toMatch(/\d[.,]?\d*K\b/)
}

describe('alert push text is pt-BR', () => {
  it('ROAS below break-even: "ROAS 0,62×", "2,50×", "−$752"', () => {
    const [a] = fire({ revenue: 620, orders: 6, cogs: 372, metaSpend: 1000 })
    expect(a.kind).toBe('roas_drop')
    expect(a.title).toBe('⚠️ ROAS 0,62× abaixo do empate — EPOCH ®️')
    expect(a.body).toContain('Empate desta loja: 2,50×')
    expect(a.body).toContain('$1.000 na Meta')
    expect(a.body).toContain('lucro −$752')
    expectPtBr(a.title); expectPtBr(a.body)
  })

  it('thin margin: "Margem −80%", thousands with a dot, orders counted', () => {
    const [a] = fire({ revenue: 1500, orders: 15, cogs: 900, metaSpend: 500, fixedCosts: 1300 })
    expect(a.kind).toBe('margin_drop')
    expect(a.title).toBe('⚠️ Margem −80% — EPOCH ®️')
    expect(a.body).toBe('Abaixo de 10%. Hoje: $1.500 de receita e −$1.200 de lucro em 15 pedidos.')
    expectPtBr(a.title); expectPtBr(a.body)
  })

  it('a fractional margin threshold keeps its decimals with a comma', () => {
    const cfg = { ...DEFAULT_CONFIG, marginDrop: { enabled: true, threshold: 7.5 } }
    const [a] = fire({ revenue: 1500, orders: 1, cogs: 900, metaSpend: 500, fixedCosts: 50 }, cfg)
    expect(a.kind).toBe('margin_drop')
    expect(a.body).toMatch(/^Abaixo de 7,5%\. /)
    expect(a.body).toContain('em 1 pedido.')
  })

  it('spend without sales: whole dollars from $100, cents below, no "K"', () => {
    const [a] = fire({ orders: 0, metaSpend: 12345.6, shopSpend: 61.2 })
    expect(a.kind).toBe('spend_no_sales')
    expect(a.title).toBe('💸 $12.407 em anúncios e nenhuma venda — EPOCH ®️')
    expect(a.body).toContain('$12.346 na Meta e $61,20 em anúncios Shopify')
    expectPtBr(a.title); expectPtBr(a.body)
  })

  it('spend spike: "Gasto 220% da média", "$1.100", "ROAS 3,64×"', () => {
    const cfg = { ...DEFAULT_CONFIG, spendSpike: { enabled: true, threshold: 200 } }
    const [a] = fire({ revenue: 4000, orders: 40, cogs: 2400, metaSpend: 1100 }, cfg)
    expect(a.kind).toBe('spend_spike')
    expect(a.title).toBe('📣 Gasto 220% da média — EPOCH ®️')
    expect(a.body).toBe('$1.100 hoje contra $500 de média nos últimos 7 dias. ROAS 3,64×.')
  })

  it('scale push: "$1.969 gastos, 22 pedidos"', () => {
    const p = scalePushText('MOKOO', {
      name: 'CBO - CHRISTMAS CAPY', verdict: 'cut', spend: 1969.4, orders: 22,
      reasons: ['Margem de −50% em 7 dias — está queimando dinheiro'],
    })
    expect(p.kind).toBe('scale_cut')
    expect(p.body).toBe('Margem de −50% em 7 dias — está queimando dinheiro · MOKOO: $1.969 gastos, 22 pedidos nos últimos 7 dias fechados.')
    expect(scalePushText('MOKOO', { name: 'X', verdict: 'scale', spend: 50, orders: 1, reasons: [] }).body)
      .toBe('MOKOO: $50,00 gastos, 1 pedido nos últimos 7 dias fechados.')
  })

  it('daily summary: signed delta with a true minus, counts and losses in pt-BR', () => {
    const rows = [
      { name: 'MOKOO', configured: true, dayClosed: false, totals: pnl({ revenue: 20000, orders: 1174, cogs: 12000, metaSpend: 6000 }) },
      { name: 'EPOCH ®️', configured: true, dayClosed: false, totals: pnl({ revenue: 100, orders: 1, cogs: 60, metaSpend: 286.4 }) },
    ]
    const before = pnl({ revenue: 40000, orders: 2000, cogs: 24000, metaSpend: 12000 })
    const s = summaryText(sumPnL(rows.map(r => r.totals)), before, rows, true)
    // Today $1,753.60 against $4,000 yesterday: −56%.
    expect(s.title).toBe('📊 Hoje: $1.754 de lucro (−56% vs ontem nesta hora)')
    expect(s.body).toMatch(/^1\.175 pedidos · \$20\.100 receita · \$6\.286 anúncios · margem 9% · /)
    expect(s.body).toContain('Pior: EPOCH ®️ −$246')
    expectPtBr(s.title); expectPtBr(s.body)
  })

  it('daily summary: dollars, not a 5-digit percentage, against a near-zero or negative yesterday', () => {
    // $310 after $1,89 read "+16.302% vs ontem nesta hora".
    const title = (today: number, yesterday: number, same = true) =>
      summaryText(pnl({ revenue: today }), pnl({ revenue: yesterday }), [], same).title
    expect(title(310, 1.89)).toBe('📊 Hoje: $310 de lucro ($308 a mais que ontem nesta hora)')
    expect(title(250, -2.5)).toBe('📊 Hoje: $250 de lucro ($253 a mais que ontem nesta hora)')
    expect(title(-40, 0.8)).toBe('📊 Hoje: −$40,00 de lucro ($40,80 a menos que ontem nesta hora)')
    // A loss turning into a smaller loss reads as a gain.
    expect(title(-40, -100, false)).toBe('📊 Hoje: −$40,00 de lucro ($60,00 a mais que ontem)')
    // A jump past ±300% over a real base, in dollars too.
    expect(title(1000, 200)).toBe('📊 Hoje: $1.000 de lucro ($800 a mais que ontem nesta hora)')
    // A readable change between two profits keeps its percentage.
    expect(title(180, 100)).toBe('📊 Hoje: $180 de lucro (+80% vs ontem nesta hora)')
    expect(title(30, 100, false)).toBe('📊 Hoje: $30,00 de lucro (−70% vs ontem)')
    expect(title(0, 0)).toBe('📊 Hoje: $0 de lucro')
    for (const [t, y] of [[310, 1.89], [250, -2.5], [-40, 0.8], [1000, 200], [180, 100]]) {
      expect(title(t, y)).not.toMatch(/\d\.\d{3}%/)
      expectPtBr(title(t, y))
    }
  })

  it('daily summary without a margin shows a dash', () => {
    const rows = [{ name: 'Glooty', configured: false, dayClosed: false, totals: pnl({ metaSpend: 120 }) }]
    const s = summaryText(rows[0].totals, pnl(), rows, false)
    expect(s.body).toContain('margem —')
    expect(s.title).toBe('📊 Hoje: −$120 de lucro')
  })
})
