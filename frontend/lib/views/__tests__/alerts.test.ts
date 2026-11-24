import { describe, expect, it } from 'vitest'
import { sumPnL, type PnL, type PnLLines } from '../../engine/pnl'
import {
  alertPatchProblems, dailySummaryOf, DEFAULT_CONFIG, evaluateStoreAlerts, mergeAlertConfig, storeUrl, summaryText, SUMMARY_URL,
  type StoreAlertInput,
} from '../../alerts'
import { buildVerdict, verdictInputFromPortfolio } from '../verdict'
import type { PortfolioView } from '../portfolio'

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
    // The period is explicit: the phone would otherwise restore the last one used.
    expect(fired[0].url).toBe('/m?loja=s1&periodo=today')
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
  it('names the stores that spent without selling; a store without costs gets its own line, out of the ranks', () => {
    const rows = [
      { name: 'MOKOO', configured: true, dayClosed: false, totals: pnl({ revenue: 1000, orders: 10, cogs: 400, metaSpend: 300 }) },
      { name: 'EPOCH', configured: true, dayClosed: false, totals: pnl({ orders: 0, metaSpend: 80 }) },
      { name: 'Glooty', configured: false, dayClosed: false, totals: pnl({ metaSpend: 120 }) },
    ]
    // The judged totals (the stores with costs), as dailySummaryOf passes them.
    const judged = sumPnL([rows[0].totals, rows[1].totals])
    const s = summaryText(judged, pnl({ revenue: 500, orders: 5, cogs: 200, metaSpend: 200 }), rows, true)
    expect(s.title).toBe('📊 Hoje: $220 de lucro (+120% vs ontem nesta hora)')
    expect(s.body.startsWith('10 pedidos · $1.000 receita · $380 anúncios · margem 22% · ')).toBe(true)
    expect(s.body).toContain('Melhor: MOKOO $300')
    expect(s.body).toContain('Pior: EPOCH −$80,00')
    expect(s.body).toContain('Sem vendas: EPOCH ($80,00 em anúncios)')
    expect(s.body).toContain('Fora do lucro, sem custos configurados: Glooty (receita − anúncios −$120)')
    expect(s.body).not.toContain('Pior: Glooty')
    expect(s.body).not.toContain('Sem vendas: Glooty')
  })
})

// 12 nov: the push read "$1.664 de lucro" (every store summed, Glooty's −$138
// of ads with no sale inside) while the Todas · Hoje screen it opens read
// "$1.802 de lucro real somando 6 lojas" with Glooty left out.
describe('dailySummaryOf', () => {
  const row = (id: string, name: string, configured: boolean, today: Partial<PnLLines>, before: Partial<PnLLines>) => ({
    id, name, timezone: 'America/Sao_Paulo', configured, totals: pnl(today),
    comparison: { included: true, totals: pnl(before) }, partial: true, minutesCovered: 17 * 60, dayState: 'running', dayClosed: false,
  })
  const stores = [
    row('m', 'MOKOO', true, { revenue: 3000, orders: 40, cogs: 1200, metaSpend: 1500 }, { revenue: 3500, orders: 45, cogs: 1400, metaSpend: 1400 }),
    row('d', 'Dumpling', true, { revenue: 4960, orders: 69, cogs: 1500, metaSpend: 100, shopSpend: 2235 }, { revenue: 5000, orders: 70, cogs: 1500, shopSpend: 2000 }),
    row('g', 'Glooty', false, { metaSpend: 137.78 }, { metaSpend: 60 }),
  ]
  const all = sumPnL(stores.map(s => s.totals))
  const view = {
    generatedAt: '2026-11-12T20:00:00.000Z', period: 'today', range: { from: '2026-11-12', to: '2026-11-12' },
    anchorToday: '2026-11-12', anchorTimezone: 'America/Sao_Paulo', totals: all, stores,
    comparison: {
      from: '2026-11-11', to: '2026-11-11', label: 'ontem até esta hora', sameTimeOfDay: true, cutoffMinutes: 17 * 60,
      totals: sumPnL(stores.map(s => s.comparison.totals)),
    },
  } as unknown as PortfolioView
  const verdict = buildVerdict(verdictInputFromPortfolio(view))
  const s = dailySummaryOf(view)

  it('says the profit the verdict of the screen it opens says, not the sum of every store', () => {
    expect(s.profit).toBeCloseTo(verdict.amount!, 6)
    expect(s.profit).toBeCloseTo(stores[0].totals.operatingProfit + stores[1].totals.operatingProfit, 6)
    expect(s.profit).not.toBeCloseTo(all.operatingProfit, 2)
    expect(s.title.startsWith('📊 Hoje: $')).toBe(true)
  })
  it('compares with the judged stores of yesterday and keeps Glooty out of the margin and the ranks', () => {
    expect(s.title.endsWith('vs ontem nesta hora)')).toBe(true)
    expect(s.body).toContain('Fora do lucro, sem custos configurados: Glooty (receita − anúncios −$138)')
    expect(s.body).not.toMatch(/Melhor: Glooty|Pior: Glooty/)
    expect(s.body).toContain(`margem ${Math.round(verdict.totals.margin!)}%`)
  })
})

describe('quiet hours', () => {
  it('holds alert pushes from 23:00 to 08:00 in Brasília', async () => {
    const { inQuietHours } = await import('../../alerts')
    expect(inQuietHours(new Date('2026-11-17T02:30:00Z'))).toBe(true)  // 23:30 BRT
    expect(inQuietHours(new Date('2026-11-17T10:59:00Z'))).toBe(true)  // 07:59 BRT
    expect(inQuietHours(new Date('2026-11-17T11:00:00Z'))).toBe(false) // 08:00 BRT
    expect(inQuietHours(new Date('2026-11-17T16:30:00Z'))).toBe(false) // 13:30 BRT
  })
})

// A notification tap opens the day the push talks about, never the period
// last used on the phone (a tap on today's ROAS alert opened "30 dias").
describe('push links carry their period', () => {
  it('store alerts open the store on its own today; a tab keeps the period too', () => {
    expect(storeUrl('user_3CV')).toBe('/m?loja=user_3CV&periodo=today')
    expect(storeUrl('a b', { tab: 'campanhas', periodo: '7d' })).toBe('/m?loja=a%20b&periodo=7d&aba=campanhas')
  })
  it('the daily summary opens Todas · Hoje, not the store last pinned', () => {
    expect(SUMMARY_URL).toBe('/m?loja=todas&periodo=today')
    const q = new URLSearchParams(SUMMARY_URL.split('?')[1])
    expect([q.get('loja'), q.get('periodo')]).toEqual(['todas', 'today'])
  })
})
