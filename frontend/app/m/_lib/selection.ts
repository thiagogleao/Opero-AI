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

import { isIsoDate, isPeriod, PERIODS, type Period } from '@/lib/engine/dates'
import type { DetailSection } from '@/lib/views/mobileDetail'

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
 * one the owner may open (active or archived).
 */
export function resolveView(url: Raw, stored: Raw, knownStore: (id: string) => boolean): ViewState {
  const lojaOk = (v: unknown): v is string => typeof v === 'string' && (v === ALL || knownStore(v))
  const loja = lojaOk(url.loja) ? url.loja : lojaOk(stored.loja) ? stored.loja : ALL
  const period = periodOf(url) ?? periodOf(stored) ?? { periodo: DEFAULT_PERIOD, de: null, ate: null }
  const aba = isTab(url.aba) ? url.aba : url.aba === undefined && isTab(stored.aba) ? stored.aba : null
  return { sel: { loja, ...period }, aba }
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
