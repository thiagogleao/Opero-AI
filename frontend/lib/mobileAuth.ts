import crypto from 'crypto'
import { cookies } from 'next/headers'

/**
 * Auth for the personal mobile PWA.
 *
 * This surface is deliberately OUTSIDE Clerk. The Opero accounts are shared
 * with per-store business partners, and a partner must never see another
 * store's numbers — but this app aggregates every store. So it cannot key off
 * any existing account: it has its own credential, held only by the owner.
 *
 * Design:
 *   - MOBILE_ACCESS_TOKEN is a 256-bit random secret (env var, never in code).
 *   - It is handed to the device once via a magic link, then exchanged for an
 *     HttpOnly cookie so the raw token never sits in localStorage (readable by
 *     any XSS) nor stays in browser history.
 *   - The cookie holds an HMAC of the token, not the token itself. Rotating
 *     MOBILE_ACCESS_TOKEN therefore revokes every device at once.
 *   - All comparisons are constant-time and run over fixed-length digests, so
 *     neither timing nor length leaks anything.
 */

export const MOBILE_COOKIE = 'opero_m'

function token(): string | null {
  const t = process.env.MOBILE_ACCESS_TOKEN
  // Refuse to run on a weak secret rather than silently accepting one.
  if (!t || t.length < 32) return null
  return t
}

/** Value stored in the cookie: HMAC(token, "opero-mobile-session-v1"). */
function sessionValue(t: string): string {
  return crypto.createHmac('sha256', t).update('opero-mobile-session-v1').digest('base64url')
}

/** Constant-time compare over SHA-256 digests (length-independent). */
function sameSecret(a: string, b: string): boolean {
  const da = crypto.createHash('sha256').update(a).digest()
  const db = crypto.createHash('sha256').update(b).digest()
  return crypto.timingSafeEqual(da, db)
}

/** True when the supplied magic-link token is the configured one. */
export function isValidToken(candidate: string | null | undefined): boolean {
  const t = token()
  if (!t || !candidate) return false
  return sameSecret(candidate, t)
}

/** Cookie value to set after a successful unlock. */
export function makeSessionCookie(): string | null {
  const t = token()
  return t ? sessionValue(t) : null
}

/** True when the request carries a valid mobile session cookie. */
export async function hasMobileSession(): Promise<boolean> {
  const t = token()
  if (!t) return false
  const jar = await cookies()
  const got = jar.get(MOBILE_COOKIE)?.value
  if (!got) return false
  return sameSecret(got, sessionValue(t))
}

/**
 * Route-handler guard. Accepts the session cookie, or a raw token in the
 * `x-mobile-token` header (so the PWA can recover if the cookie is dropped).
 */
export async function mobileAuthOk(req: Request): Promise<boolean> {
  if (await hasMobileSession()) return true
  return isValidToken(req.headers.get('x-mobile-token'))
}

export function unauthorized() {
  // No hint about what is missing — this endpoint is publicly reachable.
  return new Response('Not found', { status: 404 })
}

// ─── Rate limiting ────────────────────────────────────────────────────────────

/**
 * In-memory limiter for the unlock endpoint. A 256-bit token is not brute
 * forceable, but this blunts probing and keeps logs quiet. Per-process state is
 * fine: this app runs as a single Railway instance, and the token's entropy —
 * not this counter — is the actual defence.
 */
const attempts = new Map<string, { n: number; resetAt: number }>()
const WINDOW_MS = 10 * 60_000
const MAX_ATTEMPTS = 10

export function rateLimited(ip: string): boolean {
  const now = Date.now()
  const rec = attempts.get(ip)
  if (!rec || now > rec.resetAt) {
    attempts.set(ip, { n: 1, resetAt: now + WINDOW_MS })
    return false
  }
  rec.n++
  if (attempts.size > 1000) {
    for (const [k, v] of attempts) if (now > v.resetAt) attempts.delete(k)
  }
  return rec.n > MAX_ATTEMPTS
}
