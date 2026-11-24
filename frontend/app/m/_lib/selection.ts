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
  anchorTz, formatRange, isIsoDate, isPeriod, PERIODS, REFERENCE_TZ, resolveRange, shiftDate, type DateRange, type Period,
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
  /**
   * Only on a period a notification link opened (linkDayOf), never on one the
   * owner picked: the owner's own period it stands in for. Like row dates, the
   * notification's day belongs to that link — any chip goes back to `own`
   * (chipSelection), storage keeps `own` (toStorage), and once the calendar the
   * link was opened on moves on, `own` comes back by itself (expireLinkDay). A
   * sale push from last night tapped in the morning saved "Ontem" for good,
   * and one two days old a fixed date that never rolled. Absent otherwise.
   */
  linkDay?: LinkDay
}

/** A period as the owner chose it (no marker): what `linkDay.own` holds. */
export type OwnPeriod = Pick<Selection, 'periodo' | 'de' | 'ate'>

/** Selection.linkDay. */
export interface LinkDay {
  /** The day the notification was about (its link's `dia`): for a "Hoje"
   *  link the day it names, for another preset the day it was sent on. */
  dia: string
  /** The owner's own period, as storage held it when the link was opened. */
  own: OwnPeriod
  /** The calendar the link was opened on (ALL or a store id, read with
   *  selectionTz) and its today then: the marker lasts while that today does. */
  on: { loja: string; today: string }
  /** The link's own preset when it is not "Hoje" (the scale push's "7 dias",
   *  lib/alerts runScaleChecks): shown as it is, never read as a day.
   *  Absent for "Hoje" links. */
  asked?: Period
}

export interface ViewState {
  sel: Selection
  aba: DetailSection | null
  /**
   * Only when a notification link opened a tab other than the one the owner
   * had (the scale push opens Campanhas): the owner's own tab, which storage
   * keeps (toStorage) and a store chip brings back (chipView). The owner
   * touching a tab makes the open one theirs (drop this). Absent otherwise.
   * The scale push's Campanhas was stored as the owner's tab and every later
   * launch opened with it expanded.
   */
  ownAba?: DetailSection | null
}

export const isTab = (v: unknown): v is DetailSection => typeof v === 'string' && TABS.some(t => t.key === v)

/** Raw, unvalidated values from one source (URL or storage). `volta` is the
 *  URL's name for Selection.rowPreset; `dia` is the date a notification's
 *  "Hoje" is about, or the day a notification with another preset was sent
 *  (lib/alerts storeUrl), and marks the period — and a tab it opens — as the
 *  link's (Selection.linkDay, ViewState.ownAba; URL only, never stored). */
interface Raw { loja?: unknown; periodo?: unknown; de?: unknown; ate?: unknown; aba?: unknown; volta?: unknown; dia?: unknown }

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
  return {
    loja: get('loja'), periodo: get('periodo'), de: get('de'), ate: get('ate'), aba: get('aba'), volta: get('volta'), dia: get('dia'),
  }
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
  const own = periodOf(stored) ?? { periodo: DEFAULT_PERIOD, de: null, ate: null }
  const linkPeriod = periodOf(url)
  let period: PeriodPart & { linkDay?: LinkDay } = own
  if (linkPeriod && todayOf) {
    // A notification's "Hoje" is the day it was about (notificationDay), read
    // on the calendar of the store it opens — and it stays the link's: the
    // owner's own period comes back on the next chip, launch or day.
    period = notificationDay(linkPeriod, url.dia, todayOf(loja))
    const onLoja = period.rowPreset ? ALL : loja
    const linkDay = linkDayOf(url, period, own, { loja: onLoja, today: todayOf(onLoja) })
    if (linkDay) period = { ...period, linkDay }
  } else if (linkPeriod) {
    period = linkPeriod
  }
  const storedAba = isTab(stored.aba) ? stored.aba : null
  const aba = isTab(url.aba) ? url.aba : url.aba === undefined ? storedAba : null
  let sel: Selection = { loja, ...period }
  // Row dates belong to one store: on Todas they are just the preset.
  if (sel.rowPreset) sel = loja === ALL ? presetOf(sel) : todasRange ? expireRowDates(sel, todasRange) : sel
  // Row dates gone back to the notification's own preset may now be what the
  // owner had anyway: no marker for nothing.
  if (sel.linkDay && !sel.rowPreset && samePeriod(sel, sel.linkDay.own)) sel = { loja: sel.loja, ...sel.linkDay.own }
  const view: ViewState = { sel: todayOf ? clampSelection(sel, todayOf(loja)) : sel, aba }
  // A notification's tab is the link's too: storage keeps the owner's.
  return isNotificationLink(url) && isTab(url.aba) && url.aba !== storedAba ? { ...view, ownAba: storedAba } : view
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
 * The period a notification link opens. A push says "hoje" about the day it
 * was sent on (lib/alerts storeUrl `dia`, on the calendar of the store it
 * opens; Todas' for the daily summary): "Hoje" while it is still that day
 * there, else that day itself — "Ontem" the day after, the single date later.
 * A Hibikura alert about Tokyo's 23 nov tapped at 12h05 in Brasília opened
 * Tokyo's 24 nov at 00h05 ("cedo demais", about $0), and the 21h summary
 * tapped the next morning a nearly empty Todas · Hoje. A date that is not one
 * (or not before today: a phone clock behind the server's) changes nothing.
 */
export function notificationDay(p: PeriodPart, dia: unknown, today: string): PeriodPart {
  if (p.periodo !== 'today' || !isIsoDate(dia) || dia >= today || dia < MIN_WINDOW_DATE) return p
  if (dia === shiftDate(today, -1)) return { periodo: 'yesterday', de: null, ate: null }
  return { periodo: 'custom', de: dia, ate: dia }
}

/**
 * Whether a link is a notification's: it names its day (`dia`) on a preset —
 * "Hoje" (lib/alerts storeUrl, summaryUrl, the sale webhook) or another one
 * (the scale push's "7 dias") — or on the row dates a store row opened from
 * such a period, as toSearch writes them back (custom + volta). Nothing else
 * writes `dia`.
 */
function isNotificationLink(url: Raw): boolean {
  if (!isIsoDate(url.dia) || url.dia < MIN_WINDOW_DATE || !isPeriod(url.periodo)) return false
  return url.periodo !== 'custom' || isPeriod(url.volta)
}

/**
 * The marker of a period a notification link opened (Selection.linkDay), or
 * null when the link is not a notification's (isNotificationLink) or opened
 * the owner's own period anyway. `shown` is the period the link opened
 * (notificationDay), `own` the stored one, `on` the calendar it was opened on.
 * The scale push's "7 dias" (no "Hoje") was taken for the owner's choice:
 * saved, kept by every chip and reopened on every launch.
 */
export function linkDayOf(url: Raw, shown: PeriodPart, own: PeriodPart, on: LinkDay['on']): LinkDay | null {
  if (!isNotificationLink(url) || !isIsoDate(url.dia)) return null
  if (url.periodo === 'custom' && !shown.rowPreset) return null
  const mine: OwnPeriod = { periodo: own.periodo, de: own.de, ate: own.ate }
  if (!shown.rowPreset && samePeriod(shown, mine)) return null
  const asked = url.periodo !== 'today' && url.periodo !== 'custom' && isPeriod(url.periodo) ? url.periodo : null
  return asked ? { dia: url.dia, own: mine, on, asked } : { dia: url.dia, own: mine, on }
}

const samePeriod = (a: OwnPeriod, b: OwnPeriod) => a.periodo === b.periodo && a.de === b.de && a.ate === b.ate

/**
 * Whether a "Hoje" notification's period still shows the day it was about
 * (notificationDay on `today`): "Hoje" that day, "Ontem" the day after, the
 * single date later. A selection that no longer resolves to it (its calendar
 * rolled before the marker expired) must not be called "esse dia".
 */
function showsLinkDay(sel: Selection, dia: string, today: string): boolean {
  if (sel.periodo === 'today') return dia >= today
  if (sel.periodo === 'yesterday') return dia === shiftDate(today, -1)
  return sel.periodo === 'custom' && sel.de === dia && sel.ate === dia
}

/**
 * The strip for a period a notification opened (Selection.linkDay), or null:
 * which day the notification was about when that day is over (or which
 * preset it opened), and what brings the owner's own period back — the store
 * buttons at the top. On Todas the store rows below keep the notification's
 * period (rowTapSelection): "Ao trocar de loja" promised the owner's period
 * there and a MOKOO row opened "Ontem". `today` is the selected store's (or
 * Todas') today. Row dates opened from it have their own strip.
 */
export function linkDayNotice(sel: Selection, today: string): string | null {
  const l = sel.linkDay
  if (!l || sel.rowPreset) return null
  const back = `Os botões de loja no alto voltam para “${selectionPeriodLabel(l.own, today)}”.`
  if (l.asked) return sel.periodo === l.asked ? `A notificação abriu “${periodLabel(l.asked)}”. ${back}` : null
  if (!showsLinkDay(sel, l.dia, today)) return null
  if (l.dia >= today) return `A notificação abriu Hoje. ${back}`
  const day = formatRange({ from: l.dia, to: l.dia }, today)
  return `A notificação era sobre ${day}: mostrando esse dia${sel.periodo === 'yesterday' ? ' (Ontem)' : ''}, não o de hoje. ${back}`
}

/**
 * One key per notification for the strip the owner closed: its day, its
 * preset and the owner's period behind it — not the store, so a store row
 * (which keeps the period, and re-anchors the marker on the store's clock)
 * does not bring back a strip the owner closed. Null without a marker.
 */
export function linkDayKey(sel: Selection): string | null {
  const l = sel.linkDay
  return l ? `${l.dia}|${l.asked ?? 'today'}|${l.own.periodo}|${l.own.de ?? ''}|${l.own.ate ?? ''}` : null
}

/**
 * A period a notification opened holds while the calendar it was opened on is
 * still on that day; then the owner's own period comes back (an open app on
 * the clock tick, a page restored days later). Returns `sel` itself when
 * nothing changes.
 */
export function expireLinkDay(sel: Selection, todayOf: (loja: string) => string): Selection {
  const l = sel.linkDay
  if (!l || todayOf(l.on.loja) === l.on.today) return sel
  return { loja: sel.loja, ...l.own }
}

/** The period a store chip goes back to, in words, when the one on screen is
 *  not the owner's (row dates, a notification's day); null otherwise. */
export function chipReturnLabel(sel: Selection, today?: string): string | null {
  if (sel.linkDay) return selectionPeriodLabel(sel.linkDay.own, today)
  return sel.rowPreset ? periodShort(sel.rowPreset) : null
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
 *
 * A preset that names the same dates on the store's own clock stays the
 * preset (rowOpensDates): "Mês passado" is 1–31 out in Tokyo too, and turning
 * it into fixed dates compared it with "31 dias anteriores" instead of the
 * month before, under a strip about dates nobody changed.
 */
export function storeRowSelection(row: RowClock, answer: RowAnswer): Partial<Selection> {
  if (!rowOpensDates(row, answer)) return { loja: row.id }
  return { loja: row.id, periodo: 'custom', de: answer.range.from, ate: answer.range.to, rowPreset: answer.period }
}

/** A store row as storeRowSelection needs it (PortfolioStoreRow satisfies it). */
export interface RowClock { id: string; storeToday: string; timezone: string }
/** The answer a store row is part of (MobileResponse satisfies it). */
export interface RowAnswer { period: Period; range: DateRange; anchorToday: string; generatedAt: string }

/**
 * Whether a store row opens the dates it shows rather than the preset: only
 * when the store's day is not the answer's (Hibikura from 12h in Brasília)
 * and the preset, read on the store's own clock at the answer's time, names
 * other dates than the row.
 */
export function rowOpensDates(row: RowClock, answer: RowAnswer): boolean {
  if (row.storeToday === answer.anchorToday || answer.period === 'custom') return false
  const own = resolveRange(answer.period, row.timezone, null, null, new Date(answer.generatedAt))
  return own.from !== answer.range.from || own.to !== answer.range.to
}

/**
 * Presets whose comparison is not "the N days before" (lib/engine/dates
 * comparisonRange): row dates opened from them are compared by the preset's
 * own rule (apiQuery sends `compare`), so Hibikura's 1–23 nov from "Este mês"
 * reads "vs mesmos dias do mês passado", as Todas does, not "vs 23 dias
 * anteriores". For the others the custom rule already is the preset's (a
 * closed "Hoje" is compared with the whole day before).
 */
export const COMPARE_AS_PRESET: readonly Period[] = ['mtd', 'lastmonth']

/** The preset a custom selection is compared as, or null (COMPARE_AS_PRESET). */
export function compareAsOf(s: Pick<Selection, 'periodo' | 'rowPreset'>): Period | null {
  return s.periodo === 'custom' && s.rowPreset && COMPARE_AS_PRESET.includes(s.rowPreset) ? s.rowPreset : null
}

/** The owner's own preset in place of dates a store row opened. */
function presetOf(sel: Selection): Selection {
  if (!sel.rowPreset) return sel
  const back: Selection = { loja: sel.loja, periodo: sel.rowPreset, de: null, ate: null }
  // Row dates opened from a notification's day: the preset is that day's,
  // still not the owner's.
  return sel.linkDay ? { ...back, linkDay: sel.linkDay } : back
}

/**
 * A tap that changes part of the selection (a period, a range, a store row).
 * Row dates (rowPreset) and a notification's period (linkDay) never outlive
 * the tap that follows them: a period the owner picks replaces them, and only
 * a store row's own patch brings new row dates.
 */
export function patchSelection(sel: Selection, patch: Partial<Selection>): Selection {
  return { loja: sel.loja, periodo: sel.periodo, de: sel.de, ate: sel.ate, ...patch }
}

/**
 * A store row of "Todas" tapped (its patch: storeRowSelection). A row picks a
 * store, not a period: on a period a notification opened, the row keeps it as
 * the link's (linkDay), so the next chip or launch still brings back the
 * owner's own — tapping MOKOO under the summary's "Ontem" saved "Ontem".
 *
 * A row that keeps the preset ("Ontem") hands it to the store's own clock, so
 * the marker is re-anchored there (`todayOf`, the store's today): it lasts
 * while that clock is on the same day, as a reload of the same URL reads it
 * (resolveView anchors a link without row dates on its store). Kept on Todas'
 * calendar, Hibikura · Ontem rolled to Tokyo's next day at 12h in Brasília
 * under a strip that still named the notification's day, and a reload jumped
 * back to it. Row dates (rowPreset) stay on Todas' calendar, as resolveView
 * reads them.
 */
export function rowTapSelection(sel: Selection, patch: Partial<Selection>, todayOf?: (loja: string) => string): Selection {
  const next = patchSelection(sel, patch)
  const l = sel.linkDay
  if (!l) return next
  const reanchor = !!todayOf && !next.rowPreset && next.loja !== l.on.loja
  return { ...next, linkDay: reanchor ? { ...l, on: { loja: next.loja, today: todayOf(next.loja) } } : l }
}

/**
 * The selection a store chip (Todas or a store) opens. The period stays —
 * except dates a store row opened, which were that store's only: leaving it
 * (any chip, the same store's included) brings back the owner's preset, so
 * "Todas · Hoje" → Hibikura row → "Todas" is "Todas · Hoje" again. A period a
 * notification opened goes back the same way, to the owner's own (linkDay).
 */
export function chipSelection(sel: Selection, loja: string): Selection {
  if (sel.linkDay) return { loja, ...sel.linkDay.own }
  return sel.rowPreset ? { ...presetOf(sel), loja } : { ...sel, loja }
}

/**
 * The view a store button at the top opens: chipSelection, and the owner's
 * own tab back when a notification opened another (ViewState.ownAba). Links
 * inside the screen that open a store ("Abrir EPOCH" in Campanhas) keep the
 * open tab instead: they use chipSelection alone.
 */
export function chipView(v: ViewState, loja: string): ViewState {
  const sel = chipSelection(v.sel, loja)
  return v.ownAba !== undefined ? { sel, aba: v.ownAba } : { sel, aba: v.aba }
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
  if (sel.periodo !== 'custom') return rowTapSelection(sel, {})
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

/** One key per distinct answer: the same dates compared as a preset
 *  (compareAsOf) are another answer. */
export const selectionKey = (s: Selection) => {
  const cmp = compareAsOf(s)
  return `${s.loja}|${s.periodo}|${s.de ?? ''}|${s.ate ?? ''}${cmp ? `|${cmp}` : ''}`
}

export const sameSelection = (a: Selection | null, b: Selection | null) =>
  !!a && !!b && selectionKey(a) === selectionKey(b)

/** /api/mobile and /api/mobile/detail query for a selection. */
export function apiQuery(s: Selection): string {
  const q = new URLSearchParams({ period: s.periodo, store: s.loja === ALL ? 'all' : s.loja })
  if (s.periodo === 'custom' && s.de && s.ate) { q.set('from', s.de); q.set('to', s.ate) }
  const cmp = compareAsOf(s)
  if (cmp) q.set('compare', cmp)
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

/** ?loja=&periodo=[&de=&ate=[&volta=]][&dia=][&aba=] — always explicit, so a
 *  copied or restored URL means the same thing whatever the defaults become.
 *  Row dates carry their preset (`volta`), so a reload knows they were not
 *  picked. A period a notification opened is written as the notification's
 *  link ("Hoje" of `dia`, which notificationDay reads again on a reload, or
 *  its own preset with `dia`), so a reload neither takes it for the owner's
 *  choice nor freezes it. */
export function toSearch(v: ViewState): string {
  const linkOwn = v.sel.linkDay && !v.sel.rowPreset ? v.sel.linkDay.asked ?? 'today' : null
  const q = new URLSearchParams({ loja: v.sel.loja, periodo: linkOwn ?? v.sel.periodo })
  if (v.sel.periodo === 'custom' && v.sel.de && v.sel.ate && !(v.sel.linkDay && !v.sel.rowPreset)) {
    q.set('de', v.sel.de); q.set('ate', v.sel.ate)
    if (v.sel.rowPreset) q.set('volta', v.sel.rowPreset)
  }
  if (v.sel.linkDay) q.set('dia', v.sel.linkDay.dia)
  if (v.aba) q.set('aba', v.aba)
  return q.toString()
}

/** What the next launch restores: the owner's choices only — row dates are
 *  stored as the preset they came from, a notification's period as the
 *  owner's own period it stood in for, and its tab as the owner's (ownAba). */
export function toStorage(v: ViewState): string {
  const sel: OwnPeriod & { loja: string } = v.sel.linkDay ? { loja: v.sel.loja, ...v.sel.linkDay.own }
    : v.sel.rowPreset ? presetOf(v.sel) : v.sel
  const aba = v.ownAba !== undefined ? v.ownAba : v.aba
  return JSON.stringify({ loja: sel.loja, periodo: sel.periodo, de: sel.de, ate: sel.ate, aba })
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

/**
 * The name the period bar's last button shows for a period outside the main
 * four: the preset's short name, or for dates their compact form, never with
 * a year — "23 nov", "3–12 nov", and across months "25/10–23/11" or
 * "25/12–3/1". "25 out – 23 nov" did not fit the button on a 390 px phone,
 * and "25/12/25–3/1/26" (108 px in an 85 px label) lost its end date to the
 * ellipsis. The year goes on a second line (periodButtonYear); the full range
 * stays in the button's title (periodButtonFull).
 */
export function periodButtonLabel(sel: Pick<Selection, 'periodo' | 'de' | 'ate'>, shown?: DateRange | null): string {
  if (sel.periodo !== 'custom' || !sel.de || !sel.ate) return periodShort(sel.periodo)
  const r = shown ?? { from: sel.de, to: sel.ate }
  const [y1, m1, d1] = r.from.split('-').map(Number)
  const [y2, m2, d2] = r.to.split('-').map(Number)
  // Read against its own year, formatRange prints none.
  if (y1 === y2 && m1 === m2) return formatRange(r, r.to)
  return `${d1}/${m1}–${d2}/${m2}`
}

/**
 * The year(s) under the last button's dates when either end is not in
 * today's year — "2025", "2025–26" — or null. Without it "3–12 nov" of 2025
 * read as this November.
 */
export function periodButtonYear(sel: Pick<Selection, 'periodo' | 'de' | 'ate'>, shown?: DateRange | null, today?: string): string | null {
  if (sel.periodo !== 'custom' || !sel.de || !sel.ate || !today) return null
  const r = shown ?? { from: sel.de, to: sel.ate }
  const y1 = r.from.slice(0, 4)
  const y2 = r.to.slice(0, 4)
  const thisYear = today.slice(0, 4)
  if (y1 === thisYear && y2 === thisYear) return null
  return y1 === y2 ? y1 : `${y1}–${y2.slice(2)}`
}

/** The period of the last button in full words, for its title. */
export function periodButtonFull(sel: Pick<Selection, 'periodo' | 'de' | 'ate'>, shown?: DateRange | null, today?: string): string {
  if (sel.periodo !== 'custom' || !sel.de || !sel.ate) return periodLabel(sel.periodo)
  return formatRange(shown ?? { from: sel.de, to: sel.ate }, today)
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
