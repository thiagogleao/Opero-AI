/**
 * period-fix-r3, server side: the verdict's before-first-sale test and its
 * comparison clause, the portfolio's facts, and /api/mobile's store list.
 * Each test names its finding ("F<n>").
 */

import { describe, expect, it, vi } from 'vitest'

const failFacts = vi.hoisted(() => ({ on: false }))
vi.mock('../../db', () => ({
  query: vi.fn(async (sql: string) => {
    if (failFacts.on && sql.includes('WITH t AS')) throw new Error('statement timeout')
    if (sql.includes('shop_campaign_daily')) return []
    if (sql.includes('SELECT id, to_char(archived_at')) return []
    return []
  }),
}))

import { sumPnL, type PnL, type PnLLines } from '../../engine/pnl'
import { buildVerdict, type VerdictInput } from '../verdict'
import { factDates, factsFor } from '../portfolio'
import { selectStores, StoreSelectionError } from '../mobile'
import { isBeforeStart } from '../../../components/campaigns/storeStart'
import { MIN_DATE, resolve, screenComparison } from '../../period'
import { brt, GLOOTY, HIBIKURA, MOKOO, SQUISHY, VIEWER } from '../../period/__tests__/fixtures'
import type { StoreRef } from '../../access'

const pnl = (over: Partial<PnLLines> = {}): PnL => sumPnL([{ ...sumPnL([]), ...over }])

describe('before the first sale (R11)', () => {
  it('F3 · a window with a chargeback before the first sale is a normal reading, not "ainda não vendia"', () => {
    const totals = pnl({ chargebacks: 70.21, chargebackCount: 1 })
    expect(totals.adjustments).toBeGreaterThan(70)
    const input: VerdictInput = {
      stores: [{
        id: SQUISHY, name: 'Squishy World', timezone: 'America/Sao_Paulo', configured: true, totals,
        comparison: null, partial: false, minutesCovered: 1440, dayState: 'complete', firstOrderDate: '2026-06-02',
        archived: true, archivedOn: '2026-11-10',
      }],
      period: 'custom', range: { from: '2026-02-20', to: '2026-03-05' }, today: '2026-11-24', anchorTimezone: 'America/Sao_Paulo',
      comparison: null,
    }
    const v = buildVerdict(input)
    expect(v.beforeStart ?? null).toBeNull()
    expect(v.chips.map(c => c.label).join(' ')).not.toMatch(/Vende desde/)
    expect(v.amountCaption).not.toMatch(/ainda não vendia/)
    // The other pages' test reads the adjustments too.
    expect(isBeforeStart('2026-06-02', input.range, { orders: 0, revenue: 0, spend: 0, adjustments: totals.adjustments })).toBe(false)
    expect(isBeforeStart('2026-06-02', input.range, { orders: 0, revenue: 0, spend: 0 })).toBe(true)
  })
})

describe('the comparison clause of a Todas verdict (R6)', () => {
  it('F6 · Glooty, out of the sum for no costs, is not "sem Glooty (começou em 4 nov)" beside "fica fora da soma"', () => {
    const now = brt('2026-11-24', '16:00')
    const r = resolve({ scope: { kind: 'all' }, period: { kind: 'preset', preset: '30d' }, split: false }, VIEWER, now)
    const c = screenComparison(r)
    const stores = VIEWER.active.map(s => ({
      id: s.id, name: s.name, timezone: s.tz, configured: s.id !== GLOOTY,
      totals: pnl({ revenue: 1000, orders: 10, cogs: 300 }),
      comparison: { included: s.id !== HIBIKURA && s.id !== GLOOTY, totals: pnl({ revenue: 900, orders: 9, cogs: 270 }) },
      partial: false, minutesCovered: 1440, dayState: 'complete' as const, firstOrderDate: s.firstOrderDate,
    }))
    const v = buildVerdict({
      stores, period: '30d', range: r.window, today: r.clockToday, anchorTimezone: 'America/Sao_Paulo',
      comparison: { from: c.from, to: c.to, label: c.label, sameTimeOfDay: c.sameTimeOfDay, full: c.full, short: c.short, phrase: c.phrase, rangeText: c.rangeText, cutText: c.cutText, none: c.none, partialBase: c.partialBase, leftOut: c.leftOut, fullBase: c.fullBase, leftOutWhy: c.leftOutWhy },
    })
    expect(v.when).toMatch(/sem Hibikura \(começou em 7 nov\)/)
    expect(v.when).not.toMatch(/Glooty/)
  })
})

describe('portfolio rows take the resolution\'s facts (R19, §9.7)', () => {
  it('F16 · first-order and archive dates come from the facts; a failed read is unknown (MIN_DATE), never null', async () => {
    const d = factDates(VIEWER, [MOKOO, SQUISHY])
    expect(d.firstOrderDates.get(MOKOO)).toBe('2026-04-11')
    expect(d.archiveDates.get(SQUISHY)).toBe('2026-11-10')
    // The caller's facts are used as they are.
    expect(await factsFor([{ id: MOKOO, name: 'MOKOO', timezone: 'America/Belem' }], VIEWER)).toBe(VIEWER)
    // No facts given and the read fails: unknown, before every window.
    failFacts.on = true
    const vs = await factsFor([{ id: MOKOO, name: 'MOKOO', timezone: 'America/Belem' }])
    failFacts.on = false
    expect(factDates(vs, [MOKOO]).firstOrderDates.get(MOKOO)).toBe(MIN_DATE)
  })
})

describe('/api/mobile store lists (R2, R10)', () => {
  it('F19 · an archived id in a several-store list is refused; alone it is a consultation', () => {
    const ref = (id: string, archived: boolean): StoreRef => ({ id, name: id, domain: null, timezone: 'America/Sao_Paulo', userId: null, archived } as StoreRef)
    const visible = [ref(MOKOO, false), ref(SQUISHY, true), ref('epoch', false)]
    expect(() => selectStores(`${MOKOO},${SQUISHY}`, visible)).toThrow(StoreSelectionError)
    try { selectStores(`${MOKOO},${SQUISHY}`, visible) } catch (e) { expect((e as StoreSelectionError).status).toBe(400) }
    expect(selectStores(SQUISHY, visible).stores.map(s => s.id)).toEqual([SQUISHY])
    expect(selectStores(`${MOKOO},epoch`, visible).stores).toHaveLength(2)
  })
})
