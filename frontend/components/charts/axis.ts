/**
 * Label placement for the daily charts' x axis and value labels. Pure (no
 * React), in viewBox units: the SVGs scale as a whole, so what does not
 * overlap in the viewBox does not overlap on screen.
 *
 *   const ax = dailyAxis(days.map(d => d.date), { x0: m.l, band, right: W - m.r, partialIdx })
 *   ax.days    → [{ i, text: '17' | 'hoje', x, anchor }]   the day row
 *   ax.months  → [{ i, text: 'nov', x, anchor }]            one name per month change
 *   ax.boundaries → [i, …]                                  first day of each new month
 *
 * Rules: "hoje" first, then each month's day 1, then the first day, then
 * calendar-regular days (1, 8, 15, 22, 29 when only one in seven fits); a
 * label is kept only if its box clears every label already kept, and labels
 * near the edges are anchored inside the plot instead of spilling out.
 */

/** IBM Plex Mono advance width, in em. */
const MONO_EM = 0.6
/** IBM Plex Sans, rough average for lowercase words and digits, in em. */
const SANS_EM = 0.56
const MONTHS = ['jan', 'fev', 'mar', 'abr', 'mai', 'jun', 'jul', 'ago', 'set', 'out', 'nov', 'dez']

export function textWidth(text: string, fontSize: number, font: 'mono' | 'sans' = 'mono'): number {
  return text.length * fontSize * (font === 'mono' ? MONO_EM : SANS_EM)
}

export interface PlacedLabel {
  i: number
  text: string
  x: number
  anchor: 'start' | 'middle' | 'end'
}

/** A label centred on `cx`, moved inside [left, right] when it would spill out. */
export function clampLabel(cx: number, w: number, left: number, right: number): { x: number; anchor: PlacedLabel['anchor']; from: number; to: number } {
  if (cx + w / 2 > right) return { x: right, anchor: 'end', from: right - w, to: right }
  if (cx - w / 2 < left) return { x: left, anchor: 'start', from: left, to: left + w }
  return { x: cx, anchor: 'middle', from: cx - w / 2, to: cx + w / 2 }
}

interface Box { from: number; to: number }
const clears = (b: Box, kept: Box[], gap: number) => kept.every(k => b.to + gap <= k.from || b.from >= k.to + gap)

// Strides that land on calendar-friendly days (day % stride === 1).
const STRIDES = [1, 2, 3, 5, 7, 10, 15]

export interface DailyAxisOptions {
  /** Left edge of the first band. */
  x0: number
  /** Width of one day. */
  band: number
  /** Right edge of the plot: no label passes it. */
  right: number
  /** Index of the running day ("hoje"), or -1. */
  partialIdx?: number
  /** Day-row font size (default 11, mono). */
  fontSize?: number
  /** Month-row font size (default 10.5, sans). */
  monthFontSize?: number
  /** Minimum clear space between two labels (default 6). */
  gap?: number
}

export interface DailyAxis {
  days: PlacedLabel[]
  months: PlacedLabel[]
  boundaries: number[]
  /** Days between two regular labels (0 = only "hoje" and the month starts). */
  stride: number
}

export function dailyAxis(dates: string[], o: DailyAxisOptions): DailyAxis {
  const fs = o.fontSize ?? 11
  const mfs = o.monthFontSize ?? 10.5
  const gap = o.gap ?? 6
  const partialIdx = o.partialIdx ?? -1
  const left = o.x0
  const cx = (i: number) => o.x0 + i * o.band + o.band / 2
  const day = (i: number) => Number(dates[i].slice(8, 10))
  const boundaries = dates.map((_, i) => i).filter(i => i > 0 && day(i) === 1)

  // ── Day row
  const need = textWidth('28', fs) + gap
  const stride = STRIDES.find(st => st * o.band >= need) ?? 0
  const order: number[] = []
  if (partialIdx >= 0) order.push(partialIdx)
  order.push(...boundaries)
  if (dates.length) order.push(0)
  if (stride) for (let i = 0; i < dates.length; i++) if (stride === 1 || day(i) % stride === 1) order.push(i)

  const keptDays: Box[] = []
  const days: PlacedLabel[] = []
  const seen = new Set<number>()
  for (const i of order) {
    if (seen.has(i)) continue
    seen.add(i)
    const text = i === partialIdx ? 'hoje' : String(day(i))
    const w = textWidth(text, fs)
    const c = clampLabel(cx(i), w, left, o.right)
    if (!clears(c, keptDays, gap)) continue
    keptDays.push(c)
    days.push({ i, text, x: c.x, anchor: c.anchor })
  }
  days.sort((a, b) => a.i - b.i)

  // ── Month row: the name starts at the month's first band, once per change;
  // the first day carries its month only when the next change is far enough.
  const keptMonths: Box[] = []
  const months: PlacedLabel[] = []
  for (const i of [...boundaries, ...(dates.length ? [0] : [])]) {
    const text = MONTHS[Number(dates[i].slice(5, 7)) - 1]
    const w = textWidth(text, mfs, 'sans')
    const start = o.x0 + i * o.band + 1
    const b = start + w > o.right ? { x: o.right, anchor: 'end' as const, from: o.right - w, to: o.right } : { x: start, anchor: 'start' as const, from: start, to: start + w }
    if (!clears(b, keptMonths, gap)) continue
    keptMonths.push(b)
    months.push({ i, text, x: b.x, anchor: b.anchor })
  }
  months.sort((a, b) => a.i - b.i)

  return { days, months, boundaries, stride }
}

/** A value label's box, for 2-D collision checks between value labels. */
export interface ValueBox { from: number; to: number; top: number; bottom: number }

export function valueBox(c: { from: number; to: number }, baseline: number, fontSize = 11): ValueBox {
  return { from: c.from, to: c.to, top: baseline - fontSize, bottom: baseline + 2 }
}

export function boxesOverlap(a: ValueBox, b: ValueBox, gap = 2): boolean {
  return !(a.to + gap <= b.from || b.to + gap <= a.from || a.bottom + gap <= b.top || b.bottom + gap <= a.top)
}
