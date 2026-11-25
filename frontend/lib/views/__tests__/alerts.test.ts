import { describe, expect, it } from 'vitest'
import { sumPnL, type PnL, type PnLLines } from '../../engine/pnl'
import {
  alertPatchProblems, dailySummaryOf, DEFAULT_CONFIG, evaluateStoreAlerts, mergeAlertConfig, storeUrl, summaryText, summaryUrl,
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
    expect(fired[0].url).toMatch(/^\/m\?loja=s1&periodo=custom&de=2026-11-17&ate=2026-11-17&origem=push&n=[a-z0-9]{8}$/)
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
  it('judges a store whose ads are Shopify ads: the gate is all the ad money, as the margin is', () => {
    // Dumpling 8jcp3a's losing 4 nov with every dollar of ads on Shopify ads:
    // $835 of sales, $767 of Shopify ads, $0 of Meta. Before: nothing fired.
    const day = { revenue: 835, orders: 9, cogs: 272, shopSpend: 767 }
    expect(kinds(input(day, WEEK))).toEqual(['roas_drop'])
    // Live 24 nov: 2 orders, $101,52, Meta $5,61 + Shopify $62,03, margin 2,9%.
    const thin = { revenue: 101.52, orders: 2, cogs: 30, metaSpend: 5.61, shopSpend: 62.03 }
    const cfg = { ...DEFAULT_CONFIG, roasDrop: { enabled: false, threshold: 1.5 } }
    expect(kinds(input(thin, WEEK), cfg)).toEqual(['margin_drop'])
  })
  it('measures ROAS on the store ad channel and names it, as the screens do', () => {
    // $1.000 of sales on $500 of Meta + $560 of Shopify ads: revenue ÷ Meta
    // is 2,0×, the channel ROAS (both) 0,94×.
    const [a] = evaluateStoreAlerts(input({ revenue: 1000, orders: 10, cogs: 600, metaSpend: 500, shopSpend: 560 }, WEEK), DEFAULT_CONFIG)
    expect(a.kind).toBe('roas_drop')
    expect(a.title).toBe('⚠️ ROAS dos anúncios 0,94× abaixo do empate — MOKOO')
    expect(a.body).toContain('$500 na Meta e $560 em anúncios Shopify')
    const [shop] = evaluateStoreAlerts(input({ revenue: 835, orders: 9, cogs: 272, shopSpend: 767 }, WEEK), DEFAULT_CONFIG)
    expect(shop.title).toBe('⚠️ ROAS Shopify 1,09× abaixo do empate — MOKOO')
    expect(shop.body).toContain('$767 em anúncios Shopify')
    expect(shop.body).not.toContain('na Meta')
  })
  it('never calls revenue − ads "lucro" for a store without cost settings', () => {
    // Glooty, 8 nov: $372 of sales, $608 of Meta.
    const [a] = evaluateStoreAlerts(input({ revenue: 371.76, orders: 4, metaSpend: 607.94 }, WEEK, { configured: false, name: 'Glooty' }), DEFAULT_CONFIG)
    expect(a.title).toBe('⚠️ ROAS 0,61× abaixo do empate — Glooty')
    expect(a.body).toBe('Custos não configurados: comparado com a meta fixa de 1,50×. Hoje: $372 de receita, $608 na Meta: receita − anúncios −\u2060$236 (sem custos configurados).')
    expect(a.body).not.toContain('lucro')
  })
  it('flags a spend spike against the trailing average when enabled', () => {
    const cfg = { ...DEFAULT_CONFIG, spendSpike: { enabled: true, threshold: 200 } }
    expect(kinds(input({ revenue: 4000, orders: 40, cogs: 2400, metaSpend: 1100 }, WEEK), cfg)).toEqual(['spend_spike'])
  })
  // Regression: measured on Meta alone, Dumpling 8jcp3a (Shopify ads, 17 nov:
  // $1.867 against about $860 a day, $60 of Meta against $0) never spiked.
  it('measures the spike on all the ad money, Shopify ads included, and names the channel', () => {
    const cfg = { ...DEFAULT_CONFIG, spendSpike: { enabled: true, threshold: 200 } }
    const dumplingWeek = { revenue: 21000, orders: 700, cogs: 9000, shopSpend: 6019 }
    const day = { revenue: 6400, orders: 210, cogs: 2700, shopSpend: 1867.45, metaSpend: 60 }
    const fired = evaluateStoreAlerts(input(day, dumplingWeek, { name: 'Dumpling Squishy · 8jcp3a' }), cfg)
    const spike = fired.find(a => a.kind === 'spend_spike')
    expect(spike?.title).toBe('📣 Gasto em anúncios 224% da média — Dumpling Squishy · 8jcp3a')
    expect(spike?.body).toBe('$1.927 em anúncios hoje ($60,00 na Meta e $1.867 em anúncios Shopify) contra $860 de média por dia nos últimos 7 dias. ROAS Shopify 3,43×.')
    // (Meta under 10% of the spend: the store's channel, and its ROAS, stay Shopify's.)
    // Shopify ads alone: the spend named as such, beside the Shopify ROAS.
    const shopOnly = evaluateStoreAlerts(input({ ...day, metaSpend: 0 }, dumplingWeek), cfg).find(a => a.kind === 'spend_spike')
    expect(shopOnly?.body).toBe('$1.867 em anúncios Shopify hoje contra $860 de média por dia nos últimos 7 dias. ROAS Shopify 3,43×.')
    // Below the trailing threshold: nothing.
    expect(kinds(input({ ...day, shopSpend: 900, metaSpend: 0 }, dumplingWeek), cfg)).not.toContain('spend_spike')
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
    expect(s.body).toContain('Pior: EPOCH −\u2060$80,00')
    expect(s.body).toContain('Sem vendas: EPOCH ($80,00 em anúncios)')
    expect(s.body).toContain('Fora do lucro, sem custos configurados: Glooty (receita − anúncios −\u2060$120)')
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
    expect(s.body).toContain('Fora do lucro, sem custos configurados: Glooty (receita − anúncios −\u2060$138)')
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

// A notification tap opens the days the push talks about (lib/period
// notificationHref, R17), never the period last used on the phone, and never
// a preset that rolls.
describe('push links carry their dates', () => {
  it('store alerts carry their dates, origem=push and a nonce; a tab rides along', () => {
    expect(storeUrl('user_3CV', { from: '2026-11-24', nonce: 'abcd1234' }))
      .toBe('/m?loja=user_3CV&periodo=custom&de=2026-11-24&ate=2026-11-24&origem=push&n=abcd1234')
    // The scale push carries the 7 closed days it judged.
    expect(storeUrl('a b', { tab: 'campanhas', from: '2026-11-17', to: '2026-11-23', nonce: 'abcd1234' }))
      .toBe('/m?loja=a+b&periodo=custom&de=2026-11-17&ate=2026-11-23&aba=campanhas&origem=push&n=abcd1234')
  })
  it('the daily summary opens Todas on its own day, with the members it summed', () => {
    const q = new URLSearchParams(summaryUrl('2026-11-23', ['s1', 's2'], 'abcd1234').split('?')[1])
    expect([q.get('loja'), q.get('periodo'), q.get('de'), q.get('ate'), q.get('origem')]).toEqual(['todas', 'custom', '2026-11-23', '2026-11-23', 'push'])
    expect(q.get('m')).toMatch(/^[a-z0-9]{6}$/)
  })
  it('a threshold alert names the store-day it is about (the phone opens that day once it is over)', () => {
    const [a] = evaluateStoreAlerts(input({ orders: 0, metaSpend: 400 }, WEEK, { day: '2026-11-23' }), DEFAULT_CONFIG)
    expect(a.url).toMatch(/^\/m\?loja=s1&periodo=custom&de=2026-11-23&ate=2026-11-23&origem=push&n=/)
  })
})
