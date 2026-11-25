/**
 * R3/R4: what a link to another page, store or scope carries, and what it
 * says when the target will show other dates.
 *
 * `carry` changes the scope only: a preset stays the same preset and resolves
 * in the TARGET's clock (R2); dates stay the same dates, as asked, and the
 * target fits them on its own clock and announces any cut (R9). The split
 * stays. Exceptions: a target the viewer cannot see → null (the text renders
 * without a link); leaving an archived store → the period is not carried
 * (archive-tail dates were never the owner's choice, C1-7).
 *
 * `announce` is the one text of a scope change, used on the link's help line
 * AND on the landing page (note scope_dates_differ), so they cannot disagree
 * (L575). It is computed at render time on both ends, so a link tapped across
 * Tokyo midnight is still announced.
 */

import { formatRange } from '../engine/dates'
import { tzCity } from '../format'
import { clockText, offsetDiffers } from './clock'
import { findStore, resolve } from './resolve'
import { defaultPeriod, presetInfo, type Platform } from './value'
import { noteText } from './notes'
import type { DateRange, MemberResolution, NoteCode, Resolution, ScopeRef, Selection, ViewerStores } from './types'

export const sameScope = (a: ScopeRef, b: ScopeRef): boolean =>
  a.kind === 'all' ? b.kind === 'all' : b.kind === 'store' && a.id === b.id

export interface Carried {
  selection: Selection
  /** The source was an archived store and the target is not: the target opens
   *  the platform default (note left_archive on landing). */
  leftArchive: boolean
}

/** Whether the viewer can open `scope`. */
export function canSee(scope: ScopeRef, viewer: ViewerStores): boolean {
  return scope.kind === 'all' ? viewer.allowsAll : !!findStore(viewer, scope.id)
}

/** R4. Null when the target is not visible to the viewer. */
export function carry(sel: Selection, target: ScopeRef, viewer: ViewerStores, platform: Platform = 'desktop'): Carried | null {
  if (!canSee(target, viewer)) return null
  const source = sel.scope.kind === 'store' ? findStore(viewer, sel.scope.id) : null
  const leftArchive = !!source?.archivedOn && !sameScope(sel.scope, target)
  return {
    selection: { scope: target, period: leftArchive ? defaultPeriod(platform) : sel.period, split: sel.split },
    leftArchive,
  }
}

/** The days "the place the link sits in" shows for the target's stores: for
 *  a Todas row, that member's read range and comparison. */
interface Place {
  range: DateRange | null
  compare: DateRange | null
  cut: boolean
  /** Where the comparison's last day stops ("até 19h25"), null for whole days. */
  cutText: string | null
  rule: string | null
}

/** Where a member's comparison stops: "até 19h25"; an archived (clamped)
 *  member's cut is the archive minute and says so, "até 09h02, hora do
 *  arquivamento" (§8.2), never a bare time that reads as "until now". */
const cutOf = (minute: number | null | undefined, state?: MemberResolution['state']): string | null =>
  minute == null ? null : state === 'clamped' ? `até ${clockText(minute)}, hora do arquivamento` : `até ${clockText(minute)}`

function placeOf(src: Resolution, target: ScopeRef): Place {
  if (src.selection.scope.kind === 'all' && target.kind === 'store') {
    const m = src.members.find(x => x.storeId === target.id)
    if (m) {
      return { range: m.read, compare: m.compare?.range ?? null, cut: m.compare?.cutAtMinute != null, cutText: cutOf(m.compare?.cutAtMinute, m.state), rule: src.comparison?.rule ?? null }
    }
  }
  return scopePlace(src)
}

/** What the target shows for itself: its window (one store: the days read). */
function shownOf(r: Resolution): Place {
  if (r.selection.scope.kind === 'store' && r.members[0]) {
    const m = r.members[0]
    return { range: m.read ?? r.window, compare: m.compare?.range ?? null, cut: m.compare?.cutAtMinute != null, cutText: cutOf(m.compare?.cutAtMinute, m.state), rule: r.comparison?.rule ?? null }
  }
  return scopePlace(r)
}

function scopePlace(r: Resolution): Place {
  const c = r.comparison
  const cut = (c?.cut ?? 'none') !== 'none'
  return {
    range: r.selection.scope.kind === 'store' && r.members[0] ? r.members[0].read ?? r.window : r.window,
    compare: c?.range ?? null,
    cut,
    cutText: cut ? c?.cutText ?? (r.partialUntil ? `até ${r.partialUntil}` : null) : null,
    rule: c?.rule ?? null,
  }
}

/**
 * Dates read beside each other (R7 year rule): the year shows on every date
 * when the dates fall in more than one year or in another year than the
 * reader's today, so one side never carries it while the other does not
 * ("1 jan 2027 … 31 dez 2026", never "1 jan … 31 dez 2026").
 */
function datesFor(ranges: readonly (DateRange | null)[], readerToday: string): (r: DateRange | null) => string {
  const years = new Set(ranges.flatMap(r => (r ? [r.from.slice(0, 4), r.to.slice(0, 4)] : [])))
  const forceYear = years.size > 1 || (years.size === 1 && !years.has(readerToday.slice(0, 4)))
  const today = forceYear ? '1900-01-01' : readerToday
  return r => (r ? formatRange(r, today) : '—')
}

const same = (a: DateRange | null, b: DateRange | null) => (a?.from ?? '') === (b?.from ?? '') && (a?.to ?? '') === (b?.to ?? '')

/** A rule as what it compares with: "the day before" whatever its name — Hoje
 *  ("ontem até esta hora"), Ontem, and a single custom day ("dia anterior")
 *  all compare one day with the one before it. */
const ruleKind = (rule: string | null, compare: DateRange | null): string | null =>
  rule === 'day_before' || rule === 'yesterday' || (rule === 'n_days' && !!compare && compare.from === compare.to) ? 'prev_day' : rule

export interface Announcement {
  /** The link's help line: "Hibikura abre o Hoje de Tóquio (25 nov)". */
  line: string
  /** The landing note: "Hoje na Hibikura é 25 nov (dia de Tóquio). Em Todas as lojas, Hoje é 24 nov." */
  landing: string
  /** Fit notes of the target (future_start, future_end) the landing text
   *  already says, so the combined line says each day once (§4): notesText
   *  leaves them out beside it. */
  absorbs: NoteCode[]
}

function scopeName(scope: ScopeRef, viewer: ViewerStores): string {
  return scope.kind === 'all' ? 'Todas as lojas' : findStore(viewer, scope.id)?.name ?? 'esta loja'
}

/**
 * The text of a scope change when the target will show other dates or another
 * comparison than the place the link sits in; null otherwise (R4). `sel` is
 * the selection the link carries (its scope is the source).
 */
export function announce(sel: Selection, from: ScopeRef, to: ScopeRef, viewer: ViewerStores, now: Date): Announcement | null {
  if (sameScope(from, to) || !canSee(to, viewer)) return null
  const fromStore = from.kind === 'store' ? findStore(viewer, from.id) : null
  // Leaving an archived store does not carry its period: left_archive says so.
  if (fromStore?.archivedOn) return null
  if (from.kind === 'store' && !fromStore) return null
  const src = resolve({ ...sel, scope: from }, viewer, now)
  const dst = resolve({ ...sel, scope: to }, viewer, now)
  const place = placeOf(src, to)
  const shown = shownOf(dst)
  const datesDiffer = !same(place.range, shown.range)
  // The comparison is named when it is compared differently, not merely on
  // other dates: another rule, or cut at this hour on one side and whole on
  // the other (Todas · Este mês on 24 dez: the Hibikura row whole, its page
  // "até 04h00"). Hoje and Ontem compare with the day before by definition.
  // Same dates and same comparison days, but cut at this hour on one side
  // and whole on the other (MOKOO 20–24 nov at 19h25 → Hibikura, whose 24 nov
  // has closed in Tokyo) is a different comparison too.
  // Equal comparison days cut the same way are the same comparison, whatever
  // the rule is called: Todas' single day 24 nov ("vs ontem") and Hibikura's
  // closed 24 nov ("vs dia anterior") both compare with the whole 23 nov, so
  // nothing is announced (R4: text only when something differs).
  const dayRule = dst.comparison?.rule === 'day_before' || dst.comparison?.rule === 'yesterday'
  const sameCompare = same(place.compare, shown.compare) && place.cut === shown.cut
  const compareDiffers = !dayRule && !!shown.compare && !!place.compare && !sameCompare
    && (place.cut !== shown.cut || ruleKind(place.rule, place.compare) !== ruleKind(shown.rule, shown.compare))
  if (!datesDiffer && !compareDiffers) return null

  // The row line is read on the source page, the landing note on the target.
  const lineDates = datesFor([shown.range, shown.compare], src.clockToday)
  const d = datesFor([shown.range, shown.compare, place.range, place.compare], dst.clockToday)
  const target = scopeName(to, viewer)
  const origin = scopeName(from, viewer)
  const toAll = to.kind === 'all'
  const city = toAll ? 'Brasília' : tzCity(dst.clockTz)
  const tzNote = toAll ? ' (Brasília)' : offsetDiffers(dst.clockTz, now) ? ` (dia de ${city})` : ''
  const p = sel.period
  const plural = p.kind === 'preset' && ['7d', '14d', '30d', '90d'].includes(p.preset)
  const name = p.kind === 'preset' ? presetInfo(p.preset).label : 'O período'
  const lower = p.kind === 'preset' ? (plural ? `os ${name.toLowerCase()}` : `o ${name}`) : 'o período'
  // Whole days are said only when the other side was cut.
  const cutWords = (p: Place, other: Place) => (p.cutText ? ` ${p.cutText}` : other.cut ? ' (dias inteiros)' : '')
  const cmpWith = (fmt: (r: DateRange | null) => string) => (compareDiffers ? `, vs ${fmt(shown.compare)}${cutWords(shown, place)}` : '')
  const cmp = cmpWith(d)
  const placeCmp = compareDiffers ? `, vs ${d(place.compare)}${cutWords(place, shown)}` : ''

  const line = compareDiffers
    ? `${target} abre ${lower} de ${city}: ${lineDates(shown.range)}${cmpWith(lineDates)}`
    : `${target} abre ${lower} de ${city} (${lineDates(shown.range)})`
  const verb = plural ? 'são' : 'é'
  const title = plural ? `Os ${name.toLowerCase()}` : name
  // §4: with a fit of the target's own (dates that have not begun, or that
  // run past today), the fit and the scope change are one sentence and each
  // day is said once: "O período na MOKOO é 20–24 nov, até hoje (o resto
  // ainda não aconteceu). Na Hibikura era 20–25 nov." / "25 nov ainda não
  // começou em Brasília: mostrando Hoje (24 nov). Na Hibikura era 25 nov."
  const futureStart = dst.notes.find(n => n.code === 'future_start')
  const futureEnd = dst.notes.find(n => n.code === 'future_end')
  const absorbs: NoteCode[] = []
  let head: string
  if (futureStart) {
    head = `${noteText(futureStart).replace(/\.$/, '')}${cmp}.`
    absorbs.push('future_start')
  } else {
    const end = futureEnd ? ', até hoje (o resto ainda não aconteceu)' : ''
    if (futureEnd) absorbs.push('future_end')
    head = toAll
      ? `${title} em ${target} ${verb} ${d(shown.range)}${tzNote}${end}${cmp}.`
      : `${title} na ${target} ${verb} ${d(shown.range)}${tzNote}${end}${cmp}.`
  }
  // §4: "Em Todas as lojas, Hoje é 24 nov." / "Na Hibikura era 20–25 nov."
  // A store is "a loja": "Na", never "Em Hibikura"; the subject after the
  // comma keeps its own case ("Hoje", "o período"), never "O período"
  // mid-sentence.
  const subject = p.kind === 'dates' ? 'o período ' : plural ? '' : `${name} `
  // Plural presets drop the repeated subject (R4 ex. 6: "Em Todas as lojas
  // são 17–23 nov.").
  const tail = from.kind === 'all'
    ? plural ? ` Em ${origin} ${verb} ${d(place.range)}${placeCmp}.` : ` Em ${origin}, ${subject}${verb} ${d(place.range)}${placeCmp}.`
    : ` Na ${origin} ${plural ? 'eram' : 'era'} ${d(place.range)}${placeCmp}.`
  return { line, landing: `${head}${tail}`, absorbs }
}

/**
 * The clause a table of store rows adds to its help line (R4, "on the link,
 * where the link has a help line"): the announcement of every row whose
 * dates really differ at `now`, or null. One function for the Overview table
 * and Campanhas · Todas, so the two help lines cannot disagree.
 */
export function rowsAnnouncement(sel: Selection, storeIds: readonly string[], viewer: ViewerStores, now: Date): string | null {
  const lines = storeIds
    .map(id => announce(sel, sel.scope, { kind: 'store', id }, viewer, now)?.line)
    .filter((x): x is string => !!x)
  return lines.length ? `(${lines.join('; ')})` : null
}
