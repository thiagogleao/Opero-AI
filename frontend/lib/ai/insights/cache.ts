import { INSIGHTS_CACHE_MAX_ENTRIES, INSIGHTS_PROMPT_VERSION, INSIGHTS_TTL_MS } from '../config'

/**
 * Insights are generated on request and kept in this process's memory for
 * INSIGHTS_TTL_MS, per store + window + split (+ prompt version). The old
 * cache lived in each browser's localStorage under store+dates only, so a
 * partner toggling the 50% split kept seeing the unsplit cards for six hours.
 *
 * Memory, not the database: the app is one long-lived Node process, a lost
 * cache only costs one regeneration, and nothing is written to production.
 */

export class TtlCache<V> {
  private map = new Map<string, { value: V; expires: number }>()

  constructor(private ttlMs: number, private maxEntries: number) {}

  get(key: string, now: number = Date.now()): { value: V; expires: number } | null {
    const hit = this.map.get(key)
    if (!hit) return null
    if (hit.expires <= now) { this.map.delete(key); return null }
    return hit
  }

  /** Stores `value` and returns when it expires. Oldest entries go first when full. */
  set(key: string, value: V, now: number = Date.now()): number {
    const expires = now + this.ttlMs
    this.map.delete(key)
    this.map.set(key, { value, expires })
    while (this.map.size > this.maxEntries) {
      const oldest = this.map.keys().next().value
      if (oldest === undefined) break
      this.map.delete(oldest)
    }
    return expires
  }

  get size(): number { return this.map.size }
}

export function insightsKey(storeId: string, range: { from: string; to: string }, split: boolean): string {
  return `v${INSIGHTS_PROMPT_VERSION}|${storeId}|${range.from}|${range.to}|${split ? 'split' : 'full'}`
}

/** Generic over the result so this file does not depend on the run module. */
export function createInsightsStore<V>() {
  return {
    cache: new TtlCache<V>(INSIGHTS_TTL_MS, INSIGHTS_CACHE_MAX_ENTRIES),
    /** One generation per key at a time: a second click (or tab) waits for
     *  the first instead of paying for another Opus call. */
    inflight: new Map<string, Promise<V>>(),
  }
}
