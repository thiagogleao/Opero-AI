/**
 * The desktop URL (R3, R5, R13, R14, R15).
 *
 * Four key lists, and nothing else is ever written:
 *  - STATE_KEYS (loja, periodo, de, ate, parte): only desktopHref writes them,
 *    from a Selection;
 *  - PAGE_KEYS, declared per page with a policy (keep across store changes,
 *    or keep across period changes only);
 *  - ONE_SHOT_KEYS (vem, ajuste): written only by the link or redirect that
 *    needs them, dropped by every other desktopHref;
 *  - LEGACY_KEYS (volta, dia, compare): never written; read only by the legacy
 *    parse below, which redirects them away.
 * There is no "copy the current URL's other keys" rule (C1-3): an unknown or
 * legacy key can never reach a new link.
 *
 * `parseDesktop` is strict and total: it never throws, and every rejection is
 * a note. When `canonical` differs from the requested query the page
 * redirects once (replace) to it. canonical(canonical(x)) = canonical(x).
 */

import { todayIn } from './clock'
import { carry, sameScope } from './carry'
import { URL_NOTE_CODES } from './notes'
import { findStore, membersOf } from './resolve'
import { anchorOf } from './clock'
import { daysBetween } from '../engine/dates'
import { defaultPeriod, isDefault, isPreset, MAX_WINDOW_DAYS, MIN_DATE, parsePeriod, periodParams, preset, presetRange, samePeriod } from './value'
import type { Note, NoteCode, PeriodValue, Preset, ScopeRef, Selection, StoreFacts, ViewerStores } from './types'

export const ALL_STORES = 'todas'

export const STATE_KEYS = ['loja', 'periodo', 'de', 'ate', 'parte'] as const
export const ONE_SHOT_KEYS = ['vem', 'ajuste'] as const
export const LEGACY_KEYS = ['volta', 'dia', 'compare'] as const

/** keep: across period AND store changes; period: across period changes only
 *  (a campaign id means nothing in another store, L145); flag: a one-shot
 *  result flag of the page itself (an OAuth callback's ?shopify_connected=…):
 *  kept by the canonical redirect, never copied into a link (R14). */
export type PageKeyPolicy = 'keep' | 'period' | 'flag'

export interface PageKeyDecl {
  key: string
  policy: PageKeyPolicy
  /** Accepted values; anything else is dropped (R15). */
  valid: (v: string) => boolean
  /** 'store': the key means something only on a one-store view of the page
   *  (Campanhas' tabs and filters: Campanhas · Todas has none). On Todas it is
   *  not written, so the canonical redirect drops it and a URL never holds
   *  state the screen does not show (R14, §8.4). */
  scope?: 'store'
}

const ID_RE = /^[A-Za-z0-9_-]{1,64}$/

/** An OAuth callback's result flag value ("true", an error code). */
const FLAG_RE = /^[A-Za-z0-9_.-]{1,64}$/
const flag = (key: string): PageKeyDecl => ({ key, policy: 'flag', valid: v => FLAG_RE.test(v) })

/** The page keys each desktop page declares, by path prefix. Nothing else
 *  survives the canonical redirect (R15: "aba not a known tab → dropped", and
 *  no undeclared key either). */
export const PAGE_KEYS: Readonly<Record<string, readonly PageKeyDecl[]>> = {
  // The "Lojas arquivadas" section open (components/portfolio ARCHIVED_PARAM).
  '/overview': [
    { key: 'arquivadas', policy: 'period', valid: v => v === '1' },
  ],
  // Ajustes: the OAuth callbacks' result flags (app/settings FLAG_KEYS).
  '/settings/chaves': [flag('shopify_connected'), flag('shopify_error')],
  '/settings': [flag('shopify_connected'), flag('shopify_error'), flag('fb_connected'), flag('fb_extra_connected'), flag('fb_error')],
  '/campaigns': [
    { key: 'aba', policy: 'keep', valid: v => v === 'criativos' || v === 'campanhas', scope: 'store' },
    { key: 'campanha', policy: 'period', valid: v => ID_RE.test(v), scope: 'store' },
    { key: 'mostrar', policy: 'period', valid: v => v === 'todos', scope: 'store' },
  ],
  // The credit model of Atribuição (components/attribution/model MODEL_KEY).
  '/attribution': [
    { key: 'modelo', policy: 'keep', valid: v => v === 'primeiro' || v === 'ultimo' || v === 'dividido' },
  ],
}

/** The scope each desktop page shows: 'store' pages always show one store,
 *  '/overview' always Todas, the rest either. */
export type PageScope = 'store' | 'all' | 'either'

export const STORE_ONLY_ROUTES: readonly string[] = ['/', '/attribution', '/creatives', '/facebook', '/profit', '/settings']

export function pageScope(pathname: string): PageScope {
  if (pathname === '/overview' || pathname.startsWith('/overview/')) return 'all'
  return STORE_ONLY_ROUTES.some(r => (r === '/' ? pathname === '/' : pathname === r || pathname.startsWith(`${r}/`))) ? 'store' : 'either'
}

/** Pages of one object of one store: another store opens their list. */
export const DETAIL_ROUTES: readonly { prefix: string; list: string; nav: string }[] = [
  { prefix: '/creatives/', list: '/campaigns?aba=criativos', nav: '/campaigns' },
]

export function detailRoute(pathname: string): (typeof DETAIL_ROUTES)[number] | null {
  return DETAIL_ROUTES.find(r => pathname.startsWith(r.prefix)) ?? null
}

export function pageKeysOf(pathname: string): readonly PageKeyDecl[] {
  // The longest declared prefix: /settings/chaves has its own list.
  const hit = Object.keys(PAGE_KEYS)
    .filter(p => pathname === p || pathname.startsWith(`${p}/`))
    .sort((a, b) => b.length - a.length)[0]
  return hit ? PAGE_KEYS[hit] : []
}

/** The declared page keys of `pathname` found (valid) in `from`. With
 *  `storeChange`, keys whose policy is 'period' are dropped; 'flag' keys only
 *  with `flags` (the canonical URL of the page itself, never a link). */
export function keptPageKeys(
  pathname: string, from: URLSearchParams | Record<string, string | null | undefined>, storeChange = false, flags = false,
): Record<string, string> {
  const get = (k: string) => (from instanceof URLSearchParams ? from.get(k) : from[k] ?? null)
  const out: Record<string, string> = {}
  for (const d of pageKeysOf(pathname)) {
    if (storeChange && d.policy === 'period') continue
    if (!flags && d.policy === 'flag') continue
    const v = get(d.key)
    if (v && d.valid(v)) out[d.key] = v
  }
  return out
}

export const lojaOf = (scope: ScopeRef): string => (scope.kind === 'all' ? ALL_STORES : scope.id)

export interface HrefOptions {
  /** One-shot: where an R4 link came from. */
  vem?: ScopeRef | null
  /** One-shot: notes a redirect carries (code, and for remembered_gone the
   *  store id, so the landing note names it: "A loja lembrada (Squishy
   *  World) não está mais disponível"). */
  ajuste?: readonly (NoteCode | Note)[]
}

/**
 * The one rule for the one-shot `vem` of a link from `source` (the selection
 * of the page the link sits in) to `target` (what the link opens). `vem`
 * asks the landing page to say what changed, so it is written only when
 * there is something true to say:
 *  - same scope: nothing (an R3 link);
 *  - leaving an archived store: only when its consultation period was really
 *    dropped (the target opens another period) — that is note left_archive.
 *    A consultation already on the target's period drops nothing (P5, R4);
 *  - the link sets a period of its own (an explicit period action, R3: "Abrir
 *    histórico", an AI link naming its dates): nothing, because the page the
 *    link sits in never showed that period, so no sentence may say what it
 *    showed (R4 "the place the link sits in");
 *  - otherwise (the same period carried to another scope, R4): the source.
 */
export function vemFor(source: Selection | null, target: Selection, isArchived: (id: string) => boolean): ScopeRef | null {
  if (!source || sameScope(source.scope, target.scope)) return null
  if (source.scope.kind === 'store' && isArchived(source.scope.id)) {
    return samePeriod(source.period, target.period) ? null : source.scope
  }
  return samePeriod(source.period, target.period) ? source.scope : null
}

/** An ajuste token: "code" or "remembered_gone:<storeId>". */
function ajusteToken(n: NoteCode | Note): string {
  if (typeof n === 'string') return n
  const id = n.params?.storeId
  return typeof id === 'string' && ID_RE.test(id) ? `${n.code}:${id}` : n.code
}

/**
 * The one desktop link builder (R3). Contains exactly: the path, the state
 * keys of `sel` (loja always; the default period left out), the page keys the
 * target declares, and the one-shot keys given. `path` may carry its own
 * query (page keys the link itself sets, "/campaigns?aba=criativos") and a
 * #hash; state, one-shot and legacy keys in it are ignored.
 */
export function desktopHref(path: string, sel: Selection, pageKeys: Record<string, string> = {}, opts: HrefOptions = {}): string {
  const [beforeHash, hash] = path.split('#', 2) as [string, string | undefined]
  const [pathname, query] = beforeHash.split('?', 2) as [string, string | undefined]
  const own = new URLSearchParams(query ?? '')
  const out = new URLSearchParams()
  out.set('loja', lojaOf(sel.scope))
  if (!isDefault(sel.period, 'desktop')) {
    const p = periodParams(sel.period)
    out.set('periodo', p.periodo)
    if (p.de && p.ate) { out.set('de', p.de); out.set('ate', p.ate) }
  }
  if (sel.split) out.set('parte', '50')
  const declared = pageKeysOf(pathname)
  for (const d of declared) {
    if (d.scope === 'store' && sel.scope.kind !== 'store') continue
    const v = own.get(d.key) ?? pageKeys[d.key] ?? null
    if (v && d.valid(v)) out.set(d.key, v)
  }
  // The path's own undeclared keys (a settings sub-route's flag): the link
  // set them itself, so they are not a copy of the current URL.
  const reserved = new Set<string>([...STATE_KEYS, ...ONE_SHOT_KEYS, ...LEGACY_KEYS, ...declared.map(d => d.key)])
  for (const [k, v] of own) if (!reserved.has(k) && !out.has(k)) out.set(k, v)
  if (opts.vem && !sameScope(opts.vem, sel.scope)) out.set('vem', lojaOf(opts.vem))
  if (opts.ajuste?.length) out.set('ajuste', [...new Set(opts.ajuste.map(ajusteToken))].join(','))
  const qs = out.toString()
  return `${pathname}${qs ? `?${qs}` : ''}${hash ? `#${hash}` : ''}`
}

// ─── Parsing a desktop URL ───────────────────────────────────────────────────

export type SearchParams = Record<string, string | string[] | undefined>

/** Repeated keys: the first value counts (R15 step 1). */
export function firstValue(v: string | string[] | undefined | null): string | null {
  const s = Array.isArray(v) ? v[0] : v
  const t = typeof s === 'string' ? s.trim() : ''
  return t ? t : null
}

export interface ParseContext {
  pathname: string
  viewer: ViewerStores
  /** The remembered store (cookie), unvalidated. */
  remembered: string | null
  now: Date
}

export interface ParsedDesktop {
  /** What the page shows. Null: a store the viewer cannot see (404). */
  selection: Selection | null
  /** One-shot `vem`: where an R4 link came from. */
  cameFrom: ScopeRef | null
  /** Notes to show on this page (from `ajuste` and the parse). */
  notes: Note[]
  /** The canonical URL; redirect when it differs from the request. */
  canonical: string
  redirect: boolean
  /** The remembered cookie names a store the viewer cannot use: clear it. */
  forgetRemembered: boolean
  /** A store-only page: the declared page keys, validated. */
  pageKeys: Record<string, string>
  /** The 404 page's "keep my period" link: the period, without the store. */
  notFound: boolean
}

/** The legacy `volta` parse (R15 step 4), desktop and phone alike: dates
 *  that equal what `volta` resolves to at `now` on the target clock or on
 *  Brasília's were a fresh row link's derived dates, so they mean the preset. */
export function legacyDates(value: Extract<PeriodValue, { kind: 'dates' }>, volta: Preset, targetTz: string, now: Date): PeriodValue {
  const tzs = [targetTz, 'America/Sao_Paulo']
  for (const tz of tzs) {
    const r = presetRange(volta, todayIn(tz, now))
    if (r.from === value.from && r.to === value.to) return preset(volta)
  }
  return value
}

/** Fallback store when nothing names one (R5): the remembered one if valid,
 *  else the first active store by FALLBACK_ORDER. */
function rememberedStore(viewer: ViewerStores, remembered: string | null): { id: string | null; gone: boolean } {
  const ok = remembered && ID_RE.test(remembered) ? viewer.active.find(s => s.id === remembered) : null
  if (ok) return { id: ok.id, gone: false }
  return { id: viewer.active[0]?.id ?? viewer.archived[0]?.id ?? null, gone: !!remembered }
}

/** R15 for the desktop. */
export function parseDesktop(sp: SearchParams, ctx: ParseContext): ParsedDesktop {
  const { viewer, now } = ctx
  const pathname = ctx.pathname
  const scopeRule = pageScope(pathname)
  const get = (k: string) => firstValue(sp[k])
  const notes: Note[] = []
  const note = (code: NoteCode) => notes.push({ code })
  let forgetRemembered = false
  let vemTodas = false
  let singleStore = false

  // ── Scope ──
  const rawLoja = get('loja')
  let scope: ScopeRef | null = null
  let notFound = false
  if (rawLoja && rawLoja !== ALL_STORES) {
    const st = ID_RE.test(rawLoja) ? findStore(viewer, rawLoja) : null
    if (!st) notFound = true
    else scope = scopeRule === 'all' ? { kind: 'all' } : { kind: 'store', id: st.id }
  } else if (rawLoja === ALL_STORES && scopeRule !== 'store') {
    scope = { kind: 'all' }
  } else if (scopeRule === 'all') {
    scope = { kind: 'all' }
  }
  if (rawLoja === ALL_STORES && !viewer.allowsAll && viewer.active[0]) {
    // Todas for a viewer with fewer than two active stores, on ANY page: that
    // store's Resumo + note single_store (R15), never a silent swap.
    scope = { kind: 'store', id: viewer.active[0].id }
    singleStore = true
    note('single_store')
  } else if (!notFound && scope?.kind !== 'all' && !scope) {
    // A page that shows one store, opened with no store or with Todas.
    const r = rememberedStore(viewer, ctx.remembered)
    if (r.gone) {
      // Its name when the viewer still has it (archived since): R5 ex. 4.
      const was = ctx.remembered && ID_RE.test(ctx.remembered) ? findStore(viewer, ctx.remembered) : null
      notes.push(was ? { code: 'remembered_gone', params: { storeId: was.id } } : { code: 'remembered_gone' })
      forgetRemembered = true
    }
    if (r.id) scope = { kind: 'store', id: r.id }
    if (rawLoja === ALL_STORES) vemTodas = true
  }
  if (scope?.kind === 'all' && !viewer.allowsAll) {
    // /overview for a viewer with fewer than two active stores.
    const only = viewer.active[0]
    if (only) { scope = { kind: 'store', id: only.id }; singleStore = true; note('single_store') }
  }

  // ── Period (precedence of R15) ──
  const raw = { periodo: get('periodo'), de: get('de'), ate: get('ate') }
  const volta = get('volta')
  const parsed = parsePeriod(raw)
  let period: PeriodValue = defaultPeriod('desktop')
  if (parsed.value) {
    period = parsed.value
    if (period.kind === 'dates' && isPreset(volta)) {
      const tz = anchorOf(scope ? membersOf({ scope }, viewer).map(s => s.tz) : [])
      period = legacyDates(period, volta, tz, now)
    }
  } else if (isPreset(volta)) {
    period = preset(volta)
  }
  // A rejected periodo is said even when legacy volta supplies the period
  // shown (P5: "semana" next to volta=today read as Hoje with no word).
  for (const c of parsed.notes) note(c)

  const split = get('parte') === '50'
  const selection: Selection | null = scope ? { scope, period, split } : null

  // ── One-shot keys ──
  let cameFrom: ScopeRef | null = null
  const rawVem = get('vem')
  if (vemTodas && viewer.allowsAll) cameFrom = { kind: 'all' }
  else if (rawVem === ALL_STORES && viewer.allowsAll) cameFrom = { kind: 'all' }
  else if (rawVem && ID_RE.test(rawVem) && findStore(viewer, rawVem)) cameFrom = { kind: 'store', id: rawVem }
  if (cameFrom && selection && sameScope(cameFrom, selection.scope)) cameFrom = null
  // vem=<archived store> means "its consultation period was dropped for the
  // default" (left_archive). On any other period the owner chose the period
  // himself (a pick over the URL still loading, a forwarded or hand-typed
  // URL): the claim does not hold and the canonical redirect drops it (P5).
  if (cameFrom?.kind === 'store' && selection && findStore(viewer, cameFrom.id)?.archivedOn && !isDefault(selection.period, 'desktop')) cameFrom = null

  const ajuste: Note[] = (get('ajuste') ?? '').split(',').flatMap(tok => {
    const [code, id] = tok.split(':', 2)
    if (!(URL_NOTE_CODES as readonly string[]).includes(code)) return []
    // Only a store of this viewer is named; anything else is just the code.
    const st = code === 'remembered_gone' && id && ID_RE.test(id) ? findStore(viewer, id) : null
    if (!ajusteHolds(code as NoteCode, st, selection, viewer, ctx.remembered)) return []
    return [st ? { code: code as NoteCode, params: { storeId: st.id } } : { code: code as NoteCode }]
  })
  const seen = new Set<string>()
  const allNotes = [...ajuste, ...notes].filter(n => {
    if (seen.has(n.code)) return false
    seen.add(n.code)
    return true
  })
  const pageKeys = keptPageKeys(pathname, Object.fromEntries(Object.keys(sp).map(k => [k, get(k)])), false, true)

  // Todas for a one-store viewer lands on that store's Resumo (R15).
  const canonPath = (scopeRule === 'all' && selection?.scope.kind === 'store') || singleStore ? '/' : pathname
  const canonical = selection
    ? desktopHref(canonPath, selection, canonPath === pathname ? pageKeys : {}, { vem: cameFrom, ajuste: allNotes })
    : pathname
  const redirect = !!selection && (canonPath !== pathname || !sameQuery(sp, canonical))
  return {
    selection, cameFrom, notes: allNotes, canonical, redirect, forgetRemembered, pageKeys, notFound,
  }
}

/**
 * Whether a one-shot `ajuste` note still holds for this request (R15, P5): a
 * note is shown only for an adjustment that really happened. A token that
 * does not hold (typed by hand, or a landed URL forwarded to another viewer or
 * browser) is dropped, so the canonical redirect removes it.
 *  - too_long: the dates are exactly the 366 days the cut leaves;
 *  - floor: the dates start on MIN_DATE;
 *  - too_early, bad_param, incomplete: the link's period was not used, so the
 *    period shown is not a dates value;
 *  - single_store: the viewer has fewer than two active stores;
 *  - remembered_gone[:id]: the named store is not active, and the browser
 *    has no valid remembered store any more (the redirect cleared it).
 */
function ajusteHolds(code: NoteCode, named: StoreFacts | null, sel: Selection | null, viewer: ViewerStores, remembered: string | null): boolean {
  const p = sel?.period
  switch (code) {
    case 'too_long': return p?.kind === 'dates' && daysBetween(p.from, p.to) === MAX_WINDOW_DAYS
    case 'floor': return p?.kind === 'dates' && p.from === MIN_DATE
    case 'too_early':
    case 'bad_param':
    case 'incomplete': return p?.kind !== 'dates'
    case 'single_store': return !viewer.allowsAll
    case 'remembered_gone': {
      const validNow = !!remembered && ID_RE.test(remembered) && viewer.active.some(s => s.id === remembered)
      return !validNow && !(named && viewer.active.some(s => s.id === named.id))
    }
    default: return true
  }
}

/** Whether a request's query equals a canonical URL's (as sets of first values). */
function sameQuery(sp: SearchParams, canonical: string): boolean {
  const q = new URLSearchParams(canonical.split('?')[1]?.split('#')[0] ?? '')
  const keys = Object.keys(sp).filter(k => firstValue(sp[k]) !== null || sp[k] !== undefined)
  const canonKeys = [...q.keys()]
  if (keys.length !== canonKeys.length) return false
  for (const k of keys) {
    const v = sp[k]
    if (Array.isArray(v) && v.length > 1) return false
    if (q.get(k) !== (Array.isArray(v) ? v[0] : v)) return false
  }
  return true
}

// ─── In-flight navigation (R13) ──────────────────────────────────────────────

/** A URL read without a viewer (syntax only): the shell's latest requested
 *  selection. Canonical URLs always name their scope, so this is exact for
 *  every URL the app wrote. */
export function selectionFromUrl(url: string): { pathname: string; selection: Selection | null; params: URLSearchParams } {
  const u = new URL(url, 'http://x')
  const loja = u.searchParams.get('loja')
  const scope: ScopeRef | null = loja === ALL_STORES ? { kind: 'all' } : loja && ID_RE.test(loja) ? { kind: 'store', id: loja } : null
  const parsed = parsePeriod({ periodo: u.searchParams.get('periodo'), de: u.searchParams.get('de'), ate: u.searchParams.get('ate') })
  const period = parsed.value ?? defaultPeriod('desktop')
  return { pathname: u.pathname, selection: scope ? { scope, period, split: u.searchParams.get('parte') === '50' } : null, params: u.searchParams }
}

/** What a control or link changes (R13). */
export type LayerLink =
  | { kind: 'period'; period: PeriodValue }
  | { kind: 'split'; on: boolean }
  /** The store picker: `href` overrides the target page (the server knows the
   *  remembered store's Resumo, /overview…). */
  | { kind: 'store'; scope: ScopeRef }
  /**
   * A page link: its path and own keys.
   *  - `scope`: the scope the link NAMES (a Todas row, "Todas as lojas", a
   *    link to the store a campaign is billed in): it wins over any scope still
   *    loading, because the click is the newer choice.
   *  - `storeFallback`: the store a one-store page opens when the latest
   *    REQUESTED scope is Todas (the sidebar's Resumo/Atribuição on Todas: the
   *    remembered store). A store picked a moment before is kept (R13).
   *  - `keys`: 'exact' (default) — the link's own page keys are the whole set
   *    (an in-page tab or drill-down names its page state: "Campanhas" drops
   *    aba, "todas as campanhas" drops campanha); 'inherit' — the sidebar
   *    keeps the declared page keys of the page it is on.
   *  - `period`: set only by a link that chooses a period itself ("Ver os
   *    últimos 30 dias"); otherwise the period comes from the latest request.
   */
  | { kind: 'page'; path: string; scope?: ScopeRef; storeFallback?: ScopeRef; keys?: 'exact' | 'inherit'; period?: PeriodValue }

export interface LayerContext {
  /** Archived stores of the viewer (leaving one does not carry its period). */
  archivedIds: readonly string[]
  /** `latest` is a URL still being opened (not the page on screen): a period
   *  or split picked over it keeps its one-shot `vem`, so a row clicked a
   *  moment before still lands with its announcement (R4, R13). Over the page
   *  on screen `vem` is dropped as by every link. */
  inFlight?: boolean
}

/** Where the store picker goes from `pathname`: the same page, /overview for
 *  Todas on a store-only page, Resumo for a store on /overview, a detail
 *  page's list. */
export function storeTargetPath(pathname: string, scope: ScopeRef): string {
  const d = detailRoute(pathname)
  if (d) return scope.kind === 'all' ? '/overview' : d.list
  if (scope.kind === 'all' && pageScope(pathname) === 'store') return '/overview'
  if (scope.kind === 'store' && pageScope(pathname) === 'all') return '/'
  return pathname
}

/**
 * `link` applied on top of the latest REQUESTED URL at click time (R13): the
 * period control sets the period, the store control the scope (R4 carry), the
 * split toggle the split, a page link its path and page keys (and its scope
 * when it is an R4 link) — the period and split come from `latest`. No field
 * depends on another (no `volta`), so there are no special cases.
 */
export function layer(latest: string, link: LayerLink, ctx: LayerContext): string {
  const cur = selectionFromUrl(latest)
  const base: Selection = cur.selection ?? { scope: { kind: 'all' }, period: defaultPeriod('desktop'), split: false }
  const hasScope = !!cur.selection
  const rawVem = ctx.inFlight ? cur.params.get('vem') : null
  const isArchived = (id: string) => ctx.archivedIds.includes(id)
  const rawVemScope: ScopeRef | null = rawVem === ALL_STORES ? { kind: 'all' } : rawVem && ID_RE.test(rawVem) ? { kind: 'store', id: rawVem } : null
  // An archived store's vem (left_archive) is not kept over a period the
  // owner picks: the period on screen is then his choice, not the default
  // that replaced the consultation's dates (P5, §9.1). A split toggle
  // changes no period, so it keeps it.
  const pendingVem: ScopeRef | null = rawVemScope?.kind === 'store' && isArchived(rawVemScope.id) ? null : rawVemScope
  switch (link.kind) {
    case 'period': {
      const sel = { ...base, period: link.period }
      return hasScope ? desktopHref(cur.pathname, sel, keptPageKeys(cur.pathname, cur.params), { vem: pendingVem }) : withoutScope(cur.pathname, sel)
    }
    case 'split': {
      const sel = { ...base, split: link.on }
      return hasScope ? desktopHref(cur.pathname, sel, keptPageKeys(cur.pathname, cur.params), { vem: rawVemScope }) : withoutScope(cur.pathname, sel)
    }
    case 'store': {
      const path = storeTargetPath(cur.pathname, link.scope)
      const leaving = hasScope && base.scope.kind === 'store' && ctx.archivedIds.includes(base.scope.id) && !sameScope(base.scope, link.scope)
      const sel: Selection = { scope: link.scope, period: leaving ? defaultPeriod('desktop') : base.period, split: base.split }
      const keys = path === cur.pathname ? keptPageKeys(path, cur.params, true) : {}
      return desktopHref(path, sel, keys, { vem: hasScope ? vemFor(base, sel, isArchived) : null })
    }
    case 'page': {
      const [p] = link.path.split(/[?#]/, 1)
      const kind = pageScope(p)
      // The scope: the one the link names; else the page's own (Todas for
      // /overview); else the latest requested one, unless a one-store page
      // is opened from Todas (then the link's fallback store).
      const scope: ScopeRef = link.scope
        ?? (kind === 'all' ? { kind: 'all' }
          : kind === 'store' && base.scope.kind === 'all' && link.storeFallback ? link.storeFallback
            : base.scope)
      const leaving = hasScope && base.scope.kind === 'store' && ctx.archivedIds.includes(base.scope.id) && !sameScope(base.scope, scope)
      const period = link.period ?? (leaving ? defaultPeriod('desktop') : base.period)
      const sel: Selection = { scope, period, split: base.split }
      const keys = link.keys === 'inherit' && p === cur.pathname ? keptPageKeys(p, cur.params, !sameScope(scope, base.scope)) : {}
      return desktopHref(link.path, sel, keys, { vem: hasScope ? vemFor(base, sel, isArchived) : null })
    }
  }
}

/**
 * The page link a rendered href stands for (R13), read against the URL of the
 * page it was rendered on (`shown`): its path and own page keys; the scope
 * when the href names another scope than that page (an R4 link: a Todas row,
 * "Todas as lojas"); the period only when the href chose one itself (it
 * differs from the page's and the page is not an archived store being left,
 * whose links carry the default by rule). Null for a URL that is not a
 * desktop page link (no loja, an /api route, another origin): it is followed
 * as written.
 *
 * Every period-aware link of a page — rows, tabs, in-page drill-downs — goes
 * through this at click time, so a period, split or store still loading is
 * kept instead of the selection the href was rendered with (C2-M11).
 */
export function relayLink(href: string, shown: string, ctx: LayerContext): Extract<LayerLink, { kind: 'page' }> | null {
  if (!href.startsWith('/') || href.startsWith('//')) return null
  const h = selectionFromUrl(href)
  const s = selectionFromUrl(shown)
  if (!h.selection || h.pathname.startsWith('/api/') || h.pathname.startsWith('/m')) return null
  const reserved = new Set<string>([...STATE_KEYS, ...ONE_SHOT_KEYS, ...LEGACY_KEYS])
  const own = new URLSearchParams()
  for (const [k, v] of h.params) if (!reserved.has(k)) own.append(k, v)
  const hash = href.includes('#') ? `#${href.split('#')[1]}` : ''
  const path = `${h.pathname}${own.toString() ? `?${own.toString()}` : ''}${hash}`
  const link: Extract<LayerLink, { kind: 'page' }> = { kind: 'page', path, keys: 'exact' }
  if (!s.selection) return link
  if (!sameScope(h.selection.scope, s.selection.scope)) link.scope = h.selection.scope
  const leavingArchive = s.selection.scope.kind === 'store' && ctx.archivedIds.includes(s.selection.scope.id) && !sameScope(h.selection.scope, s.selection.scope)
  if (!leavingArchive && !samePeriod(h.selection.period, s.selection.period)) link.period = h.selection.period
  return link
}

/** A URL with no scope (a page that redirects to the remembered store): only
 *  the period and split. */
function withoutScope(pathname: string, sel: Selection): string {
  const out = new URLSearchParams()
  if (!isDefault(sel.period, 'desktop')) {
    const p = periodParams(sel.period)
    out.set('periodo', p.periodo)
    if (p.de && p.ate) { out.set('de', p.de); out.set('ate', p.ate) }
  }
  if (sel.split) out.set('parte', '50')
  const qs = out.toString()
  return `${pathname}${qs ? `?${qs}` : ''}`
}

/**
 * Picking a store changes nothing only when BOTH the latest requested scope
 * and the shown page agree with the pick (R13). "Todas" picked on a
 * store-only page always goes to /overview (L53).
 */
export function pickIsNoop(picked: ScopeRef, latest: string): boolean {
  const cur = selectionFromUrl(latest)
  if (!cur.selection) return false
  if (picked.kind === 'all' && pageScope(cur.pathname) === 'store') return false
  return sameScope(picked, cur.selection.scope)
}

/** The 404 page's "manter o período" link: the period and split of the
 *  current URL, no store (R15). */
export function keepPeriodHref(path: string, current: URLSearchParams): string {
  const parsed = parsePeriod({ periodo: current.get('periodo'), de: current.get('de'), ate: current.get('ate') })
  const sel: Selection = { scope: { kind: 'all' }, period: parsed.value ?? defaultPeriod('desktop'), split: current.get('parte') === '50' }
  return withoutScope(path, sel)
}

/**
 * The period and split of a query as URL keys, validated and normalised (R9)
 * by the URL's own parser: what every place that copies "the period" of a URL
 * (an OAuth return path, a sessionStorage hint) takes, never the raw values.
 * The default period is left out, as desktopHref does.
 */
export function periodQuery(current: URLSearchParams): URLSearchParams {
  return new URLSearchParams(keepPeriodHref('/', current).split('?')[1] ?? '')
}

/** R4 for a desktop link to another store or scope: the href, or null when
 *  the viewer cannot see the target (render the text without a link). */
export function scopeHref(path: string, sel: Selection, target: ScopeRef, viewer: ViewerStores, pageKeys: Record<string, string> = {}): string | null {
  const c = carry(sel, target, viewer, 'desktop')
  if (!c) return null
  return desktopHref(path, c.selection, pageKeys, { vem: vemFor(sel, c.selection, id => !!findStore(viewer, id)?.archivedOn) })
}

export { samePeriod }
