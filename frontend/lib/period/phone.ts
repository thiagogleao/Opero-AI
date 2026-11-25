/**
 * R16: the phone (/m) — saved view, visits, chips, rows, the strip.
 *
 * The saved view is the owner's own choice (localStorage). A *visit* is what
 * an external link opened (a push, a deep link, an archived store from
 * Ajustes): it lives in sessionStorage only, NEVER in localStorage, and the
 * clock never changes it. Shown = visit's fields over the saved view's.
 *
 * Whether a load is a fresh open or a restore is decided by how the page was
 * reached (navigation type, service-worker message, the push nonce), never by
 * the URL alone (C1-2, C2-H1). The 30-minute expiry applies only to restores.
 */

import { isIsoDate } from '../engine/dates'
import { announce, sameScope } from './carry'
import { anchorOf } from './clock'
import { membersHash, parseLegacyPush } from './push'
import { findStore, membersOf, resolve } from './resolve'
import { notesText, withoutAbsorbed } from './notes'
import { tzCity } from '../format'
import { legacyDates } from './url'
import { defaultPeriod, isPreset, parsePeriod, periodParams, preset, samePeriod, valueName } from './value'
import type { Instant, Note, NoteCode, PeriodValue, Resolution, Selection, ViewerStores } from './types'

export const ALL = 'todas'
export const SAVED_KEY = 'opero.m.view.v3'
export const LEGACY_SAVED_KEY = 'opero.m.selecao.v2'
export const SESSION_KEY = 'opero.m.visit'
/** A restore after the app was hidden this long drops the visit. */
export const VISIT_EXPIRY_MS = 30 * 60_000

export const PHONE_TABS = ['campanhas', 'criativos', 'produtos', 'paises', 'clientes'] as const
export type Tab = (typeof PHONE_TABS)[number]
export const isTab = (v: unknown): v is Tab => typeof v === 'string' && (PHONE_TABS as readonly string[]).includes(v)

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/
const NONCE_RE = /^[a-z0-9]{1,16}$/

export interface SavedView { v: 3; loja: string; period: PeriodValue; aba: Tab | null }

export interface Visit {
  /** Random, new on every FRESH open; keys the strip's ×. */
  id: string
  source: 'push' | 'link' | 'archive'
  /** The push link's nonce `n`. */
  pushId: string | null
  /** Absent only for a legacy push with no store. */
  loja?: string
  /** A push always has dates (except legacy undated pushes). */
  period?: PeriodValue
  aba?: Tab
  /** Legacy push with no date: the strip says so. */
  undated?: boolean
  /** Canonical URL of the visit as now shown (toUrl). */
  url: string
}

/** hiddenAt / lastSeenAt are DEVICE-clock instants, compared only with the
 *  device clock (visitExpired): the server offset lives in memory and starts
 *  at 0 on a reload, so a server-corrected time written before a reload and a
 *  raw device time read after it disagreed by the phone's skew (a clock 2 h
 *  fast dropped a push visit 12 s later; 2 h slow kept one hidden 40 min). */
export interface SessionRecord { visit: Visit; hiddenAt: Instant | null; lastSeenAt: Instant; closedStrip: boolean }

export interface PhoneState {
  saved: SavedView
  visit: Visit | null
  /** The strip's × for this visit id. */
  closedStrip: boolean
  /** The one-action strip (scope_dates_differ, notes). */
  transient: Note[]
}

export const DEFAULT_SAVED: SavedView = { v: 3, loja: ALL, period: defaultPeriod('phone'), aba: null }

// ─── Saved view (localStorage) ───────────────────────────────────────────────

function periodFromJson(p: unknown): PeriodValue | null {
  if (!p || typeof p !== 'object') return null
  const o = p as Record<string, unknown>
  if (o.kind === 'preset' && isPreset(o.preset)) return preset(o.preset)
  if (o.kind === 'dates' && isIsoDate(o.from) && isIsoDate(o.to)) return parsePeriod({ periodo: 'custom', de: o.from, ate: o.to }).value
  return null
}

const lojaOk = (loja: unknown, viewer: ViewerStores): loja is string =>
  loja === ALL || (typeof loja === 'string' && ID_RE.test(loja) && viewer.active.some(s => s.id === loja))

/**
 * The saved view, fully validated: an unknown or archived loja → 'todas' +
 * note saved_store_gone; a bad period → Hoje. Migrated once from v2 (period
 * and aba always; loja only if it is an active store — v2 may hold a store a
 * push chose, accepted once, C2-L7). After the move v2 is never read again.
 */
export function readSaved(v3: string | null, v2: string | null, viewer: ViewerStores): { saved: SavedView; migrated: boolean; notes: Note[] } {
  const notes: Note[] = []
  let raw: Record<string, unknown> | null = null
  try { raw = v3 ? JSON.parse(v3) : null } catch { raw = null }
  if (raw && raw.v === 3) {
    const loja = lojaOk(raw.loja, viewer) ? raw.loja : ALL
    if (loja !== raw.loja && typeof raw.loja === 'string') {
      const st = ID_RE.test(raw.loja) ? findStore(viewer, raw.loja) : null
      notes.push({ code: 'saved_store_gone', params: { store: st?.name ?? 'A loja salva' } })
    }
    return { saved: { v: 3, loja, period: periodFromJson(raw.period) ?? defaultPeriod('phone'), aba: isTab(raw.aba) ? raw.aba : null }, migrated: false, notes }
  }
  let old: Record<string, unknown> | null = null
  try { old = v2 ? JSON.parse(v2) : null } catch { old = null }
  if (old) {
    const p = parsePeriod({ periodo: typeof old.periodo === 'string' ? old.periodo : null, de: typeof old.de === 'string' ? old.de : null, ate: typeof old.ate === 'string' ? old.ate : null })
    const loja = lojaOk(old.loja, viewer) ? old.loja : ALL
    let period = p.value ?? defaultPeriod('phone')
    // The same validation as v3 (R16): a migrated store that is archived or
    // gone falls back to Todas WITH the note, never silently.
    if (loja !== old.loja && typeof old.loja === 'string' && old.loja !== ALL && old.loja !== '') {
      const st = ID_RE.test(old.loja) ? findStore(viewer, old.loja) : null
      notes.push({ code: 'saved_store_gone', params: { store: st?.name ?? 'A loja salva' } })
      // An archived store's consultation period was never the owner's choice
      // and does not follow him to Todas (R4/R10, C1-7): the phone default,
      // said as when leaving an archived store (left_archive).
      if (st?.archivedOn && !samePeriod(period, defaultPeriod('phone'))) {
        period = defaultPeriod('phone')
        notes.push({ code: 'left_archive', params: { period: valueName(period) } })
      }
    }
    return {
      saved: { v: 3, loja, period, aba: isTab(old.aba) ? old.aba : null },
      migrated: true, notes,
    }
  }
  return { saved: DEFAULT_SAVED, migrated: false, notes }
}

export function toStorage(saved: SavedView): string {
  return JSON.stringify(saved)
}

// ─── Links ───────────────────────────────────────────────────────────────────

export interface PhoneLink {
  source: Visit['source']
  pushId: string | null
  loja?: string
  period?: PeriodValue
  aba?: Tab
  undated?: boolean
}

/**
 * A /m?… URL (R15 phone column, R17 legacy forms). Precedence: `dia` (legacy
 * push) first, `volta` ignored; a preset; custom dates; `volta` alone; else no
 * period field. A store the viewer does not have drops the whole link (store,
 * period, tab) with unknown_store: a link's day is never shown on another
 * store (L113). Returns null link for bare /m.
 *
 * Legacy `volta` beside dates (an old address bar written by the row-dates
 * code) follows R15 step 4 as the desktop does: dates equal to what `volta`
 * resolves to at `now` (the link's clock or Brasília's) mean that preset.
 * Without `now` the dates are kept.
 */
export function parsePhoneLink(search: string, viewer: ViewerStores, now?: Date): { link: PhoneLink | null; notes: Note[] } {
  const q = new URLSearchParams(search.startsWith('?') ? search.slice(1) : search)
  const get = (k: string) => { const v = q.get(k); return v && v.trim() ? v.trim() : null }
  if (![...q.keys()].some(k => ['loja', 'periodo', 'de', 'ate', 'aba', 'origem', 'dia', 'volta', 'n'].includes(k))) return { link: null, notes: [] }
  const notes: Note[] = []
  const origem = get('origem')
  const dia = get('dia')
  const volta = get('volta')
  const legacyPush = dia !== null
  // 'archive' only when the link's store IS archived in the facts (below):
  // origem=arquivo on an active store (a store unarchived since, a forged or
  // old address) is a plain link visit, so the strip never calls a live,
  // polled store "arquivada … sem sincronização" (R10, R15).
  let source: Visit['source'] = origem === 'push' || legacyPush ? 'push' : 'link'
  const pushId = get('n') && NONCE_RE.test(get('n')!) ? get('n') : null

  // ── store ──
  let loja: string | undefined
  const rawLoja = get('loja')
  if (rawLoja) {
    if (rawLoja === ALL) {
      if (viewer.allowsAll) loja = ALL
      else if (viewer.active[0]) { loja = viewer.active[0].id; notes.push({ code: 'single_store', params: { store: viewer.active[0].name } }) }
    } else {
      const st = ID_RE.test(rawLoja) ? findStore(viewer, rawLoja) : null
      if (!st) return { link: null, notes: [{ code: 'unknown_store' }] }
      loja = st.id
      if (st.archivedOn) source = 'archive'
    }
  }

  // ── period ──
  let period: PeriodValue | undefined
  let undated = false
  if (legacyPush) {
    const lp = parseLegacyPush({ periodo: get('periodo'), de: get('de'), ate: get('ate'), dia, volta })
    if (lp.value) period = lp.value
    undated = lp.undated
    // A legacy link's cut is announced like any other link's (R9, P5).
    notes.push(...lp.notes.map(code => ({ code })))
  } else {
    const parsed = parsePeriod({ periodo: get('periodo'), de: get('de'), ate: get('ate') })
    // Every note of the parse travels, also when a value came out of it: a
    // range cut to 366 days (too_long) or raised to 2000 (floor) is announced
    // on open, never cut silently (R9, P5). The value carried is already the
    // normalised one, so the server cannot see the cut by itself.
    notes.push(...parsed.notes.map(code => ({ code })))
    if (parsed.value) {
      period = parsed.value
      if (now && period.kind === 'dates' && isPreset(volta)) {
        const scope = loja === undefined ? null : loja === ALL ? { kind: 'all' as const } : { kind: 'store' as const, id: loja }
        const tz = anchorOf(scope ? membersOf({ scope }, viewer).map(s => s.tz) : [])
        period = legacyDates(period, volta, tz, now)
      }
    } else if (isPreset(volta)) period = preset(volta)
    // Only a real legacy push has no date: one written by this code always
    // carries its nonce `n`, and a push visit whose period the owner replaced
    // keeps `n` in its URL — a fresh open of that address is not "Notificação
    // antiga, sem data" (R16 visit identity, R17).
    if (source === 'push' && !period && !pushId) undated = true
  }

  const abaRaw = get('aba')
  const aba = isTab(abaRaw) ? abaRaw : undefined
  const m = get('m')
  if (m && /^[a-z0-9]{1,12}$/.test(m) && loja === ALL && m !== membersHash(viewer.active.map(s => s.id))) {
    notes.push({ code: 'members_changed' })
  }
  return { link: { source, pushId, loja, period, aba, ...(undated ? { undated: true } : {}) }, notes }
}

/** The canonical URL of a visit (the address-bar mirror). */
export function toUrl(v: Omit<Visit, 'url' | 'id'>): string {
  const q = new URLSearchParams()
  if (v.loja) q.set('loja', v.loja)
  if (v.period) {
    const p = periodParams(v.period)
    q.set('periodo', p.periodo)
    if (p.de && p.ate) { q.set('de', p.de); q.set('ate', p.ate) }
  }
  if (v.aba) q.set('aba', v.aba)
  q.set('origem', v.source === 'push' ? 'push' : v.source === 'archive' ? 'arquivo' : 'link')
  if (v.pushId) q.set('n', v.pushId)
  return `/m?${q.toString()}`
}

function makeVisit(link: PhoneLink, id: string): Visit {
  const base: Omit<Visit, 'url'> = {
    id, source: link.source, pushId: link.pushId,
    ...(link.loja !== undefined ? { loja: link.loja } : {}),
    ...(link.period ? { period: link.period } : {}),
    ...(link.aba ? { aba: link.aba } : {}),
    ...(link.undated ? { undated: true } : {}),
  }
  return { ...base, url: toUrl(base) }
}

function withUrl(v: Visit): Visit {
  return { ...v, url: toUrl(v) }
}

/** A link with every field equal to the saved view opens no visit (R16). */
function equalsSaved(link: PhoneLink, saved: SavedView): boolean {
  return (link.loja === undefined || link.loja === saved.loja)
    && (!link.period || samePeriod(link.period, saved.period))
    && (link.aba === undefined || link.aba === saved.aba)
}

// ─── Opening the app ─────────────────────────────────────────────────────────

export type NavType = 'navigate' | 'reload' | 'back_forward' | 'prerender' | 'unknown'

export interface OpenInput {
  /** location.pathname + search. */
  url: string
  navType: NavType
  /** The SW posted {type:'navigate', url}. */
  fromSwMessage: boolean
  /** pageshow.persisted (bfcache). */
  persisted?: boolean
  session: SessionRecord | null
  saved: SavedView
  viewer: ViewerStores
  now: Date
  newId: () => string
  /** The one-action strip as it was before this load (sessionStorage): a
   *  reload or back/forward shows the screen unchanged, strip included (R16:
   *  "reload after every transition shows the same screen"); a fresh open
   *  does not bring it back. */
  strip?: Note[] | null
}

export interface Opened {
  state: PhoneState
  /** What the address bar should read (replaceState). */
  url: string
  notes: Note[]
  /** 'fresh' | 'restore' | 'bare' — for tests and logs. */
  kind: 'fresh' | 'restore' | 'bare'
}

/** "MOKOO", "Todas as lojas": a saved loja by name. */
function storeName(loja: string, viewer: ViewerStores): string {
  return loja === ALL ? 'Todas as lojas' : findStore(viewer, loja)?.name ?? 'Todas as lojas'
}

/**
 * The notes of an opened link, filled with what is shown instead (§4, R15
 * ex. 2): "A loja do link não está disponível. Mostrando MOKOO.", "O período
 * do link não existe: mostrando Hoje." — the saved store and period. They
 * printed "Mostrando ." with no value.
 */
export function fillOpenNotes(notes: readonly Note[], saved: SavedView, viewer: ViewerStores): Note[] {
  return notes.map(n => {
    switch (n.code) {
      case 'unknown_store': return { code: n.code, params: { saved: storeName(saved.loja, viewer), ...n.params } }
      case 'bad_param':
      case 'incomplete': return { code: n.code, params: { period: valueName(saved.period), ...n.params } }
      default: return n
    }
  })
}

/** Codes a link's normalising leaves for the answer's fit sentence (R9). */
const LINK_FIT: readonly NoteCode[] = ['too_long', 'floor']

/**
 * The two strip texts of the phone (R9, R16): the answer's notes, with a
 * link's normalising notes (too_long, floor) folded into the same "Período
 * ajustado: …" sentence the desktop shows (R9 ex. 1), and the one-action
 * strip without them. `resolution` is the answer on screen (null while it
 * loads: the fit waits for it).
 */
export function stripNotes(
  transient: readonly Note[], resolution: Pick<Resolution, 'notes' | 'label'> | null, live?: LiveContext,
): { answer: string | null; transient: string | null } {
  const now = live ? liveTransient(transient, live) : transient.filter(n => !(n.code === 'scope_dates_differ' && !n.params?.text))
  const fit = now.filter(n => LINK_FIT.includes(n.code))
  const rest = now.filter(n => !LINK_FIT.includes(n.code))
  const range = resolution?.label.range ?? ''
  const filled = resolution ? fit.map(n => ({ code: n.code, params: { range, window: range } })) : []
  // A fit the one-action strip already says (an announcement that absorbs
  // future_end) is not said again in the answer's line (§4).
  const answerNotes = resolution ? withoutAbsorbed([...resolution.notes, ...filled], rest) : []
  return {
    answer: answerNotes.length ? notesText(answerNotes) : null,
    transient: rest.length ? notesText(rest) : null,
  }
}

/** What the one-action strip is read against: the state on screen, the
 *  adopted facts and the server-corrected clock (clientNow). */
export interface LiveContext { state: PhoneState; viewer: ViewerStores; now: Date }

/**
 * The one-action strip at THIS instant (R4, R8): a scope change is kept as
 * the scope it came from and announced again from what is shown now, so the
 * strip never names a Hoje the header no longer shows — after Brasília's
 * midnight Todas and Hibikura share 25 nov and it says nothing; restored by a
 * reload the next day it says that day's dates or nothing. Other notes pass.
 */
export function liveTransient(transient: readonly Note[], live: LiveContext): Note[] {
  return transient.flatMap(n => {
    if (n.code !== 'scope_dates_differ' || typeof n.params?.from !== 'string') return [n]
    const shown = shownSelection(live.state)
    const from = n.params.from === ALL ? { kind: 'all' as const } : { kind: 'store' as const, id: n.params.from }
    const a = announce({ ...shown, scope: from }, from, shown.scope, live.viewer, live.now)
    return a ? [{ code: n.code, params: a.absorbs.length ? { text: a.landing, absorbs: a.absorbs.join(',') } : { text: a.landing } }] : []
  })
}

/** Expired: hidden ≥ 30 min (hiddenAt, or lastSeenAt older than 30 min when
 *  hiddenAt is missing). `now` is the DEVICE clock, as the record's times. */
export function visitExpired(session: SessionRecord, now: Date): boolean {
  const ref = session.hiddenAt ?? session.lastSeenAt
  return now.getTime() - Date.parse(ref) >= VISIT_EXPIRY_MS
}

/**
 * The visit identity rule (R16). A fresh open of /m?… makes a NEW visit (new
 * id, so a strip closed for an earlier visit shows again) keeping every field
 * of the link. A restore keeps the same visit, id and × state, unless the app
 * was hidden 30 min or more.
 */
export function openApp(i: OpenInput): Opened {
  const u = new URL(i.url, 'http://x')
  const search = u.search
  const bare = !search || search === '?'
  const reloaded = !i.fromSwMessage && (i.navType === 'reload' || i.navType === 'back_forward' || !!i.persisted)
  const kept = reloaded ? i.strip ?? [] : []
  if (bare && !i.fromSwMessage) {
    return { state: { saved: i.saved, visit: null, closedStrip: false, transient: kept }, url: '/m', notes: [], kind: 'bare' }
  }
  const parsedLink = parsePhoneLink(search, i.viewer, i.now)
  const link = parsedLink.link
  const notes = fillOpenNotes(parsedLink.notes, i.saved, i.viewer)
  const canonicalHere = link ? toUrl(link) : '/m'
  const sv = i.session?.visit ?? null
  const n = link?.pushId ?? null
  const sameUrl = !!sv && sv.url === canonicalHere
  let fresh: boolean
  if (i.fromSwMessage) fresh = true
  else if (i.navType === 'navigate' || i.navType === 'prerender') fresh = !(i.persisted && sameUrl)
  else if (i.navType === 'unknown') fresh = n !== null ? n !== (sv?.pushId ?? null) || !sameUrl : !sameUrl
  else fresh = !sameUrl // reload / back_forward without the visit in session

  if (!fresh && sv && i.session) {
    if (visitExpired(i.session, i.now)) {
      return { state: { saved: i.saved, visit: null, closedStrip: false, transient: [] }, url: '/m', notes: [], kind: 'restore' }
    }
    return { state: { saved: i.saved, visit: sv, closedStrip: i.session.closedStrip, transient: kept }, url: sv.url, notes: [], kind: 'restore' }
  }
  if (!link) {
    return { state: { saved: i.saved, visit: null, closedStrip: false, transient: notes }, url: '/m', notes, kind: 'fresh' }
  }
  if (link.source === 'link' && equalsSaved(link, i.saved)) {
    return { state: { saved: i.saved, visit: null, closedStrip: false, transient: notes }, url: '/m', notes, kind: 'fresh' }
  }
  const visit = makeVisit(link, i.newId())
  return { state: { saved: i.saved, visit, closedStrip: false, transient: notes }, url: visit.url, notes, kind: 'fresh' }
}

// ─── Transitions ─────────────────────────────────────────────────────────────

/** `notes`: the one-action strip this action leaves (an R4 announcement on a
 *  chip or row, a "loja não disponível" on a fallback); every owner action
 *  replaces the strip, so it lasts until the next action (R4). */
export type PhoneAction =
  | { type: 'period'; period: PeriodValue }
  | { type: 'chip'; loja: string; notes?: Note[] }
  | { type: 'row'; loja: string; notes?: Note[] }
  | { type: 'tab'; aba: Tab | null }
  | { type: 'archive'; loja: string; period: PeriodValue }
  | { type: 'back'; notes?: Note[] }
  | { type: 'close_strip' }
  | { type: 'close_transient' }
  | { type: 'expire' }
  /** The server's facts were adopted (R19); `change` names what changed in
   *  the store set ("MOKOO foi arquivada"), lib/period/phone factsChange. */
  | { type: 'facts'; change?: string | null }
  | { type: 'storage'; saved: SavedView }

const isArchived = (viewer: ViewerStores, id: string) => viewer.archived.some(s => s.id === id)

/** After an owner action: a visit with no field left, or (link/push) whose
 *  remaining fields all equal the saved view by value, is dropped. */
function prune(visit: Visit | null, saved: SavedView): Visit | null {
  if (!visit) return null
  const has = visit.loja !== undefined || !!visit.period || visit.aba !== undefined
  if (!has) return null
  if (visit.source !== 'archive' && equalsSaved({ source: visit.source, pushId: visit.pushId, loja: visit.loja, period: visit.period, aba: visit.aba }, saved)) return null
  return withUrl(visit)
}

/**
 * The transition table of R16. Storage events and facts updates never shrink
 * a visit, so a visit always shows its own store (C1-5, C2-M1). Midnight,
 * Tokyo midnight and polls are not actions: only resolutions move.
 */
export function reduce(state: PhoneState, action: PhoneAction, viewer: ViewerStores, newId: () => string = () => Math.random().toString(36).slice(2, 10)): PhoneState {
  const { saved, visit } = state
  switch (action.type) {
    case 'period': {
      const nextSaved = { ...saved, period: action.period }
      const v = visit ? { ...visit } : null
      if (v) delete v.period
      if (v) delete v.undated
      const kept = prune(v, nextSaved)
      return { saved: nextSaved, visit: kept, closedStrip: kept ? state.closedStrip : false, transient: [] }
    }
    case 'chip': {
      // An archived store's chip exists only while it is on screen, and it
      // can never be saved: tapping it changes nothing (R5 "picking the store
      // already shown changes nothing"; R10). Dropping the visit fell back to
      // the saved view — another store — with no word.
      if (isArchived(viewer, action.loja)) return state
      return { saved: { ...saved, loja: action.loja }, visit: null, closedStrip: false, transient: action.notes ?? [] }
    }
    case 'row': {
      const transient = action.notes ?? []
      if (visit && visit.source === 'archive' && visit.loja !== action.loja) {
        // Leaving an archived store never carries its period (R4/R10): the
        // consultation ends and the tap is the owner's own, as outside a visit.
        return reduce({ saved, visit: null, closedStrip: false, transient: [] }, action, viewer, newId)
      }
      if (visit) {
        // A drill-down inside the visit: its period and tab stay, nothing is
        // saved. A visit left with nothing overridden is dropped (R16).
        const kept = prune({ ...visit, loja: action.loja }, saved)
        return { saved, visit: kept, closedStrip: kept ? state.closedStrip : false, transient }
      }
      if (isArchived(viewer, action.loja)) {
        const v = makeVisit({ source: 'archive', pushId: null, loja: action.loja }, newId())
        return { saved, visit: v, closedStrip: false, transient }
      }
      return { saved: { ...saved, loja: action.loja }, visit: null, closedStrip: false, transient }
    }
    case 'tab': {
      const nextSaved = { ...saved, aba: action.aba }
      const v = visit ? { ...visit } : null
      if (v) delete v.aba
      const kept = prune(v, nextSaved)
      // A tab pick is an owner action too: the one-action strip goes (R4).
      return { saved: nextSaved, visit: kept, closedStrip: kept ? state.closedStrip : false, transient: [] }
    }
    case 'archive': {
      const v = makeVisit({ source: 'archive', pushId: null, loja: action.loja, period: action.period }, newId())
      return { saved, visit: v, closedStrip: false, transient: [] }
    }
    case 'back':
      return { saved, visit: null, closedStrip: false, transient: action.notes ?? [] }
    case 'expire':
      return { saved, visit: null, closedStrip: false, transient: [] }
    case 'close_strip':
      return { ...state, closedStrip: true }
    case 'close_transient':
      return { ...state, transient: [] }
    case 'storage':
      return { ...state, saved: action.saved }
    case 'facts': {
      let nextSaved = saved
      const notes: Note[] = action.change ? [{ code: 'stores_changed', params: { change: action.change } }] : []
      if (saved.loja !== ALL && !viewer.active.some(s => s.id === saved.loja)) {
        const st = findStore(viewer, saved.loja)
        nextSaved = { ...saved, loja: ALL }
        notes.push({ code: 'saved_store_gone', params: { store: st?.name ?? 'A loja salva' } })
      }
      let v = visit
      if (v?.loja && v.loja !== ALL) {
        const st = findStore(viewer, v.loja)
        if (!st) { v = null; notes.push({ code: 'unknown_store', params: { saved: storeName(nextSaved.loja, viewer) } }) }
        else if (st.archivedOn && v.source !== 'archive') v = withUrl({ ...v, source: 'archive' })
        // Unarchived since (R10: live again from the next request): the visit
        // goes back to what opened it, a push (it kept its nonce) or a link,
        // and the archive line goes with it.
        else if (!st.archivedOn && v.source === 'archive') v = withUrl({ ...v, source: v.pushId ? 'push' : 'link' })
      }
      return { saved: nextSaved, visit: v, closedStrip: v ? state.closedStrip : false, transient: [...state.transient, ...notes] }
    }
  }
}

/**
 * An owner action with its one-action strip (R4, R10, R16): `reduce` plus the
 * announcement of a scope change, computed here from what was ON SCREEN
 * before the action and what is shown after it — never from the saved view
 * the owner was not looking at.
 *  - leaving an archived store (chip, row, link): note left_archive, its
 *    period is not carried;
 *  - the same period on another scope: scope_dates_differ (announce), when
 *    the target shows other dates or another comparison;
 *  - a chip that ends a visit brings back the owner's own period: the strip
 *    already promised it ("Os botões de loja no alto voltam para …"), so
 *    nothing is announced against dates that are no longer the question.
 * `now` is the server-corrected clock (clientNow).
 */
export function act(state: PhoneState, action: PhoneAction, viewer: ViewerStores, now: Date, newId?: () => string): PhoneState {
  const next = reduce(state, action, viewer, newId)
  if (action.type !== 'chip' && action.type !== 'row') return next
  if (next === state) return state
  const before = shownSelection(state)
  const after = shownSelection(next)
  const notes: Note[] = [...(action.notes ?? [])]
  if (!sameScope(before.scope, after.scope)) {
    const src = before.scope.kind === 'store' ? findStore(viewer, before.scope.id) : null
    if (src?.archivedOn) {
      // Only when the consultation's period was really dropped (P5): a
      // consultation already on the saved period loses nothing.
      if (!samePeriod(before.period, after.period)) notes.push({ code: 'left_archive', params: { period: resolve(after, viewer, now).label.short } })
    } else if (samePeriod(before.period, after.period) && announce(before, before.scope, after.scope, viewer, now)) {
      // Kept as its INPUT (the scope it came from), never as text: the strip
      // survives a reload (opero.m.strip) and the day turns under it, so its
      // words are computed again at each render (liveTransient), as the
      // desktop's landing note is from vem (R4, R8).
      notes.push({ code: 'scope_dates_differ', params: { from: before.scope.kind === 'all' ? ALL : before.scope.id } })
    }
  }
  return { ...next, transient: notes }
}

/** Whether a row tap pins the store (writes the saved view): outside a visit,
 *  or leaving an archived consultation. Inside any other visit it is a
 *  drill-down that saves nothing (R5, R16). */
export function rowTapPins(state: PhoneState): boolean {
  return !state.visit || state.visit.source === 'archive'
}

/** The store list's help line, true to what a tap does (R5/R16). */
export function rowHelp(state: PhoneState): string {
  if (rowTapPins(state)) return 'Toque numa loja para fixá-la.'
  const p = state.visit?.period
  if (!p) return 'Toque numa loja para vê-la sem fixá-la.'
  // "nesses dias" for dates; a preset is a period, not days (p1: Hoje).
  if (p.kind === 'preset') return 'Toque numa loja para vê-la nesse período, sem fixá-la.'
  return p.from === p.to ? 'Toque numa loja para vê-la nesse dia, sem fixá-la.' : 'Toque numa loja para vê-la nesses dias, sem fixá-la.'
}

/** The phone's store lists from the adopted facts (R19): the chips and the
 *  archived list follow a store archived (or restored) while the app is
 *  open, never the page's first props. */
export function storeOptions(viewer: ViewerStores): {
  active: { id: string; name: string; timezone: string; archived: boolean }[]
  archived: { id: string; name: string; timezone: string; archived: boolean }[]
} {
  return {
    active: viewer.active.map(s => ({ id: s.id, name: s.name, timezone: s.tz, archived: false })),
    archived: viewer.archived.map(s => ({ id: s.id, name: s.name, timezone: s.tz, archived: true })),
  }
}

/**
 * What changed in the store set between two facts versions (R19 note
 * stores_changed): "MOKOO foi arquivada", "Glooty voltou a ficar ativa",
 * "EPOCH foi conectada", "X foi removida". Null when only first dates moved
 * (nothing the owner needs told).
 */
export function factsChange(prev: ViewerStores, next: ViewerStores): string | null {
  const was = new Set([...prev.active, ...prev.archived].map(s => s.id))
  const is = new Set([...next.active, ...next.archived].map(s => s.id))
  const parts: string[] = []
  for (const s of next.archived) if (prev.active.some(x => x.id === s.id)) parts.push(s.name + ' foi arquivada')
  for (const s of next.active) if (prev.archived.some(x => x.id === s.id)) parts.push(s.name + ' voltou a ficar ativa')
  for (const s of next.active) if (!was.has(s.id)) parts.push(s.name + ' foi conectada')
  for (const s of [...prev.active, ...prev.archived]) if (!is.has(s.id)) parts.push(s.name + ' foi removida')
  if (!parts.length) return null
  return parts.length === 1 ? parts[0] : parts.slice(0, -1).join(', ') + ' e ' + parts[parts.length - 1]
}

// ─── What is shown ───────────────────────────────────────────────────────────

export interface Shown { loja: string; period: PeriodValue; aba: Tab | null }

export function shownView(state: PhoneState): Shown {
  const v = state.visit
  return {
    loja: v?.loja ?? state.saved.loja,
    period: v?.period ?? state.saved.period,
    aba: v && v.aba !== undefined ? v.aba : state.saved.aba,
  }
}

/** The shown view as a Selection (the request, R19). */
export function shownSelection(state: PhoneState): Selection {
  const s = shownView(state)
  return { scope: s.loja === ALL ? { kind: 'all' } : { kind: 'store', id: s.loja }, period: s.period, split: false }
}

/** "Todas · 7 dias", "MOKOO · Hoje". */
export function savedLabel(saved: SavedView, viewer: ViewerStores, today?: string): string {
  const store = saved.loja === ALL ? 'Todas' : findStore(viewer, saved.loja)?.name ?? 'Todas'
  return `${store} · ${valueName(saved.period, today, true)}`
}

/**
 * R7's name of the period on screen for the strip: a preset with its dates
 * ("Últimos 30 dias · 25 out – 23 nov", "Hoje · 25 nov"), dates as asked
 * ("24 nov (ontem)"), and "(dia de Tóquio)" when one store's clock is not
 * Brasília's. "Link aberto em Hoje." named no day.
 */
export function stripLabel(r: Pick<Resolution, 'label'> & Partial<Pick<Resolution, 'clockDiffers' | 'clockTz' | 'selection'>>): string {
  const preset = r.selection ? r.selection.period.kind === 'preset' : !/\d/.test(r.label.short)
  const name = preset ? r.label.full : r.label.short
  const oneStore = r.selection?.scope.kind === 'store'
  if (!(r.clockDiffers && oneStore && r.clockTz)) return name
  const day = `dia de ${tzCity(r.clockTz)}`
  // One parenthesis: "24 nov (ontem, dia de Tóquio)", never "(ontem) (dia de Tóquio)".
  return name.endsWith(')') ? `${name.slice(0, -1)}, ${day})` : `${name} (${day})`
}

const TAB_NAMES: Record<Tab, string> = { campanhas: 'Campanhas', criativos: 'Criativos', produtos: 'Produtos', paises: 'Países', clientes: 'Clientes' }

/**
 * The strip (R16): shown while a visit exists and its × is not closed. Its
 * text is built from what the visit STILL overrides (present and different
 * from saved), so it never describes something no longer on screen (C1-6,
 * C2-M2). `resolution` names the period as R7 does ("24 nov (ontem)").
 */
export function stripFor(state: PhoneState, viewer: ViewerStores, resolution: Pick<Resolution, 'label'> & Partial<Pick<Resolution, 'clockDiffers' | 'clockTz' | 'selection'>> | null, today?: string): { text: string; button: string } | null {
  const v = state.visit
  if (!v || state.closedStrip) return null
  // A push about a store archived since keeps the push wording (R17 ex. 5).
  const isPush = v.source === 'push' || (v.source === 'archive' && v.pushId !== null)
  const by = isPush ? 'pela notificação' : 'pelo link'
  const parts: string[] = []
  if (v.source === 'archive') parts.push('Loja arquivada: só consulta, fora de Todas e sem sincronização.')
  // A push always says what it opened, even when its day equals the saved
  // period by value (R16 Q3, C2-L2): otherwise the visit was invisible and
  // only a chip ended it.
  const periodOver = !!v.period && (isPush || !samePeriod(v.period, state.saved.period))
  const lojaOver = v.loja !== undefined && v.loja !== state.saved.loja
  const abaOver = v.aba !== undefined && v.aba !== state.saved.aba
  if (v.undated) {
    parts.push(`Notificação antiga, sem data: mostrando o seu período (${valueName(state.saved.period, today, true)}).`)
  } else if (periodOver && v.period) {
    const label = resolution ? stripLabel(resolution) : valueName(v.period, today)
    const single = v.period.kind === 'dates' ? v.period.from === v.period.to : true
    if (isPush) parts.push(`Notificação sobre ${label}: mostrando ${single ? 'esse dia' : 'esses dias'}.`)
    else if (v.source === 'link') parts.push(`Link aberto em ${label}.`)
    else parts.push(`Mostrando ${label}.`)
  }
  if (!periodOver && lojaOver && v.loja && v.source !== 'archive') {
    const name = v.loja === ALL ? 'Todas as lojas' : findStore(viewer, v.loja)?.name ?? 'a loja'
    parts.push(`Mostrando ${name}, aberta ${by}.`)
  }
  if (abaOver && v.aba) parts.push(`Aba ${TAB_NAMES[v.aba]} aberta ${by}.`)
  if (!parts.length) return null
  const back = savedLabel(state.saved, viewer, today)
  parts.push(`Os botões de loja no alto voltam para ${back}.`)
  return { text: parts.join(' '), button: `Voltar para ${back}` }
}
