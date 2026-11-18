/**
 * Sparkline, MiniBars, HorizontalBars — the small charts. Server-safe (no
 * client code; wrap in <ChartTips> and add data-tip yourself if you need a
 * tooltip, or use the `tip` prop of MiniBars).
 *
 * Sparkline  A line with a soft area and a dot on the last value.
 *   { values: number[]; tone?: 'neu'|'pos'|'neg'|'meta'|'shop'|'cogs' (default neu);
 *     height?: number (px, default 34); width?: number (px; omit = fluid 100%);
 *     area?: boolean (default true); ariaLabel: string }
 *
 * MiniBars   Bars around a zero line (green/coral), e.g. 30 days of profit per store.
 *   { values: (number|null)[] (null = no data that day, drawn as a faint tick);
 *     height?: number (default 30); width?: number (default 128, fixed px; 0 = fluid);
 *     highlightLast?: number (shade the last N bars: the chosen window);
 *     color?: 'shop'|'meta'|'neu' (one colour for an all-positive series, e.g. spend);
 *     tip?: ChartTip (whole-chart tooltip); ariaLabel: string }
 *
 * HorizontalBars  Ranked share bars (HTML), e.g. countries or products.
 *   { items: { key: string; label: ReactNode; sub?: ReactNode; value: number;
 *              display?: ReactNode (right column, default formatMoney(value));
 *              note?: ReactNode (under the value); tone?: 'neu'|'pos'|'neg'|'meta'|'shop'|'cogs'|'mut' }[];
 *     max?: number (default the largest |value|); ariaLabel: string }
 */

import type { ReactNode } from 'react'
import { formatMoney } from '@/lib/format'
import { ChartTips } from './ChartTips'
import { barPath, linear, tipAttr, type ChartTip } from './scale'
import s from './charts.module.css'

const TONE = { neu: s.toneNeu, pos: s.tonePos, neg: s.toneNeg, meta: s.toneMeta, shop: s.toneShop, cogs: s.toneCogs } as const

export interface SparklineProps {
  values: number[]
  tone?: keyof typeof TONE
  height?: number
  width?: number
  area?: boolean
  ariaLabel: string
}

export function Sparkline({ values, tone = 'neu', height = 34, width, area = true, ariaLabel }: SparklineProps) {
  const W = 240
  const H = height
  if (values.length < 2) {
    return <svg viewBox={`0 0 ${W} ${H}`} width={width ?? '100%'} height={H} role="img" aria-label={`${ariaLabel}: sem dados suficientes`} />
  }
  // Zero is always in the domain; a little headroom above the top value. (An
  // all-negative series used to get an inverted domain.)
  const min = Math.min(0, ...values)
  const top = Math.max(0, ...values)
  const max = top + Math.max(top - min, 1e-9) * 0.06
  const x = linear([0, values.length - 1], [4, W - 4])
  const y = linear([min, max], [H - 3, 4])
  const d = values.map((v, i) => `${i ? 'L' : 'M'}${x(i).toFixed(1)},${y(v).toFixed(1)}`).join('')
  const lastV = values[values.length - 1]
  return (
    <svg
      viewBox={`0 0 ${W} ${H}`} width={width ?? '100%'} height={H} preserveAspectRatio="none"
      className={s.svgFixed} role="img" aria-label={ariaLabel}
    >
      {area && <path d={`${d}L${x(values.length - 1)},${H}L${x(0)},${H}Z`} className={`${TONE[tone]} ${s.sparkArea}`} />}
      <path d={d} className={`${TONE[tone]} ${s.sparkLine}`} style={{ fill: 'none' }} />
      <circle cx={x(values.length - 1)} cy={y(lastV)} r={3} className={`${TONE[tone]} ${s.sparkDot}`} />
    </svg>
  )
}

export interface MiniBarsProps {
  values: (number | null)[]
  height?: number
  width?: number
  highlightLast?: number
  color?: 'shop' | 'meta' | 'neu'
  tip?: ChartTip
  ariaLabel: string
}

export function MiniBars({ values, height = 30, width = 128, highlightLast, color, tip, ariaLabel }: MiniBarsProps) {
  const W = Math.max(1, width || 150)
  const H = height
  const nums = values.filter((v): v is number => typeof v === 'number')
  const mx = Math.max(1e-9, ...nums.map(Math.abs))
  const hasNeg = nums.some(v => v < 0)
  const y0 = hasNeg ? H / 2 : H - 2
  const scale = hasNeg ? (H / 2 - 2) / mx : (H - 4) / mx
  const bw = W / Math.max(1, values.length)
  const fill = (v: number) => (color ? `${TONE[color]} ${s.noStroke}` : v >= 0 ? s.barPos : s.barNeg)
  const svg = (
    <svg
      viewBox={`0 0 ${W} ${H}`} width={width ? W : '100%'} height={H} preserveAspectRatio="none"
      className={s.svgFixed} role="img" aria-label={ariaLabel}
      {...(tip ? { 'data-tip': tipAttr(tip), tabIndex: 0 } : {})}
    >
      {highlightLast ? <rect x={(values.length - highlightLast) * bw} y={0} width={highlightLast * bw} height={H} className={s.miniShade} /> : null}
      <line x1={0} x2={W} y1={y0} y2={y0} className={s.zero} style={{ strokeWidth: 1 }} />
      {values.map((v, i) => {
        if (v === null) return <rect key={i} x={i * bw + 1} y={y0 - 0.5} width={Math.max(1, bw - 1.5)} height={1} className={s.miniNull} />
        const h = Math.max(v === 0 ? 0 : 1.2, Math.abs(v) * scale)
        return <path key={i} d={barPath(i * bw + 0.6, Math.max(1, bw - 1.4), y0, v >= 0 ? y0 - h : y0 + h, 1)} className={fill(v)} />
      })}
    </svg>
  )
  return tip ? <ChartTips>{svg}</ChartTips> : svg
}

export interface HorizontalBarItem {
  key: string
  label: ReactNode
  sub?: ReactNode
  value: number
  display?: ReactNode
  note?: ReactNode
  tone?: 'neu' | 'pos' | 'neg' | 'meta' | 'shop' | 'cogs' | 'mut'
}

export function HorizontalBars({ items, max, ariaLabel }: { items: HorizontalBarItem[]; max?: number; ariaLabel: string }) {
  const top = max ?? Math.max(1e-9, ...items.map(i => Math.abs(i.value)))
  return (
    <ul className={s.hbars} aria-label={ariaLabel}>
      {items.map(it => (
        <li key={it.key} className={s.hrow}>
          <div className={s.hlabel}>{it.label}{it.sub && <small>{it.sub}</small>}</div>
          <div className={s.htrack} aria-hidden="true">
            <i className={`${s.hfill} ${it.tone && it.tone !== 'neu' ? s[it.tone] : ''}`} style={{ width: `${Math.min(100, (Math.abs(it.value) / top) * 100)}%` }} />
          </div>
          <div className={s.hvalue}>{it.display ?? formatMoney(it.value)}{it.note && <small>{it.note}</small>}</div>
        </li>
      ))}
    </ul>
  )
}
