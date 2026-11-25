/**
 * The period's data model (D:/opero-tmp/period/spec.md §2). Plain data,
 * serialisable, no Date objects inside values: a Resolution crosses the
 * network to the phone and into client props on the desktop.
 *
 * A *selection* is what was asked (a scope, a period value, the split toggle).
 * A *resolution* is what that selection means at one instant. Only an owner
 * action or an opened link changes a selection; the clock only changes
 * resolutions (spec P1).
 */

import type { DateRange } from '../engine/dates'

export type { DateRange }

/** 'YYYY-MM-DD', validated by isIsoDate. */
export type IsoDate = string
/** ISO-8601 UTC instant. */
export type Instant = string

export type Preset = 'today' | 'yesterday' | '7d' | '14d' | '30d' | '90d' | 'mtd' | 'lastmonth'

export type PeriodValue =
  | { kind: 'preset'; preset: Preset }
  /** from <= to, always (the parser orders them). */
  | { kind: 'dates'; from: IsoDate; to: IsoDate }

export type ScopeRef = { kind: 'all' } | { kind: 'store'; id: string }

/** One store the VIEWER may see (lib/access decides which). */
export interface StoreFacts {
  id: string
  /** Disambiguated StoreRef.name. */
  name: string
  /** IANA; safeTz() applied. */
  tz: string
  /** tenants.archived_at, or null for an active store. */
  archivedAt: Instant | null
  /** archivedAt's date on the store's own calendar. */
  archivedOn: IsoDate | null
  /** First kept order, store calendar; null = never sold. */
  firstOrderDate: IsoDate | null
  /** min(first order, first ad spend, first refund/chargeback); null = none. */
  firstActivityDate: IsoDate | null
}

export interface ViewerStores {
  /** Excludes archived; sorted by FALLBACK_ORDER (R5). */
  active: StoreFacts[]
  archived: StoreFacts[]
  /** active.length >= 2. */
  allowsAll: boolean
  /** Hash of ids + archivedAt + first dates (R19). */
  version: string
}

export interface Selection {
  /** ALWAYS what is shown (R2): never 'all' standing for a remembered store. */
  scope: ScopeRef
  period: PeriodValue
  /** ?parte=50: desktop only; a view toggle, not part of the period. */
  split: boolean
}

export type MemberState =
  /** Live store, window reaches the store's own today. */
  | 'running'
  /** Window ends before the store's own today (and before archivedOn if archived). */
  | 'closed'
  /** Window starts after the store's own today (a store behind the anchor). */
  | 'not_started'
  /** Archived, and the window starts after archivedOn: nothing was read. */
  | 'frozen'
  /** Archived, and the window reaches archivedOn: read up to the archive instant. */
  | 'clamped'

export interface MemberCompare {
  range: DateRange
  /** = lastDayCut (R6). */
  cutAtMinute: number | null
  /** 'partial': the range starts before firstActivityDate (R6). */
  base: 'full' | 'partial'
}

export interface MemberResolution {
  storeId: string
  /** todayIn(store.tz, now). */
  storeToday: IsoDate
  /** The days actually priced; null for frozen / not_started. */
  read: DateRange | null
  state: MemberState
  /** Minute of read.to that ends the reading: running → minutes into the day at
   *  asOf; clamped → minute of archivedAt; else null. */
  lastDayCut: number | null
  /** Null: nothing to compare (frozen, not_started, base wholly before start). */
  compare: MemberCompare | null
  /** Why compare is null when the member was read: the comparison lies
   *  wholly before the store's first activity. */
  noBase: boolean
}

/** How a comparison window relates to the window (R6). */
export type CompareRule = 'day_before' | 'yesterday' | 'n_days' | 'same_days' | 'prev_month'

export interface ResolvedComparison {
  range: DateRange
  rule: CompareRule
  /** "ontem até esta hora", "7 dias anteriores", "mesmos dias do mês passado". */
  words: string
  /** For titles and ⓘ: "vs 7 dias anteriores (10–16 nov)". */
  label: string
  /** For pills and KPI deltas: "vs 10–16 nov", "vs 25 out – 9 nov (até 06h08)". */
  short: string
  /** For sentences after "do que": "nos 16 dias anteriores até esta hora",
   *  "ontem até esta hora", "nos 17 dias anteriores, até 09h02 (hora do
   *  arquivamento)". */
  phrase: string
  /** The comparison's dates with where its last day stops, each day said
   *  once: "25 out – 9 nov (até 06h08)", "8–24 out (até 09h02, hora do
   *  arquivamento)", "10–16 nov". */
  rangeText: string
  /** Where the last day stops, alone: "até 06h08", "até esta hora",
   *  "até 09h02, hora do arquivamento"; null for whole days. */
  cutText: string | null
  cut: 'all' | 'none' | 'mixed'
  /** The cut minute when every cut member was cut at the same one. */
  cutMinute: number | null
  /** Names of members left out of the delta (no base / partial base). */
  leftOut: string[]
  /** `label` without its ", sem X (começou em …)" clause, and the members
   *  that clause names with why: a screen whose sum leaves stores out for
   *  another reason (no cost settings) names only the members of its own
   *  judged set (comparisonFullAmong, R6). */
  labelBase: string
  leftOutWhy: LeftOutMember[]
}

/** A member left out of the delta (R6): "Hibikura (começou em 7 nov)". */
export interface LeftOutMember { id: string; name: string; why: string }

export interface DeltaNote {
  reason: 'no_base' | 'partial_base' | 'none'
  text: string
}

/**
 * The comparison as every screen names it (header, verdict, KPI pills, phone
 * cells), from one resolution (R6, R7): lib/period screenComparison. With no
 * comparison, `none` holds R6's words (possibly '') and the range fields are
 * the window's, for year context only — never "vs dia anterior".
 */
export interface ScreenComparison extends DateRange {
  /** The rule's words ("16 dias anteriores", "ontem até esta hora"); '' with none. */
  label: string
  sameTimeOfDay: boolean
  cutoffMinutes: number | null
  full: string
  short: string
  phrase: string
  rangeText: string
  cutText: string | null
  /** No comparison at all: R6's words ("sem base: a loja começou em 7 nov"),
   *  '' when there is nothing to say (frozen); null when there is one. */
  none: string | null
  /** One store with a partial base: "base incompleta: a loja começou em
   *  7 nov" (no delta % or p.p.). */
  partialBase: string | null
  /** Members left out of the delta, by name (R6). */
  leftOut: string[]
  /** `full` without the left-out clause, and that clause's members
   *  (comparisonFullAmong). */
  fullBase: string
  leftOutWhy: LeftOutMember[]
}

export interface PeriodLabel {
  /** "Hoje · 25 nov", "Últimos 7 dias · 18–24 nov", "1–15 nov". */
  full: string
  /** "Hoje", "Últimos 7 dias", "1–15 nov". */
  short: string
  /** The period bar / picker button: "Hoje", "7 dias", "25/10–23/11". */
  button: string
  /** Second line of a dates button when the year is needed: "2025–26". */
  buttonYear: string | null
  /** For sentences: "hoje", "nos últimos 7 dias", "em 24 nov". */
  phrase: string
  /** The window as dates: "18–24 nov". */
  range: string
}

export type NoteCode =
  | 'future_start' | 'future_end' | 'floor' | 'too_early' | 'too_long'
  | 'archived_clamp' | 'archived_frozen' | 'starts_inside' | 'partial_base'
  | 'unknown_store' | 'bad_param' | 'incomplete' | 'saved_store_gone' | 'remembered_gone'
  | 'single_store' | 'scope_dates_differ' | 'left_archive' | 'members_changed'
  | 'stores_changed' | 'legacy_push_undated' | 'turn_deferred'

/** A note: a code plus the validated, already formatted values its text needs.
 *  Values never come raw from a URL (R15). */
export interface Note {
  code: NoteCode
  params?: Record<string, string | number>
}

export interface Resolution {
  /** Echoed unchanged (P1). */
  selection: Selection
  /** The `now` this was resolved (and priced) at. */
  asOf: Instant
  /** anchorTz of the members. */
  clockTz: string
  clockToday: IsoDate
  /** After fitting (R9), on the clock's calendar. */
  window: DateRange
  /** The value the window was resolved from after fitting: a future dates
   *  value shows the clock's Hoje (R9.1). */
  effective: PeriodValue
  members: MemberResolution[]
  /** Some member is 'running'. */
  partial: boolean
  /** 'HHhMM' of asOf on the clock. */
  partialUntil: string | null
  /** Minutes into the clock's day at asOf. */
  minutesIntoDay: number
  comparison: ResolvedComparison | null
  /** R6: why the screen shows no delta, in its own words; null when it shows
   *  one. 'no_base': the comparison lies wholly before the first activity
   *  ("sem base: a loja começou em 7 nov"); 'partial_base': one store whose
   *  comparison starts before it ("base incompleta: a loja começou em
   *  7 nov"; the base value may show, the delta % never); 'none': nothing to
   *  compare (frozen, not started), text ''. */
  deltaNote: DeltaNote | null
  label: PeriodLabel
  /** 'Brasília · cada loja no seu fuso' | 'Tóquio'. */
  clockNote: string
  /** The clock's UTC offset differs from Brasília's at asOf ("dia de Tóquio"). */
  clockDiffers: boolean
  notes: Note[]
  /** Never null (R8). */
  nextTurnAt: Instant
  factsVersion: string
}
