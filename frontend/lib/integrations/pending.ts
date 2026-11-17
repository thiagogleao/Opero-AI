import { seal, unseal } from './keys'

/**
 * The Facebook token a just-finished OAuth produced, waiting for the person to
 * pick an ad account. It lives in a sealed (encrypted + authenticated) httpOnly
 * cookie: the browser can neither read the token nor change the store it is
 * for. It is bound to the viewer and the store, and expires in 15 minutes.
 */

export const FB_PENDING_COOKIE = 'fb_pending'
export const FB_PENDING_TTL_SECONDS = 900

export interface FacebookPending {
  viewer: string
  storeId: string
  mode: 'main' | 'extra'
  token: string
}

export function sealPending(p: FacebookPending): string {
  return seal(p, 'fb-pending', FB_PENDING_TTL_SECONDS)
}

/** The pending connection, only if it is this viewer's (and this store's, when given). */
export function readPending(raw: string | null | undefined, viewer: string, storeId?: string | null): FacebookPending | null {
  const p = unseal<FacebookPending>(raw, 'fb-pending')
  if (!p || p.viewer !== viewer) return null
  if (storeId && p.storeId !== storeId) return null
  return p
}
