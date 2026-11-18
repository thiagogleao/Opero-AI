/**
 * VAPID key helpers for the push panel. Pure.
 *
 * A device subscribed with an old server key keeps its subscription after the
 * key changes, and every push to it is refused (401/403): it looks subscribed
 * and nothing arrives. Comparing the subscription's key with the server's is
 * the only way the phone can tell.
 */

export function urlBase64ToUint8Array(base64: string): Uint8Array<ArrayBuffer> {
  const padding = '='.repeat((4 - (base64.length % 4)) % 4)
  const raw = atob((base64 + padding).replace(/-/g, '+').replace(/_/g, '/'))
  const out = new Uint8Array(new ArrayBuffer(raw.length))
  for (let i = 0; i < raw.length; i++) out[i] = raw.charCodeAt(i)
  return out
}

export function bytesToBase64Url(bytes: ArrayBuffer | Uint8Array): string {
  const u8 = bytes instanceof Uint8Array ? bytes : new Uint8Array(bytes)
  let s = ''
  for (let i = 0; i < u8.length; i++) s += String.fromCharCode(u8[i])
  return btoa(s).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
}

/** Null when the browser does not expose the subscription's key. */
export function sameServerKey(subscriptionKey: ArrayBuffer | null | undefined, serverKey: string): boolean | null {
  if (!subscriptionKey) return null
  const norm = (k: string) => k.trim().replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '')
  return bytesToBase64Url(subscriptionKey) === norm(serverKey)
}
