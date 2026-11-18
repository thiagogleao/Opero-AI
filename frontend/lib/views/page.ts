/**
 * getPageContext: what every desktop page means by "store" and "period".
 *
 * The URL is the state: ?loja=<storeId|todas>&periodo=<7d|today|…>&de=YYYY-MM-DD
 * &ate=YYYY-MM-DD&parte=50. Every server page resolves it here, once, so the
 * same link shows the same store and the same dates on every page, and links
 * between pages keep them (ctx.hrefWith). Pages never read searchParams for
 * these keys themselves.
 *
 *   const ctx = await getPageContext(searchParams)            // store or Todas
 *   const ctx = await getPageContext(searchParams, { scope: 'store' })  // one store
 *   const ctx = await getPageContext(searchParams, { scope: 'all' })    // Todas
 *
 * Who may see what is decided by lib/access only: an id the viewer cannot see
 * is a 404, no viewer redirects to /sign-in. Archived stores open by id (their
 * history) but never enter "Todas" or the picker.
 *
 * Dates are resolved on the server with lib/engine/dates in the store's own
 * timezone (one store) or on the reference clock, Brasília (Todas) — the same
 * rule buildPortfolio uses, so a page and the portfolio view agree.
 */

import { notFound, redirect } from 'next/navigation'
import { getViewer, listStores, resolveStore, type StoreRef, type Viewer } from '../access'
import {
  anchorTz, comparisonRange, isIsoDate, isPeriod, minutesIntoDay, PERIODS, resolveRange, todayInTz,
  type Comparison, type DateRange, type Period,
} from '../engine/dates'
import { dayOfLabel, formatClock, formatRangeLabel, tzCity } from '../format'
import { comparisonText, periodPhrase, SPLIT_SHARE } from './verdict'

export type SearchParams = Record<string, string | string[] | undefined>

/** ?loja value for "Todas as lojas". */
export const ALL_STORES = 'todas'
/** Desktop default: 7 complete days ending yesterday. */
export const DEFAULT_PERIOD: Period = '7d'

// ─── Pure parts (tested) ─────────────────────────────────────────────────────

/** The URL state, normalised. `loja` is the raw value (an id, 'todas' or null). */
export interface PageParams {
  loja: string | null
  periodo: Period
  de: string | null
  ate: string | null
  parte: boolean
}

const first = (v: string | string[] | undefined): string | null => {
  const s = Array.isArray(v) ? v[0] : v
  const t = typeof s === 'string' ? s.trim() : ''
  return t ? t : null
}

/**
 * Read the URL keys. Rules:
 *  - unknown or missing periodo → the default;
 *  - de + ate (both real dates) without periodo → a custom range;
 *  - periodo=custom without both dates → the default (never a silent "today");
 *  - parte=50 → the partner split; anything else → off.
 */
export function parsePageParams(sp: SearchParams, defaultPeriod: Period = DEFAULT_PERIOD): PageParams {
  const loja = first(sp.loja)
  const rawPeriod = first(sp.periodo)
  const de = first(sp.de)
  const ate = first(sp.ate)
  const dates = isIsoDate(de) && isIsoDate(ate)
  let periodo: Period = isPeriod(rawPeriod) ? rawPeriod : defaultPeriod
  if (!rawPeriod && dates) periodo = 'custom'
  if (periodo === 'custom' && !dates) periodo = defaultPeriod
  return {
    loja,
    periodo,
    de: periodo === 'custom' ? de : null,
    ate: periodo === 'custom' ? ate : null,
    parte: first(sp.parte) === '50',
  }
}

/** Everything a page says about its window. */
export interface PeriodWindow {
  period: Period
  range: DateRange
  /** "10–16 nov" / "17 nov". */
  rangeLabel: string
  /** "Últimos 7 dias", "Hoje", or the range for custom. */
  periodLabel: string
  /** For sentences: "nos últimos 7 dias", "hoje". */
  periodPhrase: string
  comparison: Comparison
  /** "3–9 nov". */
  comparisonRangeLabel: string
  /** "vs 7 dias anteriores (3–9 nov)" / "vs ontem até esta hora". */
  comparisonText: string
  /** Timezone the window was resolved in. */
  timezone: string
  /** Today in that timezone. */
  today: string
  /** The window includes today (numbers still moving). */
  partial: boolean
  /** Minutes into today in `timezone` (always set; meaningful when partial). */
  minutesIntoDay: number
  /** "parcial · até 13h38" when partial, else null. */
  partialLabel: string | null
}

export function resolvePeriodWindow(
  period: Period, de: string | null, ate: string | null, tz: string, now: Date = new Date(),
): PeriodWindow {
  const range = resolveRange(period, tz, de, ate, now)
  const today = todayInTz(tz, now)
  const comparison = comparisonRange(period, range, tz, now)
  const partial = range.to >= today && range.from <= today
  const minutes = minutesIntoDay(tz, now)
  const rangeLabel = formatRangeLabel(range, today)
  const preset = PERIODS.find(p => p.key === period)
  return {
    period, range, rangeLabel,
    periodLabel: period === 'custom' || !preset ? rangeLabel : preset.label,
    periodPhrase: periodPhrase(period, range, today),
    comparison,
    comparisonRangeLabel: formatRangeLabel({ from: comparison.from, to: comparison.to }, today),
    comparisonText: comparisonText(comparison, today),
    timezone: tz, today, partial, minutesIntoDay: minutes,
    partialLabel: partial ? `parcial · até ${formatClock(minutes)}` : null,
  }
}

/** Keys hrefWith can override; null removes a key. */
export interface HrefOverrides {
  loja?: string | null
  periodo?: Period | null
  de?: string | null
  ate?: string | null
  parte?: boolean
}

/**
 * A link to `path` that keeps the page state (loja, periodo, de, ate, parte).
 * The default period is left out of the URL; de/ate only travel with
 * periodo=custom. Query keys already in `path` win over the kept state, and a
 * #hash is preserved.
 */
export function buildHref(path: string, state: PageParams, overrides: HrefOverrides = {}, defaultPeriod: Period = DEFAULT_PERIOD): string {
  const [beforeHash, hash] = path.split('#', 2) as [string, string | undefined]
  const [pathname, query] = beforeHash.split('?', 2) as [string, string | undefined]
  const loja = 'loja' in overrides ? overrides.loja ?? null : state.loja
  let periodo = 'periodo' in overrides ? overrides.periodo ?? defaultPeriod : state.periodo
  let de = 'de' in overrides ? overrides.de ?? null : state.de
  let ate = 'ate' in overrides ? overrides.ate ?? null : state.ate
  const parte = 'parte' in overrides ? !!overrides.parte : state.parte
  if (periodo === 'custom' && !(isIsoDate(de) && isIsoDate(ate))) periodo = defaultPeriod
  if (periodo !== 'custom') { de = null; ate = null }

  const out = new URLSearchParams()
  if (loja) out.set('loja', loja)
  if (periodo !== defaultPeriod) out.set('periodo', periodo)
  if (de && ate) { out.set('de', de); out.set('ate', ate) }
  if (parte) out.set('parte', '50')
  // The path's own query keys (e.g. ?aba=x) are kept and win.
  if (query) for (const [k, v] of new URLSearchParams(query)) out.set(k, v)
  const qs = out.toString()
  return `${pathname}${qs ? `?${qs}` : ''}${hash ? `#${hash}` : ''}`
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
  /** "dia de Tóquio" when the store's day is not Brazil's. */
  dayLabel: string | null
  archived: boolean
}

export function toStoreOption(s: StoreRef): StoreOption {
  return {
    id: s.id, name: s.name, shopName: s.shopName,
    code: s.domain ? s.domain.split('.')[0].split('-')[0] : null,
    timezone: s.timezone, city: tzCity(s.timezone), dayLabel: dayOfLabel(s.timezone), archived: s.archived,
  }
}

// ─── The server helper ───────────────────────────────────────────────────────

export interface PageContext extends PeriodWindow {
  viewer: Viewer
  isOwner: boolean
  /** Active stores the viewer may see, oldest first (the picker). */
  stores: StoreRef[]
  storeOptions: StoreOption[]
  /** "Todas as lojas" is offered (owner, or a partner with 2+ stores). */
  allowAll: boolean
  /** 'store': one store; 'all': every active store of the viewer. */
  scope: 'store' | 'all'
  /** What the page asked for (opts.scope). The shell uses it so that picking
   *  "Todas" on a one-store page opens /overview, and picking a store on an
   *  all-stores page opens that store's Resumo, instead of doing nothing. */
  mode: 'either' | 'store' | 'all'
  /** The store shown, or null for Todas (and when the viewer has no store). */
  store: StoreRef | null
  /** The stores in scope: [store] or every active store. */
  selected: StoreRef[]
  storeIds: string[]
  /** What the shell shows as the current choice ("MOKOO", "Todas as lojas"). */
  scopeName: string
  /** The normalised URL state, with loja resolved (id or 'todas'). */
  params: PageParams
  /** Partner view (?parte=50): money results are halved. */
  split: boolean
  splitFactor: number
  /** v × splitFactor — for profit, profit/order, cash result, refunds only. */
  part: (v: number) => number
  /** Link to another page (or this one) keeping loja/periodo/de/ate/parte. */
  hrefWith: (path: string, overrides?: HrefOverrides) => string
  now: Date
}

export interface PageContextOptions {
  /** 'either' (default): ?loja=todas shows Todas, anything else one store.
   *  'store': always one store (Todas falls back to the remembered store).
   *  'all': always Todas, whatever ?loja says (the overview page). */
  scope?: 'either' | 'store' | 'all'
  defaultPeriod?: Period
  now?: Date
}

/**
 * Resolve the page's viewer, store(s) and window from the URL.
 * Redirects to /sign-in without a viewer; 404 for a store the viewer cannot see.
 */
export async function getPageContext(
  searchParams: SearchParams | Promise<SearchParams>, opts: PageContextOptions = {},
): Promise<PageContext> {
  const sp = await searchParams
  const now = opts.now ?? new Date()
  const defaultPeriod = opts.defaultPeriod ?? DEFAULT_PERIOD
  const viewer = await getViewer()
  if (!viewer) redirect('/sign-in')

  const raw = parsePageParams(sp, defaultPeriod)
  const isOwner = viewer.kind === 'owner'
  const mode = opts.scope ?? 'either'

  let stores: StoreRef[]
  let store: StoreRef | null = null
  const wantsAll = mode === 'all' || (mode === 'either' && raw.loja === ALL_STORES)
  if (wantsAll) {
    stores = await listStores(viewer)
  } else {
    const urlId = raw.loja && raw.loja !== ALL_STORES ? raw.loja : null
    const r = await resolveStore(viewer, urlId)
    stores = r.stores
    // A specific id the viewer cannot see is a 404, never another store.
    if (urlId && r.store?.id !== urlId) notFound()
    store = r.store
  }
  const allowAll = isOwner || stores.length > 1
  const scope: 'store' | 'all' = wantsAll && (allowAll || mode === 'all') ? 'all' : 'store'
  if (scope === 'store' && !store) {
    // ?loja=todas for a one-store partner, or scope 'store' after Todas.
    store = stores[0] ?? null
  }
  const selected = scope === 'all' ? stores : store ? [store] : []
  const tz = anchorTz(selected.map(s => s.timezone))
  const win = resolvePeriodWindow(raw.periodo, raw.de, raw.ate, tz, now)

  const params: PageParams = {
    ...raw,
    loja: scope === 'all' ? ALL_STORES : store?.id ?? null,
    de: raw.periodo === 'custom' ? win.range.from : null,
    ate: raw.periodo === 'custom' ? win.range.to : null,
  }
  const splitFactor = raw.parte ? SPLIT_SHARE : 1

  return {
    ...win,
    viewer, isOwner,
    stores,
    storeOptions: stores.map(toStoreOption),
    allowAll,
    scope, mode, store, selected,
    storeIds: selected.map(s => s.id),
    scopeName: scope === 'all' ? 'Todas as lojas' : store?.name ?? 'Nenhuma loja',
    params,
    split: raw.parte,
    splitFactor,
    part: (v: number) => v * splitFactor,
    hrefWith: (path, overrides) => buildHref(path, params, overrides, defaultPeriod),
    now,
  }
}
