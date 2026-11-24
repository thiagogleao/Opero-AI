import { beforeEach, describe, expect, it, vi } from 'vitest'

// The database is answered here: these tests read no production data.
vi.mock('../db', () => ({ query: vi.fn() }))

import { query } from '../db'
import {
  combineChargebackHealth, DISPUTES_FORBIDDEN, disputesReadable, getChargebackHealth, getCombinedChargebackHealth, getWindowDisputeStatuses, groupDisputeStatuses, NO_DISPUTES, splitNeedsResponse,
  type ChargebackHealth, type NeedsResponseRow,
} from '../adjustments'

const row = (id: string, due: string | null, overdue = false): NeedsResponseRow => ({
  external_id: id, amount: '49.90', currency: 'USD', reason: 'product_not_received', evidence_due_by: due, overdue,
})

/** EPOCH on 18 nov: 6 disputes waiting for evidence, one already past its deadline. */
const EPOCH_WAITING: NeedsResponseRow[] = [
  row('e-late', '2026-11-10 23:00:00+00', true),
  row('e0', '2026-11-20 23:00:00+00'),
  row('e1', '2026-11-25 23:00:00+00'),
  row('e2', '2026-12-01 23:00:00+00'),
  row('e3', '2026-12-10 23:00:00+00'),
  row('e4', '2026-12-25 23:00:00+00'),
  row('e5', null),
]

/** Answers the three health queries by their SQL. */
function answer(waiting: NeedsResponseRow[]) {
  vi.mocked(query).mockImplementation((async (sql: string) => {
    if (sql.includes("status = 'needs_response'")) return waiting
    if (sql.includes('FROM shopify_orders')) return [{ n: '400' }]
    return [{ n: '6', amount: '299.40', fees: '90', open: '6', lost: '0', won: '0' }]
  }) as unknown as typeof query)
}

describe('splitNeedsResponse', () => {
  it('lists every answerable dispute in deadline order and only counts the overdue ones', () => {
    const out = splitNeedsResponse(EPOCH_WAITING)
    expect(out.overdue).toBe(1)
    expect(out.dueSoon.map(d => d.externalId)).toEqual(['e0', 'e1', 'e2', 'e3', 'e4', 'e5'])
    expect(out.dueSoon[0]).toEqual({ externalId: 'e0', amount: 49.9, currency: 'USD', reason: 'product_not_received', dueBy: '2026-11-20 23:00:00+00' })
  })

  it('a missing currency is dollars and a missing reason stays empty (shown as "motivo não informado")', () => {
    const [d] = splitNeedsResponse([{ ...row('x', null), currency: null, reason: null }]).dueSoon
    expect(d.currency).toBe('USD')
    expect(d.reason).toBe('')
  })
})

describe('getChargebackHealth (regression: the Resumo showed 4–5 of 12 disputes still answerable)', () => {
  // Braces: a function returned from beforeEach is run as its cleanup.
  beforeEach(() => { vi.mocked(query).mockReset() })

  it('returns every dispute still in time, past the old 5-row cut, plus the overdue count', async () => {
    answer(EPOCH_WAITING)
    const h = await getChargebackHealth('epoch')
    expect(h.dueSoon).toHaveLength(6)
    expect(h.dueSoon.map(d => d.externalId)).toContain('e4') // the 25 dez one, sixth in line
    expect(h.overdue).toBe(1)
    expect(h.count).toBe(6)
    expect(h.rate).toBeCloseTo(1.5, 6)
    // No row limit in the query any more.
    const sql = vi.mocked(query).mock.calls.map(c => String(c[0])).find(s => s.includes("status = 'needs_response'"))!
    expect(sql).not.toMatch(/LIMIT/i)
  })

  it('several stores keep every answerable dispute (no cut at 5) and sum the overdue ones', async () => {
    answer(EPOCH_WAITING)
    const h = await getCombinedChargebackHealth(['epoch', 'camp'])
    expect(h.dueSoon).toHaveLength(12)
    expect(h.overdue).toBe(2)
    expect(h.dueSoon[h.dueSoon.length - 1].dueBy).toBeNull() // no deadline: last
  })
})

describe('combineChargebackHealth', () => {
  const h = (dueBy: (string | null)[], over: number | undefined, count: number, orders: number): ChargebackHealth => ({
    count, orders, rate: orders ? (count / orders) * 100 : 0, amount: 0, fees: 0, open: dueBy.length, lost: 0, won: 0,
    dueSoon: dueBy.map((d, i) => ({ externalId: `${count}-${i}`, amount: 10, currency: 'USD', reason: 'general', dueBy: d })),
    overdue: over, hasData: count > 0,
  })

  it('recomputes the rate from the summed counts and merges the lists by deadline', () => {
    const out = combineChargebackHealth([
      h(['2026-12-01 00:00:00+00', null], 1, 4, 100),
      h(['2026-11-20 00:00:00+00'], undefined, 1, 4),
    ])
    expect(out.rate).toBeCloseTo((5 / 104) * 100, 6)
    expect(out.dueSoon.map(d => d.dueBy)).toEqual(['2026-11-20 00:00:00+00', '2026-12-01 00:00:00+00', null])
    expect(out.overdue).toBe(1)
  })
})

describe('dispute statuses add up to the count (regression: CAMP HALLOW read "7 em aberto · 5 perdidas · 11 ganhas" = 23 next to 31)', () => {
  beforeEach(() => { vi.mocked(query).mockReset() })

  it('groupDisputeStatuses puts every status in exactly one group', () => {
    const c = groupDisputeStatuses([
      { status: 'needs_response', n: '4' }, { status: 'under_review', n: 3 }, { status: 'lost', n: '5' },
      { status: 'won', n: '11' }, { status: 'prevented', n: '8' }, { status: 'accepted', n: '1' }, { status: null, n: '2' },
    ])
    expect(c).toEqual({ open: 7, lost: 5, won: 11, prevented: 8, other: 3 })
    expect(c.open + c.lost + c.won + c.prevented + c.other).toBe(34)
    expect(groupDisputeStatuses([])).toEqual(NO_DISPUTES)
  })

  it('getChargebackHealth names the prevented ones and whatever is left', async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes("status = 'needs_response'")) return []
      if (sql.includes('FROM shopify_orders')) return [{ n: '700' }]
      // CAMP HALLOW, 90 days on 24 nov (read-only check of production).
      return [{ n: '31', amount: '3204', fees: '465', open: '7', lost: '5', won: '11', prevented: '8' }]
    }) as unknown as typeof query)
    const h = await getChargebackHealth('camp')
    expect(h.prevented).toBe(8)
    expect(h.other).toBe(0)
    expect(h.open + h.lost + h.won + (h.prevented ?? 0) + (h.other ?? 0)).toBe(h.count)
    // The prevented ones stay in the rate (the prudent side).
    expect(h.rate).toBeCloseTo((31 / 700) * 100, 6)
  })

  it('a status the query does not name lands in "other"', async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes("status = 'needs_response'")) return []
      if (sql.includes('FROM shopify_orders')) return [{ n: '100' }]
      return [{ n: '5', amount: '0', fees: '0', open: '1', lost: '1', won: '1', prevented: '0' }]
    }) as unknown as typeof query)
    expect((await getChargebackHealth('x')).other).toBe(2)
  })

  it('combineChargebackHealth sums the prevented and other ones too', () => {
    const one = (prevented: number | undefined, other: number | undefined): ChargebackHealth => ({
      count: 10, orders: 100, rate: 10, amount: 0, fees: 0, open: 2, lost: 2, won: 2, prevented, other, dueSoon: [], hasData: true,
    })
    const out = combineChargebackHealth([one(3, 1), one(undefined, undefined), one(4, 0)])
    expect(out.prevented).toBe(7)
    expect(out.other).toBe(1)
  })

  it('getWindowDisputeStatuses reads the chargebacks that ARRIVED in the window (event_date), every status', async () => {
    vi.mocked(query).mockResolvedValue([
      { status: 'lost', n: '14' }, { status: 'needs_response', n: '3' }, { status: 'prevented', n: '7' },
      { status: 'under_review', n: '13' }, { status: 'won', n: '3' },
    ] as never)
    const c = await getWindowDisputeStatuses('epoch', '2026-10-01', '2026-10-31')
    expect(c).toEqual({ open: 16, lost: 14, won: 3, prevented: 7, other: 0 })
    const [sql, args] = vi.mocked(query).mock.calls[0]
    expect(String(sql)).toMatch(/event_date BETWEEN \$2::date AND \$3::date/)
    expect(String(sql)).toMatch(/kind = 'chargeback'/)
    expect(args).toEqual(['epoch', '2026-10-01', '2026-10-31'])
  })
})

// Glooty and Hibikura have no chargeback row ever; whether their tokens can
// read disputes was only known from a live check in Ajustes. The 403 that
// syncAdjustments meets is on the pass's sync_runs row (autoSync recordRun).
describe('disputes the token cannot read (regression: a zero that proves nothing)', () => {
  beforeEach(() => { vi.mocked(query).mockReset() })

  it('disputesReadable: the 403 note is false, a clean finished pass is true, anything else unknown', () => {
    expect(disputesReadable({ status: 'success', error_message: DISPUTES_FORBIDDEN })).toBe(false)
    expect(disputesReadable({ status: 'error', error_message: `estornos: Shopify HTTP 500 · ${DISPUTES_FORBIDDEN}` })).toBe(false)
    expect(disputesReadable({ status: 'success', error_message: null })).toBe(true)
    expect(disputesReadable({ status: 'success', error_message: '2 sem conversão para USD' })).toBe(true)
    expect(disputesReadable({ status: 'error', error_message: 'disputas: Shopify HTTP 500' })).toBeNull()
    expect(disputesReadable(null)).toBeNull()
  })

  it('getChargebackHealth reads the latest finished adjustments pass', async () => {
    let runs: { status: string; error_message: string | null }[] = [{ status: 'success', error_message: DISPUTES_FORBIDDEN }]
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes('FROM sync_runs')) return runs
      if (sql.includes("status = 'needs_response'")) return []
      if (sql.includes('FROM shopify_orders')) return [{ n: '212' }]
      return [{ n: '0', amount: '0', fees: '0', open: '0', lost: '0', won: '0', prevented: '0' }]
    }) as unknown as typeof query)
    expect((await getChargebackHealth('glooty')).readable).toBe(false)
    const sql = vi.mocked(query).mock.calls.map(c => String(c[0])).find(s => s.includes('FROM sync_runs'))!
    expect(sql).toMatch(/source = 'adjustments'/)
    expect(sql).toMatch(/status <> 'running'/)
    expect(sql).toMatch(/ORDER BY started_at DESC LIMIT 1/)
    runs = []
    expect((await getChargebackHealth('glooty')).readable).toBeNull()
  })

  it('a failed read of the passes leaves the health whole, readable unknown', async () => {
    vi.mocked(query).mockImplementation((async (sql: string) => {
      if (sql.includes('FROM sync_runs')) throw new Error('boom')
      if (sql.includes("status = 'needs_response'")) return []
      if (sql.includes('FROM shopify_orders')) return [{ n: '400' }]
      return [{ n: '2', amount: '100', fees: '30', open: '1', lost: '1', won: '0', prevented: '0' }]
    }) as unknown as typeof query)
    const h = await getChargebackHealth('epoch')
    expect(h.count).toBe(2)
    expect(h.readable).toBeNull()
  })
})
