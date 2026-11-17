import { describe, expect, it } from 'vitest'
import { adsOf, asMetaId, numericId, sortMoments } from '../journey'
import { parseBulkJsonl } from '../journeyBulk'

describe('journey parsing', () => {
  it('reads Shopify gids and Meta ids', () => {
    expect(numericId('gid://shopify/Order/5288?x=1')).toBe('5288')
    expect(asMetaId('120249395202940003')).toBe('120249395202940003')
    expect(asMetaId('Facebook_UA')).toBeNull()
    expect(asMetaId('12345')).toBeNull()
  })

  it('sorts visits by time and takes first and last ad from the whole list', () => {
    const m = sortMoments([
      { occurredAt: '2026-11-03T10:00:00Z', utmParameters: { content: '222222222222' } },
      { occurredAt: '2026-11-01T10:00:00Z', utmParameters: { content: '111111111111' } },
      { occurredAt: '2026-11-02T10:00:00Z', source: 'direct' },
    ])
    expect(m.map(x => x.occurredAt?.slice(8, 10))).toEqual(['01', '02', '03'])
    expect(adsOf(m)).toEqual({ first: '111111111111', last: '222222222222' })
  })
})

describe('parseBulkJsonl', () => {
  it('attaches visits to their order, sorted, the same way the paged collector does', () => {
    const text = [
      JSON.stringify({ id: 'gid://shopify/Order/1', createdAt: '2026-11-05T00:00:00Z',
        customerJourneySummary: { ready: true, momentsCount: { count: 3, precision: 'EXACT' }, daysToConversion: 2, customerOrderIndex: 1 } }),
      JSON.stringify({ __parentId: 'gid://shopify/Order/1', occurredAt: '2026-11-04T00:00:00Z', utmParameters: { content: '999999999999' } }),
      JSON.stringify({ __parentId: 'gid://shopify/Order/1', occurredAt: '2026-11-02T00:00:00Z', utmParameters: { content: '888888888888' } }),
      'not json',
      JSON.stringify({ id: 'gid://shopify/Order/2', createdAt: '2026-11-06T00:00:00Z', customerJourneySummary: { ready: false, momentsCount: null, daysToConversion: null, customerOrderIndex: null } }),
      '',
    ].join('\n')
    const out = parseBulkJsonl(text)
    expect(out).toHaveLength(2)
    expect(out[0].orderId).toBe('1')
    expect(out[0].moments.map(m => m.occurredAt)).toEqual(['2026-11-02T00:00:00Z', '2026-11-04T00:00:00Z'])
    expect(out[0].moments[0]).not.toHaveProperty('__parentId')
    expect(adsOf(out[0].moments)).toEqual({ first: '888888888888', last: '999999999999' })
    expect(out[1].summary?.ready).toBe(false)
    expect(out[1].moments).toEqual([])
  })
})
