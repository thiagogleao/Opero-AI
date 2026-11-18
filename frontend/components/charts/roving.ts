/**
 * Roving tab stop for the points of a chart (pure; used by ChartTips).
 *
 * A chart is ONE stop in the page's tab order: Tab lands on one point (a day
 * bar, an hour), ←/→ move between points, Home/End jump to the first/last, and
 * the next Tab leaves the chart. Before this, every day bar was its own stop —
 * 38 presses to get past the Resumo's daily chart.
 *
 * The keys are only ←/→/Home/End: ↑/↓ keep scrolling the page.
 */

/** aria-keyshortcuts value set on every point. */
export const ROVING_KEYS = 'ArrowLeft ArrowRight Home End'

/** The index a key moves to from `current` among `count` points, or null when
 *  the key is not a roving key (the event is left alone). Clamped at the ends,
 *  never wrapping: a wrap from the last day to the first reads as a jump in time. */
export function rovingTarget(key: string, current: number, count: number): number | null {
  if (count <= 0) return null
  const last = count - 1
  const i = Math.min(Math.max(0, current), last)
  switch (key) {
    case 'ArrowRight': return Math.min(last, i + 1)
    case 'ArrowLeft': return Math.max(0, i - 1)
    case 'Home': return 0
    case 'End': return last
    default: return null
  }
}

/** Which point holds the tab stop: the focused one, else the first one marked
 *  tabindex="0" (the chart's own choice, rendered on the server), else the
 *  first point. `tabIndexes` are the points' current tabindex attributes. */
export function rovingStop(tabIndexes: (string | null)[], focused: number): number {
  if (focused >= 0 && focused < tabIndexes.length) return focused
  const marked = tabIndexes.indexOf('0')
  return marked >= 0 ? marked : 0
}
