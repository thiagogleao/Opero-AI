'use client'

/**
 * useShellNavigation — how the shell's controls (store picker, period picker,
 * split toggle, sidebar links) open a URL: router.push in a transition (so the
 * control can show a spinner until the page is there) that also registers the
 * URL as the one being opened (./url beginNavigation). A control used before
 * it lands lays its change on top of it (./url onTopOfInFlight) instead of on
 * the state still on screen.
 *
 *   const nav = useShellNavigation()
 *   const href = onTopOfInFlight(targetFromScreen, NAV_LAYER.period)
 *   nav.push(href)            // nav.pending: true until the page is there
 *
 * The registration ends when this control's transition ends, or when the
 * control leaves the screen (its page was replaced: the navigation landed).
 * A newer navigation from another control owns the slot from then on, and
 * ending an older one changes nothing.
 */

import { useRouter } from 'next/navigation'
import { useCallback, useEffect, useRef, useTransition } from 'react'
import { beginNavigation, endNavigation } from './url'

export function useShellNavigation(): { pending: boolean; push: (href: string) => void } {
  const router = useRouter()
  const [pending, startTransition] = useTransition()
  // A box, not the token itself: the unmount cleanup reads what is in it then.
  const mine = useRef<{ token: number | null }>({ token: null })

  useEffect(() => {
    const m = mine.current
    if (pending || m.token === null) return
    endNavigation(m.token)
    m.token = null
  }, [pending])

  useEffect(() => {
    const m = mine.current
    return () => { if (m.token !== null) endNavigation(m.token) }
  }, [])

  const push = useCallback((href: string) => {
    mine.current.token = beginNavigation(href)
    startTransition(() => { router.push(href) })
  }, [router])

  return { pending, push }
}
