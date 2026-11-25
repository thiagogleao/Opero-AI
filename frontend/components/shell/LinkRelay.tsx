'use client'

/**
 * LinkRelay — the shell's click interception for period-aware links (R13).
 *
 * Every link inside the page content (a Todas row, Campanhas · Todas rows,
 * tabs, "Ver todos os produtos", Atribuição's "Todas as lojas"…) was rendered
 * with the selection on screen. A period, split or store picked a moment
 * before is still loading when such a link is clicked; following the href as
 * rendered dropped that pick (and the link, not registered as in flight, was
 * then cancelled by the next pick). This listener catches the click before
 * next/link handles it and opens the link laid over the latest REQUESTED URL
 * instead (./url relayed → lib/period relayLink + layer), registered as the
 * navigation in flight. One place for every link of every page: no page
 * builds its own click handler.
 *
 * Left alone: modified clicks (new tab), target=_blank, download links,
 * other origins and anything that is not a desktop page link (no `loja`, an
 * /api route) — those keep the browser's or next/link's behaviour.
 *
 * Also registers the viewer's archived stores for the shell's layer calls.
 */

import { useEffect } from 'react'
import { registerArchived, relayed } from './url'
import { useShellNavigation } from './useShellNavigation'

export function LinkRelay({ rootId, archivedIds }: { rootId: string; archivedIds: readonly string[] }) {
  const { push } = useShellNavigation()
  const key = archivedIds.join(',')
  useEffect(() => { registerArchived(key ? key.split(',') : []) }, [key])

  useEffect(() => {
    const root = document.getElementById(rootId)
    if (!root) return
    // Capture phase on the content root: it runs before React's delegated
    // onClick (next/link), which then sees defaultPrevented and stands down.
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || !root.contains(a)) return
      if ((a.target && a.target !== '_self') || a.hasAttribute('download')) return
      const url = new URL(a.href, window.location.href)
      if (url.origin !== window.location.origin) return
      // An anchor on this same page (#section) is not a navigation.
      if (url.hash && url.pathname === window.location.pathname && url.search === window.location.search) return
      const href = `${url.pathname}${url.search}${url.hash}`
      const next = relayed(href)
      if (next === href && !new URLSearchParams(url.search).has('loja')) return
      e.preventDefault()
      push(next)
    }
    root.addEventListener('click', onClick, true)
    return () => root.removeEventListener('click', onClick, true)
  }, [rootId, push])

  return null
}
