/**
 * Money, Pct, Roas, Count, Delta, RichLine — numbers on screen, always in mono
 * with tabular figures and always through lib/format. Server-safe.
 *
 * Money  { value: number|null; cents?: 'auto'|'always'|'never'; sign?: boolean;
 *          tone?: 'auto'|'none'|'pos'|'neg'|'mut'; empty?: string; className? }
 *        tone 'auto' colours negatives coral (positives stay ink); 'none' never colours.
 *   <Money value={-201.18} />            → −$201 (coral)
 *   <Money value={9.8} />                → $9,80
 *   <Money value={1313.07} sign tone="pos" /> → +$1.313 (green)
 * Pct    { value: number|null (12 = 12%); digits?: number; sign?: boolean; tone?; className? }
 * Roas   { value: number|null; className? }                       → 1,95×
 * Count  { value: number|null; className? }                       → 1.174
 *
 * Delta  The change against the comparison, saying what it compares.
 *        { current: number|null; previous: number|null; label?: string (e.g. "vs 3–9 nov");
 *          kind?: 'money'|'count'|'pct' (pct = percentage points); goodWhen?: 'up'|'down'|'neutral';
 *          showPrevious?: boolean (adds the previous value: "vs 3–9 nov ($1.869)") }
 *   <Delta current={1313} previous={1869} label="vs 3–9 nov" />   → ▼ 30% vs 3–9 nov
 *   Costs use goodWhen="down" (spend falling is green); neutral data (revenue
 *   of a store you are not judging) use "neutral" (steel blue). A change from
 *   zero, from a loss or into a loss has no percentage: shows "era $X" instead.
 *
 * RichLine { line: VerdictLine; className? } — renders a verdict line with its
 *          strong runs.
 */

import type { VerdictLine } from '@/lib/views/verdict'
import { formatCount, formatMoney, formatPct, formatPp, formatRoas, pctChange, readablePctChange, type MoneyOptions } from '@/lib/format'
import s from './Display.module.css'

const cx = (...c: (string | false | null | undefined)[]) => c.filter(Boolean).join(' ')
type Tone = 'auto' | 'none' | 'pos' | 'neg' | 'mut'

function toneClass(tone: Tone, v: number | null | undefined): string | undefined {
  if (tone === 'pos') return s.pos
  if (tone === 'neg') return s.neg
  if (tone === 'mut') return s.mut
  if (tone === 'auto' && typeof v === 'number' && v < 0) return s.neg
  return undefined
}

export function Money({ value, cents, sign, tone = 'auto', empty, className }: {
  value: number | null | undefined; cents?: MoneyOptions['cents']; sign?: boolean; tone?: Tone; empty?: string; className?: string
}) {
  return <span className={cx(s.num, toneClass(tone, value), className)}>{formatMoney(value, { cents, sign, empty })}</span>
}

export function Pct({ value, digits, sign, tone = 'none', className }: {
  value: number | null | undefined; digits?: number; sign?: boolean; tone?: Tone; className?: string
}) {
  return <span className={cx(s.num, toneClass(tone, value), className)}>{formatPct(value, { digits, sign })}</span>
}

export function Roas({ value, className }: { value: number | null | undefined; className?: string }) {
  return <span className={cx(s.num, className)}>{formatRoas(value)}</span>
}

export function Count({ value, className }: { value: number | null | undefined; className?: string }) {
  return <span className={cx(s.num, className)}>{formatCount(value)}</span>
}

export interface DeltaProps {
  current: number | null | undefined
  previous: number | null | undefined
  label?: string
  kind?: 'money' | 'count' | 'pct'
  goodWhen?: 'up' | 'down' | 'neutral'
  showPrevious?: boolean
  className?: string
}

export function Delta({ current, previous, label, kind = 'money', goodWhen = 'up', showPrevious, className }: DeltaProps) {
  const fmtPrev = (v: number) => kind === 'money' ? formatMoney(v) : kind === 'pct' ? formatPct(v) : formatCount(v)
  if (typeof current !== 'number' || typeof previous !== 'number') {
    return <span className={cx(s.delta, s.none, className)}><span className={s.vs}>sem comparação</span></span>
  }
  // Margins and other percentages change in points, not in percent of percent.
  // A money/count change that crosses zero ($1.869 → −$200) has no honest
  // percentage either: it falls back to "era $1.869".
  const pct = kind === 'pct' ? current - previous : current < 0 ? null : pctChange(current, previous)
  // Past ±300% a percentage stops informing ($250 after $1,89 read
  // "▲13.123%"): say the difference instead. No minimum base here, unlike the
  // verdict's totals: a $8 cost per order still moves meaningfully in percent.
  const change = kind !== 'pct' && pct !== null && readablePctChange(current, previous, { minBase: 0 }) === null ? null : pct
  if (change === null && pct !== null) {
    const d = current - previous
    const dir = d > 0 ? 'up' : 'down'
    const good = goodWhen === 'neutral' ? 'neutral' : (dir === 'up') === (goodWhen === 'up') ? 'up' : 'down'
    return (
      <span className={cx(s.delta, good === 'neutral' ? s.neutral : s[good], className)}>
        <span className={s.arrow} aria-hidden="true">{dir === 'up' ? '▲' : '▼'}</span>
        <span className="sr-only">{dir === 'up' ? 'subiu' : 'caiu'}</span>
        {kind === 'money' ? formatMoney(Math.abs(d)) : formatCount(Math.abs(d))} a {d > 0 ? 'mais' : 'menos'}
        {label && <span className={s.vs}>{label}{showPrevious ? ` (${fmtPrev(previous)})` : ''}</span>}
      </span>
    )
  }
  if (change === null) {
    return (
      <span className={cx(s.delta, s.none, className)}>
        <span className={s.vs}>{label ? `${label}: ` : ''}era {fmtPrev(previous)}</span>
      </span>
    )
  }
  const dir = Math.abs(change) < 0.5 ? 'flat' : change > 0 ? 'up' : 'down'
  const good = goodWhen === 'neutral' || dir === 'flat' ? 'neutral' : (dir === 'up') === (goodWhen === 'up') ? 'up' : 'down'
  const text = kind === 'pct' ? formatPp(Math.abs(change)) : formatPct(Math.abs(change), { digits: 0 })
  return (
    <span className={cx(s.delta, good === 'neutral' ? s.neutral : s[good], className)}>
      <span className={s.arrow} aria-hidden="true">{dir === 'up' ? '▲' : dir === 'down' ? '▼' : '■'}</span>
      <span className="sr-only">{dir === 'up' ? 'subiu' : dir === 'down' ? 'caiu' : 'estável'}</span>
      {text}
      {label && <span className={s.vs}>{label}{showPrevious ? ` (${fmtPrev(previous)})` : ''}</span>}
    </span>
  )
}

export function RichLine({ line, className }: { line: VerdictLine; className?: string }) {
  return (
    <span className={cx(s.rich, className)}>
      {line.parts.map((p, i) => p.strong
        ? <strong key={i} className={p.tone ? s[p.tone] : undefined}>{p.text}</strong>
        : <span key={i} className={p.tone ? s[p.tone] : undefined}>{p.text}</span>)}
    </span>
  )
}
