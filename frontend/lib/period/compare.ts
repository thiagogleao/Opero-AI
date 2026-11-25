/**
 * R6: the one comparison rule, everywhere.
 *
 *  - Hoje, or a dates value whose single day is the clock's today: the day
 *    before ("ontem até esta hora");
 *  - Ontem: the day before;
 *  - 7/14/30/90 dias and any dates value: the same number of days right before;
 *  - Este mês: the same days of the previous month, clamped to its length;
 *  - Mês passado: the whole month before.
 * A clamped archived member (R10) compares the span it read: mtd and
 * lastmonth by the same days of the month before, anything else by as many
 * days right before.
 *
 * A preset always compares by its own rule because it is never turned into
 * dates (P2): the old `compare`/`compareAs` mechanism is gone.
 */

import { daysBetween, formatRange, shiftDate } from '../engine/dates'
import { clockText } from './clock'
import type { CompareRule, DateRange, IsoDate, MemberCompare, PeriodValue } from './types'

/** The rule for a value shown in `window` on a clock whose today is `clockToday`. */
export function ruleOf(effective: PeriodValue, window: DateRange, clockToday: IsoDate): CompareRule {
  if (effective.kind === 'preset') {
    switch (effective.preset) {
      case 'today': return 'day_before'
      case 'yesterday': return 'yesterday'
      case 'mtd': return 'same_days'
      case 'lastmonth': return 'prev_month'
      default: return 'n_days'
    }
  }
  return window.from === window.to && window.to === clockToday ? 'day_before' : 'n_days'
}

/** The same calendar day one month earlier, clamped to that month's length
 *  (31 mar → 28/29 fev). */
function monthBack(d: IsoDate): IsoDate {
  const [y, m, day] = d.split('-').map(Number)
  const prevLen = new Date(Date.UTC(y, m - 1, 0)).getUTCDate()
  return new Date(Date.UTC(y, m - 2, Math.min(day, prevLen))).toISOString().slice(0, 10)
}

/** The comparison range of a member's `read` under `rule`. */
export function compareRange(rule: CompareRule, read: DateRange): DateRange {
  switch (rule) {
    case 'day_before':
    case 'yesterday': {
      const d = shiftDate(read.from, -1)
      return { from: d, to: d }
    }
    case 'same_days':
      return { from: monthBack(read.from), to: monthBack(read.to) }
    case 'prev_month': {
      const [y, m] = read.from.split('-').map(Number)
      return {
        from: new Date(Date.UTC(y, m - 2, 1)).toISOString().slice(0, 10),
        to: new Date(Date.UTC(y, m - 1, 0)).toISOString().slice(0, 10),
      }
    }
    case 'n_days':
    default: {
      const n = daysBetween(read.from, read.to)
      return { from: shiftDate(read.from, -n), to: shiftDate(read.from, -1) }
    }
  }
}

/** The rule of a clamped archived member: the span it read (R10). */
export function clampedRule(effective: PeriodValue): CompareRule {
  return effective.kind === 'preset' && (effective.preset === 'mtd' || effective.preset === 'lastmonth') ? 'same_days' : 'n_days'
}

/** Where the store's activity starts: null counts as "after every window" (R11). */
export const startOf = (firstActivityDate: IsoDate | null): IsoDate => firstActivityDate ?? '9999-12-31'

/**
 * One member's comparison (R6). Null when the comparison range lies wholly
 * before the store's first activity ("sem base"); base 'partial' when it
 * starts before it (the delta % is then not shown).
 */
export function comparisonFor(
  rule: CompareRule, read: DateRange, firstActivityDate: IsoDate | null, lastDayCut: number | null,
): { compare: MemberCompare | null; noBase: boolean } {
  const range = compareRange(rule, read)
  const start = startOf(firstActivityDate)
  if (range.to < start) return { compare: null, noBase: true }
  return { compare: { range, cutAtMinute: lastDayCut, base: range.from < start ? 'partial' : 'full' }, noBase: false }
}

/** The words of a rule: "ontem até esta hora", "7 dias anteriores". These are
 *  also the Comparison.label strings the verdict reads. */
export function ruleWords(rule: CompareRule, range: DateRange, cut: boolean): string {
  switch (rule) {
    case 'day_before': return cut ? 'ontem até esta hora' : 'dia anterior'
    case 'yesterday': return 'dia anterior'
    case 'same_days': return 'mesmos dias do mês passado'
    case 'prev_month': return 'mês anterior'
    case 'n_days':
    default: {
      const n = daysBetween(range.from, range.to)
      return n === 1 ? 'dia anterior' : `${n} dias anteriores`
    }
  }
}

export interface LabelInput {
  rule: CompareRule
  range: DateRange
  cut: 'all' | 'none' | 'mixed'
  /** The cut minute when the screen is one store (its clock). */
  oneStoreMinute: number | null
  /** One archived store clamped at its archive minute. */
  archived: boolean
  /** Members read whole while others were cut ("Hibikura"), with their city. */
  wholeMembers: { name: string; city: string }[]
  leftOut: { name: string; why: string }[]
  /** The clock's today, for the year rule. */
  today: IsoDate
}

/** A rule's words as a phrase after "do que": "nos 16 dias anteriores",
 *  "no dia anterior", "nos mesmos dias do mês passado", "no mês anterior". */
export function wordsPhrase(words: string): string {
  if (words === 'ontem até esta hora') return words
  if (words === 'dia anterior' || words === 'mês anterior') return `no ${words}`
  if (/^mesmos dias/.test(words) || /dias anteriores$/.test(words)) return `nos ${words}`
  return `em ${words}`
}

export interface ComparisonLabels {
  words: string
  label: string
  /** `label` before the left-out clause. */
  labelBase: string
  short: string
  phrase: string
  rangeText: string
  cutText: string | null
}

/** The labels of R6: `full` for titles and ⓘ, `short` for pills, `phrase`
 *  for sentences, `rangeText` for "era $X em …". Each day is said once (bug
 *  L65: never "1–24 out até 00h06 de 24 out"). An archived store's cut is the
 *  archive minute, said as such, never "até esta hora" (R10, P7). */
export function comparisonLabels(i: LabelInput): ComparisonLabels {
  const range = formatRange(i.range, i.today)
  const cut = i.cut !== 'none'
  const words = ruleWords(i.rule, i.range, cut)
  const at = i.oneStoreMinute !== null ? clockText(i.oneStoreMinute) : null
  const cutText = !cut ? null
    : i.archived && at ? `até ${at}, hora do arquivamento`
      : at ? `até ${at}` : 'até esta hora'
  let label: string
  let short: string
  let phrase: string
  if (i.rule === 'day_before' && cut) {
    label = `vs ontem ${cutText}`
    short = label
    phrase = i.archived && at ? `no dia anterior, até ${at} (hora do arquivamento)` : 'ontem até esta hora'
  } else if (cut) {
    label = at ? `vs ${words} (${range}, ${cutText})` : `vs ${words} até esta hora (${range})`
    short = `vs ${range} (${cutText})`
    phrase = i.archived && at ? `${wordsPhrase(words)}, até ${at} (hora do arquivamento)` : `${wordsPhrase(words)} até esta hora`
  } else {
    label = `vs ${words} (${range})`
    short = `vs ${range}`
    phrase = wordsPhrase(words)
  }
  const rangeText = cutText ? `${range} (${cutText})` : range
  if (i.cut === 'mixed' && i.wholeMembers.length) {
    const names = joinNames(i.wholeMembers.map(m => m.name))
    const cities = [...new Set(i.wholeMembers.map(m => m.city))]
    label += `; ${names} com o dia inteiro (o dia de ${cities.join(' e ')} já fechou)`
  }
  const labelBase = label
  label += leftOutClause(i.leftOut)
  return { words, label, labelBase, short, phrase, rangeText, cutText }
}

/** ", sem Hibikura (começou em 7 nov)"; '' when nobody is left out. */
export function leftOutClause(leftOut: readonly { name: string; why: string }[]): string {
  return leftOut.length ? `, sem ${joinNames(leftOut.map(l => `${l.name} (${l.why})`))}` : ''
}

/**
 * The comparison's full label for a screen whose sum is `judgedIds` (R6
 * "the same stores in both windows": the verdict's judged set minus members
 * with no base or a partial base). A member outside the judged set (out of
 * the sum for having no cost settings) is not a comparison exclusion and is
 * not named here: it is named once, for being outside the sum. Without the
 * structured fields (an older answer) the full label as it came.
 */
export function comparisonFullAmong(
  c: { full?: string; fullBase?: string; leftOutWhy?: readonly { id: string; name: string; why: string }[] },
  judgedIds: readonly string[],
): string | undefined {
  if (c.fullBase === undefined || !c.leftOutWhy) return c.full
  return c.fullBase + leftOutClause(c.leftOutWhy.filter(l => judgedIds.includes(l.id)))
}

export function joinNames(names: readonly string[]): string {
  if (names.length <= 1) return names.join('')
  return `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}
