import crypto from 'node:crypto'
import { beforeAll, describe, expect, it } from 'vitest'
import { fingerprint, seal, signPayload, unseal, verifyPayload } from '../keys'
import { createOAuthState, readOAuthState, safeReturnTo, viewerKey } from '../oauthState'
import { adminApiUrl, normalizeShopDomain, SHOPIFY_API_VERSION, verifyShopifyHmac } from '../shopify'
import { normalizeAdAccountId } from '../facebook'
import { clientIp, unlockTarget } from '../request'
import { sanitizeError } from '../health'
import { readPending, sealPending } from '../pending'

beforeAll(() => {
  process.env.OAUTH_STATE_SECRET = 'test-secret-'.padEnd(48, 'x')
})

describe('signed payloads', () => {
  it('round-trips and rejects tampering, other purposes and expiry', () => {
    const t = signPayload({ a: 1 }, 'p', 60)
    expect(verifyPayload<{ a: number }>(t, 'p')?.a).toBe(1)
    expect(verifyPayload(t, 'other')).toBeNull()
    const [body, sig] = t.split('.')
    const forged = Buffer.from(JSON.stringify({ a: 2, exp: 9999999999 })).toString('base64url')
    expect(verifyPayload(`${forged}.${sig}`, 'p')).toBeNull()
    expect(verifyPayload(`${body}.${sig.slice(0, -2)}AA`, 'p')).toBeNull()
    expect(verifyPayload(signPayload({ a: 1 }, 'p', -1), 'p')).toBeNull()
    expect(verifyPayload('garbage', 'p')).toBeNull()
  })

  it('sealed values are unreadable and tamper-proof', () => {
    const s = seal({ token: 'EAAsecret' }, 'q', 60)
    expect(Buffer.from(s, 'base64url').toString('latin1')).not.toContain('EAAsecret')
    expect(unseal<{ token: string }>(s, 'q')?.token).toBe('EAAsecret')
    expect(unseal(s, 'other')).toBeNull()
    const raw = Buffer.from(s, 'base64url'); raw[raw.length - 1] ^= 1
    expect(unseal(raw.toString('base64url'), 'q')).toBeNull()
    expect(unseal(seal({ x: 1 }, 'q', -1), 'q')).toBeNull()
  })

  it('fingerprint is short and does not contain the secret', () => {
    const f = fingerprint('shpat_abcdef0123456789')
    expect(f).toMatch(/^[0-9a-f]{8}$/)
    expect('shpat_abcdef0123456789').not.toContain(f)
  })
})

describe('OAuth state', () => {
  const viewer = viewerKey({ kind: 'partner', userId: 'user_A' })

  it('carries store, viewer and mode, bound to the nonce cookie', () => {
    const { state, nonce } = createOAuthState({ provider: 'facebook', viewer, storeId: 's1', mode: 'extra', returnTo: '/settings' })
    const ok = readOAuthState(state, nonce, 'facebook')
    expect(ok.ok && ok.state.storeId).toBe('s1')
    expect(ok.ok && ok.state.viewer).toBe('partner:user_A')
    expect(readOAuthState(state, 'other-nonce', 'facebook').ok).toBe(false)
    expect(readOAuthState(state, undefined, 'facebook').ok).toBe(false)
    expect(readOAuthState(state, nonce, 'shopify').ok).toBe(false)
  })

  it('return paths come from an allowlist', () => {
    expect(safeReturnTo('/settings/chaves', '/settings')).toBe('/settings/chaves')
    expect(safeReturnTo('https://evil.example', '/settings')).toBe('/settings')
    expect(safeReturnTo('//evil.example', '/onboarding')).toBe('/onboarding')
    expect(viewerKey({ kind: 'owner' })).toBe('owner')
  })

  it('a pending Facebook login is bound to its viewer and store', () => {
    const raw = sealPending({ viewer, storeId: 's1', mode: 'main', token: 'EAAx' })
    expect(readPending(raw, viewer, 's1')?.token).toBe('EAAx')
    expect(readPending(raw, viewer, 's2')).toBeNull()
    expect(readPending(raw, 'partner:user_B')).toBeNull()
    // The old cookie format (base64 JSON) is not accepted.
    const legacy = Buffer.from(JSON.stringify({ viewer, storeId: 's1', mode: 'main', token: 'EAAx', exp: 9e9 })).toString('base64')
    expect(readPending(legacy, viewer)).toBeNull()
  })
})

describe('Shopify', () => {
  it('normalizes and validates shop domains', () => {
    expect(normalizeShopDomain('6k7fjw-jt')).toBe('6k7fjw-jt.myshopify.com')
    expect(normalizeShopDomain('https://6K7FJW-JT.myshopify.com/admin/orders')).toBe('6k7fjw-jt.myshopify.com')
    expect(normalizeShopDomain(' mpjmxs-uj.myshopify.com ')).toBe('mpjmxs-uj.myshopify.com')
    expect(normalizeShopDomain('evil.example')).toBeNull()
    expect(normalizeShopDomain('evil.example/x.myshopify.com')).toBeNull()
    expect(normalizeShopDomain('x.myshopify.com.evil.example')).toBeNull()
    expect(normalizeShopDomain('a.myshopify.com@evil.example')).toBeNull()
    expect(normalizeShopDomain('-bad.myshopify.com')).toBeNull()
    expect(normalizeShopDomain('')).toBeNull()
    expect(normalizeShopDomain(null)).toBeNull()
  })

  it('uses one supported API version', () => {
    expect(SHOPIFY_API_VERSION).toBe('2026-10')
    expect(adminApiUrl('a.myshopify.com', '/shop.json')).toBe('https://a.myshopify.com/admin/api/2026-10/shop.json')
  })

  it('verifies the callback HMAC with the server secret, in constant time', () => {
    const secret = 'hush'
    const params = new URLSearchParams({
      code: '0907a61c0c8d55e99db179b68161bc00', shop: 'some-shop.myshopify.com',
      state: '0.6784241404160823', timestamp: '1337178173',
    })
    const message = 'code=0907a61c0c8d55e99db179b68161bc00&shop=some-shop.myshopify.com&state=0.6784241404160823&timestamp=1337178173'
    const good = crypto.createHmac('sha256', secret).update(message).digest('hex')
    // Shopify's documented example for this query and secret.
    expect(good).toBe('700e2dadb827fcc8609e9d5ce208b2e9cdaab9df07390d2cbca10d7c328fc4bf')
    params.set('hmac', good)
    expect(verifyShopifyHmac(params, secret)).toBe(true)
    expect(verifyShopifyHmac(params, 'another-secret')).toBe(false)
    params.set('shop', 'evil.myshopify.com')
    expect(verifyShopifyHmac(params, secret)).toBe(false)
    params.set('hmac', 'nothex')
    expect(verifyShopifyHmac(params, secret)).toBe(false)
  })
})

describe('Facebook', () => {
  it('normalizes ad account ids', () => {
    expect(normalizeAdAccountId('act_1040512874708609')).toBe('act_1040512874708609')
    expect(normalizeAdAccountId('1040512874708609')).toBe('act_1040512874708609')
    expect(normalizeAdAccountId(' act_123456 ')).toBe('act_123456')
    expect(normalizeAdAccountId('act_12a')).toBeNull()
    expect(normalizeAdAccountId('')).toBeNull()
    expect(normalizeAdAccountId(123)).toBeNull()
  })
})

describe('unlock link', () => {
  it('rate limits on the right-most forwarded address', () => {
    const h = (xff: string) => new Headers({ 'x-forwarded-for': xff })
    expect(clientIp(h('1.1.1.1, 203.0.113.9'))).toBe('203.0.113.9')
    expect(clientIp(h('spoofed'))).toBe('spoofed')
    expect(clientIp(new Headers({ 'x-real-ip': '10.0.0.1' }))).toBe('10.0.0.1')
    expect(clientIp(new Headers())).toBe('unknown')
  })

  it('only ever lands on / or /m', () => {
    expect(unlockTarget('desktop')).toBe('/')
    expect(unlockTarget(null)).toBe('/m')
    expect(unlockTarget('https://evil.example')).toBe('/m')
    expect(unlockTarget('//evil.example')).toBe('/m')
  })
})

describe('sanitizeError', () => {
  it('keeps the message line and strips credentials', () => {
    const raw = "\n\n  Message: Call was not successful\n  Method:  GET\n  Path:    https://graph.facebook.com/v20.0/act_1/insights?access_token=EAAB123"
    expect(sanitizeError(raw)).toBe('Call was not successful')
    expect(sanitizeError('bad token EAABwzLixnjYBO1234567890abcdefghij here')).toBe('bad token [token] here')
    expect(sanitizeError('x access_token=abc&y=1')).toBe('x access_token=[token]&y=1')
    expect(sanitizeError('shpat_0123456789abcdef revoked')).toBe('[token] revoked')
    expect(sanitizeError(null)).toBeNull()
  })
})
