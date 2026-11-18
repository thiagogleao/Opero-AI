import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest'

// ─── Mocks: owner session, the store list, the database, the job runner ──────

const STORES = [
  { id: 'mokoo', name: 'MOKOO', shopName: 'MOKOO', domain: 'm.myshopify.com', timezone: 'America/Belem', archived: false, userId: null },
  { id: 'squishy', name: 'Squishy World', shopName: 'Squishy', domain: 's.myshopify.com', timezone: 'America/Sao_Paulo', archived: true, userId: null },
]

const m = vi.hoisted(() => ({
  query: vi.fn(async (sql: string): Promise<unknown[]> => (/FROM tenants t/.test(sql) ? [{ id: 'mokoo' }] : [])),
  spawn: vi.fn(() => { throw new Error('a test must never start a process') }),
  launch: vi.fn((): string => 'started'),
  laneBusy: vi.fn((): boolean => false),
}))

vi.mock('@/lib/mobileAuth', () => ({
  mobileAuthOk: vi.fn(async () => true),
  unauthorized: () => new Response('Not found', { status: 404 }),
}))
vi.mock('@/lib/access', () => ({ listStores: vi.fn(async () => STORES) }))
vi.mock('@/lib/db', () => ({ query: m.query }))
// The route must not spawn anything itself; the runner is the only way in.
vi.mock('child_process', () => ({ spawn: m.spawn, default: { spawn: m.spawn } }))
vi.mock('@/lib/sync/jobs', async orig => ({
  ...(await orig<typeof import('@/lib/sync/jobs')>()),
  launch: m.launch,
  laneBusy: m.laneBusy,
}))

const { POST } = await import('../route')

const post = (stores: string[]) => POST(new Request('http://x/api/mobile/refresh', {
  method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ stores }),
}))

beforeEach(() => {
  vi.unstubAllEnvs()
  vi.stubEnv('DATABASE_READ_ONLY', '')
  vi.stubEnv('AUTO_SYNC_DISABLED', '')
  m.query.mockClear(); m.spawn.mockClear(); m.launch.mockClear(); m.laneBusy.mockClear()
  m.launch.mockImplementation(() => 'started')
  m.laneBusy.mockImplementation(() => false)
})
afterEach(() => vi.unstubAllEnvs())

describe('POST /api/mobile/refresh on a server that must not write', () => {
  it('read-only database: 503 with the reason, before any query or launch', async () => {
    vi.stubEnv('DATABASE_READ_ONLY', '1')
    vi.stubEnv('AUTO_SYNC_DISABLED', '1')
    const res = await post(['mokoo'])
    expect(res.status).toBe(503)
    expect(await res.json()).toEqual({ error: 'Sincronização desligada neste servidor (banco somente leitura)' })
    expect(m.query).not.toHaveBeenCalled()
    expect(m.launch).not.toHaveBeenCalled()
    expect(m.spawn).not.toHaveBeenCalled()
  })

  it('sync turned off: 503 too', async () => {
    vi.stubEnv('AUTO_SYNC_DISABLED', '1')
    const res = await post(['mokoo'])
    expect(res.status).toBe(503)
    expect((await res.json()).error).toBe('Sincronização desligada neste servidor')
    expect(m.launch).not.toHaveBeenCalled()
  })

  it('a runner that refuses ("disabled") is a 503, never "launched"', async () => {
    m.launch.mockImplementation(() => 'disabled')
    const res = await post(['mokoo'])
    expect(res.status).toBe(503)
  })
})

describe('POST /api/mobile/refresh on a server that syncs', () => {
  it('hands each store/source to the job runner and reports its answer', async () => {
    m.launch.mockImplementationOnce(() => 'started').mockImplementationOnce(() => 'queued')
    const res = await post(['mokoo'])
    expect(res.status).toBe(200)
    const body = await res.json()
    expect(body.launched).toEqual([
      { storeId: 'mokoo', name: 'MOKOO', source: 'shopify', state: 'started' },
      { storeId: 'mokoo', name: 'MOKOO', source: 'facebook', state: 'queued' },
    ])
    expect(m.launch.mock.calls.map(c => (c as unknown[])[0])).toEqual([
      expect.objectContaining({ tenantId: 'mokoo', lane: 'shopify', mode: 'refresh', reason: 'atualizar (celular)', label: 'MOKOO' }),
      expect.objectContaining({ tenantId: 'mokoo', lane: 'facebook', mode: 'quick' }),
    ])
    expect(m.spawn).not.toHaveBeenCalled()
  })

  it('a lane already running here is skipped as "em andamento"', async () => {
    m.laneBusy.mockImplementation((...a: unknown[]) => a[1] === 'facebook')
    const body = await (await post(['mokoo'])).json()
    expect(body.launched.map((l: { source: string }) => l.source)).toEqual(['shopify'])
    expect(body.skipped).toEqual([{ storeId: 'mokoo', name: 'MOKOO', source: 'facebook', reason: 'em_andamento', retryInSeconds: null }])
  })

  it('an archived store is refused', async () => {
    const res = await post(['squishy'])
    expect(res.status).toBe(400)
    expect(m.launch).not.toHaveBeenCalled()
  })
})
