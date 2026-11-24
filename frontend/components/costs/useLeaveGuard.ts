'use client'

import { useEffect } from 'react'

/**
 * Warn before leaving with unsaved changes: the browser's own prompt on
 * reload/close/external links, and a confirm on in-app links to another page
 * or another store, and on picking another store in the shell's store picker.
 * Links that stay on this page and this store (a #section, another period)
 * are not leaving: the editor keeps the draft across a period change.
 *
 * The shell's pickers navigate by code (router.push), so links cannot catch
 * them. They announce a change with a cancelable window event first:
 *  - 'opero:before-store-change' (StorePicker): another store unmounts this
 *    editor, so it asks, and preventDefault() keeps the person here; picking
 *    the store already on screen (pinning it from Todas) is not leaving
 *    (storeChangeLeaves);
 *  - 'opero:before-period-change' (PeriodPicker): the editor stays mounted and
 *    the draft is re-priced for the new window (PE18), so a period change on
 *    this page and store is not leaving and goes through without a prompt. It
 *    asks only when the event's detail names a destination (href/to/url) on
 *    another page or store.
 *
 * Fallback until the store event exists: the picker's accessible contract — a
 * listbox named "Escolha a loja" whose current store is the option with
 * aria-selected=true — caught in the capture phase. It stands down for good
 * once the event has been seen, and a choice it already confirmed is not
 * asked again by the event that follows it. If neither works the confirm
 * silently stops, but nothing is lost: the draft stays in sessionStorage and
 * is offered back.
 */
let leaving = false

const STORE_LIST = 'ul[role="listbox"][aria-label="Escolha a loja"]'
export const BEFORE_STORE_CHANGE = 'opero:before-store-change'
export const BEFORE_PERIOD_CHANGE = 'opero:before-period-change'

/** The shell dispatches BEFORE_STORE_CHANGE: the markup fallback is not needed. */
let storeEventSeen = false
/** The fallback asked and the person chose to leave: the event right behind it
 *  (same click) must not ask a second time. */
let fallbackConfirmedAt = -Infinity
const SAME_CHOICE_MS = 1500

/** For a reload the screen itself offers (after a save conflict): the draft is
 *  already in sessionStorage, so asking "sair mesmo assim?" there is noise. */
export function leaveWithoutAsking() {
  leaving = true
}

/** Where a picker event says it is going, when its detail says so. */
export function eventDestination(e: Event, base: string): URL | null {
  const d = (e as CustomEvent<unknown>).detail
  if (!d || typeof d !== 'object') return null
  const rec = d as Record<string, unknown>
  const raw = [rec.href, rec.to, rec.url].find((v): v is string => typeof v === 'string' && v.length > 0)
  if (!raw) return null
  try { return new URL(raw, base) } catch { return null }
}

/** The store id a URL names in ?loja; null when it names none: a missing ?loja,
 *  and 'todas' (this page shows one store at a time and reads Todas the same
 *  way), both open the store this browser remembers. */
function namedStore(u: URL): string | null {
  const id = u.searchParams.get('loja')
  return id && id !== 'todas' ? id : null
}

/**
 * Leaving = another page or another store; a new period or #hash is not.
 *
 * The store is compared as resolved, not as the raw ?loja: /profit opened with
 * no ?loja (or ?loja=todas) shows the remembered store, while every link the
 * shell builds (period buttons, the "Custos" item) names it (loja=<id>), so a
 * raw comparison saw '' vs id and asked on a plain period change. The store on
 * screen (`shownStoreId`) is what `here` shows; a destination that names no
 * store opens the remembered one, which is the store on screen only when this
 * page was opened the same way (no store named either); otherwise it could be
 * another store, so it counts as leaving.
 */
export function leavesEditor(to: URL, here: URL, shownStoreId: string): boolean {
  if (to.pathname !== here.pathname) return true
  const target = namedStore(to) ?? (namedStore(here) === null ? shownStoreId : null)
  return target !== shownStoreId
}

/**
 * Whether a store picker announcement ('opero:before-store-change', detail
 * { from, to, href }) leaves the editor showing `shownStoreId`.
 *
 * On a one-store page opened from Todas the picker lets the person pick the
 * store already on screen, to pin it (shell/url pickIsNoop): only ?loja changes
 * from 'todas' to that id, the editor (keyed by store id) stays mounted with its
 * draft, so asking "Sair mesmo assim?" there was false. The destination is read
 * from detail.href when there is one (the same rule as links: another page or
 * another store leaves), else from detail.to (a store id). An event that says
 * neither may go anywhere, so it still counts as leaving.
 */
export function storeChangeLeaves(e: Event, here: URL, shownStoreId: string): boolean {
  const d = (e as CustomEvent<unknown>).detail
  if (!d || typeof d !== 'object') return true
  const rec = d as Record<string, unknown>
  if (typeof rec.href === 'string' && rec.href.length > 0) {
    try { return leavesEditor(new URL(rec.href, here), here, shownStoreId) } catch { /* unreadable href: try detail.to */ }
  }
  if (typeof rec.to === 'string' && rec.to.length > 0) return rec.to !== shownStoreId
  return true
}

/** `storeId`: the store the editor shows (the page resolved it from the URL or
 *  the remembered store), so links naming it are not leaving. */
export function useLeaveGuard(active: boolean, message: string, storeId: string) {
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
      if (!leavesEditor(to, new URL(window.location.href), storeId)) return
      if (!window.confirm(message)) e.preventDefault()
    }

    // The shell's announcements.
    const onStoreChange = (e: Event) => {
      storeEventSeen = true
      if (performance.now() - fallbackConfirmedAt < SAME_CHOICE_MS) { fallbackConfirmedAt = -Infinity; return }
      if (!storeChangeLeaves(e, new URL(window.location.href), storeId)) return
      if (!window.confirm(message)) e.preventDefault()
    }
    const onPeriodChange = (e: Event) => {
      const to = eventDestination(e, window.location.href)
      if (!to || !leavesEditor(to, new URL(window.location.href), storeId)) return
      if (!window.confirm(message)) e.preventDefault()
    }

    // Fallback: capture phase on the document runs before React's own
    // listeners on the app root, so stopping here keeps the picker from
    // navigating at all.
    const onPickStore = (e: MouseEvent | KeyboardEvent) => {
      if (storeEventSeen) return
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
      if (window.confirm(message)) fallbackConfirmedAt = performance.now()
      else { e.preventDefault(); e.stopPropagation() }
    }

    window.addEventListener('beforeunload', onBeforeUnload)
    window.addEventListener(BEFORE_STORE_CHANGE, onStoreChange)
    window.addEventListener(BEFORE_PERIOD_CHANGE, onPeriodChange)
    document.addEventListener('click', onClick, true)
    document.addEventListener('click', onPickStore, true)
    document.addEventListener('keydown', onPickStore, true)
    return () => {
      window.removeEventListener('beforeunload', onBeforeUnload)
      window.removeEventListener(BEFORE_STORE_CHANGE, onStoreChange)
      window.removeEventListener(BEFORE_PERIOD_CHANGE, onPeriodChange)
      document.removeEventListener('click', onClick, true)
      document.removeEventListener('click', onPickStore, true)
      document.removeEventListener('keydown', onPickStore, true)
    }
  }, [active, message, storeId])
}
