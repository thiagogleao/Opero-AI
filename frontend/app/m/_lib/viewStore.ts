/**
 * The phone's state as an external store (useSyncExternalStore): only the
 * browser plumbing around lib/period/phone, which owns every rule (R16).
 *
 *  - localStorage 'opero.m.view.v3': the saved view (the owner's choices);
 *  - sessionStorage 'opero.m.visit': the visit an external link opened, with
 *    hiddenAt / lastSeenAt / closedStrip — never in localStorage;
 *  - the address bar mirrors the visit with window.history.replaceState only
 *    (Next 16 integrates native replaceState into its router: docs
 *    01-app/01-getting-started/04-linking-and-navigating.md, "Native History
 *    API"); never router.replace, never pushState, so Back never lands on a
 *    stateless /m.
 *
 * The server snapshot is null: the saved view lives on the phone. The clock
 * never changes the state (P1); only actions, links and facts do.
 *
 * The visit's hiddenAt / lastSeenAt are written and compared on the DEVICE
 * clock (deviceNow): a duration needs one clock, and the server offset does
 * not survive a reload (P6, R16).
 */

import { clientNow, deviceNow } from '@/lib/period/client/clock'
import {
  act, factsChange, LEGACY_SAVED_KEY, openApp, readSaved, SAVED_KEY, SESSION_KEY, toStorage, visitExpired,
  type NavType, type PhoneAction, type PhoneState, type SessionRecord,
} from '@/lib/period/phone'
import type { Note, ViewerStores } from '@/lib/period'

/** sessionStorage: the one-action strip on screen, so a reload shows the
 *  same screen until the next action (R16; the desktop keeps its landing
 *  note through `vem` on reloads). */
const STRIP_KEY = 'opero.m.strip'

let state: PhoneState | null = null
let viewer: ViewerStores | null = null
let session: SessionRecord | null = null
const listeners = new Set<() => void>()

const newId = () => Math.random().toString(36).slice(2, 10)

function notify() { for (const l of listeners) l() }

function readSession(): SessionRecord | null {
  try {
    const raw = sessionStorage.getItem(SESSION_KEY)
    const v = raw ? JSON.parse(raw) as SessionRecord : null
    return v && v.visit && typeof v.visit.url === 'string' ? v : null
  } catch { return null }
}

function writeSession() {
  try {
    if (!state?.visit) { sessionStorage.removeItem(SESSION_KEY); session = null; return }
    const nowIso = deviceNow().toISOString()
    session = {
      visit: state.visit,
      hiddenAt: session?.visit.id === state.visit.id ? session.hiddenAt : null,
      lastSeenAt: nowIso,
      closedStrip: state.closedStrip,
    }
    sessionStorage.setItem(SESSION_KEY, JSON.stringify(session))
  } catch { /* private mode: the visit lives in memory only */ }
}

function readStrip(): Note[] | null {
  try {
    const raw = sessionStorage.getItem(STRIP_KEY)
    const v = raw ? JSON.parse(raw) as unknown : null
    return Array.isArray(v) ? v.filter((n): n is Note => !!n && typeof (n as Note).code === 'string') : null
  } catch { return null }
}

function writeStrip() {
  try {
    if (state?.transient.length) sessionStorage.setItem(STRIP_KEY, JSON.stringify(state.transient))
    else sessionStorage.removeItem(STRIP_KEY)
  } catch { /* private mode: the strip lives in memory only */ }
}

function writeSaved() {
  if (!state) return
  try { localStorage.setItem(SAVED_KEY, toStorage(state.saved)) } catch { /* ignore */ }
}

function mirrorUrl() {
  const url = state?.visit ? state.visit.url : '/m'
  if (`${window.location.pathname}${window.location.search}` !== url) window.history.replaceState(null, '', url)
}

function navType(): NavType {
  try {
    const e = performance.getEntriesByType('navigation')[0] as PerformanceNavigationTiming | undefined
    const t = e?.type
    return t === 'navigate' || t === 'reload' || t === 'back_forward' || t === 'prerender' ? t : 'unknown'
  } catch { return 'unknown' }
}

function open(url: string, fromSwMessage: boolean, persisted = false) {
  if (!viewer) return
  const saved = readSaved(localStorage.getItem(SAVED_KEY), localStorage.getItem(LEGACY_SAVED_KEY), viewer)
  session = readSession()
  const opened = openApp({
    url, navType: navType(), fromSwMessage, persisted, session, saved: saved.saved, viewer, now: deviceNow(), newId,
    strip: readStrip(),
  })
  // One strip for the open: the saved view's own fallback and the link's.
  state = { ...opened.state, transient: [...saved.notes, ...opened.state.transient] }
  if (saved.migrated || saved.notes.length) writeSaved()
  writeSession()
  writeStrip()
  mirrorUrl()
  notify()
}

/** Set the store facts (from the page, then from every answer, R19). The
 *  first call opens the app from the current URL. A changed version applies
 *  R16's facts rows (a saved store archived → Todas; a visit store gone…). */
export function setFacts(next: ViewerStores): void {
  const prev = viewer
  const changed = !!prev && prev.version !== next.version
  viewer = next
  if (!prev) { open(`${window.location.pathname}${window.location.search}`, false); return }
  // R19: adopt, apply R16's facts rows and name the change (stores_changed).
  if (changed) dispatch({ type: 'facts', change: factsChange(prev, next) })
}

export function getFacts(): ViewerStores | null {
  return viewer
}

export function getState(): PhoneState | null {
  return state
}

export const getServerState = (): PhoneState | null => null

export function subscribe(cb: () => void): () => void {
  listeners.add(cb)
  return () => { listeners.delete(cb) }
}

/** The only writer after opening: an owner action (R16 transitions), with
 *  its R4 strip computed by lib/period/phone act on the server-corrected
 *  clock. */
export function dispatch(action: PhoneAction): void {
  if (!state || !viewer) return
  const next = act(state, action, viewer, clientNow(), newId)
  if (next === state) return
  state = next
  if (action.type !== 'storage') writeSaved()
  writeSession()
  writeStrip()
  mirrorUrl()
  notify()
}

/** The service worker posted {type:'navigate', url}: always a fresh open (R17). */
export function applySwNavigate(url: string): void {
  open(url, true)
}


/** Re-read the saved view (another window changed it; or we resume). */
export function rereadSaved(): void {
  if (!viewer || !state) return
  const saved = readSaved(localStorage.getItem(SAVED_KEY), null, viewer).saved
  dispatch({ type: 'storage', saved })
}

/** visibilitychange → hidden. */
export function markHidden(): void {
  if (!session) return
  session = { ...session, hiddenAt: deviceNow().toISOString() }
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)) } catch { /* ignore */ }
}

/**
 * visibilitychange → visible / pageshow: a visit hidden for 30 minutes or more
 * is gone (the expiry applies only to a restore, R16); the saved view is
 * re-read (storage events fired while frozen are not replayed).
 */
export function markVisible(persisted = false): void {
  if (persisted) { open(`${window.location.pathname}${window.location.search}`, false, true); return }
  if (session?.hiddenAt && state?.visit && visitExpired(session, deviceNow())) {
    dispatch({ type: 'expire' })
  } else if (session) {
    session = { ...session, hiddenAt: null, lastSeenAt: deviceNow().toISOString() }
    try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)) } catch { /* ignore */ }
  }
  rereadSaved()
}

/** Every 60 s while visible. */
export function touch(): void {
  if (!session) return
  session = { ...session, lastSeenAt: deviceNow().toISOString() }
  try { sessionStorage.setItem(SESSION_KEY, JSON.stringify(session)) } catch { /* ignore */ }
}
