import crypto from 'node:crypto'

/**
 * Server-held keys for the integration flows: signing OAuth state and sealing
 * the short-lived "pending connection" cookie.
 *
 * Why not plain cookies: the old flows kept the target store and the fresh
 * Facebook token in base64 cookies. httpOnly stops page scripts, not the
 * person at the keyboard — anyone could edit them in devtools and point a
 * write at another account's store. Signed state cannot be edited, and sealed
 * cookies cannot be read or edited, by anyone without the server key.
 *
 * The key is derived from the first strong secret the server already has, so
 * no new env var is required: OAUTH_STATE_SECRET if set, else Clerk's secret
 * key (always present in production), else the owner's mobile token. Each
 * purpose gets its own derived key, so a signature for one use is never valid
 * for another.
 */

const ROOT_SECRET_ENV = ['OAUTH_STATE_SECRET', 'CLERK_SECRET_KEY', 'MOBILE_ACCESS_TOKEN'] as const

function rootSecret(): string {
  for (const name of ROOT_SECRET_ENV) {
    const v = process.env[name]
    if (v && v.length >= 32) return v
  }
  throw new Error('Nenhum segredo de servidor para assinar o OAuth: configure OAUTH_STATE_SECRET (32+ caracteres)')
}

function derive(purpose: string): Buffer {
  return crypto.createHmac('sha256', rootSecret()).update(`opero-integrations:v1:${purpose}`).digest()
}

const b64 = (b: Buffer) => b.toString('base64url')
const unb64 = (s: string) => Buffer.from(s, 'base64url')

const nowSeconds = () => Math.floor(Date.now() / 1000)

interface Expiring { exp: number }

/** `payload.signature`, both base64url. The payload is readable (it travels in
 *  a URL through Shopify/Facebook), so never put a secret in it. */
export function signPayload<T extends object>(data: T, purpose: string, ttlSeconds: number): string {
  const body = b64(Buffer.from(JSON.stringify({ ...data, exp: nowSeconds() + ttlSeconds })))
  const sig = b64(crypto.createHmac('sha256', derive(`sign:${purpose}`)).update(body).digest())
  return `${body}.${sig}`
}

/** The signed data, or null when the signature is wrong, the purpose differs
 *  or it has expired. Constant-time on the signature. */
export function verifyPayload<T extends object>(token: string | null | undefined, purpose: string): (T & Expiring) | null {
  if (!token || token.length > 4096) return null
  const dot = token.indexOf('.')
  if (dot <= 0) return null
  const body = token.slice(0, dot)
  const sig = unb64(token.slice(dot + 1))
  const expected = crypto.createHmac('sha256', derive(`sign:${purpose}`)).update(body).digest()
  if (sig.length !== expected.length || !crypto.timingSafeEqual(sig, expected)) return null
  try {
    const data = JSON.parse(unb64(body).toString('utf8')) as T & Expiring
    if (typeof data.exp !== 'number' || data.exp < nowSeconds()) return null
    return data
  } catch {
    return null
  }
}

/** AES-256-GCM: confidential and tamper-proof. For values that must not be
 *  readable by the browser holding them (a fresh access token). */
export function seal<T extends object>(data: T, purpose: string, ttlSeconds: number): string {
  const iv = crypto.randomBytes(12)
  const cipher = crypto.createCipheriv('aes-256-gcm', derive(`seal:${purpose}`), iv)
  const plain = Buffer.from(JSON.stringify({ ...data, exp: nowSeconds() + ttlSeconds }))
  const ct = Buffer.concat([cipher.update(plain), cipher.final()])
  return b64(Buffer.concat([iv, cipher.getAuthTag(), ct]))
}

export function unseal<T extends object>(value: string | null | undefined, purpose: string): (T & Expiring) | null {
  if (!value || value.length > 8192) return null
  try {
    const raw = unb64(value)
    if (raw.length < 29) return null
    const decipher = crypto.createDecipheriv('aes-256-gcm', derive(`seal:${purpose}`), raw.subarray(0, 12))
    decipher.setAuthTag(raw.subarray(12, 28))
    const plain = Buffer.concat([decipher.update(raw.subarray(28)), decipher.final()])
    const data = JSON.parse(plain.toString('utf8')) as T & Expiring
    if (typeof data.exp !== 'number' || data.exp < nowSeconds()) return null
    return data
  } catch {
    return null
  }
}

/** Constant-time string equality over SHA-256 digests (length-independent). */
export function sameString(a: string, b: string): boolean {
  const da = crypto.createHash('sha256').update(a).digest()
  const db = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(da, db)
}

/** Short, non-reversible tag so a person can tell two credentials apart (for
 *  example "is the token in the database the one I just pasted?") without the
 *  credential itself ever leaving the server. */
export function fingerprint(secret: string): string {
  return crypto.createHash('sha256').update(secret).digest('hex').slice(0, 8)
}
