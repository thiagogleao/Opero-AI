'use client'

/**
 * useTurnWatcher (R8): refreshes a screen when its day turns, the same on the
 * desktop (router.refresh) and the phone (refetch).
 *
 * One timer for nextTurnAt + 2 s on the server's clock (clientNow), plus a
 * re-check on visibilitychange → visible, online, pageshow (bfcache included),
 * popstate, mount, and at least every 5 minutes (background timers are
 * throttled). A re-check refreshes only when the local resolution differs
 * from the one shown (`differs`) or nextTurnAt has passed, and the guard
 * (turnGuard.ts) bounds the refreshes per turn. While a form is dirty the
 * refresh is deferred and `onDeferred` lets the page say "O dia virou".
 */

import { useEffect, useRef } from 'react'
import { clientNowMs } from './clock'
import { initialGuard, shouldRefresh, type GuardState } from './turnGuard'

export interface TurnWatcherOptions {
  /** Resolution.nextTurnAt of what is shown; null disables the watcher. */
  nextTurnAt: string | null
  /** Re-resolve locally and say whether it differs from what is shown. */
  differs?: () => boolean
  onTurn: () => void
  isDirty?: () => boolean
  onDeferred?: () => void
}

export function useTurnWatcher(o: TurnWatcherOptions): void {
  const opts = useRef(o)
  useEffect(() => { opts.current = o })
  const guard = useRef<GuardState>(initialGuard)

  useEffect(() => {
    const at = o.nextTurnAt
    if (!at) return
    let timer: ReturnType<typeof setTimeout> | null = null
    let stopped = false
    const check = () => {
      if (stopped) return
      if (timer) clearTimeout(timer)
      const cur = opts.current
      const differs = cur.differs ? cur.differs() : false
      const r = shouldRefresh(guard.current, at, clientNowMs(), differs)
      guard.current = r.state
      if (r.refresh) {
        if (cur.isDirty?.()) cur.onDeferred?.()
        else cur.onTurn()
      }
      timer = setTimeout(check, r.checkInMs)
    }
    const onVisible = () => { if (document.visibilityState === 'visible') check() }
    check()
    document.addEventListener('visibilitychange', onVisible)
    window.addEventListener('online', check)
    window.addEventListener('pageshow', check)
    window.addEventListener('popstate', check)
    return () => {
      stopped = true
      if (timer) clearTimeout(timer)
      document.removeEventListener('visibilitychange', onVisible)
      window.removeEventListener('online', check)
      window.removeEventListener('pageshow', check)
      window.removeEventListener('popstate', check)
    }
  }, [o.nextTurnAt])
}
