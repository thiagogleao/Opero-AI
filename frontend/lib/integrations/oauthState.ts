import crypto from 'node:crypto'
import type { Viewer } from '../access'
import { periodQuery } from '../period/url'
import { sameString, signPayload, verifyPayload } from './keys'

/**
 * OAuth state for the Shopify and Facebook connect flows.
 *
 * The state is signed and expires in 10 minutes. It carries everything the
 * callback needs to decide where the result goes — the provider, the viewer
 * who started it, the target store, the mode and where to send the person
 * back — so the callback never reads a client-editable cookie to pick a store.
 * A random nonce is also kept in an httpOnly cookie and must match: that binds
 * the state to the browser that started the flow, so a callback URL cannot be
 * replayed from somewhere else.
 */

export type OAuthProvider = 'shopify' | 'facebook'

export interface OAuthState {
  provider: OAuthProvider
  /** viewerKey() of who started the flow; the callback must be the same viewer. */
  viewer: string
  /** Target store. null only for a Shopify "add store" flow. */
  storeId: string | null
  /** shopify: 'reconnect' | 'add'. facebook: 'main' | 'extra'. */
  mode: string
  /** Where to send the person back (a path from RETURN_PATHS, with its
   *  validated period state: see safeReturnTo). */
  returnTo: string
  /** Shopify: the validated *.myshopify.com domain the flow was started for. */
  shop?: string
  /** Onboarding: "when did the store open?" (YYYY-MM-DD), passed back as-is. */
  startDate?: string
  nonce: string
}

export const OAUTH_TTL_SECONDS = 600

export const NONCE_COOKIE: Record<OAuthProvider, string> = {
  shopify: 'shopify_oauth_nonce',
  facebook: 'fb_oauth_nonce',
}

/** Cookies the previous implementation used. Deleted on every exit so a stale
 *  one can never steer a later flow (the "cancelled add-extra hijacks the next
 *  connect" bug). */
export const LEGACY_OAUTH_COOKIES = [
  'shopify_oauth_state', 'shopify_custom_creds',
  'fb_oauth_state', 'fb_oauth_tenant', 'fb_oauth_mode', 'fb_extra_pending',
]

export function viewerKey(v: Viewer): string {
  return v.kind === 'owner' ? 'owner' : `partner:${v.userId}`
}

export function createOAuthState(s: Omit<OAuthState, 'nonce'>): { state: string; nonce: string } {
  const nonce = crypto.randomBytes(16).toString('base64url')
  return { state: signPayload<OAuthState>({ ...s, nonce }, `oauth:${s.provider}`, OAUTH_TTL_SECONDS), nonce }
}

export type StateCheck =
  | { ok: true; state: OAuthState }
  | { ok: false; reason: 'invalid_state' }

/** Valid only when the signature checks, it has not expired, it was issued for
 *  this provider and its nonce matches the browser's cookie. */
export function readOAuthState(
  raw: string | null | undefined, nonceCookie: string | null | undefined, provider: OAuthProvider,
): StateCheck {
  const s = verifyPayload<OAuthState>(raw, `oauth:${provider}`)
  if (!s || s.provider !== provider || !nonceCookie || !sameString(s.nonce, nonceCookie)) {
    return { ok: false, reason: 'invalid_state' }
  }
  return { ok: true, state: s }
}

/** The only places a flow may send someone back to. Anything else falls back,
 *  so a crafted `return` can never turn these routes into an open redirect. */
export const RETURN_PATHS = ['/settings', '/settings/chaves', '/onboarding', '/'] as const

const LOCAL = 'http://opero.invalid'

/**
 * Where a flow sends the person back: one of RETURN_PATHS, plus the site's
 * period state (periodo, de/ate with periodo=custom, parte=50) so the screen
 * comes back on the window it left from. Every other key is dropped (the
 * callbacks set loja and their own flags) and each kept value is validated,
 * so nothing free-form rides in the signed state or the redirect.
 */
export function safeReturnTo(raw: string | null | undefined, fallback: (typeof RETURN_PATHS)[number]): string {
  if (!raw || !raw.startsWith('/') || raw.startsWith('//') || raw.includes('\\')) return fallback
  let u: URL
  try { u = new URL(raw, LOCAL) } catch { return fallback }
  if (u.origin !== LOCAL || !(RETURN_PATHS as readonly string[]).includes(u.pathname)) return fallback
  // lib/period's own parse (normalised dates, the split), never a copy (R3).
  const qs = periodQuery(u.searchParams).toString()
  return qs ? `${u.pathname}?${qs}` : u.pathname
}

/** The path of a safeReturnTo value, without its period state. */
export function returnPathname(returnTo: string): string {
  return returnTo.split('?', 1)[0]
}

/** The period state a safeReturnTo value carries, to pass on to a next screen. */
export function returnState(returnTo: string): Record<string, string> {
  const q = returnTo.split('?', 2)[1]
  return q ? Object.fromEntries(new URLSearchParams(q)) : {}
}
