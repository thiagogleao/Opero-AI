/**
 * resolve(selection, viewer, now): what a selection means at one instant
 * (R1–R6, R8–R11). The single resolution path: desktop pages, the shell,
 * /api/mobile, /api/mobile/detail, /api/campaigns, /api/profit, lib/alerts and
 * the phone all call it. Pure: `now` and the store facts are arguments.
 */

import { formatRange, shiftDate } from '../engine/dates'
import { tzCity } from '../format'
import { anchorOf, clockText, minutesInto, nextMidnight, offsetDiffers, todayIn } from './clock'
import { clampedRule, comparisonFor, comparisonLabels, ruleOf } from './compare'
import { dateBeside, rangeBeside, startsInside } from './facts'
import { dedupeNotes } from './notes'
import { datesButton, datesButtonYear, fitValue, presetInfo } from './value'
import type {
  DateRange, IsoDate, MemberResolution, Note, PeriodLabel, PeriodValue, Resolution, ResolvedComparison, ScreenComparison,
  Selection, StoreFacts, ViewerStores,
} from './types'

/** The stores a scope shows: Todas = the viewer's active stores (never an
 *  archived one, never another account's); a store = that one store, archived
 *  allowed (consultation, R10). Empty when the store is not the viewer's. */
export function membersOf(sel: Pick<Selection, 'scope'>, viewer: ViewerStores): StoreFacts[] {
  if (sel.scope.kind === 'all') return viewer.active
  const id = sel.scope.id
  const s = viewer.active.find(x => x.id === id) ?? viewer.archived.find(x => x.id === id)
  return s ? [s] : []
}

/** Whether the viewer can see a store (active or archived). */
export function findStore(viewer: ViewerStores, id: string): StoreFacts | null {
  return viewer.active.find(x => x.id === id) ?? viewer.archived.find(x => x.id === id) ?? null
}

/** Minute of the day of an instant on the store's clock. */
function minuteOf(tz: string, instant: string): number {
  return minutesInto(tz, new Date(instant))
}

/**
 * The one function that turns the window into a member's `read` and `state`
 * (R2, R10). An archived store is never 'running': it is clamped at its
 * archive instant, frozen after it, closed before it.
 */
export function memberWindow(
  window: DateRange, store: StoreFacts, now: Date,
): Pick<MemberResolution, 'storeId' | 'storeToday' | 'read' | 'state' | 'lastDayCut'> {
  const storeToday = todayIn(store.tz, now)
  const base = { storeId: store.id, storeToday }
  if (store.archivedOn) {
    if (window.from > store.archivedOn) return { ...base, read: null, state: 'frozen', lastDayCut: null }
    if (window.to >= store.archivedOn) {
      const cut = store.archivedAt ? minuteOf(store.tz, store.archivedAt) : null
      return { ...base, read: { from: window.from, to: store.archivedOn }, state: 'clamped', lastDayCut: cut }
    }
    return { ...base, read: { ...window }, state: 'closed', lastDayCut: null }
  }
  if (window.from > storeToday) return { ...base, read: null, state: 'not_started', lastDayCut: null }
  if (window.to >= storeToday) {
    return { ...base, read: { from: window.from, to: storeToday }, state: 'running', lastDayCut: minutesInto(store.tz, now) }
  }
  return { ...base, read: { ...window }, state: 'closed', lastDayCut: null }
}

export interface ResolveOptions {
  /** Extra notes the caller adds (one-shot `ajuste=` codes, landing notes). */
  notes?: Note[]
}

const CLOCK_ALL = 'Brasília · cada loja no seu fuso'

/** The city of a clock for wording ("Brasília" for Todas). */
export function clockCity(clockTz: string, scopeAll: boolean): string {
  return scopeAll ? 'Brasília' : tzCity(clockTz)
}

function periodLabel(
  value: PeriodValue, effective: PeriodValue, window: DateRange, clockToday: IsoDate, comparison: DateRange | null,
  future: boolean, city: string,
): PeriodLabel {
  const ctx = { window, comparison, clockToday }
  const range = rangeBeside(window, ctx)
  if (value.kind === 'preset') {
    const info = presetInfo(value.preset)
    return { full: `${info.label} · ${range}`, short: info.label, button: info.button, buttonYear: null, phrase: info.phrase, range }
  }
  const asked: DateRange = { from: value.from, to: value.to }
  const askedText = rangeBeside(asked, { window: asked, comparison, clockToday })
  const yesterday = shiftDate(clockToday, -1)
  const word = asked.from === asked.to ? (asked.from === clockToday ? ' (hoje)' : asked.from === yesterday ? ' (ontem)' : '') : ''
  const full = future ? `${askedText} · ainda não começou em ${city}` : `${askedText}${word}`
  const phrase = effective.kind === 'preset'
    ? presetInfo(effective.preset).phrase
    : window.from === window.to && (window.from === clockToday || window.from === yesterday)
      ? dayPhrase(window.from, clockToday)
      : `em ${range}`
  return { full, short: `${askedText}${word}`, button: datesButton(asked), buttonYear: datesButtonYear(asked, clockToday), phrase, range }
}

/**
 * The days a member is priced on (R10): a clamped archived store's read days
 * (nothing is synced after the archive day, so no fixed cost accrues there and
 * the reading is identical at 14:19 and 23:59); every other member the window.
 */
export function pricedWindow(r: Pick<Resolution, 'members' | 'window'>, storeId: string): DateRange {
  const m = r.members.find(x => x.storeId === storeId)
  return m?.state === 'clamped' && m.read ? m.read : r.window
}

/** A single day as a sentence names it on a clock whose today is
 *  `clockToday`: "hoje", "ontem", "em 24 nov" (R7). The sale push and the
 *  screen it opens say the same word for the same day (R17). */
export function dayPhrase(day: IsoDate, clockToday: IsoDate): string {
  if (day === clockToday) return 'hoje'
  if (day === shiftDate(clockToday, -1)) return 'ontem'
  return `em ${dateBeside(day, { window: { from: day, to: day }, clockToday })}`
}

/** How many days an archived store opens from the "arquivadas" list (R10). */
export const ARCHIVE_OPEN_DAYS = 30

/** The period an archived store opens with from the "arquivadas" list, desktop
 *  and phone alike: the 30 days ending on its archive day, as dates (R10).
 *  Null for a store that is not archived. */
export function archiveOpening(store: Pick<StoreFacts, 'archivedOn'>): Extract<PeriodValue, { kind: 'dates' }> | null {
  if (!store.archivedOn) return null
  return { kind: 'dates', from: shiftDate(store.archivedOn, -(ARCHIVE_OPEN_DAYS - 1)), to: store.archivedOn }
}

/** R10's name for that opening: "Últimos 30 dias até o arquivamento" over
 *  its dates, on one archived store. Null for any other selection. */
function archiveLabel(sel: Selection, stores: StoreFacts[], window: DateRange, clockToday: IsoDate): PeriodLabel | null {
  if (sel.scope.kind !== 'store' || stores.length !== 1 || sel.period.kind !== 'dates') return null
  const open = archiveOpening(stores[0])
  if (!open || open.from !== sel.period.from || open.to !== sel.period.to) return null
  const range = rangeBeside(window, { window, clockToday })
  return {
    full: `Últimos ${ARCHIVE_OPEN_DAYS} dias até o arquivamento · ${range}`,
    short: `últimos ${ARCHIVE_OPEN_DAYS} dias até o arquivamento (${range})`,
    button: datesButton(open),
    buttonYear: datesButtonYear(open, clockToday),
    phrase: `nos últimos ${ARCHIVE_OPEN_DAYS} dias até o arquivamento`,
    range,
  }
}

/** R6's words for a screen with no delta (see Resolution.deltaNote). */
function deltaNoteOf(
  members: MemberResolution[], stores: StoreFacts[], scopeAll: boolean, comparison: ResolvedComparison | null,
  window: DateRange, clockToday: IsoDate,
): Resolution['deltaNote'] {
  const ctx = { window, comparison: comparison?.range ?? null, clockToday }
  const factOf = (id: string) => stores.find(s => s.id === id)
  if (!comparison) {
    const noBase = members.filter(m => m.noBase)
    const starts = noBase.map(m => factOf(m.storeId)?.firstActivityDate).filter((d): d is string => !!d).sort()
    if (!noBase.length) return { reason: 'none', text: '' }
    if (!starts.length) return { reason: 'no_base', text: 'sem base de comparação' }
    const day = dateBeside(starts[0], ctx)
    return { reason: 'no_base', text: scopeAll && members.length > 1 ? `sem base: a primeira loja começou em ${day}` : `sem base: a loja começou em ${day}` }
  }
  if (!scopeAll) {
    const m = members[0]
    const st = m ? factOf(m.storeId) : null
    if (m?.compare?.base === 'partial' && st?.firstActivityDate) {
      return { reason: 'partial_base', text: `base incompleta: a loja começou em ${dateBeside(st.firstActivityDate, ctx)}` }
    }
    return null
  }
  // Todas whose every compared member is left out: nothing is like for like.
  const compared = members.filter(m => m.compare)
  if (compared.length && compared.every(m => m.compare!.base === 'partial')) {
    return { reason: 'partial_base', text: 'base incompleta: todas as lojas começaram durante a comparação' }
  }
  return null
}

/**
 * The comparison as every screen names it (R6, R7): the one source of the
 * header, verdict, KPI pills and phone cells. Never an invented "vs dia
 * anterior": without a comparison, `none` carries R6's words.
 */
export function screenComparison(r: Pick<Resolution, 'comparison' | 'deltaNote' | 'window'>): ScreenComparison {
  const c = r.comparison
  const partialBase = r.deltaNote?.reason === 'partial_base' ? r.deltaNote.text : null
  if (c) {
    return {
      from: c.range.from, to: c.range.to, label: c.words, sameTimeOfDay: c.cut !== 'none', cutoffMinutes: c.cutMinute,
      full: c.label, short: c.short, phrase: c.phrase, rangeText: c.rangeText, cutText: c.cutText,
      none: null, partialBase, leftOut: c.leftOut, fullBase: c.labelBase, leftOutWhy: c.leftOutWhy,
    }
  }
  return {
    from: r.window.from, to: r.window.to, label: '', sameTimeOfDay: false, cutoffMinutes: null,
    full: '', short: '', phrase: '', rangeText: '', cutText: null,
    none: r.deltaNote?.text ?? '', partialBase: null, leftOut: [], fullBase: '', leftOutWhy: [],
  }
}

/** R1–R11 in one pass. */
export function resolve(sel: Selection, viewer: ViewerStores, now: Date, opts: ResolveOptions = {}): Resolution {
  const stores = membersOf(sel, viewer)
  const scopeAll = sel.scope.kind === 'all'
  const clockTz = anchorOf(stores.map(s => s.tz))
  const clockToday = todayIn(clockTz, now)
  const fitted = fitValue(sel.period, clockToday)
  const window = fitted.window
  const rule = ruleOf(fitted.effective, window, clockToday)
  const notes: Note[] = []
  const city = clockCity(clockTz, scopeAll)

  const members: MemberResolution[] = stores.map(store => {
    const w = memberWindow(window, store, now)
    if (!w.read) return { ...w, compare: null, noBase: false }
    const r = w.state === 'clamped' ? clampedRule(fitted.effective) : rule
    const { compare, noBase } = comparisonFor(r, w.read, store.firstActivityDate, w.lastDayCut)
    return { ...w, compare, noBase }
  })

  // ── Comparison (one label for the screen) ──
  const compared = members.filter(m => m.compare)
  let comparison: ResolvedComparison | null = null
  if (compared.length) {
    // The cut is said of the members that stay in the delta (R6): on Todas a
    // member with a partial base is left out and named only as left out,
    // never also "com o dia inteiro" in the same label. When every compared
    // member is left out, the label still describes them.
    const inDelta = scopeAll ? compared.filter(m => m.compare!.base === 'full') : compared
    const basis = inDelta.length ? inDelta : compared
    const first = basis[0].compare!
    const cuts = basis.map(m => m.compare!.cutAtMinute)
    const cutCount = cuts.filter(c => c !== null).length
    const cut: ResolvedComparison['cut'] = cutCount === 0 ? 'none' : cutCount === basis.length ? 'all' : 'mixed'
    const distinct = [...new Set(cuts.filter((c): c is number => c !== null))]
    const cutMinute = distinct.length === 1 ? distinct[0] : null
    const nameOf = (id: string) => stores.find(s => s.id === id)!
    const leftOut = members
      .filter(m => m.read && m.state !== 'frozen' && (m.compare === null || m.compare.base === 'partial'))
      .map(m => {
        const st = nameOf(m.storeId)
        const day = st.firstActivityDate ? dateBeside(st.firstActivityDate, { window, comparison: first.range, clockToday }) : null
        return { id: st.id, name: st.name, why: day ? `começou em ${day}` : 'sem base' }
      })
    const archived = !scopeAll && members[0]?.state === 'clamped'
    const usedRule = archived ? clampedRule(fitted.effective) : rule
    const labels = comparisonLabels({
      rule: usedRule, range: first.range, cut,
      oneStoreMinute: !scopeAll && cut === 'all' ? cutMinute : null,
      archived,
      wholeMembers: cut === 'mixed'
        ? basis.filter(m => m.compare!.cutAtMinute === null).map(m => ({ name: nameOf(m.storeId).name, city: tzCity(nameOf(m.storeId).tz) }))
        : [],
      leftOut: scopeAll ? leftOut : [],
      today: clockToday,
    })
    comparison = {
      range: first.range, rule: usedRule, ...labels, cut, cutMinute,
      leftOut: leftOut.map(l => l.name), leftOutWhy: scopeAll ? leftOut : [],
    }
  }
  const deltaNote = deltaNoteOf(members, stores, scopeAll, comparison, window, clockToday)

  // ── Notes ──
  const dateText = (d: IsoDate) => formatRange({ from: d, to: d }, clockToday)
  const windowText = rangeBeside(window, { window, comparison: comparison?.range ?? null, clockToday })
  if (fitted.notes.includes('future_start') && sel.period.kind === 'dates') {
    notes.push({ code: 'future_start', params: { asked: formatRange({ from: sel.period.from, to: sel.period.to }, clockToday), city, today: dateText(clockToday) } })
  }
  if (fitted.notes.includes('future_end') && sel.period.kind === 'dates') {
    notes.push({ code: 'future_end', params: { today: dateText(clockToday), askedEnd: dateBeside(sel.period.to, { window, comparison: comparison?.range ?? null, clockToday }), window: windowText } })
  }
  for (const m of members) {
    const st = stores.find(s => s.id === m.storeId)!
    const ctx = { window, comparison: comparison?.range ?? null, clockToday }
    if (m.state === 'clamped' && st.archivedOn) {
      notes.push({ code: 'archived_clamp', params: { store: st.name, day: dateBeside(st.archivedOn, ctx), time: m.lastDayCut !== null ? clockText(m.lastDayCut) : '—' } })
    } else if (m.state === 'frozen' && st.archivedOn) {
      notes.push({ code: 'archived_frozen', params: { range: windowText, store: st.name, day: dateBeside(st.archivedOn, ctx) } })
    }
    if (!scopeAll && m.read) {
      const inside = startsInside(window, st)
      if (inside) notes.push({ code: 'starts_inside', params: { store: st.name, day: dateBeside(inside.day, ctx), n: inside.daysBefore } })
      if (m.compare?.base === 'partial' && st.firstActivityDate) {
        notes.push({ code: 'partial_base', params: { store: st.name, day: dateBeside(st.firstActivityDate, ctx) } })
      }
    }
  }
  for (const n of opts.notes ?? []) notes.push(n)

  // ── The next turn (R8): the clock's midnight or any live member's ──
  const turns = [nextMidnight(clockTz, now).getTime(), ...stores.filter(s => !s.archivedOn).map(s => nextMidnight(s.tz, now).getTime())]
  const nextTurnAt = new Date(Math.min(...turns)).toISOString()

  const partial = members.some(m => m.state === 'running')
  const minutes = minutesInto(clockTz, now)
  return {
    selection: sel,
    asOf: now.toISOString(),
    clockTz,
    clockToday,
    window,
    effective: fitted.effective,
    members,
    partial,
    partialUntil: partial ? clockText(minutes) : null,
    minutesIntoDay: minutes,
    comparison,
    deltaNote,
    label: archiveLabel(sel, stores, window, clockToday)
      ?? periodLabel(sel.period, fitted.effective, window, clockToday, comparison?.range ?? null, fitted.notes.includes('future_start'), city),
    clockNote: scopeAll ? CLOCK_ALL : tzCity(clockTz),
    clockDiffers: offsetDiffers(clockTz, now),
    notes: dedupeNotes(notes),
    nextTurnAt,
    factsVersion: viewer.version,
  }
}

const rangeKey = (r: DateRange | null | undefined) => (r ? `${r.from}:${r.to}` : '-')

/**
 * Whether two resolutions show the same thing (R8): the selection, the window
 * and, per member, read / state / comparison range. asOf, partialUntil,
 * lastDayCut and cutAtMinute change every minute and are ignored (C2-H4), so a
 * 5-minute re-check on an unchanged day refreshes nothing.
 */
export function sameResolution(a: Resolution, b: Resolution): boolean {
  return resolutionKey(a) === resolutionKey(b)
}

/** The string sameResolution compares. */
export function resolutionKey(r: Resolution): string {
  const sel = r.selection
  const scope = sel.scope.kind === 'all' ? 'all' : sel.scope.id
  const period = sel.period.kind === 'preset' ? sel.period.preset : `${sel.period.from}:${sel.period.to}`
  const members = r.members.map(m => `${m.storeId}/${rangeKey(m.read)}/${m.state}/${rangeKey(m.compare?.range)}`).join(',')
  return `${scope}|${period}|${sel.split ? 1 : 0}|${rangeKey(r.window)}|${members}`
}
