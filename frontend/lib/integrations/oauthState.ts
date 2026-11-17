import crypto from 'node:crypto'
import type { Viewer } from '../access'
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
  /** Where to send the person back (always a path from RETURN_PATHS). */
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

export function safeReturnTo(raw: string | null | undefined, fallback: (typeof RETURN_PATHS)[number]): string {
  return raw && (RETURN_PATHS as readonly string[]).includes(raw) ? raw : fallback
}
