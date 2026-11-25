/**
 * period-fix-r2, server side: the verdict before the first sale and its
 * period phrase, the phone detail tabs of an archived store, and the facts
 * loader when its read fails. Each test names its finding ("F<n>").
 */

import { describe, expect, it, vi } from 'vitest'

const failFacts = vi.hoisted(() => ({ on: false }))
vi.mock('../../db', () => ({
  query: vi.fn(async (sql: string) => {
    if (failFacts.on && sql.includes('WITH t AS')) throw new Error('statement timeout')
    if (sql.includes('shop_campaign_daily')) return []
    if (sql.includes('SELECT id, to_char(archived_at')) return [{ id: 'squishy', archived_at: '2026-11-10T13:00:00.000Z' }]
    return []
  }),
}))

import { sumPnL, type PnL, type PnLLines } from '../../engine/pnl'
import { buildVerdict, type VerdictInput } from '../verdict'
import { detailWindow } from '../mobileDetail'
import { viewerStoresOf } from '../periodFacts'
import { beforeFirstSale, resolve, screenComparison } from '../../period'
import { brt, MOKOO, SQUISHY, store, VIEWER } from '../../period/__tests__/fixtures'
import { judgedWindowsText } from '../../../app/m/_lib/labels'

const pnl = (over: Partial<PnLLines> = {}): PnL => sumPnL([{ ...sumPnL([]), ...over }])

describe('verdict (R7, R11)', () => {
  it('F5 · Glooty before its first sale: "Vende desde 6 nov" only, no "custos não configurados", one start date', () => {
    const input: VerdictInput = {
      stores: [{
        id: 'glooty', name: 'Glooty', timezone: 'America/Belem', configured: false, totals: pnl(),
        comparison: null, partial: false, minutesCovered: 1440, dayState: 'complete', firstOrderDate: '2026-11-06',
      }],
      period: 'lastmonth', range: { from: '2026-10-01', to: '2026-10-31' }, today: '2026-11-24', anchorTimezone: 'America/Belem',
      comparison: {
        from: '2026-09-01', to: '2026-09-30', label: '', sameTimeOfDay: false, full: '', short: '', phrase: '', rangeText: '',
        cutText: null, none: 'sem base: a loja começou em 4 nov', partialBase: null, leftOut: [],
      },
    }
    const v = buildVerdict(input)
    expect(v.chips.map(c => c.label)).toEqual(['Vende desde 6 nov'])
    expect(v.when).not.toMatch(/4 nov/)
    expect(v.beforeStart?.text).toBe('6 nov')
  })

  it('F15 · a single day that is yesterday is "ontem" in the verdict, as in the label, strip and push', () => {
    const input: VerdictInput = {
      stores: [{
        id: MOKOO, name: 'MOKOO', timezone: 'America/Belem', configured: true,
        totals: pnl({ revenue: 1000, orders: 20, cogs: 300 }), comparison: null, partial: false, minutesCovered: 1440, dayState: 'complete',
        firstOrderDate: '2026-04-11',
      }],
      period: 'custom', range: { from: '2026-11-23', to: '2026-11-23' }, today: '2026-11-24', anchorTimezone: 'America/Belem',
      comparison: null,
    }
    expect(buildVerdict(input).headline).toMatch(/em 23 nov/)
    const r = resolve({ scope: store(MOKOO), period: { kind: 'dates', from: '2026-11-23', to: '2026-11-23' }, split: false }, VIEWER, brt('2026-11-24', '10:00'))
    expect(r.label.phrase).toBe('ontem')
    const v = buildVerdict({ ...input, periodPhrase: r.label.phrase })
    expect(v.headline).toMatch(/^A MOKOO lucrou ontem/)
  })
})

describe('phone detail tabs (R10, R12)', () => {
  it('F13/F22 · an archived store reads and prices its read days, with no decision window', () => {
    const now = brt('2026-11-24', '16:00')
    const w = detailWindow({ period: 'mtd', from: null, to: null }, [{ id: SQUISHY, archived: true }], VIEWER, now)
    expect(w.range).toEqual({ from: '2026-11-01', to: '2026-11-10' })
    expect(w.rangeLabel).toBe('1–10 nov')
    expect(w.consultOnly).toBe(true)
    expect(w.partial).toBe(false)
    expect(judgedWindowsText([], true)).not.toMatch(/7 dias fechados/)
    const live = detailWindow({ period: 'mtd', from: null, to: null }, [{ id: MOKOO, archived: false }], VIEWER, now)
    expect(live.range).toEqual({ from: '2026-11-01', to: '2026-11-24' })
    expect(live.consultOnly).toBe(false)
  })
})

describe('facts loader (R10, R11, R19)', () => {
  it('F20 · a failed read gives unknown facts: comparisons stay, the archive keeps its real day, no "never sold"', async () => {
    failFacts.on = true
    const vs = await viewerStoresOf([
      { id: MOKOO, name: 'MOKOO', timezone: 'America/Belem', archived: false },
      { id: 'epoch', name: 'EPOCH', timezone: 'America/Sao_Paulo', archived: false },
      { id: SQUISHY, name: 'Squishy World', timezone: 'America/Sao_Paulo', archived: true },
    ])
    failFacts.on = false
    const now = brt('2026-11-24', '16:00')
    const todas = resolve({ scope: { kind: 'all' }, period: { kind: 'preset', preset: '7d' }, split: false }, vs, now)
    expect(todas.comparison).not.toBeNull()
    expect(screenComparison(todas).none).toBeNull()
    const mokoo = resolve({ scope: store(MOKOO), period: { kind: 'preset', preset: 'today' }, split: false }, vs, now)
    expect(mokoo.comparison?.label).toBe('vs ontem até 16h00')
    expect(vs.archived[0].archivedOn).toBe('2026-11-10')
    const sq = resolve({ scope: store(SQUISHY), period: { kind: 'preset', preset: 'lastmonth' }, split: false }, vs, now)
    expect(sq.members[0].state).toBe('closed')
    expect(beforeFirstSale('2026-11-23', { orders: 0, adSpend: 0 }, vs.active.find(s => s.id === MOKOO)!)).toBe(false)
  })
})
