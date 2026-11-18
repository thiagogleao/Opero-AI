/**
 * The phone's selection as an external store (useSyncExternalStore), backed
 * by the URL and localStorage.
 *
 * The server cannot know what the owner picked last (that lives on the phone),
 * so the server snapshot is null and the first client render resolves the
 * view from the URL, then storage, then the default. From then on only a tap
 * (`setView`) or a notification tap changes it; a poll or a late answer never
 * does, because nothing else writes here.
 */

import { rawFromSearch, rawFromStorage, resolveView, STORAGE_KEY, toSearch, toStorage, type ViewState } from './selection'

let current: ViewState | null = null
let knownStore: (id: string) => boolean = () => false
const listeners = new Set<() => void>()

/** Which store ids may be opened (active and archived). Set before reading. */
export function configureStores(ids: readonly string[]) {
  const set = new Set(ids)
  knownStore = id => set.has(id)
}

function storedRaw() {
  try { return rawFromStorage(window.localStorage.getItem(STORAGE_KEY)) } catch { return {} }
}

function persist(v: ViewState) {
  try { window.localStorage.setItem(STORAGE_KEY, toStorage(v)) } catch { /* private mode: the URL still holds it */ }
  const search = `?${toSearch(v)}`
  if (window.location.search !== search) {
    // replaceState: switching stores should not fill the back button. The
    // state MUST be null: Next's router ignores a call that passes its own
    // history state (`__NA`) and would later restore the URL it knows.
    window.history.replaceState(null, '', `${window.location.pathname}${search}${window.location.hash}`)
  }
}

export function getView(): ViewState | null {
  if (current === null && typeof window !== 'undefined') {
    current = resolveView(rawFromSearch(window.location.search), storedRaw(), knownStore)
  }
  return current
}

export const getServerView = (): ViewState | null => null

export function subscribeView(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function setView(next: ViewState) {
  current = next
  persist(next)
  for (const l of listeners) l()
}

/** Write the resolved view to the URL and storage once, after the first render. */
export function persistCurrent() {
  const v = getView()
  if (v) persist(v)
}

/** A notification tap on an open app: the service worker could not navigate
 *  it, so it posts the URL; take its loja/periodo/aba over the current view. */
export function applyUrl(url: string) {
  let u: URL
  try { u = new URL(url, window.location.origin) } catch { return }
  if (u.origin !== window.location.origin) return
  const base = getView()
  const next = resolveView(rawFromSearch(u.search), base ? JSON.parse(toStorage(base)) : storedRaw(), knownStore)
  setView(next)
}
