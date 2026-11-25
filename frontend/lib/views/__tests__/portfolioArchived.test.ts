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
import { buildPortfolio, type PortfolioStoreInput } from '../portfolio'
import { preset, resolve, viewerStores, type PeriodValue } from '../../period'

// 2026-11-24 15:11 in São Paulo and Belém. Squishy World archived 10 nov 10:00.
const NOW = new Date('2026-11-24T18:11:00Z')
const SW: PortfolioStoreInput = { id: 'sw', name: 'Squishy World', timezone: 'America/Sao_Paulo', archived: true }
const MK: PortfolioStoreInput = { id: 'mk', name: 'MOKOO', timezone: 'America/Belem' }
const VS = viewerStores([
  { id: 'sw', name: 'Squishy World', timezone: 'America/Sao_Paulo', archived: true, archivedAt: '2026-11-10T13:00:00.000Z', firstOrderDate: '2025-01-01' },
  { id: 'mk', name: 'MOKOO', timezone: 'America/Belem', archived: false, firstOrderDate: '2026-04-11' },
  { id: 'ep', name: 'EPOCH', timezone: 'America/Sao_Paulo', archived: false, firstOrderDate: '2025-06-01' },
])
const BARE = { liveFeed: false, chargebackHealth: false, freshness: false }
// The facts the resolution was made with: rows take their archive day from them (R19, §9.7).
const lone = (p: PeriodValue) => buildPortfolio([SW], resolve({ scope: { kind: 'store', id: 'sw' }, period: p, split: false }, VS, NOW), BARE, VS)

/** Every computePnL call: [ids, range, cutoffMinutes]. */
const pnlCalls = () => vi.mocked(computePnL).mock.calls.map(([ids, range, opts]) => [ids, range, opts?.cutoffMinutes ?? null])

beforeEach(() => { vi.mocked(computePnL).mockClear(); vi.mocked(computeSameTimeComparison).mockClear() })

// buildPortfolio takes lib/period's resolution and never re-resolves (I-19):
// the archived store's state and comparison cut are the resolution's (R10).
describe('buildPortfolio of a lone archived store (the phone, /api/mobile)', () => {
  it('Este mês is compared on the days read (1–10 out), the last cut at the archive minute (10h00) — never at 15h11', async () => {
    const v = await lone(preset('mtd'))
    expect(v.comparison).toMatchObject({ from: '2026-10-01', to: '2026-10-10', label: 'mesmos dias do mês passado' })
    expect(v.stores[0].comparison).toMatchObject({ included: true, range: { from: '2026-10-01', to: '2026-10-10' }, cutoffMinutes: 600 })
    expect(pnlCalls()).toContainEqual([['sw'], { from: '2026-10-10', to: '2026-10-10' }, { sw: 600 }])
    expect(computeSameTimeComparison).not.toHaveBeenCalled()
    expect(v.stores[0].archivedOn).toBe('2026-11-10')
    expect(v.stores[0].dayState).toBe('complete')
  })

  it('30 dias (25 out – 23 nov) is compared with the 17 days before the 17 read', async () => {
    const v = await lone(preset('30d'))
    expect(v.range).toEqual({ from: '2026-10-25', to: '2026-11-23' })
    expect(v.comparison).toMatchObject({ from: '2026-10-08', to: '2026-10-24', label: '17 dias anteriores' })
  })

  it('Hoje is frozen: nothing compared, never "até esta hora"', async () => {
    const v = await lone(preset('today'))
    expect(v.resolution.members[0].state).toBe('frozen')
    expect(v.stores[0].comparison.included).toBe(false)
    expect(computeSameTimeComparison).not.toHaveBeenCalled()
  })
})

describe('buildPortfolio on Todas', () => {
  it('Hoje: every running store is cut at its own minute; an archived store is never a member', async () => {
    const r = resolve({ scope: { kind: 'all' }, period: preset('today'), split: false }, VS, NOW)
    expect(r.members.map(m => m.storeId)).toEqual(['ep', 'mk'])
    const v = await buildPortfolio([MK, { id: 'ep', name: 'EPOCH', timezone: 'America/Sao_Paulo' }], r, BARE)
    const byId = new Map(v.stores.map(x => [x.id, x]))
    expect(byId.get('mk')!.comparison.cutoffMinutes).toBe(911)
    expect(pnlCalls()).toContainEqual([['ep', 'mk'], { from: '2026-11-23', to: '2026-11-23' }, { ep: 911, mk: 911 }])
  })
})
