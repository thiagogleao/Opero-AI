import { describe, expect, it } from 'vitest'
import { sumPnL, type PnL, type PnLLines } from '../../engine/pnl'
import {
  alertPatchProblems, DEFAULT_CONFIG, evaluateStoreAlerts, mergeAlertConfig, summaryText,
  type StoreAlertInput,
} from '../../alerts'

const pnl = (over: Partial<PnLLines> = {}): PnL => sumPnL([{ ...sumPnL([]), ...over }])

function input(today: Partial<PnLLines>, trailing: Partial<PnLLines> = {}, over: Partial<StoreAlertInput> = {}): StoreAlertInput {
  return {
    storeId: 's1', name: 'MOKOO', day: '2026-11-17', minutesIntoDay: 15 * 60, configured: true,
    today: pnl(today), trailing: pnl(trailing), ...over,
  }
}
// Last 7 days: $10,000 revenue, $6,000 of variable costs → contribution
// $4,000, break-even ROAS 2.5×; $3,500 of Meta spend → $500 a day.
const WEEK = { revenue: 10000, orders: 100, cogs: 6000, metaSpend: 3500 }
const kinds = (i: StoreAlertInput, cfg = DEFAULT_CONFIG) => evaluateStoreAlerts(i, cfg).map(a => a.kind)

describe('evaluateStoreAlerts', () => {
  it('fires "gasto sem vendas" on a day with spend and no sale', () => {
    const fired = evaluateStoreAlerts(input({ orders: 0, metaSpend: 400 }, WEEK), DEFAULT_CONFIG)
    expect(fired.map(a => a.kind)).toEqual(['spend_no_sales'])
    expect(fired[0].url).toBe('/m?loja=s1')
    expect(fired[0].title).toContain('nenhuma venda')
  })
  it('counts Shopify ads toward spend without sales', () => {
    expect(kinds(input({ orders: 0, metaSpend: 10, shopSpend: 60 }, WEEK))).toEqual(['spend_no_sales'])
  })
  it('judges ROAS against the store own break-even', () => {
    // ROAS 2.2× is fine against a fixed 1.5× target but below this store's 2.5×.
    expect(kinds(input({ revenue: 1100, orders: 11, cogs: 660, metaSpend: 500 }, WEEK))).toEqual(['roas_drop'])
    // ROAS 4× is above break-even and the margin is 15%: nothing to say.
    expect(kinds(input({ revenue: 2000, orders: 20, cogs: 1200, metaSpend: 500 }, WEEK))).toEqual([])
  })
  it('uses the fixed target for a store without cost settings, and never its margin', () => {
    const unconfigured = { configured: false }
    expect(kinds(input({ revenue: 600, orders: 6, metaSpend: 500 }, WEEK, unconfigured))).toEqual(['roas_drop'])
    expect(kinds(input({ revenue: 1000, orders: 10, metaSpend: 500 }, WEEK, unconfigured))).toEqual([])
  })
  it('sends one push per problem: margin only when ROAS is above break-even', () => {
    // ROAS 3×, contribution $600 − $500 Meta − $80 fixed = $20 profit: 1.3% margin.
    expect(kinds(input({ revenue: 1500, orders: 15, cogs: 900, metaSpend: 500, fixedCosts: 80 }, WEEK))).toEqual(['margin_drop'])
  })
  it('waits for the store own hour and for enough spend', () => {
    expect(kinds(input({ orders: 0, metaSpend: 400 }, WEEK, { minutesIntoDay: 3 * 60 }))).toEqual([])
    expect(evaluateStoreAlerts(input({ orders: 0, metaSpend: 400 }, WEEK, { minutesIntoDay: 3 * 60 }), DEFAULT_CONFIG, { ignoreHour: true })).toHaveLength(1)
    expect(kinds(input({ revenue: 50, orders: 1, cogs: 30, metaSpend: 40 }, WEEK))).toEqual([])
  })
  it('flags a spend spike against the trailing average when enabled', () => {
    const cfg = { ...DEFAULT_CONFIG, spendSpike: { enabled: true, threshold: 200 } }
    expect(kinds(input({ revenue: 4000, orders: 40, cogs: 2400, metaSpend: 1100 }, WEEK), cfg)).toEqual(['spend_spike'])
  })
})

describe('alert config', () => {
  it('refuses a cleared field instead of storing 0', () => {
    expect(alertPatchProblems({ dailySummary: { hour: 0.5 } })).toHaveLength(1)
    expect(alertPatchProblems({ roasDrop: { threshold: 0 } })).toHaveLength(1)
    expect(alertPatchProblems({ minSpend: '' })).toHaveLength(1)
    expect(alertPatchProblems({ fromHour: 24 })).toHaveLength(1)
    expect(alertPatchProblems({ roasDrop: { enabled: false }, dailySummary: { hour: 20 } })).toEqual([])
  })
  it('merges a partial rule over the current one, not over the defaults', () => {
    const current = mergeAlertConfig(DEFAULT_CONFIG, { roasDrop: { enabled: false, threshold: 2 } })
    const next = mergeAlertConfig(current, { roasDrop: { threshold: 1.8 } })
    expect(next.roasDrop).toEqual({ enabled: false, threshold: 1.8 })
  })
  it('ignores junk in a stored blob', () => {
    const c = mergeAlertConfig(DEFAULT_CONFIG, { dailySummary: { hour: 99, enabled: 'yes' }, minSpend: -5 })
    expect(c.dailySummary).toEqual(DEFAULT_CONFIG.dailySummary)
    expect(c.minSpend).toBe(DEFAULT_CONFIG.minSpend)
    expect(c.spendNoSales).toEqual(DEFAULT_CONFIG.spendNoSales)
  })
})

describe('summaryText', () => {
  it('names the stores that spent without selling and those without costs', () => {
    const rows = [
      { name: 'MOKOO', configured: true, dayClosed: false, totals: pnl({ revenue: 1000, orders: 10, cogs: 400, metaSpend: 300 }) },
      { name: 'Glooty', configured: false, dayClosed: false, totals: pnl({ metaSpend: 120 }) },
    ]
    const s = summaryText(sumPnL(rows.map(r => r.totals)), pnl({ revenue: 500, orders: 5, cogs: 200, metaSpend: 200 }), rows, true)
    expect(s.title).toBe('📊 Hoje: $180 de lucro (+80% vs ontem nesta hora)')
    expect(s.body).toContain('Sem vendas: Glooty ($120 em anúncios)')
    expect(s.body).toContain('Sem custos configurados: Glooty')
    expect(s.body).toContain('Melhor: MOKOO $300')
  })
})
