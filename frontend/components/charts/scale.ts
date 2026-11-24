/**
 * Pure chart helpers shared by the SVG charts (no React, no DOM).
 *
 *   niceTicks(min, max, count)  round tick values covering [min, max], 0 included
 *                               (label them with formatMoneyAxis(t, ticks))
 *   linear([d0, d1], [r0, r1])  a linear scale function
 *   barPath(x, w, y0, y1, r)    a bar with a rounded far end and a flat base
 *   tipAttr(tip)                serialise a tooltip for <ChartTips> (data-tip)
 */

/** Every axis these charts draw is money: no step finer than one cent. */
export const MIN_TICK_STEP = 0.01

/**
 * A round step near span / count: 1, 2 or 5 × a power of ten, and 2,5 × one
 * only from 25 up (25, 250, 2.500). Below that 2,5 lands between round
 * numbers ($2,50 / $7,50 ticks on a $10 axis, half cents at $0,025), so 2
 * is used instead. Never below `minStep`.
 */
export function niceStep(span: number, count: number, minStep = MIN_TICK_STEP): number {
  const raw = Math.max(span / Math.max(1, count), minStep)
  const mag = 10 ** Math.floor(Math.log10(raw))
  const n = raw / mag
  const step = n <= 1 ? 1 : n <= 2 ? 2 : n <= 2.5 ? (mag >= 10 ? 2.5 : 2) : n <= 5 ? 5 : 10
  return Number((step * mag).toPrecision(12))
}

/**
 * Round ticks from ≤ min to ≥ max; always includes 0 when the range does.
 * Steps of a dollar or more are whole dollars; smaller ones are whole cents
 * (format them with formatMoneyAxis(t, ticks), which then shows the cents).
 */
export function niceTicks(min: number, max: number, count = 5, minStep = MIN_TICK_STEP): number[] {
  let lo = Math.min(min, 0)
  let hi = Math.max(max, 0)
  if (hi - lo < 1e-9) { hi = lo + 1 }
  const step = niceStep(hi - lo, count, minStep)
  lo = Math.floor(lo / step) * step
  hi = Math.ceil(hi / step) * step
  const out: number[] = []
  for (let v = lo; v <= hi + step / 2; v += step) out.push(Math.abs(v) < step / 1e6 ? 0 : Number(v.toFixed(10)))
  return out
}

export function linear(domain: [number, number], range: [number, number]): (v: number) => number {
  const [d0, d1] = domain
  const [r0, r1] = range
  const k = d1 === d0 ? 0 : (r1 - r0) / (d1 - d0)
  return (v: number) => r0 + (v - d0) * k
}

/** Bar from baseline y0 to y1 with the far end rounded (radius r). */
export function barPath(x: number, w: number, y0: number, y1: number, r = 3): string {
  const h = Math.abs(y1 - y0)
  const rr = Math.max(0, Math.min(r, h, w / 2))
  const f = (n: number) => Number(n.toFixed(2))
  if (h < 0.5) return `M${f(x)},${f(y0)}h${f(w)}`
  if (y1 < y0) {
    return `M${f(x)},${f(y0)}V${f(y1 + rr)}Q${f(x)},${f(y1)} ${f(x + rr)},${f(y1)}H${f(x + w - rr)}Q${f(x + w)},${f(y1)} ${f(x + w)},${f(y1 + rr)}V${f(y0)}Z`
  }
  return `M${f(x)},${f(y0)}V${f(y1 - rr)}Q${f(x)},${f(y1)} ${f(x + rr)},${f(y1)}H${f(x + w - rr)}Q${f(x + w)},${f(y1)} ${f(x + w)},${f(y1 - rr)}V${f(y0)}Z`
}

/** A tooltip: title, rows of [label, value, tone?], and an optional note. */
export interface ChartTip {
  title: string
  rows?: [string, string, ('pos' | 'neg' | 'warn' | null)?][]
  note?: string
}

/** For the data-tip attribute read by <ChartTips>. */
export function tipAttr(tip: ChartTip): string {
  return JSON.stringify(tip)
}

/** Deterministic, CSS-safe id fragment from React's useId(). */
export function svgId(reactId: string, suffix: string): string {
  return `c${reactId.replace(/[^a-zA-Z0-9_-]/g, '')}-${suffix}`
}
