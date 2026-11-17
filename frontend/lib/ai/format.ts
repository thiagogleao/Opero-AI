/**
 * Number formatting for what the model reads. Every figure is rounded once,
 * here, so the prompt, the tool results and the facts returned to the screen
 * show the same digits — the model is told to copy numbers, not to round
 * them again.
 */

export const r2 = (n: number | null | undefined): number | null =>
  n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 100) / 100

export const r1 = (n: number | null | undefined): number | null =>
  n === null || n === undefined || !Number.isFinite(n) ? null : Math.round(n * 10) / 10

/** "$1,234.56" (or "−$12.30"); "—" for a missing value. */
export function usd(n: number | null | undefined): string {
  if (n === null || n === undefined || !Number.isFinite(n)) return '—'
  const abs = Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })
  return n < 0 ? `-$${abs}` : `$${abs}`
}

/** "12.3%"; "—" when not computable. */
export function pct(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : `${n.toFixed(1)}%`
}

/** "2.41x"; "—" when not computable (no spend, no contribution). */
export function times(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : `${n.toFixed(2)}x`
}

export function int(n: number | null | undefined): string {
  return n === null || n === undefined || !Number.isFinite(n) ? '—' : Math.round(n).toLocaleString('en-US')
}

export const safeDiv = (a: number, b: number): number | null => (b > 0 ? a / b : null)
