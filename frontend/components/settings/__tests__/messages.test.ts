import { afterEach, describe, expect, it, vi } from 'vitest'
import { SHOPIFY_ERROR, accountStatusText, callApi, shortError } from '../messages'
import { explainShopifyKey } from '../ShopifyKeyForm'

const respond = (status: number, body: unknown, json = true) =>
  vi.fn(async () => new Response(json ? JSON.stringify(body) : String(body), { status, headers: { 'Content-Type': json ? 'application/json' : 'text/html' } }))

afterEach(() => { vi.unstubAllGlobals() })

describe('callApi — success only when the server confirmed', () => {
  it('ok for a 2xx JSON answer', async () => {
    vi.stubGlobal('fetch', respond(200, { ok: true, store: { id: 'a' } }))
    const r = await callApi<{ ok: boolean }>('/api/x', { method: 'POST', body: '{}' })
    expect(r.ok).toBe(true)
    expect(r.data?.ok).toBe(true)
  })

  it('not ok for an HTML 500 (a crashed route), with a sentence that says nothing changed', async () => {
    vi.stubGlobal('fetch', respond(500, '<html>Internal error</html>', false))
    const r = await callApi('/api/x', { method: 'PATCH', body: '{}' })
    expect(r.ok).toBe(false)
    expect(r.error).toBe('O servidor respondeu com erro (HTTP 500). Nada foi alterado.')
  })

  it('not ok for a 200 without a JSON body', async () => {
    vi.stubGlobal('fetch', respond(200, 'ok', false))
    expect((await callApi('/api/x')).ok).toBe(false)
  })

  it('uses the Portuguese text of a known code, else the server message with a period', async () => {
    vi.stubGlobal('fetch', respond(409, { error: 'x', code: 'dev_dashboard_store' }))
    expect((await callApi('/api/x', {}, SHOPIFY_ERROR)).error).toBe(SHOPIFY_ERROR.dev_dashboard_store)
    vi.stubGlobal('fetch', respond(500, { error: 'Erro interno', code: 'internal' }))
    const r = await callApi('/api/x', {}, SHOPIFY_ERROR)
    expect(r.error).toBe('Erro interno.')
    expect(r.code).toBe('internal')
  })

  it('keeps extra fields of an error body (expiresAt of replaces_permanent_token)', async () => {
    vi.stubGlobal('fetch', respond(409, { error: 'x', code: 'replaces_permanent_token', expiresAt: '2027-01-12T00:00:00Z' }))
    const r = await callApi('/api/x')
    expect(r.extra.expiresAt).toBe('2027-01-12T00:00:00Z')
  })

  it('a network failure is not a success', async () => {
    vi.stubGlobal('fetch', vi.fn(async () => { throw new TypeError('Failed to fetch') }))
    const r = await callApi('/api/x')
    expect(r).toMatchObject({ ok: false, status: 0, code: 'network' })
  })
})

describe('explainShopifyKey', () => {
  it('catches the usual mix-ups', () => {
    expect(explainShopifyKey('shpss_abc', 'token')).toMatch(/Client Secret/)
    expect(explainShopifyKey('0123456789abcdef0123456789abcdef', 'token')).toMatch(/Client ID/)
    expect(explainShopifyKey('shpat_abc', 'secret')).toMatch(/token de acesso/)
    expect(explainShopifyKey('shpat_abc', 'token')).toBeNull()
    expect(explainShopifyKey('', 'token')).toBeNull()
  })
})

describe('accountStatusText', () => {
  it('names Meta account states in words', () => {
    expect(accountStatusText(1)).toEqual({ text: 'ativa no Meta', tone: 'pos' })
    expect(accountStatusText(2).tone).toBe('neg')
    expect(accountStatusText(null).tone).toBe('mut')
  })
})

describe('shortError — a collector error fit to quote', () => {
  it('keeps a short message as it is', () => {
    expect(shortError('Call was not successful')).toBe('Call was not successful')
  })
  it('cuts an HTTP dump to its first line and 140 characters', () => {
    const dump = `Response(code=402, body="b'{"errors":"Unavailable Shop"}'", headers={'Date': 'Wed, 18 Nov 2026 01:31:18 GMT', 'Content-Type': 'application/json; charset=utf-8', 'Transfer-Encoding': 'chunked'})\nsecond line`
    const out = shortError(dump)
    expect(out.length).toBeLessThanOrEqual(140)
    expect(out.endsWith('…')).toBe(true)
    expect(out).not.toContain('second line')
    expect(out.startsWith('Response(code=402')).toBe(true)
  })
})
