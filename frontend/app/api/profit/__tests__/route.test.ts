import { beforeEach, describe, expect, it, vi } from 'vitest'
import { createHash } from 'node:crypto'
import type { ProfitConfig } from '@/lib/engine/costs'
import { canonicalJson, NO_CONFIG_VERSION } from '@/lib/data/profitConfig'

// ─── Mocks: who is looking, the profit_settings table, the engine ────────────

const STORES = [
  { id: 'store-a', name: 'Loja A', shopName: 'Loja A', domain: 'a.myshopify.com', timezone: 'America/Sao_Paulo', archived: false, userId: 'u1' },
  { id: 'store-b', name: 'Loja B', shopName: 'Loja B', domain: 'b.myshopify.com', timezone: 'Asia/Tokyo', archived: false, userId: 'u2' },
]

const db = vi.hoisted(() => ({
  rows: new Map<string, string>(),       // tenant_id → settings JSON (canonical, like jsonb::text)
  writes: 0,
  /** Simulates another save landing between our read and our write. */
  raceOnce: null as null | (() => void),
}))

const md5 = (s: string) => createHash('md5').update(s).digest('hex')

vi.mock('@/lib/db', () => ({
  query: vi.fn(async (sql: string, params: unknown[]) => {
    const [id] = params as string[]
    if (/^\s*SELECT settings/.test(sql)) {
      const s = db.rows.get(id)
      return s === undefined ? [] : [{ settings: JSON.parse(s), version: md5(s) }]
    }
    if (db.raceOnce) { const r = db.raceOnce; db.raceOnce = null; r() }
    const next = canonicalJson(JSON.parse(params[1] as string))
    if (/^\s*INSERT/.test(sql)) {
      if (db.rows.has(id)) return []
      db.rows.set(id, next); db.writes++
      return [{ version: md5(next) }]
    }
    if (/^\s*UPDATE/.test(sql)) {
      const cur = db.rows.get(id)
      if (cur === undefined || md5(cur) !== params[2]) return []
      db.rows.set(id, next); db.writes++
      return [{ version: md5(next) }]
    }
    throw new Error(`unexpected SQL: ${sql}`)
  }),
}))

const viewer = vi.hoisted(() => ({ current: { kind: 'partner', userId: 'u1' } as { kind: string; userId?: string } | null }))

vi.mock('@/lib/access', async () => {
  const actual = await vi.importActual<typeof import('@/lib/access')>('@/lib/access')
  const visible = () => STORES.filter(s => viewer.current?.kind === 'owner' || s.userId === viewer.current?.userId)
  return {
    ...actual,
    getViewer: vi.fn(async () => viewer.current),
    requireStore: vi.fn(async (_v: unknown, id: string) => {
      const s = visible().find(x => x.id === id)
      if (!s) throw new actual.AccessError(404)
      return s
    }),
    resolveStore: vi.fn(async () => ({ store: visible()[0] ?? null, stores: visible() })),
  }
})

const engine = vi.hoisted(() => ({ calls: [] as { id: string; opts: { configOverride?: Record<string, ProfitConfig> } }[] }))

vi.mock('@/lib/engine/pnl', async () => {
  const actual = await vi.importActual<typeof import('@/lib/engine/pnl')>('@/lib/engine/pnl')
  return {
    ...actual,
    computeStorePnL: vi.fn(async (id: string, range: { from: string; to: string }, opts: { configOverride?: Record<string, ProfitConfig> } = {}) => {
      engine.calls.push({ id, opts })
      // Like the engine: the override, else the stored row (if it is set up).
      const stored = db.rows.has(id) ? JSON.parse(db.rows.get(id)!) as ProfitConfig : null
      const cfg = opts.configOverride?.[id] ?? (stored?.shopify && stored.cogs && stored.shipping ? stored : undefined)
      const lines = { ...actual.sumPnL([]), revenue: 1000, orders: 10, cogs: cfg ? cfg.cogs.default_cost_usd * 10 : 0, metaSpend: 200 }
      const totals = actual.derive(lines)
      return {
        store: { id, name: id, domain: null, timezone: 'UTC', userId: null, archived: false },
        configured: !!cfg, range, partial: false, minutesCovered: 1440, cutoffMinutes: null,
        totals, daily: [{ date: range.from, ...totals }], hourly: null, countries: null, products: [],
      }
    }),
  }
})

const { GET, POST, PUT } = await import('../route')

// ─── Helpers ──────────────────────────────────────────────────────────────────

function savedConfig(): ProfitConfig {
  return {
    shopify: { transaction_fee_pct: 2.9, payment_processing_pct: 0, payment_processing_fixed: 0.3 },
    cogs: {
      default_cost_usd: 7.8, packaging_cost_usd: 0, additional_unit_discount_usd: 3, volume_discounts: [],
      products: [{ product_id: '1', name: 'Banana', cost_usd: 8 }],
      price_tiers: [{ effective_from: '2026-09-11', label: '', order_prices: { 1: 9, 2: 15 }, extra_unit_usd: 4.79 }],
      order_fees: [{ country_code: 'AT', name: 'Austria', amount_usd: 3.5, effective_from: '2026-06-22' }],
      zero_cost_products: ['9'],
    },
    shipping: { default_rate_usd: 0, rates: [] },
    extra_costs: [],
  }
}

const put = (body: unknown) => PUT(new Request('http://x/api/profit', { method: 'PUT', body: JSON.stringify(body) }))
const post = (body: unknown) => POST(new Request('http://x/api/profit', { method: 'POST', body: JSON.stringify(body) }))
const get = (q = '') => GET(new Request(`http://x/api/profit${q}`))

async function currentVersion(id = 'store-a') {
  return (await (await get(`?store=${id}`)).json()).version as string
}

beforeEach(() => {
  db.rows.clear(); db.writes = 0; db.raceOnce = null
  engine.calls = []
  viewer.current = { kind: 'partner', userId: 'u1' }
  db.rows.set('store-a', canonicalJson(savedConfig()))
})

// ─── Tests ────────────────────────────────────────────────────────────────────

describe('GET', () => {
  it('returns the saved settings with every default filled, and their version', async () => {
    const res = await get('?store=store-a')
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.configured).toBe(true)
    expect(j.store).toEqual({ id: 'store-a', name: 'Loja A', timezone: 'America/Sao_Paulo', archived: false })
    expect(j.config.cogs.country_prices).toEqual([])
    expect(j.config.cogs.price_tiers).toEqual(savedConfig().cogs.price_tiers)
    expect(j.version).toBe(md5(db.rows.get('store-a')!))
  })

  it('a store with nothing saved is "not configured", version none', async () => {
    viewer.current = { kind: 'owner' }
    const j = await (await get('?store=store-b')).json()
    expect(j.configured).toBe(false)
    expect(j.version).toBe(NO_CONFIG_VERSION)
    expect(j.config.cogs.products).toEqual([])
  })

  it('another account\'s store is 404, and no viewer is 401', async () => {
    expect((await get('?store=store-b')).status).toBe(404)
    viewer.current = null
    expect((await get('?store=store-a')).status).toBe(401)
  })
})

describe('PUT', () => {
  it('refuses a save without the loaded version (a screen whose load failed)', async () => {
    const res = await put({ storeId: 'store-a', config: { cogs: { price_tiers: [] } } })
    expect(res.status).toBe(400)
    expect((await res.json()).issues[0].path).toBe('baseVersion')
    expect(db.writes).toBe(0)
  })

  it('refuses a stale version with 409 and the current one', async () => {
    const res = await put({ storeId: 'store-a', baseVersion: 'old', config: { shopify: { transaction_fee_pct: 3 } } })
    expect(res.status).toBe(409)
    expect((await res.json()).version).toBe(md5(db.rows.get('store-a')!))
  })

  it('merges a partial body: only the field sent changes', async () => {
    const baseVersion = await currentVersion()
    const res = await put({ storeId: 'store-a', baseVersion, config: { shopify: { transaction_fee_pct: 3 } } })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.changed).toBe(true)
    const stored = JSON.parse(db.rows.get('store-a')!) as ProfitConfig
    expect(stored.shopify.transaction_fee_pct).toBe(3)
    expect(stored.cogs.price_tiers).toEqual(savedConfig().cogs.price_tiers)
    expect(stored.cogs.order_fees).toEqual(savedConfig().cogs.order_fees)
    expect(stored.cogs.zero_cost_products).toEqual(['9'])
    expect(j.version).toBe(md5(db.rows.get('store-a')!))
  })

  it('refuses invalid fields with 422 and field paths, writing nothing', async () => {
    const baseVersion = await currentVersion()
    const res = await put({ storeId: 'store-a', baseVersion, config: {
      cogs: { price_tiers: [{ effective_from: '2026-11-20', order_prices: {}, extra_unit_usd: 0 }], order_fees: [{ country_code: 'Austria', amount_usd: 3 }] },
    } })
    expect(res.status).toBe(422)
    const j = await res.json()
    expect(j.issues.map((i: { path: string }) => i.path)).toEqual(['cogs.price_tiers[0].order_prices', 'cogs.order_fees[0].country_code'])
    expect(j.error).toMatch(/inválida/)
    expect(db.writes).toBe(0)
  })

  it('refuses a save that would leave the store with no cost at all', async () => {
    viewer.current = { kind: 'owner' }
    const res = await put({ storeId: 'store-b', baseVersion: NO_CONFIG_VERSION, config: { shopify: { transaction_fee_pct: 0 } } })
    expect(res.status).toBe(422)
    expect(db.writes).toBe(0)
  })

  it('creates the first settings of a store', async () => {
    viewer.current = { kind: 'owner' }
    const res = await put({ storeId: 'store-b', baseVersion: NO_CONFIG_VERSION, config: { cogs: { default_cost_usd: 11 } } })
    expect(res.status).toBe(200)
    expect(JSON.parse(db.rows.get('store-b')!).cogs.default_cost_usd).toBe(11)
  })

  it('writes nothing when the settings are already exactly these', async () => {
    const baseVersion = await currentVersion()
    const full = (await (await get('?store=store-a')).json()).config
    const res = await put({ storeId: 'store-a', baseVersion, config: full })
    expect(res.status).toBe(200)
    expect((await res.json()).changed).toBe(false)
    expect(db.writes).toBe(0)
  })

  it('a save landing between our read and our write wins; ours gets 409', async () => {
    const baseVersion = await currentVersion()
    db.raceOnce = () => { db.rows.set('store-a', canonicalJson({ ...savedConfig(), extra_costs: [{ name: 'x', amount_usd: 1, frequency: 'monthly' }] })) }
    const res = await put({ storeId: 'store-a', baseVersion, config: { shopify: { transaction_fee_pct: 3 } } })
    expect(res.status).toBe(409)
    expect(JSON.parse(db.rows.get('store-a')!).shopify.transaction_fee_pct).toBe(2.9)
  })

  it('cannot save another account\'s store, and needs a storeId', async () => {
    expect((await put({ storeId: 'store-b', baseVersion: NO_CONFIG_VERSION, config: { cogs: { default_cost_usd: 1 } } })).status).toBe(404)
    expect((await put({ baseVersion: 'x', config: {} })).status).toBe(400)
    const bad = await PUT(new Request('http://x/api/profit', { method: 'PUT', body: '{nope' }))
    expect(bad.status).toBe(400)
  })
})

describe('POST (preview)', () => {
  it('without a draft prices the saved settings through the engine', async () => {
    const res = await post({ storeId: 'store-a', period: 'custom', from: '2026-11-01', to: '2026-11-10' })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.source).toBe('saved')
    expect(j.range).toEqual({ from: '2026-11-01', to: '2026-11-10' })
    expect(engine.calls).toHaveLength(1)
    // No override: the engine reads the stored row, as the dashboard does.
    expect(engine.calls[0].opts.configOverride).toBeUndefined()
    expect(j.totals.cogs).toBe(78)
    expect(j.configured).toBe(true)
    expect(j.saved).toBeNull()
    expect(j.breakdown.lines.length).toBeGreaterThan(0)
  })

  it('a draft is merged onto the saved settings, priced, and compared with them', async () => {
    const j = await (await post({ storeId: 'store-a', config: { cogs: { default_cost_usd: 10 } }, period: '7d' })).json()
    expect(j.source).toBe('draft')
    expect(j.changed).toBe(true)
    const draft = engine.calls[0].opts.configOverride!['store-a']
    expect(draft.cogs.default_cost_usd).toBe(10)
    expect(draft.cogs.price_tiers).toEqual(savedConfig().cogs.price_tiers)
    expect(j.totals.cogs).toBe(100)
    expect(j.saved.totals.cogs).toBe(78)
    expect(engine.calls[1].opts.configOverride).toBeUndefined()
  })

  it('an invalid draft still previews (bad entries ignored) and lists the issues', async () => {
    const res = await post({ storeId: 'store-a', config: { shopify: { transaction_fee_pct: 'abc' } } })
    expect(res.status).toBe(200)
    const j = await res.json()
    expect(j.issues.map((i: { path: string }) => i.path)).toEqual(['shopify.transaction_fee_pct'])
    expect(j.changed).toBe(false)
  })

  it('a store with nothing saved and no draft is priced unconfigured', async () => {
    viewer.current = { kind: 'owner' }
    const j = await (await post({ storeId: 'store-b' })).json()
    expect(engine.calls[0].opts.configOverride).toBeUndefined()
    expect(j.configured).toBe(false)
  })

  it('rejects bad windows and the old save action', async () => {
    expect((await post({ storeId: 'store-a', period: 'custom', from: '2026-11-10', to: '2026-11-01' })).status).toBe(400)
    expect((await post({ storeId: 'store-a', period: 'week' })).status).toBe(400)
    expect((await post({ storeId: 'store-a', period: 'custom', from: '2024-01-01', to: '2026-11-01' })).status).toBe(400)
    expect((await post({ action: 'save', config: {} })).status).toBe(400)
  })

  it('defaults to the selected store when none is named', async () => {
    const j = await (await post({})).json()
    expect(j.store.id).toBe('store-a')
  })
})
