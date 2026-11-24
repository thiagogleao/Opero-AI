import { beforeEach, describe, expect, it, vi } from 'vitest'
import type { StoreMargin } from '../meta'

// The database answers by SQL: the ownership EXISTS gets `owned`, the
// detail's lifetime read (ownership + format) gets `owned` and `lifetime`,
// every other read (facts, ad catalog, journeys) an empty list.
const m = vi.hoisted(() => ({
  owned: false as boolean,
  lifetime: { plays: 0, impressions: 0 },
  calls: [] as { sql: string; params: unknown[] }[],
}))
vi.mock('../../db', () => ({
  query: vi.fn(async (sql: string, params: unknown[] = []) => {
    m.calls.push({ sql, params })
    if (/SELECT EXISTS/.test(sql)) return [{ ok: m.owned }]
    if (/COUNT\(\*\)::int AS days/.test(sql)) return [{ days: m.owned ? 12 : 0, last_spend: m.owned ? '2026-11-23' : null, ...m.lifetime }]
    return []
  }),
}))

const { adBelongsToStore, adFormatOf, getCreativeDetail } = await import('../creatives')

const MOKOO = 'user_3CVoVQYfnj1Ljnm3tf0iHP40fxX'
const EPOCH = '73a1d3b1-45ff-410a-af37-93f95a591e6e'
const range = { from: '2026-11-11', to: '2026-11-17' }
const margin: StoreMargin = {
  range, configured: true, contributionRate: 0.4, breakEvenRoas: 2.5, revenue: 1000, orders: 20,
  metaSpend: 0, metaPurchaseValue: 0, partial: false,
}

beforeEach(() => { m.owned = false; m.lifetime = { plays: 0, impressions: 0 }; m.calls.length = 0 })

describe('adFormatOf', () => {
  it('reads a video from its plays and an image from stray plays', () => {
    // Hibikura 52645047117420 over its whole history: 4.727 plays on 4.827 impressions.
    expect(adFormatOf(4727, 4827)).toBe('video')
    // MOKOO image ads: a few dozen stray plays on tens of thousands of impressions.
    expect(adFormatOf(31, 118000)).toBe('image')
  })

  it('is unknown, never "image", without impressions', () => {
    expect(adFormatOf(0, 0)).toBeNull()
  })
})

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
    // 18 nov in Belém: the verdict window (last 7 closed days) is the page's.
    const d = await getCreativeDetail(store, '120211111111110001', range, { margin, now: new Date('2026-11-18T15:00:00Z') })
    expect(d).not.toBeNull()
    expect(d!.hasSpend).toBe(false)
    expect(d!.daily).toHaveLength(7)
    expect(d!.creative.adId).toBe('120211111111110001')
    expect(d!.verdictWindow).toEqual(range)
    expect(d!.verdictBreakEvenRoas).toBe(2.5)
  })

  it('takes the format from the whole history, so a video stays a video on a window without spend', async () => {
    m.owned = true
    // MOKOO 120249710934810625: 138.124 plays on 151.542 impressions since 28 out.
    m.lifetime = { plays: 138124, impressions: 151542 }
    const d = await getCreativeDetail(store, '120249710934810625', range, { margin, now: new Date('2026-11-18T15:00:00Z') })
    expect(d!.hasSpend).toBe(false)
    expect(d!.creative.video).toBeNull() // the window's own stats: nothing played
    expect(d!.format).toBe('video')
    // ...and a page without spend can point to the ad's last spend, any window.
    expect(d!.creative.lastSpendDay).toBeNull()
    expect(d!.lastSpendDayEver).toBe('2026-11-23')
    // The lifetime read filters by store and ad only (no date window), values as parameters.
    const life = m.calls.find(c => /COUNT\(\*\)::int AS days/.test(c.sql))!
    expect(life.sql.trim()).toMatch(/WHERE tenant_id = \$1 AND ad_id = \$2$/)
    expect(life.params).toEqual([MOKOO, '120249710934810625'])
  })

  it("reads the verdict window's facts with the page's in one read per merged span", async () => {
    m.owned = true
    // "Hoje" 23 nov: the facts cover 16–23 nov (the closed week and today).
    await getCreativeDetail(store, '120211111111110001', { from: '2026-11-23', to: '2026-11-23' }, {
      margin, verdictMargin: { configured: true, contributionRate: 0.5, breakEvenRoas: 2 }, now: new Date('2026-11-23T19:00:00Z'),
    })
    const factReads = m.calls.filter(c => /FROM fb_ad_daily_metrics m/.test(c.sql))
    expect(factReads.map(c => c.params.slice(1, 3))).toEqual([['2026-11-16', '2026-11-23']])
  })
})
