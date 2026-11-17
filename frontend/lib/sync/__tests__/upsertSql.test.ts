import { describe, expect, it } from 'vitest'
import { buildUpsert } from '../upsertSql'

describe('buildUpsert', () => {
  it('writes only the columns the row carries and never moves a row to another tenant', () => {
    const q = buildUpsert({
      table: 'shopify_orders',
      rows: [{ order_id: '1', tenant_id: 't', total_price: 5, browser_ip: null }],
      conflict: ['order_id'],
      preserveOnNull: ['browser_ip'],
    })!
    expect(q.sql).toBe(
      'INSERT INTO shopify_orders (order_id, tenant_id, total_price, browser_ip) VALUES ($1, $2, $3, $4) ' +
      'ON CONFLICT (order_id) DO UPDATE SET total_price = EXCLUDED.total_price, ' +
      'browser_ip = COALESCE(EXCLUDED.browser_ip, shopify_orders.browser_ip) ' +
      'WHERE shopify_orders.tenant_id IS NOT DISTINCT FROM EXCLUDED.tenant_id')
    expect(q.params).toEqual(['1', 't', 5, null])
  })

  it('needs no owner guard when tenant_id is in the key', () => {
    const q = buildUpsert({ table: 'fb_ads', rows: [{ tenant_id: 't', ad_id: 'a', name: 'x' }], conflict: ['tenant_id', 'ad_id'] })!
    expect(q.sql).toContain('DO UPDATE SET name = EXCLUDED.name')
    expect(q.sql).not.toContain('WHERE')
  })

  it('does nothing on conflict when only key columns are present', () => {
    const q = buildUpsert({ table: 'x', rows: [{ id_a: 1 }], conflict: ['id_a'] })!
    expect(q.sql).toMatch(/DO NOTHING$/)
  })

  it('numbers parameters across rows and rejects mixed rows and bad identifiers', () => {
    const q = buildUpsert({ table: 't', rows: [{ a: 1, b: 2 }, { a: 3, b: 4 }], conflict: ['a'] })!
    expect(q.sql).toContain('VALUES ($1, $2), ($3, $4)')
    expect(() => buildUpsert({ table: 't', rows: [{ a: 1 }, { b: 2 }], conflict: ['a'] })).toThrow()
    expect(() => buildUpsert({ table: 't; drop', rows: [{ a: 1 }], conflict: ['a'] })).toThrow()
    expect(buildUpsert({ table: 't', rows: [], conflict: ['a'] })).toBeNull()
  })
})
