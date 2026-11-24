import { afterEach, describe, expect, it, vi } from 'vitest'
import {
  FACEBOOK_ERROR, SHOPIFY_ERROR, accountStatusText, callApi, codeText, facebookErrorText, shopifyErrorText, shortError,
} from '../messages'
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

// Codes come from the URL (?fb_error=, ?shopify_error=, ?error=): a prototype
// key used to index Object.prototype and crash Ajustes and onboarding.
const PROTO_KEYS = ['__proto__', 'constructor', 'toString', 'hasOwnProperty', 'valueOf', 'isPrototypeOf', '__defineGetter__', 'propertyIsEnumerable', 'toLocaleString']

describe('error codes from the URL — own keys only', () => {
  it('known codes keep their text', () => {
    expect(shopifyErrorText('invalid_hmac')).toBe(SHOPIFY_ERROR.invalid_hmac)
    expect(facebookErrorText('access_denied')).toBe(FACEBOOK_ERROR.access_denied)
  })

  it('a prototype key is an unknown code, not a crash', () => {
    for (const k of PROTO_KEYS) {
      expect(typeof shopifyErrorText(k)).toBe('string')
      expect(typeof facebookErrorText(k)).toBe('string')
      expect(codeText(SHOPIFY_ERROR, k)).toBeNull()
      expect(codeText(FACEBOOK_ERROR, k)).toBeNull()
    }
    expect(facebookErrorText('__proto__')).toBe('Erro: __proto__.')
    expect(shopifyErrorText('constructor')).toBe('Erro: constructor.')
  })

  it('the tables have no prototype, so even a direct index misses', () => {
    expect((SHOPIFY_ERROR as Record<string, unknown>).constructor).toBeUndefined()
    expect((FACEBOOK_ERROR as Record<string, unknown>).toString).toBeUndefined()
    expect(Object.isFrozen(SHOPIFY_ERROR)).toBe(true)
  })

  it('an unknown code keeps the "Erro: <code>." fallback; a sentence in the URL is not echoed', () => {
    expect(shopifyErrorText('scope_changed')).toBe('Erro: scope_changed.')
    expect(facebookErrorText('Sua conta foi suspensa, ligue para 0800')).toBe('Erro desconhecido.')
    expect(facebookErrorText('')).toBe('Erro desconhecido.')
    expect(shopifyErrorText('x'.repeat(65))).toBe('Erro desconhecido.')
  })

  it('codeText ignores null, undefined and works on a plain table', () => {
    expect(codeText(SHOPIFY_ERROR, null)).toBeNull()
    expect(codeText(SHOPIFY_ERROR, undefined)).toBeNull()
    expect(codeText({ a: 'A' }, 'a')).toBe('A')
    expect(codeText({ a: 'A' }, 'constructor')).toBeNull()
  })

  it('callApi with a prototype-key code in the body falls back to the server text, not a function', async () => {
    vi.stubGlobal('fetch', respond(400, { error: 'Pedido inválido', code: 'constructor' }))
    const r = await callApi('/api/x', {}, FACEBOOK_ERROR)
    expect(r.error).toBe('Pedido inválido.')
    vi.stubGlobal('fetch', respond(400, { error: 'Pedido inválido', code: 'constructor' }))
    const plain = await callApi('/api/x')
    expect(plain.error).toBe('Pedido inválido.')
  })
})
