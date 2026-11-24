import { beforeEach, describe, expect, it, vi } from 'vitest'

// No database: the queries and the engine are answered here, and every call
// the comparison makes is recorded so the test can see what was priced.
vi.mock('../../db', () => ({
  query: vi.fn(async (sql: string, params: unknown[]) => {
    if (!sql.includes('archived_at')) return []
    const ids = (params[0] as string[]) ?? []
    return ids.includes('sw') ? [{ id: 'sw', d: '2026-11-10' }] : []
  }),
}))
vi.mock('../../engine/pnl', async importOriginal => {
  const real = await importOriginal<typeof import('../../engine/pnl')>()
  const TZ: Record<string, string> = { sw: 'America/Sao_Paulo', mk: 'America/Belem' }
  const fake = (id: string, range: { from: string; to: string }, cutoffMinutes: number | null) => ({
    store: { id, name: id, domain: null, timezone: TZ[id], userId: null, archived: id === 'sw' },
    configured: true, range, partial: false, minutesCovered: 1440, cutoffMinutes,
    totals: real.sumPnL([]), daily: [], hourly: null, countries: null, products: null,
  })
  return {
    ...real,
    computePnL: vi.fn(async (ids: string[], range: { from: string; to: string }, opts: { cutoffMinutes?: Record<string, number | null> } = {}) =>
      new Map(ids.map(id => [id, fake(id, range, opts.cutoffMinutes?.[id] ?? null)]))),
    computeSameTimeComparison: vi.fn(async (ids: string[], day: string) => {
      const prev = new Date(Date.parse(`${day}T00:00:00Z`) - 86400000).toISOString().slice(0, 10)
      return new Map(ids.map(id => [id, fake(id, { from: prev, to: prev }, 911)]))
    }),
  }
})

import { computePnL, computeSameTimeComparison } from '../../engine/pnl'
import { comparisonRange } from '../../engine/dates'
import { archivedComparison, buildPortfolio, type PortfolioStoreInput } from '../portfolio'
import { archivedComparison as fromStore } from '../store'

// 2026-11-24 15:11 in São Paulo and Belém.
const NOW = new Date('2026-11-24T18:11:00Z')
const SW: PortfolioStoreInput = { id: 'sw', name: 'Squishy World', timezone: 'America/Sao_Paulo', archived: true }
const MK: PortfolioStoreInput = { id: 'mk', name: 'MOKOO', timezone: 'America/Belem' }
const BARE = { liveFeed: false, chargebackHealth: false, freshness: false }

/** Every computePnL call: [ids, range, cutoffMinutes]. */
const pnlCalls = () => vi.mocked(computePnL).mock.calls.map(([ids, range, opts]) => [ids, range, opts?.cutoffMinutes ?? null])

beforeEach(() => { vi.mocked(computePnL).mockClear(); vi.mocked(computeSameTimeComparison).mockClear() })

describe('buildPortfolio of a lone archived store (the phone, /api/mobile)', () => {
  it('Este mês is compared on the days read (1–10 out), whole — not 1–24 out cut at 15h11', async () => {
    const v = await buildPortfolio([SW], 'mtd', null, null, NOW, BARE)
    expect(v.comparison).toMatchObject({ from: '2026-10-01', to: '2026-10-10', label: 'mesmos dias do mês passado', sameTimeOfDay: false, cutoffMinutes: null })
    expect(v.stores[0].comparison).toMatchObject({ included: true, range: { from: '2026-10-01', to: '2026-10-10' }, cutoffMinutes: null })
    expect(pnlCalls()).toContainEqual([['sw'], { from: '2026-10-01', to: '2026-10-10' }, null])
    expect(computeSameTimeComparison).not.toHaveBeenCalled()
    expect(v.stores[0].archivedOn).toBe('2026-11-10')
  })

  it('30 dias (25 out – 23 nov) is compared with the 17 days before the 17 read', async () => {
    const v = await buildPortfolio([SW], '30d', null, null, NOW, BARE)
    expect(v.range).toEqual({ from: '2026-10-25', to: '2026-11-23' })
    expect(v.comparison).toMatchObject({ from: '2026-10-08', to: '2026-10-24', label: '17 dias anteriores', sameTimeOfDay: false })
  })

  it('Hoje is the day before, whole', async () => {
    const v = await buildPortfolio([SW], 'today', null, null, NOW, BARE)
    expect(v.comparison).toMatchObject({ from: '2026-11-23', to: '2026-11-23', label: 'dia anterior', sameTimeOfDay: false, cutoffMinutes: null })
    expect(computeSameTimeComparison).not.toHaveBeenCalled()
  })
})

describe('buildPortfolio with an archived store beside a running one', () => {
  it('Hoje: only the running store is compared until this hour', async () => {
    const v = await buildPortfolio([MK, SW], 'today', null, null, NOW, BARE)
    expect(vi.mocked(computeSameTimeComparison).mock.calls.map(c => c[0])).toEqual([['mk']])
    expect(pnlCalls()).toContainEqual([['sw'], { from: '2026-11-23', to: '2026-11-23' }, null])
    const byId = new Map(v.stores.map(r => [r.id, r]))
    expect(byId.get('mk')!.comparison.cutoffMinutes).toBe(911)
    expect(byId.get('sw')!.comparison.cutoffMinutes).toBeNull()
  })

  it('Este mês: the archived store\'s last comparison day is not cut', async () => {
    await buildPortfolio([MK, SW], 'mtd', null, null, NOW, BARE)
    const lastDay = pnlCalls().find(([, r]) => (r as { from: string }).from === '2026-10-24' && (r as { to: string }).to === '2026-10-24')
    expect(lastDay?.[2]).toEqual({ mk: 911, sw: null })
  })
})

describe('archivedComparison lives in portfolio and is the one the Resumo uses', () => {
  it('is the same function from lib/views/store', () => {
    expect(fromStore).toBe(archivedComparison)
  })

  it('maps a comparison it already moved to itself (the page context moved it first)', () => {
    const range = { from: '2026-11-01', to: '2026-11-24' }
    for (const period of ['mtd', '30d', 'custom'] as const) {
      const once = archivedComparison(SW, '2026-11-10', range, comparisonRange(period, range, SW.timezone, NOW), SW.timezone, NOW)
      expect(archivedComparison(SW, '2026-11-10', range, once, SW.timezone, NOW)).toEqual(once)
    }
  })
})
