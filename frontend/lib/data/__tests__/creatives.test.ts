import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreMargin } from '../meta'

// The database answers by SQL: the ownership EXISTS gets `owned`, every other
// read (facts, ad catalog, journeys) an empty list.
const m = vi.hoisted(() => ({ owned: false as boolean, calls: [] as { sql: string; params: unknown[] }[] }))
vi.mock('../../db', () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    m.calls.push({ sql, params })
    return /SELECT EXISTS/.test(sql) ? [{ ok: m.owned }] : []
  }),
}))

const { adBelongsToStore, getCreativeDetail } = await import('../creatives')

const MOKOO = 'user_3CVoVQYfnj1Ljnm3tf0iHP40fxX'
const EPOCH = '73a1d3b1-45ff-410a-af37-93f95a591e6e'
const range = { from: '2026-11-11', to: '2026-11-17' }
const margin: StoreMargin = {
  range, configured: true, contributionRate: 0.4, breakEvenRoas: 2.5, revenue: 1000, orders: 20,
  metaSpend: 0, metaPurchaseValue: 0, partial: false,
}

beforeEach(() => { m.owned = false; m.calls.length = 0 })

describe('adBelongsToStore', () => {
  it('asks whether the store ever had metrics for the ad, with no date window', async () => {
    m.owned = true
    await expect(adBelongsToStore(EPOCH, '120249753018240003')).resolves.toBe(true)
    expect(m.calls).toHaveLength(1)
    const { sql, params } = m.calls[0]
    expect(sql).toMatch(/FROM fb_ad_daily_metrics WHERE tenant_id = \$1 AND ad_id = \$2/)
    // Any window: a creative opened on a period without spend still belongs.
    expect(sql).not.toMatch(/date/i)
    // Values travel as parameters, never inside the SQL text.
    expect(params).toEqual([EPOCH, '120249753018240003'])
    expect(sql).not.toContain('120249753018240003')
  })

  it("another store's ad (or an unknown id) does not belong", async () => {
    m.owned = false
    await expect(adBelongsToStore(MOKOO, '120249753018240003')).resolves.toBe(false)
  })

  it('an empty id or store is not an ad of anyone, and costs no query', async () => {
    await expect(adBelongsToStore(MOKOO, '')).resolves.toBe(false)
    await expect(adBelongsToStore('', '123')).resolves.toBe(false)
    expect(m.calls).toHaveLength(0)
  })
})

describe('getCreativeDetail follows the same rule', () => {
  const store = { id: MOKOO, timezone: 'America/Belem' }

  it('returns null for an ad the store never had', async () => {
    m.owned = false
    await expect(getCreativeDetail(store, '999999', range, { margin })).resolves.toBeNull()
  })

  it("returns the detail, without spend, for the store's ad on a quiet window", async () => {
    m.owned = true
    const d = await getCreativeDetail(store, '120211111111110001', range, { margin })
    expect(d).not.toBeNull()
    expect(d!.hasSpend).toBe(false)
    expect(d!.daily).toHaveLength(7)
    expect(d!.creative.adId).toBe('120211111111110001')
  })
})
