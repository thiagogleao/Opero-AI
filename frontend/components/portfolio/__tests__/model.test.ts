import { describe, expect, it } from 'vitest'
import { sumPnL, type PnL, type PnLLines } from '@/lib/engine/pnl'
import type { SharedAdAccount } from '@/lib/attributionModels'
import { adChannels, freshnessCell, idleReasons, laneState, lastSaleDate, noSalesCashHit, notSellingYet, pairOrdersIn, pairsMixedIn, quietNote, resultSortValue, sumMembers, resumoLinkOverrides, rowResult, sharedAccountBadges, storeDayOf, trailGap, trailProfitCount, trailRange, trailSinceStart, type QuietInput, type TrailDay } from '../model'

const pnl = (over: Partial<PnLLines> = {}): PnL => sumPnL([{ ...sumPnL([]), ...over }])
const NOW = new Date('2026-11-18T01:30:00Z')
const ago = (min: number) => new Date(NOW.getTime() - min * 60000).toISOString()

describe('rowResult', () => {
  it('is real profit for a store with costs', () => {
    const r = rowResult({ configured: true, totals: pnl({ revenue: 100, orders: 2, cogs: 30, metaSpend: 40 }) })
    expect(r).toEqual({ kind: 'profit', value: 30 })
    expect(resultSortValue(r)).toBe(30)
  })

  it('is revenue − ads without costs, and never sorts with real profit', () => {
    const r = rowResult({ configured: false, totals: pnl({ revenue: 156.3, orders: 2, metaSpend: 819.5 }) })
    expect(r.kind).toBe('revenue_minus_ads')
    expect(r.value).toBeCloseTo(-663.2, 6)
    expect(resultSortValue(r)).toBeNull()
  })

  it('is nothing (not $0) without orders and without spend', () => {
    expect(rowResult({ configured: true, totals: pnl() })).toEqual({ kind: 'none', value: null })
  })

  it('ads without a sale are a loss, not "sem vendas"', () => {
    const r = rowResult({ configured: true, totals: pnl({ metaSpend: 25 }) })
    expect(r).toEqual({ kind: 'profit', value: -25 })
  })
})

describe('noSalesCashHit', () => {
  it('names the chargebacks of a row with no sale (CAMP HALLOW, 11–17 nov)', () => {
    const t = pnl({ chargebacks: 312.63, chargebackFees: 30, chargebackCount: 2 })
    expect(rowResult({ configured: true, totals: t }).kind).toBe('none')
    const hit = noSalesCashHit(t)
    expect(hit?.what).toBe('2 chargebacks')
    expect(hit?.amount).toBeCloseTo(-342.63, 6)
  })

  it('names refunds and chargebacks together', () => {
    expect(noSalesCashHit(pnl({ refunds: 20, refundCount: 1, chargebacks: 50, chargebackCount: 3 }))?.what).toBe('1 reembolso e 3 chargebacks')
  })

  it('keeps the money when no count came with it', () => {
    expect(noSalesCashHit(pnl({ chargebackFees: 15 }))).toEqual({ what: null, amount: -15 })
  })

  it('says nothing when the store sold, or when nothing left the cash', () => {
    expect(noSalesCashHit(pnl({ revenue: 80, orders: 1, chargebacks: 50, chargebackCount: 1 }))).toBeNull()
    expect(noSalesCashHit(pnl())).toBeNull()
    expect(noSalesCashHit(pnl({ metaSpend: 25 }))).toBeNull()
  })
})

describe('adChannels', () => {
  it('judges the only channel that spent against the store break-even', () => {
    const t = pnl({ revenue: 16514, orders: 228, cogs: 5000, shopSpend: 6019 })
    const { gauge, spendOnly } = adChannels(t, true)
    expect(gauge?.label).toBe('Shopify')
    expect(gauge?.roas).toBeCloseTo(16514 / 6019, 6)
    expect(gauge?.breakEven).toBeCloseTo(t.breakEvenRoas!, 6)
    expect(spendOnly).toEqual([])
  })

  it('with both channels, Meta keeps the gauge and Shopify is spend only', () => {
    const { gauge, spendOnly } = adChannels(pnl({ revenue: 10942, orders: 134, cogs: 3461, metaSpend: 5624, shopSpend: 226 }), true)
    expect(gauge?.channel).toBe('meta')
    expect(gauge?.roas).toBeCloseTo(10942 / 5624, 6)
    expect(spendOnly).toHaveLength(1)
    expect(spendOnly[0].roas).toBeNull()
    expect(spendOnly[0].spend).toBe(226)
  })

  it('measures both channels together when both carry real spend (never revenue ÷ a small Meta spend)', () => {
    const { gauge, spendOnly } = adChannels(pnl({ revenue: 6130, orders: 88, cogs: 1500, metaSpend: 600, shopSpend: 1796 }), true)
    expect(gauge?.label).toBe('Anúncios')
    expect(gauge?.roas).toBeCloseTo(6130 / 2396, 6)
    expect(spendOnly).toEqual([])
    // Dumpling 8jcp3a today: $56 of Meta next to $1.796 of Shopify ads is a Shopify store.
    const d = adChannels(pnl({ revenue: 6130, orders: 88, metaSpend: 55.81, shopSpend: 1796 }), true)
    expect(d.gauge?.label).toBe('Shopify')
    expect(d.spendOnly.map(c => c.label)).toEqual(['Meta'])
  })

  it('has no break-even without costs and no gauge without spend', () => {
    expect(adChannels(pnl({ revenue: 156, metaSpend: 819 }), false).gauge?.breakEven).toBeNull()
    expect(adChannels(pnl({ revenue: 100, orders: 1 }), true).gauge).toBeNull()
  })
})

describe('sharedAccountBadges', () => {
  const pair: SharedAdAccount = { adStoreId: 'epoch', adStoreName: 'EPOCH', salesStoreId: 'camp', salesStoreName: 'CAMP HALLOW', orders: 66, revenue: 7035.94 }

  it('names the paying store on the selling store and the other way round', () => {
    expect(sharedAccountBadges('camp', [pair], 'Nos últimos 90 dias')[0].label).toBe('anúncios na conta da EPOCH')
    expect(sharedAccountBadges('epoch', [pair], 'Nos últimos 90 dias')[0].label).toBe('paga anúncios da CAMP HALLOW')
    expect(sharedAccountBadges('epoch', [pair], 'Nos últimos 90 dias')[0].detail).toContain('66 pedidos')
    expect(sharedAccountBadges('mokoo', [pair], 'x')).toEqual([])
  })

  it('tells a window the pair mixed from one it did not, and stays cautious when unknown', () => {
    // CAMP HALLOW stopped selling on 30 out: a November week has no cross orders.
    expect(pairOrdersIn([], pair)).toBe(0)
    expect(pairOrdersIn([{ ...pair, orders: 12 }], pair)).toBe(12)
    expect(pairOrdersIn(null, pair)).toBeNull()
    expect(pairsMixedIn([pair], [])).toEqual([])
    expect(pairsMixedIn([pair], [{ ...pair, orders: 3 }])).toEqual([pair])
    expect(pairsMixedIn([pair], null)).toEqual([pair])
  })
})

describe('freshness', () => {
  const lane = (min: number | null, staleness: 'ok' | 'amber' | 'red' | 'unknown', lastStatus: 'success' | 'error' | null = 'success') =>
    ({ lastSuccessAt: min === null ? null : ago(min), lastStatus, staleness })

  it('maps lanes like the top bar: red with an error is failing', () => {
    expect(laneState(lane(5, 'ok'))).toBe('ok')
    expect(laneState(lane(30, 'amber'))).toBe('stale')
    expect(laneState(lane(200, 'red', 'error'))).toBe('failing')
    expect(laneState(lane(200, 'red'))).toBe('stale')
    expect(laneState(null)).toBeNull()
  })

  it('reports the OLDEST source and the worst state, so a fresh source never hides a late one', () => {
    const c = freshnessCell({ shopify: lane(4, 'ok'), facebook: lane(130, 'red', 'error') }, NOW)
    expect(c.state).toBe('failing')
    expect(c.label).toBe('há 2 h')
    expect(c.detail).toBe('pedidos há 4 min · Meta há 2 h (última tentativa falhou)')
  })

  it('a store without ad sync is judged on orders alone; nothing known is unknown', () => {
    expect(freshnessCell({ shopify: lane(6, 'ok'), facebook: null }, NOW)).toMatchObject({ state: 'ok', label: 'há 6 min' })
    expect(freshnessCell(undefined, NOW).state).toBe('unknown')
    expect(freshnessCell({ shopify: lane(null, 'unknown'), facebook: null }, NOW)).toMatchObject({ state: 'unknown', label: 'nunca' })
  })
})

describe('trailRange', () => {
  it('is 30 days ending with the window, or the whole window when longer (max 92)', () => {
    expect(trailRange({ from: '2026-11-10', to: '2026-11-16' })).toEqual({ from: '2026-10-18', to: '2026-11-16' })
    expect(trailRange({ from: '2026-11-17', to: '2026-11-17' })).toEqual({ from: '2026-10-19', to: '2026-11-17' })
    expect(trailRange({ from: '2026-09-01', to: '2026-10-31' })).toEqual({ from: '2026-09-01', to: '2026-10-31' })
    // 1 Aug – 31 Oct is exactly 92 days: a longer window is cut there.
    expect(trailRange({ from: '2026-01-01', to: '2026-10-31' })).toEqual({ from: '2026-08-01', to: '2026-10-31' })
  })
})

describe('trailSinceStart', () => {
  const blank = (date: string): TrailDay => ({ date, profit: 0, revenue: 0, adSpend: 0, orders: 0 })
  const dates = (from: string, n: number) => Array.from({ length: n }, (_, i) => {
    const d = new Date(`${from}T12:00:00Z`)
    d.setUTCDate(d.getUTCDate() + i)
    return d.toISOString().slice(0, 10)
  })
  // Hibikura, 19 out – 17 nov (engine daily rows): nothing until 7 nov, when
  // its first order and first ad came.
  const HIBIKURA_PROFIT = [68.15, 17.22, -213.15, 87.01, -96.2, -10.09, 96.69, 187.16, 114.5, 44.29, 588.68]
  const hibikura = (): TrailDay[] => dates('2026-10-19', 30).map((date, i) => i < 19 ? blank(date)
    : { date, profit: HIBIKURA_PROFIT[i - 19], revenue: 100, adSpend: i === 19 ? 0 : 50, orders: 2 })

  it('starts the sparkline at the store\'s first day, as the Resumo chart does (Hibikura: 8 de 11, not 8 de 30)', () => {
    const r = trailSinceStart(hibikura(), '2026-11-07')
    expect(r.startedOn).toBe('2026-11-07')
    expect(r.days).toHaveLength(11)
    expect(r.days[0].date).toBe('2026-11-07')
    expect(r.days.filter(d => d.profit > 0)).toHaveLength(8)
    expect(r.days.reduce((a, d) => a + d.profit, 0)).toBeCloseTo(884.26, 2)
  })

  it('starts on the first ad when the ads came before the first sale', () => {
    const days = dates('2026-10-24', 30).map(blank)
    days[11] = { ...days[11], adSpend: 74.48, profit: -74.48 } // 4 nov
    days[13] = { ...days[13], revenue: 403.71, orders: 4, adSpend: 267.99, profit: 135.72 } // 6 nov
    const r = trailSinceStart(days, '2026-11-06')
    expect(r.startedOn).toBe('2026-11-04')
    expect(r.days[0].date).toBe('2026-11-04')
    expect(r.days).toHaveLength(19)
  })

  it('keeps idle days after the start and every day of an older store', () => {
    const days = hibikura()
    days[25] = blank(days[25].date) // a quiet day after the start still counts
    expect(trailSinceStart(days, '2026-11-07').days).toHaveLength(11)
    // MOKOO sold before the trail: nothing is dropped, nothing to say.
    expect(trailSinceStart(hibikura(), '2026-04-11')).toEqual({ days: hibikura(), startedOn: null })
  })

  it('counts "dias no lucro" on closed days only, as the Resumo line does', () => {
    const r = trailSinceStart(hibikura(), '2026-11-07')
    // 17 nov still running (MOKOO, Este mês at 09h): its morning is not a day.
    expect(trailProfitCount(r.days, '2026-11-17')).toEqual({ inProfit: 7, of: 10, leftOut: true })
    expect(trailProfitCount(r.days, null)).toEqual({ inProfit: 8, of: 11, leftOut: false })
    // A running day outside the bars (Hibikura's Tokyo day already on 18 nov).
    expect(trailProfitCount(r.days, '2026-11-18')).toEqual({ inProfit: 8, of: 11, leftOut: false })
  })

  it('falls back on the first active day when the first sale is unknown', () => {
    const r = trailSinceStart(hibikura(), null)
    expect(r.startedOn).toBe('2026-11-07')
    expect(r.days).toHaveLength(11)
    expect(trailSinceStart([blank('2026-11-01')], null)).toEqual({ days: [blank('2026-11-01')], startedOn: null })
  })
})

describe('trailGap', () => {
  const blank = (date: string): TrailDay => ({ date, profit: 0, revenue: 0, adSpend: 0, orders: 0 })
  const october = () => Array.from({ length: 31 }, (_, i) => blank(`2026-10-${String(i + 1).padStart(2, '0')}`))

  it('says "ainda não vendia" for a window that ends before the first sale (Hibikura, Mês passado)', () => {
    // It read "sem movimento em 31 dias" next to "ainda não vendia · 1ª venda em 7 nov".
    expect(trailGap(october(), { configured: true, firstOrderDate: '2026-11-07' })).toEqual({ kind: 'not_yet' })
    // Before the missing costs: a store that did not exist yet has no series for that reason (Glooty, 1ª venda 6 nov).
    expect(trailGap(october(), { configured: false, firstOrderDate: '2026-11-06' })).toEqual({ kind: 'not_yet' })
  })

  it('draws the bars when ads ran before the first sale', () => {
    const days = october()
    days[30] = { ...days[30], adSpend: 74.48, profit: -74.48 }
    expect(trailGap(days, { configured: true, firstOrderDate: '2026-11-06' })).toBeNull()
    expect(trailGap(days, { configured: false, firstOrderDate: '2026-11-06' })).toEqual({ kind: 'unconfigured' })
  })

  it('keeps "sem movimento" for a store that existed, counting the days since it started', () => {
    expect(trailGap(october(), { configured: true, firstOrderDate: '2026-04-11' })).toEqual({ kind: 'idle', days: 31 })
    expect(trailGap(october(), { configured: true, firstOrderDate: null })).toEqual({ kind: 'idle', days: 31 })
    // First kept sale on 20 out, nothing kept since (refunded): 12 days, not 31.
    expect(trailGap(october(), { configured: true, firstOrderDate: '2026-10-20' })).toEqual({ kind: 'idle', days: 12 })
  })

  it('has nothing to say when there are no days or the bars have something to draw', () => {
    expect(trailGap(undefined, { configured: true, firstOrderDate: null })).toEqual({ kind: 'no_data' })
    expect(trailGap([], { configured: true, firstOrderDate: null })).toEqual({ kind: 'no_data' })
    const days = october()
    days[3] = { ...days[3], revenue: 80, orders: 1, profit: 12 }
    expect(trailGap(days, { configured: true, firstOrderDate: '2026-04-11' })).toBeNull()
  })
})

describe('resumoLinkOverrides', () => {
  const week = { from: '2026-11-10', to: '2026-11-16' }
  it('keeps the period when the store is on the same date as Brasília', () => {
    expect(resumoLinkOverrides({ id: 'mokoo', storeToday: '2026-11-17' }, { today: '2026-11-17', period: '7d', range: week }))
      .toEqual({ loja: 'mokoo' })
  })
  it('opens a store a day ahead (Tóquio after noon) on the exact dates of the row', () => {
    expect(resumoLinkOverrides({ id: 'hib', storeToday: '2026-11-18' }, { today: '2026-11-17', period: 'today', range: { from: '2026-11-17', to: '2026-11-17' } }))
      .toEqual({ loja: 'hib', periodo: 'custom', de: '2026-11-17', ate: '2026-11-17' })
    expect(resumoLinkOverrides({ id: 'hib', storeToday: '2026-11-18' }, { today: '2026-11-17', period: '7d', range: week }))
      .toEqual({ loja: 'hib', periodo: 'custom', de: '2026-11-10', ate: '2026-11-16' })
  })
  it('a custom window already has explicit dates', () => {
    expect(resumoLinkOverrides({ id: 'hib', storeToday: '2026-11-18' }, { today: '2026-11-17', period: 'custom', range: week }))
      .toEqual({ loja: 'hib' })
  })
})

describe('lastSaleDate', () => {
  it('is the date on the store calendar, not the UTC date', () => {
    // 23h50 on 17 nov in Belém is 02h50 UTC on the 18th.
    expect(lastSaleDate('2026-11-18T02:50:00.000Z', 'America/Belem')).toBe('2026-11-17')
    expect(lastSaleDate('2026-11-18T02:50:00.000Z', 'Asia/Tokyo')).toBe('2026-11-18')
  })
  it('is null without an order or with a bad timestamp', () => {
    expect(lastSaleDate(null, 'America/Belem')).toBeNull()
    expect(lastSaleDate('nope', 'America/Belem')).toBeNull()
  })
})

describe('quietNote', () => {
  // Glooty on 18 nov: last order 10 nov, last ad spend 15 nov, readings current.
  const glooty: QuietInput = {
    range: { from: '2026-11-11', to: '2026-11-17' }, today: '2026-11-18',
    lastSaleDate: '2026-11-10', lastAdDate: '2026-11-15', ordersLane: 'ok', metaLane: 'ok',
  }

  it('says when the store last sold, that the order reading is current and that the ads stopped', () => {
    const n = quietNote(glooty)!
    expect(n.tone).toBe('info')
    expect(n.title).toBe('Última venda em 10 nov, há 8 dias')
    expect(n.lines.join(' ')).toContain('Não é falha de sincronização')
    expect(n.lines.join(' ')).toContain('Anúncios parados: o último gasto foi em 15 nov.')
  })

  it('works on "Hoje" too', () => {
    expect(quietNote({ ...glooty, range: { from: '2026-11-18', to: '2026-11-18' } })?.title).toBe('Última venda em 10 nov, há 8 dias')
  })

  it('warns, without blaming the store, when the order reading is late', () => {
    const n = quietNote({ ...glooty, ordersLane: 'failing' })!
    expect(n.tone).toBe('warn')
    expect(n.lines[0]).toContain('pode haver vendas que ainda não chegaram')
    expect(n.lines.join(' ')).not.toContain('Não é falha')
  })

  it('does not call the ads stopped while the Meta reading is late, and says when they still spend', () => {
    expect(quietNote({ ...glooty, metaLane: 'stale' })!.lines.join(' ')).toContain('O último gasto em anúncios registrado foi em 15 nov.')
    expect(quietNote({ ...glooty, lastAdDate: '2026-11-17' })!.lines.join(' ')).toContain('continuam gastando')
    expect(quietNote({ ...glooty, lastAdDate: null })!.lines).toHaveLength(1)
  })

  it('also speaks on a longer window whose sales stopped before its end (Glooty 30 dias)', () => {
    expect(quietNote({ ...glooty, range: { from: '2026-10-19', to: '2026-11-17' } })?.title).toBe('Última venda em 10 nov, há 8 dias')
  })

  it('stays silent when the last sale is recent or the window is in the past', () => {
    expect(quietNote({ ...glooty, lastSaleDate: '2026-11-17', range: { from: '2026-11-18', to: '2026-11-18' } })).toBeNull()
    expect(quietNote({ ...glooty, lastSaleDate: '2026-11-17' })).toBeNull()
    expect(quietNote({ ...glooty, lastSaleDate: null })).toBeNull()
    // 1–5 nov, whatever happened since: not about the present.
    expect(quietNote({ ...glooty, range: { from: '2026-11-01', to: '2026-11-05' } })).toBeNull()
  })
})

describe('sumMembers', () => {
  it('counts the stores the verdict sums: with costs and with something in the window', () => {
    const stores = [
      { id: 'hibikura', configured: true, totals: pnl({ revenue: 1448, orders: 20, metaSpend: 611 }) },
      { id: 'epoch', configured: true, totals: pnl({ metaSpend: 196 }) },
      { id: 'camp', configured: true, totals: pnl() },
      { id: 'glooty', configured: false, totals: pnl() },
    ]
    const m = sumMembers(stores)
    expect(m.summed.map(s => s.id)).toEqual(['hibikura', 'epoch'])
    expect(m.idle.map(s => s.id)).toEqual(['camp'])
    expect(m.excluded.map(s => s.id)).toEqual(['glooty'])
  })

  it('never calls a lone store idle', () => {
    expect(sumMembers([{ id: 'camp', configured: true, totals: pnl() }]).summed).toHaveLength(1)
  })
})

describe('idleReasons', () => {
  const lastMonth = { from: '2026-10-01', to: '2026-10-31' }
  it('names a store that had not sold yet apart from one that stopped, as the verdict does', () => {
    const idle = [
      { name: 'Hibikura', dayState: 'complete', firstOrderDate: '2026-11-07' },
      { name: 'CAMP HALLOW', dayState: 'complete', firstOrderDate: '2026-07-24' },
      { name: 'Nova', dayState: 'complete', firstOrderDate: null },
    ]
    const r = idleReasons(idle, lastMonth)
    expect(r.notYet.map(s => s.name)).toEqual(['Hibikura'])
    expect(r.quiet.map(s => s.name)).toEqual(['CAMP HALLOW', 'Nova'])
    expect(r.notStarted).toEqual([])
  })

  it('a store whose own day has not begun is neither', () => {
    const today = { from: '2026-11-19', to: '2026-11-19' }
    const r = idleReasons([{ name: 'EPOCH', dayState: 'not_started', firstOrderDate: '2026-12-01' }], today)
    expect(r.notStarted.map(s => s.name)).toEqual(['EPOCH'])
    expect(r.notYet).toEqual([])
    expect(r.quiet).toEqual([])
  })

  it('a first sale inside the window is not "ainda não vendia"', () => {
    const mtd = { from: '2026-11-01', to: '2026-11-18' }
    expect(idleReasons([{ name: 'X', dayState: 'running', firstOrderDate: '2026-11-18' }], mtd).quiet).toHaveLength(1)
    // The row cell uses the same rule ("ainda não vendia · 1ª venda em 7 nov").
    expect(notSellingYet({ dayState: 'complete', firstOrderDate: '2026-11-07' }, lastMonth)).toBe(true)
    expect(notSellingYet({ dayState: 'complete', firstOrderDate: '2026-11-07' }, mtd)).toBe(false)
  })
})

describe('storeDayOf', () => {
  it('names the store\'s own day of an archive, as Ajustes does (not the UTC date)', () => {
    // 22h on 10 nov in São Paulo = 01h UTC on the 11th.
    expect(storeDayOf('2026-11-11T01:00:00.000Z', 'America/Sao_Paulo')).toBe('2026-11-10')
    expect(storeDayOf('2026-11-10T12:02:25.443Z', 'America/Sao_Paulo')).toBe('2026-11-10')
    expect(storeDayOf('2026-11-10T23:00:00.000Z', 'Asia/Tokyo')).toBe('2026-11-11')
    expect(storeDayOf(null, 'America/Sao_Paulo')).toBeNull()
    expect(storeDayOf('not a date', 'America/Sao_Paulo')).toBeNull()
  })
})
