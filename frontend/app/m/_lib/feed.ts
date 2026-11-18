/**
 * Which live-feed sales are new, for the sale chime. Pure.
 *
 * The feed is filtered by the selected store, so its contents change with the
 * selection: going from MOKOO to Todas used to "discover" every EPOCH and
 * Dumpling order and ring for sales that were hours old. The baseline is
 * therefore tied to the selection it was taken on — a different selection
 * starts a new baseline in silence — and only a sale that is both unseen and
 * recent counts.
 */

export interface FeedItemLike {
  storeId: string
  orderId: string
  placedAt: string | null
  receivedAt: string
}

export interface FeedBaseline {
  /** selectionKey() of the answer the baseline was taken from. */
  key: string
  seen: Set<string>
}

/** A sale older than this is history, not news, even if it was never seen. */
export const FRESH_SALE_MS = 2 * 60 * 60_000
const MAX_SEEN = 600

export const feedId = (o: Pick<FeedItemLike, 'storeId' | 'orderId'>) => `${o.storeId}|${o.orderId}`

export function diffFeed(
  prev: FeedBaseline | null, key: string, items: readonly FeedItemLike[], alreadyAnnounced: ReadonlySet<string>, now: number,
): { baseline: FeedBaseline; fresh: string[] } {
  const ids = items.map(feedId)
  if (!prev || prev.key !== key) return { baseline: { key, seen: new Set(ids) }, fresh: [] }
  const fresh = items
    .filter(o => {
      const id = feedId(o)
      if (prev.seen.has(id) || alreadyAnnounced.has(id)) return false
      const at = Date.parse(o.placedAt ?? o.receivedAt)
      return Number.isFinite(at) && now - at <= FRESH_SALE_MS
    })
    .map(feedId)
  const seen = new Set([...prev.seen, ...ids])
  // Keep the newest ids only: the feed shows 40, the set must not grow forever.
  const trimmed = seen.size > MAX_SEEN ? new Set([...seen].slice(-MAX_SEEN)) : seen
  return { baseline: { key, seen: trimmed }, fresh }
}

/** Whether a sale of `storeId` belongs to what is on screen ('todas' or one id). */
export function inScope(loja: string, storeId: string | null | undefined, activeIds: ReadonlySet<string>): boolean {
  if (!storeId) return false
  return loja === 'todas' ? activeIds.has(storeId) : loja === storeId
}
