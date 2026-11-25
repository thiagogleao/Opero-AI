/**
 * The turn refresh guard (R8), pure so it can be tested with any clock skew.
 *
 * Each `nextTurnAt` value triggers at most one turn refresh. If the answer
 * still carries the same `nextTurnAt` (a server clock behind the client's
 * estimate), retry after 15 s, at most 4 times, then leave it to the 5-minute
 * re-check. A desktop clock 3 min fast therefore costs at most 5 refreshes per
 * turn, not 3 minutes of re-renders.
 */

export const RETRY_MS = 15_000
export const MAX_RETRIES = 4
export const RECHECK_MS = 5 * 60_000
/** The timer fires this long after nextTurnAt (server time). */
export const TURN_SLACK_MS = 2_000

export interface GuardState {
  /** The nextTurnAt the last refresh was for. */
  firedFor: string | null
  retries: number
}

export const initialGuard: GuardState = { firedFor: null, retries: 0 }

/**
 * Whether to refresh now. `differs`: the local re-check (sameResolution)
 * disagrees with what is shown. Returns the new guard state and, when not
 * refreshing, when to check again.
 */
export function shouldRefresh(
  g: GuardState, nextTurnAt: string, nowMs: number, differs: boolean,
): { refresh: boolean; state: GuardState; checkInMs: number } {
  const due = Date.parse(nextTurnAt) + TURN_SLACK_MS <= nowMs
  if (!due && !differs) {
    return { refresh: false, state: g, checkInMs: Math.min(RECHECK_MS, Math.max(1000, Date.parse(nextTurnAt) + TURN_SLACK_MS - nowMs)) }
  }
  if (g.firedFor !== nextTurnAt) return { refresh: true, state: { firedFor: nextTurnAt, retries: 0 }, checkInMs: RETRY_MS }
  if (g.retries < MAX_RETRIES) return { refresh: true, state: { firedFor: nextTurnAt, retries: g.retries + 1 }, checkInMs: RETRY_MS }
  return { refresh: false, state: g, checkInMs: RECHECK_MS }
}
