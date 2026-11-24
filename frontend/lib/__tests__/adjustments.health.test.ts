import { beforeEach, describe, expect, it, vi } from 'vitest'

// The database is answered here: these tests read no production data.
vi.mock('../db', () => ({ query: vi.fn() }))

import { query } from '../db'
import {
  combineChargebackHealth, getChargebackHealth, getCombinedChargebackHealth, splitNeedsResponse,
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
