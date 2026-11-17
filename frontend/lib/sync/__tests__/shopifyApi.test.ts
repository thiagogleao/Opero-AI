import { describe, expect, it } from 'vitest'
import { isOrderTopic, verifyWebhook, webhookAuthMethod, webhookDigest } from '../shopifyApi'
import { redactText } from '../jobs'

describe('webhookAuthMethod', () => {
  const body = '{"id":1}'
  it('reports a signed body as hmac, even when the URL token is also present', () => {
    const h = webhookDigest(body, 'secret')
    expect(webhookAuthMethod({ rawBody: body, hmacHeader: h, urlToken: 'abc', expectedToken: 'abc', secrets: ['secret'] })).toBe('hmac')
  })
  it('reports a token-only delivery as token, so the order is read back from Shopify', () => {
    expect(webhookAuthMethod({ rawBody: body, hmacHeader: null, urlToken: 'abc', expectedToken: 'abc', secrets: ['secret'] })).toBe('token')
  })
  it('rejects a forged signature without the token', () => {
    expect(webhookAuthMethod({ rawBody: body, hmacHeader: 'forged', urlToken: null, expectedToken: 'abc', secrets: ['secret'] })).toBe(null)
  })
})

describe('verifyWebhook', () => {
  const body = '{"id":1}'
  it('accepts the URL token', () => {
    expect(verifyWebhook({ rawBody: body, hmacHeader: null, urlToken: 'abc', expectedToken: 'abc', secrets: [] })).toBe(true)
  })
  it('accepts the HMAC of the store own app secret (Dev Dashboard stores)', () => {
    const h = webhookDigest(body, 'store-secret')
    expect(verifyWebhook({ rawBody: body, hmacHeader: h, urlToken: null, expectedToken: 'abc', secrets: ['partners', 'store-secret'] })).toBe(true)
  })
  it('rejects a wrong signature or token', () => {
    expect(verifyWebhook({ rawBody: body, hmacHeader: 'x', urlToken: 'nope', expectedToken: 'abc', secrets: ['s'] })).toBe(false)
    expect(verifyWebhook({ rawBody: body, hmacHeader: null, urlToken: null, expectedToken: null, secrets: [null] })).toBe(false)
  })
  it('knows its topics', () => {
    expect(isOrderTopic('orders/updated')).toBe(true)
    expect(isOrderTopic('products/update')).toBe(false)
  })
})

describe('redactText', () => {
  it('masks tokens in collector output', () => {
    const meta = 'EAA' + 'a'.repeat(30)
    const shop = 'shpat_' + 'b'.repeat(20)
    const s = redactText('GET /act_1/insights?access_token=EAABxyz&appsecret_proof=123 ' + meta + ' ' + shop)
    expect(s).not.toMatch(/EAABxyz|=123|aaaaaaaaaa|bbbbbbbbbb/)
    expect(s).toContain('access_token=***')
  })
})
