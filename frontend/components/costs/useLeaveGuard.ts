'use client'

import { useEffect } from 'react'

/**
 * Warn before leaving with unsaved changes: the browser's own prompt on
 * reload/close/external links, and a confirm on in-app links to another page
 * or another store, and on picking another store in the shell's store picker.
 * Links that stay on this page and this store (a #section, another period)
 * are not leaving: the editor keeps the draft across a period change.
 *
 * The store picker navigates by code (router.push), so its choice is caught
 * before React sees it, by the picker's accessible contract: a listbox named
 * "Escolha a loja" whose current store is the option with aria-selected=true.
 * If that contract changes the confirm silently stops, but nothing is lost:
 * the editor also keeps the draft in sessionStorage and offers it back.
 */
let leaving = false

const STORE_LIST = 'ul[role="listbox"][aria-label="Escolha a loja"]'

/** For a reload the screen itself offers (after a save conflict): the draft is
 *  already in sessionStorage, so asking "sair mesmo assim?" there is noise. */
export function leaveWithoutAsking() {
  leaving = true
}

export function useLeaveGuard(active: boolean, message: string) {
  useEffect(() => {
    if (!active) return
    const onBeforeUnload = (e: BeforeUnloadEvent) => {
      if (leaving) return
      e.preventDefault()
      // Chrome still needs returnValue set to show its prompt.
      e.returnValue = ''
    }
    const onClick = (e: MouseEvent) => {
      if (e.defaultPrevented || e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return
      const a = (e.target as Element | null)?.closest?.('a[href]') as HTMLAnchorElement | null
      if (!a || a.target === '_blank' || a.hasAttribute('download')) return
      const to = new URL(a.href, window.location.href)
      if (to.origin !== window.location.origin) return // beforeunload covers it
      const here = new URL(window.location.href)
      const sameStore = (to.searchParams.get('loja') ?? '') === (here.searchParams.get('loja') ?? '')
      if (to.pathname === here.pathname && sameStore) return
      if (!window.confirm(message)) e.preventDefault()
    }
    // Capture phase on the document runs before React's own listeners on the
    // app root, so stopping here keeps the picker from navigating at all.
    const onPickStore = (e: MouseEvent | KeyboardEvent) => {
      const target = e.target as Element | null
      const list = target?.closest?.(STORE_LIST)
      if (!list) return
      let option: Element | null
      if (e instanceof KeyboardEvent) {
        if (e.key !== 'Enter' && e.key !== ' ') return
        const id = list.getAttribute('aria-activedescendant')
        option = id ? document.getElementById(id) : null
      } else {
        option = target!.closest('[role="option"]')
      }
      if (!option || option.getAttribute('aria-selected') === 'true') return
      if (!window.confirm(message)) { e.preventDefault(); e.stopPropagation() }
    }
    window.addEventListener('beforeunload', onBeforeUnload)
    document.addEventListener('click', onClick, true)
    document.addEventListener('click', onPickStore, true)
    document.addEventListener('keydown', onPickStore, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('click', onPickStore, true)
      document.removeEventListener('keydown', onPickStore, true)
    }
  }, [active, message])
}
