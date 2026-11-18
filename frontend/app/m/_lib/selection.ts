/**
 * What the phone is looking at: the store ("todas" or an id), the period and,
 * optionally, the open detail tab. Pure — shared by the client store
 * (selectionStore.ts) and the tests.
 *
 * The selection lives in the URL (?loja=&periodo=&de=&ate=&aba=) and in
 * localStorage, and is restored from them on launch and on notification taps
 * (/m?loja=<id>&aba=campanhas). It only ever changes when the owner taps:
 * nothing — a slow answer, a poll, an "Atualizar" — may move it back.
 */

import { anchorTz, formatRange, isIsoDate, isPeriod, PERIODS, REFERENCE_TZ, type Period } from '@/lib/engine/dates'
import type { DetailSection } from '@/lib/views/mobileDetail'
import { fitCustomRange, MIN_WINDOW_DATE, tooEarlyRangeError, type RangeCut } from '@/lib/views/portfolioLimits'

export const ALL = 'todas'
export const DEFAULT_PERIOD: Period = 'today'
export const STORAGE_KEY = 'opero.m.selecao.v2'
export const TABS: { key: DetailSection; label: string }[] = [
  { key: 'campanhas', label: 'Campanhas' },
  { key: 'criativos', label: 'Criativos' },
  { key: 'produtos', label: 'Produtos' },
  { key: 'paises', label: 'Países' },
  { key: 'clientes', label: 'Clientes' },
]

export interface Selection {
  /** 'todas' or a store id. */
  loja: string
  periodo: Period
  /** Only with periodo 'custom' (both set), else null. */
  de: string | null
  ate: string | null
}

export interface ViewState {
  sel: Selection
  aba: DetailSection | null
}

export const isTab = (v: unknown): v is DetailSection => typeof v === 'string' && TABS.some(t => t.key === v)

/** Raw, unvalidated values from one source (URL or storage). */
interface Raw { loja?: unknown; periodo?: unknown; de?: unknown; ate?: unknown; aba?: unknown }

function periodOf(r: Raw): Pick<Selection, 'periodo' | 'de' | 'ate'> | null {
  if (!isPeriod(r.periodo)) return null
  if (r.periodo !== 'custom') return { periodo: r.periodo, de: null, ate: null }
  // "Escolher datas" counts only with both dates: a half-chosen range would
  // otherwise silently become "today" somewhere down the line.
  if (!isIsoDate(r.de) || !isIsoDate(r.ate)) return null
  const [de, ate] = r.de <= r.ate ? [r.de, r.ate] : [r.ate, r.de]
  // Wholly before the first date anything is priced from (portfolioLimits):
  // malformed, as on the desktop (lib/views/page parsePageParams).
  if (ate < MIN_WINDOW_DATE) return null
  return { periodo: 'custom', de, ate }
}

export function rawFromSearch(search: string | URLSearchParams): Raw {
  const sp = typeof search === 'string' ? new URLSearchParams(search) : search
  const get = (k: string) => sp.get(k) ?? undefined
  return { loja: get('loja'), periodo: get('periodo'), de: get('de'), ate: get('ate'), aba: get('aba') }
}

export function rawFromStorage(json: string | null): Raw {
  if (!json) return {}
  try {
    const v = JSON.parse(json) as unknown
    return v && typeof v === 'object' ? (v as Raw) : {}
  } catch {
    return {}
  }
}

/**
 * The view to open: each field from the URL when it is valid there, else from
 * storage, else the default (Todas · Hoje). `knownStore` says whether an id is
 * one the owner may open (active or archived). With `todayOf` (the selected
 * store's today, selectionTz) a custom range is read the way the server will
 * read it (clampSelection), so the period button never names dates the
 * numbers do not use.
 */
export function resolveView(
  url: Raw, stored: Raw, knownStore: (id: string) => boolean, todayOf?: (loja: string) => string,
): ViewState {
  const lojaOk = (v: unknown): v is string => typeof v === 'string' && (v === ALL || knownStore(v))
  const loja = lojaOk(url.loja) ? url.loja : lojaOk(stored.loja) ? stored.loja : ALL
  const period = periodOf(url) ?? periodOf(stored) ?? { periodo: DEFAULT_PERIOD, de: null, ate: null }
  const aba = isTab(url.aba) ? url.aba : url.aba === undefined && isTab(stored.aba) ? stored.aba : null
  const sel: Selection = { loja, ...period }
  return { sel: todayOf ? clampSelection(sel, todayOf(loja)) : sel, aba }
}

/** A store as the phone's selection needs it. */
export interface StoreClock { id: string; timezone: string }

/**
 * The calendar a selection is read on: the store's own timezone, or for Todas
 * the anchor of the active stores — lib/engine/dates anchorTz, the rule
 * buildPortfolio resolves the window with (Brasília for several stores).
 */
export function selectionTz(loja: string, active: readonly StoreClock[], archived: readonly StoreClock[] = []): string {
  if (loja === ALL) return anchorTz(active.map(s => s.timezone))
  return [...active, ...archived].find(s => s.id === loja)?.timezone || REFERENCE_TZ
}

/**
 * A custom range as the server will price it (lib/views/portfolioLimits
 * fitCustomRange: ordered, never past the selected store's today, never before
 * 1 jan 2000, at most the last 366 days). The server echoes the dates as sent,
 * so a deep link to 25–30 nov or Tokyo's "tomorrow" carried over to a
 * Brazilian store showed "25–30 nov" on the button over numbers for 18 nov,
 * and 1990–2026 would have named 37 years over the last one. A range that
 * starts after today has nothing of its own to show and becomes "Hoje" (what
 * the server would answer, under its real name). Returns `sel` itself when
 * nothing changes.
 */
export function clampSelection(sel: Selection, today: string): Selection {
  if (sel.periodo !== 'custom' || !sel.de || !sel.ate) return sel
  const [de, ate] = sel.de <= sel.ate ? [sel.de, sel.ate] : [sel.ate, sel.de]
  if (de > today) return { ...sel, periodo: 'today', de: null, ate: null }
  const r = fitCustomRange(de, ate, today)
  return r.from === sel.de && r.to === sel.ate ? sel : { ...sel, de: r.from, ate: r.to }
}

/** "MOKOO · 3–12 nov", "Todas · Hoje": a selection in words. A custom period
 *  names its dates ("Escolher datas" is the action, not the period). */
export function selectionPeriodLabel(sel: Pick<Selection, 'periodo' | 'de' | 'ate'>, today?: string): string {
  if (sel.periodo === 'custom') return sel.de && sel.ate ? formatRange({ from: sel.de, to: sel.ate }, today) : 'datas escolhidas'
  return periodLabel(sel.periodo)
}

export const selectionKey = (s: Selection) => `${s.loja}|${s.periodo}|${s.de ?? ''}|${s.ate ?? ''}`

export const sameSelection = (a: Selection | null, b: Selection | null) =>
  !!a && !!b && selectionKey(a) === selectionKey(b)

/** /api/mobile and /api/mobile/detail query for a selection. */
export function apiQuery(s: Selection): string {
  const q = new URLSearchParams({ period: s.periodo, store: s.loja === ALL ? 'all' : s.loja })
  if (s.periodo === 'custom' && s.de && s.ate) { q.set('from', s.de); q.set('to', s.ate) }
  return q.toString()
}

/** The request an answer says it answers (MobileRequestEcho / DetailRequestEcho). */
export interface Echo { store: string; period: string; from: string | null; to: string | null }

/** True when the answer is for exactly this selection; anything else is dropped. */
export function echoMatches(echo: Echo | null | undefined, s: Selection): boolean {
  if (!echo) return false
  const store = s.loja === ALL ? 'all' : s.loja
  const custom = s.periodo === 'custom'
  return echo.store === store && echo.period === s.periodo
    && (echo.from ?? null) === (custom ? s.de : null) && (echo.to ?? null) === (custom ? s.ate : null)
}

/** ?loja=&periodo=[&de=&ate=][&aba=] — always explicit, so a copied or
 *  restored URL means the same thing whatever the defaults become. */
export function toSearch(v: ViewState): string {
  const q = new URLSearchParams({ loja: v.sel.loja, periodo: v.sel.periodo })
  if (v.sel.periodo === 'custom' && v.sel.de && v.sel.ate) { q.set('de', v.sel.de); q.set('ate', v.sel.ate) }
  if (v.aba) q.set('aba', v.aba)
  return q.toString()
}

export function toStorage(v: ViewState): string {
  return JSON.stringify({ loja: v.sel.loja, periodo: v.sel.periodo, de: v.sel.de, ate: v.sel.ate, aba: v.aba })
}

export type CustomRange =
  | {
    ok: true; from: string; to: string
    /** the end was in the future and is now today */
    clamped: boolean
    /** longer than the 366 days priced at once ('long', only the last ones
     *  kept) or starting before 1 jan 2000 ('floor') */
    cut: RangeCut
  }
  | { ok: false; error: string }

/**
 * "Escolher datas": the range that will be applied, exactly. Ordered first,
 * then checked against today (the store's): a start after today is refused,
 * an end after today becomes today; then the server's limits
 * (portfolioLimits): nothing before 1 jan 2000, at most the last 366 days.
 * Ordering after clamping only the end produced "25–18 nov" (iOS Safari does
 * not enforce the inputs' max or min), which the server read as 18 nov and a
 * reload turned into "18–25 nov".
 */
export function customRange(de: string, ate: string, today: string): CustomRange | null {
  if (!isIsoDate(de) || !isIsoDate(ate)) return null
  const [from, to] = de <= ate ? [de, ate] : [ate, de]
  if (from > today) return { ok: false, error: 'A data inicial não pode passar de hoje' }
  const early = tooEarlyRangeError(from, to)
  if (early) return { ok: false, error: early }
  const r = fitCustomRange(from, to, today)
  return { ok: true, from: r.from, to: r.to, clamped: to > today, cut: r.cut }
}

export const PERIOD_MAIN: Period[] = ['today', 'yesterday', '7d', '30d']
export const PERIOD_MORE: Period[] = ['14d', 'mtd', 'lastmonth', '90d']

export function periodShort(p: Period): string {
  return PERIODS.find(x => x.key === p)?.short ?? p
}

export function periodLabel(p: Period): string {
  return PERIODS.find(x => x.key === p)?.label ?? p
}

// ─── Clocks ───────────────────────────────────────────────────────────────────

/** Minutes east of UTC of `tz` at `now`. */
export function tzOffsetMinutes(tz: string, now: Date = new Date()): number {
  try {
    const p = new Intl.DateTimeFormat('en-US', {
      timeZone: tz, hourCycle: 'h23', year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit',
    }).formatToParts(now)
    const n = (t: string) => Number(p.find(x => x.type === t)?.value ?? 0)
    const local = Date.UTC(n('year'), n('month') - 1, n('day'), n('hour') % 24, n('minute'))
    return Math.round((local - Math.floor(now.getTime() / 60000) * 60000) / 60000)
  } catch {
    return 0
  }
}

/**
 * Whether a store's clock reads differently from the phone's right now. Zone
 * NAMES are not compared: Belém and São Paulo are both UTC−3, and labelling
 * MOKOO "dia de Belém" on a São Paulo phone was noise.
 */
export function clockDiffers(storeTz: string, deviceTz: string, now: Date = new Date()): boolean {
  return tzOffsetMinutes(storeTz, now) !== tzOffsetMinutes(deviceTz, now)
}
