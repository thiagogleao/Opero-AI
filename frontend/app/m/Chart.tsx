'use client'

import { useCallback, useEffect, useRef, useState } from 'react'

export interface Series {
  key: string
  label: string
  color: string
  /** Draw a 10% wash under the line. Reserved for the magnitude series. */
  area?: boolean
  values: (number | null)[]
}

interface Props {
  labels: string[]              // one per x position (ISO date)
  series: Series[]
  height?: number
  /** Formats a value for the axis and the tap readout. */
  format: (v: number) => string
  /** Draw a zero baseline — for measures that can go negative. */
  zeroLine?: boolean
}

/**
 * Measures the element so the SVG can be drawn at true pixel size. Scaling a
 * viewBox instead would stretch strokes and dots along one axis.
 */
function useWidth<T extends HTMLElement>() {
  const ref = useRef<T>(null)
  const [w, setW] = useState(0)
  useEffect(() => {
    const el = ref.current
    if (!el) return
    const ro = new ResizeObserver(([e]) => setW(e.contentRect.width))
    ro.observe(el)
    setW(el.getBoundingClientRect().width)
    return () => ro.disconnect()
  }, [])
  return [ref, w] as const
}

/** Round a span up to a readable axis step (1/2/5 × 10^n). */
function niceStep(range: number, targetTicks = 3): number {
  if (range <= 0) return 1
  const raw = range / targetTicks
  const mag = Math.pow(10, Math.floor(Math.log10(raw)))
  const norm = raw / mag
  const step = norm >= 5 ? 10 : norm >= 2 ? 5 : norm >= 1 ? 2 : 1
  return step * mag
}

const PAD = { top: 10, right: 8, bottom: 16, left: 44 }

export default function Chart({ labels, series, height = 132, format, zeroLine }: Props) {
  const [ref, width] = useWidth<HTMLDivElement>()
  const [active, setActive] = useState<number | null>(null)

  const n = labels.length
  const plotW = Math.max(0, width - PAD.left - PAD.right)
  const plotH = height - PAD.top - PAD.bottom

  const all = series.flatMap(s => s.values).filter((v): v is number => v != null)
  const rawMin = all.length ? Math.min(...all) : 0
  const rawMax = all.length ? Math.max(...all) : 1
  const lo = Math.min(rawMin, zeroLine ? 0 : rawMin)
  const hi = Math.max(rawMax, 0)
  const step = niceStep(hi - lo || Math.abs(hi) || 1)
  const yMin = Math.floor(lo / step) * step
  const yMax = Math.ceil(hi / step) * step || step
  const span = yMax - yMin || 1

  const x = (i: number) => PAD.left + (n <= 1 ? plotW / 2 : (i / (n - 1)) * plotW)
  const y = (v: number) => PAD.top + plotH - ((v - yMin) / span) * plotH

  const ticks: number[] = []
  for (let t = yMin; t <= yMax + 1e-9; t += step) ticks.push(Math.round(t * 1e6) / 1e6)

  const path = (values: (number | null)[]) => {
    let d = '', pen = false
    values.forEach((v, i) => {
      if (v == null) { pen = false; return }
      d += `${pen ? 'L' : 'M'}${x(i).toFixed(2)},${y(v).toFixed(2)}`
      pen = true
    })
    return d
  }

  const areaPath = (values: (number | null)[]) => {
    const pts = values.map((v, i) => ({ v, i })).filter(p => p.v != null) as { v: number; i: number }[]
    if (pts.length < 2) return ''
    const base = y(Math.max(yMin, 0))
    return `M${x(pts[0].i)},${base}` +
      pts.map(p => `L${x(p.i).toFixed(2)},${y(p.v).toFixed(2)}`).join('') +
      `L${x(pts[pts.length - 1].i)},${base}Z`
  }

  const pick = useCallback((clientX: number) => {
    const el = ref.current
    if (!el || n === 0) return
    const rect = el.getBoundingClientRect()
    const rel = clientX - rect.left - PAD.left
    const i = n <= 1 ? 0 : Math.round((rel / Math.max(plotW, 1)) * (n - 1))
    setActive(Math.max(0, Math.min(n - 1, i)))
  }, [ref, n, plotW])

  const readout = active != null ? active : n - 1
  const showReadout = active != null && n > 0

  return (
    <div>
      {/* Tap readout replaces hover, which does not exist on touch. */}
      <div style={{
        display: 'flex', alignItems: 'baseline', gap: 10, minHeight: 18,
        marginBottom: 4, flexWrap: 'wrap',
      }}>
        {showReadout && (
          <>
            <span style={{ fontSize: 11, color: 'var(--ink-3)', fontVariantNumeric: 'tabular-nums' }}>
              {labels[readout]?.slice(5).split('-').reverse().join('/')}
            </span>
            {series.map(s => (
              <span key={s.key} style={{ fontSize: 11, color: 'var(--ink-2)', display: 'flex', alignItems: 'center', gap: 4 }}>
                <i style={{ width: 7, height: 7, borderRadius: 2, background: s.color, display: 'inline-block' }} />
                {s.values[readout] != null ? format(s.values[readout]!) : '—'}
              </span>
            ))}
          </>
        )}
      </div>

      <div
        ref={ref}
        style={{ width: '100%', touchAction: 'pan-y' }}
        onPointerDown={e => pick(e.clientX)}
        onPointerMove={e => { if (e.buttons || e.pointerType === 'touch') pick(e.clientX) }}
        onPointerLeave={() => setActive(null)}
      >
        {width > 0 && (
          <svg width={width} height={height} style={{ display: 'block', overflow: 'visible' }}>
            {ticks.map(t => (
              <g key={t}>
                <line
                  x1={PAD.left} x2={width - PAD.right} y1={y(t)} y2={y(t)}
                  stroke={t === 0 && zeroLine ? 'rgba(255,255,255,0.22)' : 'rgba(255,255,255,0.06)'}
                  strokeWidth={1}
                />
                <text
                  x={PAD.left - 6} y={y(t) + 3} textAnchor="end"
                  fontSize={9.5} fill="var(--ink-3)"
                  style={{ fontVariantNumeric: 'tabular-nums' }}
                >{format(t)}</text>
              </g>
            ))}

            {series.filter(s => s.area).map(s => (
              <path key={`a-${s.key}`} d={areaPath(s.values)} fill={s.color} opacity={0.1} />
            ))}

            {series.map(s => (
              <path
                key={s.key} d={path(s.values)} fill="none" stroke={s.color}
                strokeWidth={2} strokeLinecap="round" strokeLinejoin="round"
              />
            ))}

            {showReadout && (
              <>
                <line
                  x1={x(readout)} x2={x(readout)} y1={PAD.top} y2={PAD.top + plotH}
                  stroke="rgba(255,255,255,0.25)" strokeWidth={1}
                />
                {series.map(s => s.values[readout] != null && (
                  // 2px surface ring keeps the dot legible where lines cross.
                  <circle
                    key={`d-${s.key}`} cx={x(readout)} cy={y(s.values[readout]!)} r={4}
                    fill={s.color} stroke="var(--surface)" strokeWidth={2}
                  />
                ))}
              </>
            )}
          </svg>
        )}
      </div>

      {/* Two or more series always carry a legend — identity never rests on hue alone. */}
      {series.length > 1 && (
        <div style={{ display: 'flex', gap: 14, marginTop: 6 }}>
          {series.map(s => (
            <span key={s.key} style={{ display: 'flex', alignItems: 'center', gap: 5, fontSize: 11, color: 'var(--ink-3)' }}>
              <i style={{ width: 9, height: 2.5, borderRadius: 2, background: s.color, display: 'inline-block' }} />
              {s.label}
            </span>
          ))}
        </div>
      )}
    </div>
  )
}
