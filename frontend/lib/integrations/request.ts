/**
 * Request details for the owner's unlock link.
 */

/**
 * The client address for rate limiting: the RIGHT-most X-Forwarded-For entry,
 * which is the one Railway's proxy appended. Entries to its left come from the
 * client and can be anything — keying on the left-most let every request pick
 * a fresh "address" and never hit the limit.
 */
export function clientIp(headers: Headers): string {
  const xff = headers.get('x-forwarded-for')
  if (xff) {
    const parts = xff.split(',').map(s => s.trim()).filter(Boolean)
    if (parts.length) return parts[parts.length - 1]
  }
  return headers.get('x-real-ip')?.trim() || 'unknown'
}

/** Where the unlock link lands: the desktop site ('/') only for to=desktop,
 *  otherwise the phone app. Never anything taken from the request. */
export function unlockTarget(to: string | null): '/' | '/m' {
  return to === 'desktop' ? '/' : '/m'
}
