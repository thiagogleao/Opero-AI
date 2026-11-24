/**
 * The phone's selection as an external store (useSyncExternalStore), backed
 * by the URL and localStorage.
 *
 * The server cannot know what the owner picked last (that lives on the phone),
 * so the server snapshot is null and the first client render resolves the
 * view from the URL, then storage, then the default. From then on only a tap
 * (`setView`) or a notification tap changes it; a poll or a late answer never
 * does, because nothing else writes here. The one exception is the calendar:
 * dates a store row opened give way to the owner's preset once Todas' day
 * moves on (`revalidate`, on the clock tick).
 */

import { todayInTz } from '@/lib/engine/dates'
import {
  clampSelection, expireRowDates, linkRangeNotice, rawFromSearch, rawFromStorage, resolveView, selectionTz, STORAGE_KEY, todasRangeAt,
  toSearch, toStorage, unknownLinkStore, type StoreClock, type ViewState,
} from './selection'

let current: ViewState | null = null
let knownStore: (id: string) => boolean = () => false
/** Today on the calendar the selection is read on (selectionTz). */
let todayOf: ((loja: string) => string) | undefined
/** The active stores' clocks, for Todas' calendar (todasRangeAt). */
let activeClocks: readonly StoreClock[] = []
/** The launch URL named a store the owner cannot open (takeLinkNotice). */
let linkStoreMissing = false
/** The last link's custom range was cut before asking (takeLinkRangeNotice). */
let linkRangeNote: string | null = null
const listeners = new Set<() => void>()

/** Which stores may be opened (active and archived) and their clocks. Set
 *  before reading. */
export function configureStores(active: readonly StoreClock[], archived: readonly StoreClock[] = []) {
  const set = new Set([...active, ...archived].map(s => s.id))
  knownStore = id => set.has(id)
  todayOf = loja => todayInTz(selectionTz(loja, active, archived), new Date())
  activeClocks = active
}

const todasRange = () => todasRangeAt(activeClocks, new Date())

/** Every view that is stored goes through here: a custom range is clamped to
 *  the selected store's today, so switching from Hibikura (whose "today" is
 *  Brazil's tomorrow from noon on) to MOKOO or Todas cannot carry Tokyo's
 *  date into a Brazilian calendar — on screen, in the URL or in storage; and
 *  dates a store row opened last only while Todas is still on that day. */
function normalise(v: ViewState): ViewState {
  if (!todayOf) return v
  const sel = clampSelection(expireRowDates(v.sel, todasRange()), todayOf(v.sel.loja))
  return sel === v.sel ? v : { ...v, sel }
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
    const url = rawFromSearch(window.location.search)
    linkStoreMissing = unknownLinkStore(url, knownStore) !== null
    current = resolveView(url, storedRaw(), knownStore, todayOf, todasRange())
    linkRangeNote = todayOf ? linkRangeNotice(url, current.sel, todayOf(current.sel.loja)) : null
  }
  return current
}

export const getServerView = (): ViewState | null => null

export function subscribeView(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

export function setView(next: ViewState) {
  current = normalise(next)
  persist(current)
  for (const l of listeners) l()
}

/** Write the resolved view to the URL and storage once, after the first render. */
export function persistCurrent() {
  const v = getView()
  if (v) persist(v)
}

/** On the clock tick: row dates whose day is over give way to the preset
 *  (a "Hoje" keeps rolling to the new day). Nothing else ever changes here. */
export function revalidate() {
  const v = getView()
  if (v && normalise(v) !== v) setView(v)
}

/** Once: whether the launch URL named a store the owner cannot open, so the
 *  screen says it shows another store instead (as for a store gone 404). */
export function takeLinkNotice(): boolean {
  getView()
  const missing = linkStoreMissing
  linkStoreMissing = false
  return missing
}

/** Once: why the last link's custom range is not the one it asked for
 *  (selection linkRangeNotice), or null. The server never sees the uncut
 *  range, so its own rangeNote cannot say it. */
export function takeLinkRangeNotice(): string | null {
  getView()
  const note = linkRangeNote
  linkRangeNote = null
  return note
}

/** A notification tap on an open app: the service worker could not navigate
 *  it, so it posts the URL; take its loja/periodo/aba over the current view.
 *  Returns true when the URL's store could not be opened (the current one
 *  stays, and the screen must say so). */
export function applyUrl(url: string): boolean {
  let u: URL
  try { u = new URL(url, window.location.origin) } catch { return false }
  if (u.origin !== window.location.origin) return false
  const base = getView()
  const raw = rawFromSearch(u.search)
  const next = resolveView(raw, base ? JSON.parse(toStorage(base)) : storedRaw(), knownStore, todayOf, todasRange())
  linkRangeNote = todayOf ? linkRangeNotice(raw, next.sel, todayOf(next.sel.loja)) : null
  setView(next)
  return unknownLinkStore(raw, knownStore) !== null
}
