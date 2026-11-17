/**
 * Per-viewer rate limits for the AI routes, held in this process's memory.
 *
 * Every call is billed to the owner's Anthropic key, so a loop in a browser
 * tab (or a curious partner) must hit a ceiling long before the bill does.
 * Memory is enough: the app runs as one long-lived Node process, and a
 * restart that forgets the counters only ever loosens the limit for a moment.
 */

export interface Limit { windowMs: number; max: number }

export interface LimitResult {
  ok: boolean
  /** Seconds until the next call would be allowed (0 when ok). */
  retryAfter: number
}

export class RateLimiter {
  private hits = new Map<string, number[]>()

  constructor(private limits: readonly Limit[], private maxKeys = 5_000) {}

  /** Records a hit for `key` when every limit allows it. */
  take(key: string, now: number = Date.now()): LimitResult {
    const longest = Math.max(...this.limits.map(l => l.windowMs))
    const past = (this.hits.get(key) ?? []).filter(t => now - t < longest)
    let retryAfter = 0
    for (const l of this.limits) {
      const inWindow = past.filter(t => now - t < l.windowMs)
      if (inWindow.length >= l.max) {
        // The oldest hit inside the window is the one that has to age out.
        const wait = inWindow[inWindow.length - l.max] + l.windowMs - now
        retryAfter = Math.max(retryAfter, Math.ceil(wait / 1000))
      }
    }
    if (retryAfter > 0) {
      this.hits.set(key, past)
      return { ok: false, retryAfter }
    }
    past.push(now)
    this.hits.set(key, past)
    if (this.hits.size > this.maxKeys) this.prune(now, longest)
    return { ok: true, retryAfter: 0 }
  }

  private prune(now: number, longest: number) {
    for (const [k, v] of this.hits) {
      if (!v.some(t => now - t < longest)) this.hits.delete(k)
    }
  }
}

/** "em 3 min", "em 40 s" — for the 429 message. */
export function waitLabel(seconds: number): string {
  if (seconds >= 3600) return `em ${Math.ceil(seconds / 3600)} h`
  if (seconds >= 60) return `em ${Math.ceil(seconds / 60)} min`
  return `em ${Math.max(1, seconds)} s`
}
