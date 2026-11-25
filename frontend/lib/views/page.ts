/**
 * getPageContext: what every desktop page means by "store" and "period".
 *
 * The URL is the state: ?loja=<storeId|todas>&periodo=<7d|today|…>&de=YYYY-MM-DD
 * &ate=YYYY-MM-DD&parte=50. Every server page resolves it here, once, through
 * lib/period (the single source of the period rules, desktop and phone alike):
 *
 *   parseDesktop (R15) → redirect once to the canonical URL → resolve (R1–R11)
 *
 * A URL always names what is on screen (R2): a one-store page opened with
 * ?loja=todas or no store is redirected to the concrete store, with `vem`
 * saying where it came from so the page announces any change of dates (R4).
 * Links between pages are built with ctx.hrefWith (lib/period desktopHref),
 * never by hand.
 *
 * Who may see what is decided by lib/access only: an id the viewer cannot see
 * is a 404, no viewer redirects to /sign-in. Archived stores open by id (their
 * history, consultation only) but never enter "Todas" or the picker.
 */

import { notFound, redirect } from 'next/navigation'
import { cookies } from 'next/headers'
import type { Metadata } from 'next'
import { ACTIVE_STORE_COOKIE, getViewer, listStores, type StoreRef, type Viewer } from '../access'
import type { Comparison, DateRange, Period } from '../engine/dates'
import { formatRangeLabel, tzCity } from '../format'
import {
  carry, desktopHref, findStore, landingNotes, MAX_WINDOW_DAYS as PERIOD_MAX_DAYS, MIN_DATE, notesText,
  offsetDiffers, parseDesktop, parsePeriod, resolve, rowsAnnouncement, sameScope, scopeHref, screenComparison, announce, dateBeside, preset, vemFor,
  type Announcement, type Note, type PeriodValue, type Resolution, type ScopeRef, type ScreenComparison, type Selection, type ViewerStores,
} from '../period'
import { viewerStoresOf } from './periodFacts'
import { SPLIT_SHARE } from './verdict'

export type SearchParams = Record<string, string | string[] | undefined>

/** ?loja value for "Todas as lojas". */
export const ALL_STORES = 'todas'
/** Desktop default: 7 complete days ending yesterday. */
export const DEFAULT_PERIOD: Period = '7d'
/** Longest window a page prices (lib/period MAX_WINDOW_DAYS). */
export const MAX_WINDOW_DAYS = PERIOD_MAX_DAYS
/** No page date before this one (lib/period MIN_DATE). */
export const MIN_PAGE_DATE = MIN_DATE

/** The URL state of the page shown, in the URL's own words (for the few
 *  readers that still want the strings). */
export interface PageParams {
  loja: string | null
  periodo: Period
  de: string | null
  ate: string | null
  parte: boolean
}

/** A store as the shell's pickers need it (serialisable for client props). */
export interface StoreOption {
  id: string
  /** Disambiguated name ("Dumpling Squishy · 8jcp3a"). */
  name: string
  shopName: string
  /** First label of the myshopify domain ("6k7fjw"), for the small code pill. */
  code: string | null
  timezone: string
  /** "Belém", "Tóquio". */
  city: string
  /** "dia de Tóquio" when the store's clock is not Brasília's offset (R7). */
  dayLabel: string | null
  archived: boolean
}

export function toStoreOption(s: StoreRef, now: Date): StoreOption {
  return {
    id: s.id, name: s.name, shopName: s.shopName,
    code: s.domain ? s.domain.split('.')[0].split('-')[0] : null,
    timezone: s.timezone, city: tzCity(s.timezone),
    dayLabel: offsetDiffers(s.timezone, now) ? `dia de ${tzCity(s.timezone)}` : null,
    archived: s.archived,
  }
}

/** Keys hrefWith can override; null removes a key (loja null = Todas). */
export interface HrefOverrides {
  loja?: string | null
  periodo?: Period | null
  de?: string | null
  ate?: string | null
  parte?: boolean
}

/** The engine-style period of a resolution: the preset, or 'custom'. */
function enginePeriod(v: PeriodValue): Period {
  return v.kind === 'preset' ? v.preset : 'custom'
}

/** The comparison as every page names it: lib/period screenComparison (R6,
 *  R7), the same object the verdict and the KPI pills read. `noBase` marks a
 *  screen with no comparison at all (`none` holds R6's words). */
export interface PageComparison extends Comparison, ScreenComparison {
  noBase: boolean
}

function pageComparison(r: Resolution): PageComparison {
  const c = screenComparison(r)
  return { ...c, noBase: c.none !== null }
}

// ─── The server helper ───────────────────────────────────────────────────────

export interface PageContext {
  viewer: Viewer
  isOwner: boolean
  /** The period facts of every store the viewer may see. */
  viewerStores: ViewerStores
  /** What was asked (scope is always what is shown). */
  selection: Selection
  /** What it means now (lib/period resolve). */
  resolution: Resolution
  /** One-shot `vem`: the scope an R4 link came from. */
  cameFrom: ScopeRef | null
  /** Every note to show (resolution + landing), already deduplicated. */
  notes: Note[]
  /** The notes that describe how the window was adjusted, as one sentence
   *  (R9, R15): the header's "período ajustado" chip. Null when none. */
  rangeNote: string | null
  /** The landing announcement and other notes for the line under the header. */
  noteLine: string | null

  // ── the window, for pages (all derived from `resolution`) ──
  period: Period
  range: DateRange
  rangeLabel: string
  periodLabel: string
  periodPhrase: string
  comparison: PageComparison
  comparisonRangeLabel: string
  comparisonText: string
  timezone: string
  today: string
  partial: boolean
  minutesIntoDay: number
  partialLabel: string | null
  /** An archived store's archive day (store calendar), else null. */
  archivedOn: string | null
  /** The days of a window that runs past the archive day that were read. */
  readRange: DateRange | null

  // ── stores and scope ──
  /** Active stores the viewer may see, in the picker's order. */
  stores: StoreRef[]
  storeOptions: StoreOption[]
  /** "Todas as lojas" is offered (two active stores or more). */
  allowAll: boolean
  scope: 'store' | 'all'
  mode: 'either' | 'store' | 'all'
  store: StoreRef | null
  storeOption: StoreOption | null
  selected: StoreRef[]
  storeIds: string[]
  scopeName: string
  /** The store a link from Todas to a one-store page opens: the remembered
   *  store when valid, else the first active store (R5). Null without stores. */
  rememberedStoreId: string | null
  params: PageParams
  /** The validated page keys of this URL (R14). */
  pageKeys: Record<string, string>
  split: boolean
  splitFactor: number
  part: (v: number) => number
  /** A link keeping the selection (R3). An override of `loja` that changes the
   *  scope is an R4 link (lib/period carry): the period travels as asked,
   *  resolved on the target's clock, and `vem` lets the target announce it. */
  hrefWith: (path: string, overrides?: HrefOverrides) => string
  /** R4: a link to another store or Todas, or null when the viewer cannot see
   *  it (render the text without a link). */
  scopeHref: (path: string, target: ScopeRef) => string | null
  /** R4's announcement for a link from this page to `target`. */
  announceTo: (target: ScopeRef) => Announcement | null
  /** The help-line clause of a table of store rows (R4): the rows whose
   *  dates differ, or null (lib/period rowsAnnouncement). */
  rowsAnnouncement: (storeIds: readonly string[]) => string | null
  /** A store-fact date beside this window (R11 dateBeside). */
  dateBeside: (date: string) => string
  now: Date
}

export interface PageContextOptions {
  /** The page's path ('/', '/campaigns', '/creatives/123'): the canonical URL
   *  is built on it. */
  path: string
  /** 'either' (default): ?loja=todas shows Todas, anything else one store.
   *  'store': always one store. 'all': always Todas (the overview page). */
  scope?: 'either' | 'store' | 'all'
  now?: Date
}

function sameUrlQuery(sp: SearchParams, url: string): boolean {
  const q = new URLSearchParams(url.split('?')[1]?.split('#')[0] ?? '')
  const keys = Object.keys(sp).filter(k => sp[k] !== undefined)
  if (keys.length !== [...q.keys()].length) return false
  return keys.every(k => {
    const v = sp[k]
    if (Array.isArray(v) && v.length !== 1) return false
    return q.get(k) === (Array.isArray(v) ? v[0] : v)
  })
}

/**
 * Resolve the page's viewer, store(s) and window from the URL.
 * Redirects to /sign-in without a viewer, to the canonical URL when the URL
 * is spelled otherwise (R15); 404 for a store the viewer cannot see.
 */
export async function getPageContext(
  searchParams: SearchParams | Promise<SearchParams>, opts: PageContextOptions,
): Promise<PageContext> {
  const sp = await searchParams
  const now = opts.now ?? new Date() // clock-ok: request instant (injectable through opts.now)
  const viewer = await getViewer()
  if (!viewer) redirect('/sign-in')
  const isOwner = viewer.kind === 'owner'
  const mode = opts.scope ?? 'either'

  const all = await listStores(viewer, { includeArchived: true })
  const vs = await viewerStoresOf(all)
  const jar = await cookies()
  const remembered = jar.get(ACTIVE_STORE_COOKIE)?.value ?? null
  const parsed = parseDesktop(sp, { pathname: opts.path, viewer: vs, remembered, now })
  if (parsed.notFound) notFound()
  if (parsed.selection) {
    // The canonical URL holds exactly the state, the page's declared keys
    // (its OAuth flags included, lib/period PAGE_KEYS) and the one-shot keys:
    // an unknown aba or key is dropped, never kept as typed (R15).
    const target = parsed.canonical
    const path = target.split('?')[0]
    if (path !== opts.path || !sameUrlQuery(sp, target)) {
      // An invalid remembered store is cleared by a route handler (a page
      // cannot set cookies) that then lands on the canonical URL.
      if (parsed.forgetRemembered) redirect(`/api/active-store/forget?to=${encodeURIComponent(target)}`)
      redirect(target)
    }
  }
  const sel: Selection = parsed.selection ?? { scope: { kind: 'all' }, period: preset('7d'), split: false }

  const scopeAll = sel.scope.kind === 'all'
  const byId = new Map(all.map(s => [s.id, s]))
  const stores = vs.active.map(f => byId.get(f.id)).filter((s): s is StoreRef => !!s)
  const store = sel.scope.kind === 'store' ? byId.get(sel.scope.id) ?? null : null
  const selected = scopeAll ? stores : store ? [store] : []

  const base = resolve(sel, vs, now)
  const landed = landingNotes(parsed.notes, parsed.cameFrom, base, vs, now)
  const resolution = landed.length ? resolve(sel, vs, now, { notes: landed }) : base

  const fitCodes = new Set(['future_start', 'future_end', 'too_long', 'floor', 'too_early', 'bad_param', 'incomplete'])
  const fit = resolution.notes.filter(n => fitCodes.has(n.code))
  const lineCodes = new Set(['scope_dates_differ', 'left_archive', 'remembered_gone', 'single_store', 'starts_inside', 'partial_base'])
  // R9: the header shows the "período ajustado" chip AND the note line, so a
  // fit ("28–30 nov ainda não começou em Brasília: mostrando Hoje (24 nov).")
  // is read, not hidden in the chip's title.
  const line = resolution.notes.filter(n => fitCodes.has(n.code) || lineCodes.has(n.code))
  const member = resolution.members[0] ?? null
  const storeFacts = store ? findStore(vs, store.id) : null
  const comparison = pageComparison(resolution)
  const today = resolution.clockToday
  const splitFactor = sel.split ? SPLIT_SHARE : 1
  const params: PageParams = {
    loja: scopeAll ? ALL_STORES : store?.id ?? null,
    periodo: enginePeriod(sel.period),
    de: sel.period.kind === 'dates' ? sel.period.from : null,
    ate: sel.period.kind === 'dates' ? sel.period.to : null,
    parte: sel.split,
  }
  const dateCtx = { window: resolution.window, comparison: resolution.comparison?.range ?? null, clockToday: today }

  const hrefWith = (path: string, o: HrefOverrides = {}): string => {
    let next: Selection = sel
    if ('loja' in o) {
      const target: ScopeRef = !o.loja || o.loja === ALL_STORES ? { kind: 'all' } : { kind: 'store', id: o.loja }
      if (!sameScope(target, sel.scope)) {
        const c = carry(sel, target, vs, 'desktop')
        next = c ? c.selection : { ...sel, scope: target }
      }
    }
    if ('periodo' in o || 'de' in o || 'ate' in o) {
      // The URL's own parser (validated, normalised dates): never a second
      // spelling of the period (R3).
      const parsed = parsePeriod({ periodo: o.periodo ?? null, de: o.de ?? null, ate: o.ate ?? null })
      next = { ...next, period: parsed.value ?? preset('7d') }
    }
    if ('parte' in o) next = { ...next, split: !!o.parte }
    // lib/period vemFor: a link that sets its own period (the archived list's
    // "Abrir histórico") carries no vem — Todas never showed those dates.
    return desktopHref(path, next, {}, { vem: vemFor(sel, next, id => !!findStore(vs, id)?.archivedOn) })
  }

  return {
    viewer, isOwner, viewerStores: vs, selection: sel, resolution, cameFrom: parsed.cameFrom,
    notes: resolution.notes,
    rangeNote: fit.length ? notesText(fit) : null,
    noteLine: line.length ? notesText(line) : null,

    period: enginePeriod(resolution.effective),
    range: resolution.window,
    rangeLabel: resolution.label.range,
    periodLabel: sel.period.kind === 'preset' ? resolution.label.short : resolution.label.range,
    periodPhrase: resolution.label.phrase,
    comparison,
    comparisonRangeLabel: comparison.rangeText || formatRangeLabel({ from: comparison.from, to: comparison.to }, today),
    comparisonText: comparison.none ?? comparison.full,
    timezone: resolution.clockTz,
    today,
    partial: resolution.partial,
    minutesIntoDay: resolution.minutesIntoDay,
    partialLabel: resolution.partialUntil ? `parcial · até ${resolution.partialUntil}` : null,
    archivedOn: storeFacts?.archivedOn ?? null,
    readRange: member?.state === 'clamped' && member.read && member.read.to < resolution.window.to ? member.read : null,

    stores,
    storeOptions: stores.map(s => toStoreOption(s, now)),
    allowAll: vs.allowsAll,
    scope: scopeAll ? 'all' : 'store',
    mode,
    store,
    storeOption: store ? toStoreOption(store, now) : null,
    selected,
    storeIds: selected.map(s => s.id),
    scopeName: scopeAll ? 'Todas as lojas' : store?.name ?? 'Nenhuma loja',
    rememberedStoreId: vs.active.find(s => s.id === remembered)?.id ?? vs.active[0]?.id ?? null,
    params,
    pageKeys: parsed.pageKeys,
    split: sel.split,
    splitFactor,
    part: (v: number) => v * splitFactor,
    hrefWith,
    scopeHref: (path, target) => scopeHref(path, sel, target, vs),
    announceTo: target => announce(sel, sel.scope, target, vs, now),
    rowsAnnouncement: ids => rowsAnnouncement(sel, ids, vs, now),
    dateBeside: (date: string) => dateBeside(date, dateCtx),
    now,
  }
}

/** The sidebar footer's "Fuso": the clock the page counts days in. */
export function clockLabel(ctx: Pick<PageContext, 'resolution'>): string {
  return ctx.resolution.clockNote
}

// ─── The tab title (and the 404 title) ───────────────────────────────────────

export type RouteParams = Record<string, string | string[] | undefined>

export interface PageMetadataOptions {
  /** The page's getPageContext scope: 'all' ignores ?loja, so it never 404s on it. */
  scope?: 'either' | 'store' | 'all'
  /** Whatever else the page 404s on (a creative id, say): false → not found. */
  exists?: (params: RouteParams, searchParams: SearchParams) => Promise<boolean>
}

const firstOf = (v: string | string[] | undefined): string | null => {
  const s = Array.isArray(v) ? v[0] : v
  const t = typeof s === 'string' ? s.trim() : ''
  return t ? t : null
}

/**
 * generateMetadata for a page built on getPageContext. The 404 rule is
 * repeated here because the root loading.tsx starts streaming before the page
 * runs, so the page's own notFound() comes after its static <title> is out.
 * Same rule as getPageContext: a ?loja id the viewer cannot see is a 404.
 */
export function pageMetadata(title: Metadata['title'], opts: PageMetadataOptions = {}) {
  return async function generateMetadata(
    { params, searchParams }: { params?: Promise<RouteParams>; searchParams: Promise<SearchParams> },
  ): Promise<Metadata> {
    const sp = await searchParams
    const loja = firstOf(sp.loja)
    if ((opts.scope ?? 'either') !== 'all' && loja && loja !== ALL_STORES) {
      const viewer = await getViewer()
      if (viewer) {
        const all = await listStores(viewer, { includeArchived: true })
        if (!all.some(s => s.id === loja)) notFound()
      }
    }
    if (opts.exists && !(await opts.exists((await params) ?? {}, sp))) notFound()
    return { title }
  }
}
