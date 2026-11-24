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

import {
  anchorTz, formatRange, isIsoDate, isPeriod, PERIODS, REFERENCE_TZ, resolveRange, type DateRange, type Period,
} from '@/lib/engine/dates'
import type { DetailSection } from '@/lib/views/mobileDetail'
import {
  fitCustomRange, MAX_WINDOW_DAYS, MIN_WINDOW_DATE, MIN_WINDOW_LABEL, tooEarlyRangeError, type RangeCut,
} from '@/lib/views/portfolioLimits'

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
  /**
   * Only on custom dates a store row of "Todas" opened (storeRowSelection),
   * never on dates the owner picked: the preset the owner had chosen ("Hoje",
   * "7 dias"…). The dates belong to that one store and that one day — any chip
   * goes back to the preset (chipSelection), storage keeps the preset instead
   * of the dates (toStorage), and once Todas' calendar moves on (midnight, a
   * reopen days later) the preset comes back by itself (expireRowDates).
   * Absent otherwise (never null).
   */
  rowPreset?: Period
}

export interface ViewState {
  sel: Selection
  aba: DetailSection | null
}

export const isTab = (v: unknown): v is DetailSection => typeof v === 'string' && TABS.some(t => t.key === v)

/** Raw, unvalidated values from one source (URL or storage). `volta` is the
 *  URL's name for Selection.rowPreset. */
interface Raw { loja?: unknown; periodo?: unknown; de?: unknown; ate?: unknown; aba?: unknown; volta?: unknown }

type PeriodPart = Pick<Selection, 'periodo' | 'de' | 'ate' | 'rowPreset'>

function periodOf(r: Raw): PeriodPart | null {
  if (!isPeriod(r.periodo)) return null
  if (r.periodo !== 'custom') return { periodo: r.periodo, de: null, ate: null }
  // "Escolher datas" counts only with both dates: a half-chosen range would
  // otherwise silently become "today" somewhere down the line.
  if (!isIsoDate(r.de) || !isIsoDate(r.ate)) return null
  const [de, ate] = r.de <= r.ate ? [r.de, r.ate] : [r.ate, r.de]
  // Wholly before the first date anything is priced from (portfolioLimits):
  // malformed, as on the desktop (lib/views/page parsePageParams).
  if (ate < MIN_WINDOW_DATE) return null
  return isPeriod(r.volta) && r.volta !== 'custom'
    ? { periodo: 'custom', de, ate, rowPreset: r.volta }
    : { periodo: 'custom', de, ate }
}

export function rawFromSearch(search: string | URLSearchParams): Raw {
  const sp = typeof search === 'string' ? new URLSearchParams(search) : search
  const get = (k: string) => sp.get(k) ?? undefined
  return { loja: get('loja'), periodo: get('periodo'), de: get('de'), ate: get('ate'), aba: get('aba'), volta: get('volta') }
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
 * numbers do not use. With `todasRange` (a preset read on Todas' calendar)
 * dates a store row opened are dropped for the owner's preset once they are
 * no longer that row's (expireRowDates): a reload the next morning opens
 * "Hoje", not yesterday frozen.
 */
export function resolveView(
  url: Raw, stored: Raw, knownStore: (id: string) => boolean, todayOf?: (loja: string) => string,
  todasRange?: (p: Period) => DateRange,
): ViewState {
  const lojaOk = (v: unknown): v is string => typeof v === 'string' && (v === ALL || knownStore(v))
  const loja = lojaOk(url.loja) ? url.loja : lojaOk(stored.loja) ? stored.loja : ALL
  const period = periodOf(url) ?? periodOf(stored) ?? { periodo: DEFAULT_PERIOD, de: null, ate: null }
  const aba = isTab(url.aba) ? url.aba : url.aba === undefined && isTab(stored.aba) ? stored.aba : null
  let sel: Selection = { loja, ...period }
  // Row dates belong to one store: on Todas they are just the preset.
  if (sel.rowPreset) sel = loja === ALL ? presetOf(sel) : todasRange ? expireRowDates(sel, todasRange) : sel
  return { sel: todayOf ? clampSelection(sel, todayOf(loja)) : sel, aba }
}

/**
 * What happened to a link's custom range on its way to the screen, in words,
 * or null when it is shown as asked. resolveView cuts it the way the server
 * will (clampSelection), so the server never needs to cut it and never sends
 * its rangeNote: a link for 1 jan 2024 – 30 dez 2026 opened "24 nov 2025 – 24
 * nov 2026" with no word of why. Said with the period sheet's reasons. `sel`
 * is what resolveView chose; nothing is said when it did not take the link's
 * dates (another period, or dates a store row opened, which go back to their
 * preset by design).
 */
export function linkRangeNotice(url: Raw, sel: Selection, today: string): string | null {
  const asked = periodOf(url)
  if (!asked || asked.periodo !== 'custom' || asked.rowPreset || !asked.de || !asked.ate) return null
  const r = customRange(asked.de, asked.ate, today)
  if (!r) return null
  const askedText = formatRange({ from: asked.de, to: asked.ate }, today)
  if (!r.ok) {
    // A start after today: clampSelection opened "Hoje" instead.
    return sel.periodo === 'today' ? `As datas do link (${askedText}) ainda não chegaram: mostrando Hoje.` : null
  }
  if (!r.clamped && !r.cut) return null
  if (sel.periodo !== 'custom' || sel.de !== r.from || sel.ate !== r.to) return null
  const why = [
    r.cut === 'long' ? `só os últimos ${MAX_WINDOW_DAYS} dias (o máximo de uma vez)` : null,
    r.cut === 'floor' ? `a partir de ${MIN_WINDOW_LABEL} (nada antes disso entra)` : null,
    r.clamped ? 'até hoje (o resto ainda não aconteceu)' : null,
  ].filter((x): x is string => x !== null)
  return `O link pedia ${askedText}. Mostrando ${formatRange({ from: r.from, to: r.to }, today)}: ${why.join(' e ')}.`
}

/**
 * The store a link names that the owner cannot open (neither active nor
 * archived), or null. resolveView falls back to the stored store for it; the
 * screen must then say the numbers are not the link's store
 * (viewStore takeLinkNotice), as it does for a store that answers 404.
 */
export function unknownLinkStore(url: Raw, knownStore: (id: string) => boolean): string | null {
  const v = url.loja
  return typeof v === 'string' && v !== '' && v !== ALL && !knownStore(v) ? v : null
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

/** A preset as Todas reads it at `now` (the server's buildPortfolio window:
 *  resolveRange on the anchor calendar) — what a store row opens. */
export function todasRangeAt(active: readonly StoreClock[], now: Date): (p: Period) => DateRange {
  const tz = selectionTz(ALL, active)
  return p => resolveRange(p, tz, null, null, now)
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
  // Row dates the store cannot read as they are are no longer the row's: the
  // owner's preset, not a "Hoje" or a cut range nobody picked.
  if (de > today) return sel.rowPreset ? presetOf(sel) : { ...sel, periodo: 'today', de: null, ate: null }
  const r = fitCustomRange(de, ate, today)
  if (r.from === sel.de && r.to === sel.ate) return sel
  return sel.rowPreset ? presetOf(sel) : { ...sel, de: r.from, ate: r.to }
}

/**
 * The selection a store row of "Todas" opens. "Todas" reads every store on
 * the same calendar dates (its own timezone); a store alone reads its own
 * clock. So a store whose today is not the answer's (Hibikura from 12h in
 * Brasília) opens the dates its row showed, as custom dates — keeping the
 * preset opened Tokyo's next day (a "+$267" row landed on "−$58,78"). The
 * desktop store rows do the same (components/portfolio/model
 * resumoLinkOverrides). Every other store keeps the period as it is.
 *
 * The dates carry the owner's preset with them (rowPreset): they are that
 * store's view of that day, not a period the owner chose. Without it the
 * next chip carried "23 nov" to Todas and MOKOO, and a reopen the next
 * morning restored yesterday frozen instead of "Hoje".
 */
export function storeRowSelection(
  row: { id: string; storeToday: string },
  answer: { period: Period; range: { from: string; to: string }; anchorToday: string },
): Partial<Selection> {
  if (row.storeToday === answer.anchorToday || answer.period === 'custom') return { loja: row.id }
  return { loja: row.id, periodo: 'custom', de: answer.range.from, ate: answer.range.to, rowPreset: answer.period }
}

/** The owner's own preset in place of dates a store row opened. */
function presetOf(sel: Selection): Selection {
  return sel.rowPreset ? { loja: sel.loja, periodo: sel.rowPreset, de: null, ate: null } : sel
}

/**
 * A tap that changes part of the selection (a period, a range, a store row).
 * Row dates (rowPreset) never outlive the tap that follows them: a period the
 * owner picks replaces them, and only a store row's own patch brings new ones.
 */
export function patchSelection(sel: Selection, patch: Partial<Selection>): Selection {
  return { loja: sel.loja, periodo: sel.periodo, de: sel.de, ate: sel.ate, ...patch }
}

/**
 * The selection a store chip (Todas or a store) opens. The period stays —
 * except dates a store row opened, which were that store's only: leaving it
 * (any chip, the same store's included) brings back the owner's preset, so
 * "Todas · Hoje" → Hibikura row → "Todas" is "Todas · Hoje" again.
 */
export function chipSelection(sel: Selection, loja: string): Selection {
  return sel.rowPreset ? { ...presetOf(sel), loja } : { ...sel, loja }
}

/**
 * Row dates hold while they are what the row would open now: the preset read
 * on Todas' calendar (`todasRange`, lib/engine/dates resolveRange on
 * selectionTz(ALL)). Once that calendar moves on — midnight in Brasília, or a
 * reopen days later — the owner's preset comes back, so a "Hoje" keeps rolling
 * to the new day. Returns `sel` itself when nothing changes.
 */
export function expireRowDates(sel: Selection, todasRange: (p: Period) => DateRange): Selection {
  if (!sel.rowPreset) return sel
  if (sel.periodo !== 'custom') return patchSelection(sel, {})
  // Row dates are one store's: on Todas they are just the preset.
  if (sel.loja === ALL) return presetOf(sel)
  const r = todasRange(sel.rowPreset)
  return r.from === sel.de && r.to === sel.ate ? sel : presetOf(sel)
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

/** ?loja=&periodo=[&de=&ate=[&volta=]][&aba=] — always explicit, so a copied
 *  or restored URL means the same thing whatever the defaults become. Row
 *  dates carry their preset (`volta`), so a reload knows they were not picked. */
export function toSearch(v: ViewState): string {
  const q = new URLSearchParams({ loja: v.sel.loja, periodo: v.sel.periodo })
  if (v.sel.periodo === 'custom' && v.sel.de && v.sel.ate) {
    q.set('de', v.sel.de); q.set('ate', v.sel.ate)
    if (v.sel.rowPreset) q.set('volta', v.sel.rowPreset)
  }
  if (v.aba) q.set('aba', v.aba)
  return q.toString()
}

/** What the next launch restores: the owner's choices only — row dates are
 *  stored as the preset they came from. */
export function toStorage(v: ViewState): string {
  const sel = v.sel.rowPreset ? presetOf(v.sel) : v.sel
  return JSON.stringify({ loja: sel.loja, periodo: sel.periodo, de: sel.de, ate: sel.ate, aba: v.aba })
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
