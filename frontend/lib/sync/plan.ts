import { shiftDate } from '../engine/dates'

/**
 * What to collect, and when. Pure functions only — the scheduler, the refresh
 * endpoint and the job runner all decide through here, and the tests pin it.
 *
 * Lanes: one store runs at most one job per lane at a time, and the Python
 * collector holds the same lane as its lock key.
 *   shopify             orders, items, Shop Campaigns, checkouts, products
 *   facebook            Meta daily insights (spend, purchases)
 *   facebook_structure  campaigns/ad sets/ads/creatives + breakdowns
 */

export type Lane = 'shopify' | 'facebook' | 'facebook_structure'
export type ShopifyMode = 'scheduled' | 'refresh' | 'backfill'
export type InsightMode = 'quick' | 'repull7' | 'repull28' | 'backfill'
export type SyncMode = ShopifyMode | InsightMode | 'structure'

export interface SyncJob {
  tenantId: string
  lane: Lane
  mode: SyncMode
  /** Store-local dates, inclusive. Always explicit. */
  from: string
  to: string
  /** Only this ad account (a newly attached account's backfill). */
  account?: string
  /** For logs: why this job exists ("agendado", "atualizar", …). */
  reason: string
  /** Store name for logs. */
  label?: string
}

export const laneKey = (tenantId: string, lane: Lane) => `${tenantId}:${lane}`
export const jobKey = (j: Pick<SyncJob, 'tenantId' | 'lane'>) => laneKey(j.tenantId, j.lane)

/** collect_recent.py arguments for a job. */
export function cliArgs(j: SyncJob): string[] {
  const args = ['--tenant', j.tenantId, '--source', j.lane === 'shopify' ? 'shopify' : 'facebook',
    '--mode', j.mode, '--date-from', j.from, '--date-to', j.to]
  if (j.account && j.lane !== 'shopify') args.push('--account', j.account)
  return args
}

const SHOPIFY_RANK: Record<string, number> = { scheduled: 0, refresh: 1, backfill: 2 }
const INSIGHT_RANK: Record<string, number> = { quick: 0, repull7: 1, repull28: 2, backfill: 3 }

const minDate = (a: string, b: string) => (a < b ? a : b)
const maxDate = (a: string, b: string) => (a > b ? a : b)

/**
 * Fold a new request into a job already waiting in the same lane: the wider
 * window, the stronger mode, every account unless both asked for the same one.
 * This is what turns "the scheduler and two browser tabs all asked" into one
 * run instead of three.
 */
export function mergeJobs(a: SyncJob, b: SyncJob): SyncJob {
  if (jobKey(a) !== jobKey(b)) throw new Error('mergeJobs: different lanes')
  const rank = a.lane === 'shopify' ? SHOPIFY_RANK : INSIGHT_RANK
  const mode = (rank[b.mode] ?? 0) > (rank[a.mode] ?? 0) ? b.mode : a.mode
  const reasons = [...new Set([...a.reason.split(' + '), ...b.reason.split(' + ')])].join(' + ')
  return {
    ...a,
    mode,
    from: minDate(a.from, b.from),
    to: maxDate(a.to, b.to),
    account: a.account && a.account === b.account ? a.account : undefined,
    reason: reasons,
    label: a.label ?? b.label,
  }
}

/** Kill timer for a job, by how much it has to read. */
export function jobTimeoutMs(j: SyncJob): number {
  const days = Math.max(1, Math.round((Date.parse(`${j.to}T00:00:00Z`) - Date.parse(`${j.from}T00:00:00Z`)) / 86400000) + 1)
  const min = 60_000
  if (j.lane === 'facebook_structure') return 25 * min
  if (j.lane === 'facebook') return Math.min(60 * min, Math.max(10 * min, days * 30_000 + 5 * min))
  return Math.min(60 * min, Math.max(10 * min, days * 20_000 + 5 * min))
}

// ─── Windows ──────────────────────────────────────────────────────────────────

/** Re-read at most this far back after an outage. */
export const CATCH_UP_DAYS = 30
/** A store or ad account seen for the first time gets this much history. */
export const BACKFILL_DAYS = 90

/**
 * Window of a routine pass: today and the two days before (yesterday's late
 * orders and ad spend are incomplete at the previous run), widened back to
 * the day before the last success after an outage — so a store whose sync
 * stopped on Friday and resumed on Tuesday gets Friday back.
 */
export function incrementalWindow(today: string, lastSuccessDay: string | null): { from: string; to: string } {
  let from = shiftDate(today, -2)
  if (lastSuccessDay) from = minDate(from, shiftDate(lastSuccessDay, -1))
  return { from: maxDate(from, shiftDate(today, -CATCH_UP_DAYS)), to: today }
}

export function backfillWindow(today: string, collectFrom: string | null): { from: string; to: string } {
  const floor = shiftDate(today, -(BACKFILL_DAYS - 1))
  return { from: collectFrom && collectFrom > floor ? collectFrom : floor, to: today }
}

// ─── Meta passes ──────────────────────────────────────────────────────────────

export interface PassHistory {
  /** Start of the last run that succeeded (or partly succeeded). */
  success: Date | null
  /** Start of the last run in any state. */
  attempt: Date | null
}

export interface MetaPlanInput {
  now: Date
  /** Store-local date and hour. */
  today: string
  localHour: number
  /** Store-local date of an instant. */
  dayOf: (d: Date) => string
  structure: PassHistory
  repull7: PassHistory
  repull28: PassHistory
}

export interface PlannedPass { lane: Lane; mode: SyncMode; from: string; to: string; reason: string }

const H = 3_600_000
export const STRUCTURE_EVERY_MS = 4 * H
/** A failed pass is not retried sooner than this. */
export const RETRY_AFTER_MS = 1 * H
/** Late-attribution re-pulls start after this local hour, when the day is settled. */
export const REPULL_FROM_HOUR = 3

const ago = (now: Date, d: Date | null) => (d ? now.getTime() - d.getTime() : Infinity)

/**
 * Which slow Meta passes are due for one store:
 *  - structure + breakdowns every 4 h (the scheduler used to collect them
 *    never; only a desktop refresh did, so new ads dropped out of campaigns);
 *  - the last 7 complete days re-read once a night and the last 28 once a
 *    week: Meta keeps crediting purchases to a day for up to 7 days after the
 *    click (28 for view-through), and a day was frozen after day 2.
 */
export function dueMetaPasses(p: MetaPlanInput): PlannedPass[] {
  const out: PlannedPass[] = []
  const yesterday = shiftDate(p.today, -1)
  if (ago(p.now, p.structure.success) >= STRUCTURE_EVERY_MS && ago(p.now, p.structure.attempt) >= 30 * 60_000) {
    out.push({ lane: 'facebook_structure', mode: 'structure', from: shiftDate(p.today, -2), to: p.today, reason: 'estrutura' })
  }
  if (p.localHour < REPULL_FROM_HOUR) return out
  const weekly = ago(p.now, p.repull28.success) >= 6.5 * 24 * H && ago(p.now, p.repull28.attempt) >= RETRY_AFTER_MS
  if (weekly) {
    out.push({ lane: 'facebook', mode: 'repull28', from: shiftDate(p.today, -28), to: yesterday, reason: '28 dias' })
    return out
  }
  const lastDaily = [p.repull7.success, p.repull28.success].filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null
  const dailyDone = lastDaily ? p.dayOf(lastDaily) >= p.today : false
  const lastAttempt = [p.repull7.attempt, p.repull28.attempt].filter((d): d is Date => !!d)
    .sort((a, b) => b.getTime() - a.getTime())[0] ?? null
  if (!dailyDone && ago(p.now, lastAttempt) >= RETRY_AFTER_MS) {
    out.push({ lane: 'facebook', mode: 'repull7', from: shiftDate(p.today, -7), to: yesterday, reason: '7 dias' })
  }
  return out
}

/** Every store's last 90 days of orders are re-read once a month (and on the
 *  first night after this deploy): it repairs statuses that froze under the
 *  old collector and fills the new columns (tax, shipping, channel, province)
 *  for recent history. Routine passes only see orders updated since the last
 *  run, so a change missed back then would otherwise stay missed. */
export const SHOPIFY_REPAIR_EVERY_MS = 30 * 24 * H

export function shopifyRepairDue(o: { now: Date; localHour: number; backfill: PassHistory }): boolean {
  return o.localHour >= REPULL_FROM_HOUR
    && ago(o.now, o.backfill.success) >= SHOPIFY_REPAIR_EVERY_MS
    && ago(o.now, o.backfill.attempt) >= RETRY_AFTER_MS
}

/** A failed account backfill is not retried sooner than this. */
export const BACKFILL_RETRY_MS = 6 * H

/**
 * Does an ad account need its history pulled? (Attaching one used to bring
 * only the last two days.)
 *
 * The routine 30-minute pass collects every linked account for the last three
 * days, so "has rows" or "has a successful run" is true within half an hour of
 * linking — before this check (hourly) ever sees the account. What marks an
 * account as already collected is history reaching back past that routine
 * window: a run whose window started at the backfill floor, or tagged rows
 * older than the window.
 *
 * Rows collected before runs tagged their account carry no tag. A main account
 * whose ads also appear in those untagged rows is continuing that history
 * (MOKOO, Glooty, Hibikura); one whose ads never do is a new main account and
 * gets its history. With no tagged rows yet it cannot be told apart: wait.
 */
export function accountNeedsBackfill(a: {
  primary: boolean
  /** First day of the store's Meta rows tagged with this account. */
  firstTaggedDay: string | null
  /** The store holds Meta rows with no account tag. */
  tenantHasUntaggedRows: boolean
  /** Some ad of this account also appears in the store's untagged rows. */
  continuesUntagged: boolean
  /** Earliest date_from of a successful run for this account. */
  earliestCollectedFrom: string | null
  /** Start of the last backfill attempt for this account. */
  lastBackfillAttempt: Date | null
  collectFrom: string | null
  today: string
  now: Date
}): boolean {
  const floor = backfillWindow(a.today, a.collectFrom).from
  if (a.earliestCollectedFrom && a.earliestCollectedFrom <= floor) return false
  if (a.firstTaggedDay && (a.firstTaggedDay < shiftDate(a.today, -2) || a.firstTaggedDay <= floor)) return false
  if (a.primary && a.tenantHasUntaggedRows && (!a.firstTaggedDay || a.continuesUntagged)) return false
  return ago(a.now, a.lastBackfillAttempt) >= BACKFILL_RETRY_MS
}

// ─── Manual refresh ───────────────────────────────────────────────────────────

/** A lane that finished this recently is not run again for a plain refresh. */
export const REFRESH_DEBOUNCE_MS = 2 * 60_000

export type RefreshDecision = 'launch' | 'running' | 'fresh'

export function refreshDecision(o: {
  busy: boolean; lastSuccessAt: Date | null; now: Date; explicitRange: boolean
}): RefreshDecision {
  if (o.busy) return 'running'
  if (!o.explicitRange && o.lastSuccessAt && o.now.getTime() - o.lastSuccessAt.getTime() < REFRESH_DEBOUNCE_MS) return 'fresh'
  return 'launch'
}

/** Freshness colour for a lane: green / amber / red by minutes since success. */
export type Staleness = 'ok' | 'amber' | 'red' | 'unknown'
export const STALE_AFTER_MIN: Record<Lane, [number, number]> = {
  shopify: [20, 60],
  facebook: [45, 120],
  facebook_structure: [6 * 60, 24 * 60],
}
export function staleness(lane: Lane, lastSuccessAt: Date | null, now: Date): Staleness {
  if (!lastSuccessAt) return 'unknown'
  const min = (now.getTime() - lastSuccessAt.getTime()) / 60_000
  const [amber, red] = STALE_AFTER_MIN[lane]
  return min >= red ? 'red' : min >= amber ? 'amber' : 'ok'
}
