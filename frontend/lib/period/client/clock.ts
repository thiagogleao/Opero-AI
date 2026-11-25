/**
 * The server-corrected clock (R19). Client only: the one place besides
 * turn.ts that reads the device clock. Every answer from the server carries
 * `serverNow`; the client keeps offset = serverNow − (sentAt + receivedAt)/2,
 * the median of the last 5 answers, so a phone clock off by minutes or hours
 * schedules turns on server time and never loops (C2-H3).
 */

const samples: number[] = []
let offset = 0

/** Record one answer's server time. */
export function adoptServerNow(serverNow: string | number, sentAt: number, receivedAt: number): number {
  const server = typeof serverNow === 'number' ? serverNow : Date.parse(serverNow)
  if (!Number.isFinite(server)) return offset
  samples.push(server - (sentAt + receivedAt) / 2)
  if (samples.length > 5) samples.shift()
  const sorted = [...samples].sort((a, b) => a - b)
  offset = sorted[Math.floor(sorted.length / 2)]
  return offset
}

/** Device time corrected to the server's, in ms. */
export function clientNowMs(): number {
  return Date.now() + offset // clock-ok: the corrected clock itself
}

export function clientNow(): Date {
  return new Date(clientNowMs())
}

/**
 * The raw device clock, for durations measured and compared on the same
 * device across reloads (the phone visit's hiddenAt / lastSeenAt and its
 * 30-minute expiry, R16). The server offset is in memory only and starts at 0
 * after a reload, so mixing corrected and raw times broke the expiry by the
 * phone's skew (P6); a duration needs one clock, and the device's own is the
 * one that survives a reload.
 */
export function deviceNow(): Date {
  return new Date(Date.now()) // clock-ok: device-clock durations (visit expiry)
}

const seen = new Set<string>()

/**
 * Adopt a page's server instant only the first time it is seen (R19). A
 * desktop page embeds the instant it was rendered at; a back/forward hop
 * reuses an older render (Next's client cache, bfcache), and adopting it again
 * as a fresh sample made the offset that page's age (−20 min), which pushed
 * the midnight turn 20 minutes late.
 */
export function adoptFreshServerNow(serverNow: string, sentAt: number, receivedAt: number): number {
  if (seen.has(serverNow)) return offset
  seen.add(serverNow)
  return adoptServerNow(serverNow, sentAt, receivedAt)
}

/** For tests. */
export function resetClientClock(): void {
  samples.length = 0
  seen.clear()
  offset = 0
}

export function clockOffset(): number {
  return offset
}
