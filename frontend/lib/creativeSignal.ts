/**
 * The verdict on a single ad.
 *
 * One definition for every surface: the web dashboard feeds it to the AI and
 * the mobile app renders it as a badge. When these drifted apart an ad could
 * read KILL on the phone and SCALE on the desktop, so the thresholds live here
 * and nowhere else.
 */

export type Signal = 'kill' | 'scale' | 'refresh' | 'ok'

export interface SignalInput {
  spend: number
  roas: number
  frequency: number
  /** Percentage of impressions that became a video play; null for static ads. */
  hookRate: number | null
  /** The store's own break-even ROAS — an ad is only "good" relative to costs. */
  breakEven: number
}

/** Below 80% of break-even with real money spent is money burning right now. */
const KILL_SPEND_FLOOR  = 50
const KILL_ROAS_FACTOR  = 0.8
/** 40% above break-even, with enough spend to trust the number. */
const SCALE_SPEND_FLOOR = 30
const SCALE_ROAS_FACTOR = 1.4
/** Andromeda-era fatigue markers. */
const FATIGUE_FREQUENCY = 3.5
const WEAK_HOOK_RATE    = 25

export function creativeSignal(a: SignalInput): Signal {
  if (a.spend >= KILL_SPEND_FLOOR && a.roas < a.breakEven * KILL_ROAS_FACTOR) return 'kill'
  if (a.roas >= a.breakEven * SCALE_ROAS_FACTOR && a.spend >= SCALE_SPEND_FLOOR) return 'scale'
  if (a.frequency > FATIGUE_FREQUENCY) return 'refresh'
  if (a.hookRate !== null && a.hookRate < WEAK_HOOK_RATE) return 'refresh'
  return 'ok'
}

/** Ordering for a list that should lead with what needs a decision. */
export const SIGNAL_RANK: Record<Signal, number> = { kill: 0, scale: 1, refresh: 2, ok: 3 }

/** The break-even a store is judged against when its costs are not configured. */
export const FALLBACK_BREAK_EVEN = 1.5
