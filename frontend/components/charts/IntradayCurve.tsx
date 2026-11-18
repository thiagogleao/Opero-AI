/**
 * IntradayCurve — cumulative profit through one day, green above zero and
 * coral below, with the "agora" marker, the rest of the day hatched, an
 * optional reference (yesterday's curve or a level) and orders per hour on the
 * floor. Server SVG + tiny client tooltip layer.
 *
 *   <IntradayCurve
 *     points={pnl.hourly!}                      // engine HourPoint[] or PortfolioIntraday.points
 *     nowMinutes={pnl.partial ? pnl.minutesCovered : null}
 *     reference={{ points: yesterday.hourly!, label: 'ontem até esta hora' }}
 *     ariaLabel="Lucro acumulado de hoje na MOKOO" />
 *
 * Props:
 *   points          { hour: number; cumProfit: number; cumRevenue?: number; orders?: number }[]
 *                   — point h is the running total at the END of hour h (engine semantics).
 *   nowMinutes?     minutes into the day while it runs; null/undefined = a closed day.
 *   nowLabel?       default "agora · 13h38".
 *   reference?      { points: {hour, cumProfit}[]; label: string } — dashed steel-blue curve
 *                   (e.g. yesterday, the whole day or cut at the same time).
 *   referenceValue? { value: number; label: string } — dashed level ("ontem inteiro $1.551").
 *   tzNote?         appended to tooltip titles (" · Tóquio").
 *   height?         viewBox height (default 230).
 *   width?          viewBox width (default 680; use ~340 for a phone column so the
 *                   labels stay at their real size — the SVG is always fluid).
 *   showOrders?     orders-per-hour strip (default true).
 *   ariaLabel       what the chart shows.
 */

import { useId } from 'react'
import { formatClock, formatCount, formatMoney, formatMoneyAxis } from '@/lib/format'
import { ChartTips } from './ChartTips'
import { linear, niceTicks, svgId, tipAttr } from './scale'
import s from './charts.module.css'

export interface IntradayPointIn {
  hour: number
  cumProfit: number
  cumRevenue?: number
  orders?: number
}

export interface IntradayCurveProps {
  points: IntradayPointIn[]
  nowMinutes?: number | null
  nowLabel?: string
  reference?: { points: { hour: number; cumProfit: number }[]; label: string } | null
  referenceValue?: { value: number; label: string } | null
  tzNote?: string
  height?: number
  width?: number
  showOrders?: boolean
  ariaLabel: string
}

const hh = (h: number) => `${String(h).padStart(2, '0')}h`

export function IntradayCurve({
  points, nowMinutes, nowLabel, reference, referenceValue, tzNote = '', height = 230, width = 680, showOrders = true, ariaLabel,
}: IntradayCurveProps) {
  const uid = useId()
  const clipA = svgId(uid, 'a')
  const clipB = svgId(uid, 'b')
  const future = svgId(uid, 'f')
  const W = width
  const H = height
  const floor = showOrders ? 30 : 0
  const m = { l: 52, r: 14, t: 22, b: 22 + floor }
  const iw = W - m.l - m.r
  const ih = H - m.t - m.b
  const running = typeof nowMinutes === 'number'
  const nowH = running ? Math.min(24, Math.max(0, nowMinutes / 60)) : 24

  // x position of each point: the end of its hour, but never past "now".
  const pts = [{ t: 0, p: 0, r: 0, o: 0, h: -1 }, ...points.map(pt => ({
    t: Math.min(pt.hour + 1, running ? nowH : 24), p: pt.cumProfit, r: pt.cumRevenue ?? 0, o: pt.orders ?? 0, h: pt.hour,
  }))]
  const refPts = reference ? [{ t: 0, p: 0 }, ...reference.points.map(pt => ({ t: pt.hour + 1, p: pt.cumProfit }))] : []
  const all = [...pts.map(p => p.p), ...refPts.map(p => p.p), ...(referenceValue ? [referenceValue.value] : [])]
  const ticks = niceTicks(Math.min(0, ...all), Math.max(0, ...all), 4)
  const x = linear([0, 24], [m.l, m.l + iw])
  const y = linear([ticks[0], ticks[ticks.length - 1]], [m.t + ih, m.t])
  const y0 = y(0)

  const line = pts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join('')
  const last = pts[pts.length - 1]
  const area = `${line}L${x(last.t).toFixed(1)},${y0.toFixed(1)}L${x(0).toFixed(1)},${y0.toFixed(1)}Z`
  const refLine = refPts.map((p, i) => `${i ? 'L' : 'M'}${x(p.t).toFixed(1)},${y(p.p).toFixed(1)}`).join('')
  const orders = points.map(p => p.orders ?? 0)
  const omax = Math.max(1, ...orders)
  const fy = m.t + ih + 22
  const hourW = iw / 24

  return (
    <ChartTips>
      <svg viewBox={`0 0 ${W} ${H}`} className={s.svg} role="group" aria-label={ariaLabel}>
        <defs>
          <clipPath id={clipA}><rect x={0} y={0} width={W} height={Math.max(0, y0)} /></clipPath>
          <clipPath id={clipB}><rect x={0} y={y0} width={W} height={Math.max(0, H - y0)} /></clipPath>
          <pattern id={future} width="6" height="6" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <line x1="0" y1="0" x2="0" y2="6" className={s.futureLine} />
          </pattern>
        </defs>

        {running && nowH < 24 && (
          <g>
            <rect x={x(nowH)} y={m.t} width={x(24) - x(nowH)} height={ih} fill={`url(#${future})`} />
            {x(24) - x(nowH) > 70 && (
              <text x={(x(nowH) + x(24)) / 2} y={m.t + ih / 2 + 4} textAnchor="middle" className={s.sans} fontSize={10.5}>resto do dia</text>
            )}
          </g>
        )}

        {ticks.map(t => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className={t === 0 ? s.zero : s.grid} />
            <text x={m.l - 8} y={y(t) + 4} textAnchor="end" fontSize={10.5}>{t === 0 ? '$0' : formatMoneyAxis(t)}</text>
          </g>
        ))}
        {[0, 6, 12, 18, 24].map(h => (
          <text key={h} x={x(h)} y={H - 4} textAnchor={h === 0 ? 'start' : h === 24 ? 'end' : 'middle'} fontSize={10.5}>{h}h</text>
        ))}

        {showOrders && (
          <g>
            <line x1={m.l} x2={W - m.r} y1={fy + 0.5} y2={fy + 0.5} className={s.grid} />
            <text x={m.l - 8} y={fy - 1} textAnchor="end" fontSize={10} className={s.sans}>ped./h</text>
            {points.map(p => {
              const o = p.orders ?? 0
              if (!o) return null
              const bh = Math.max(2, (o / omax) * 14)
              return <rect key={p.hour} x={x(p.hour) + 1.5} y={fy - bh} width={Math.max(1, hourW - 3)} height={bh} rx={1.5} className={s.ordersBar} />
            })}
          </g>
        )}

        {referenceValue && (
          <g>
            <line x1={m.l} x2={W - m.r} y1={y(referenceValue.value)} y2={y(referenceValue.value)} className={s.refLine} />
            <text x={m.l + 4} y={y(referenceValue.value) - 5} fontSize={10} className={s.txNeu}>{referenceValue.label}</text>
          </g>
        )}
        {reference && refPts.length > 1 && (
          <g>
            <path d={refLine} className={s.refLine} />
            <text x={x(refPts[refPts.length - 1].t) - 4} y={y(refPts[refPts.length - 1].p) - 6} textAnchor="end" fontSize={10} className={s.txNeu}>{reference.label}</text>
          </g>
        )}

        <path d={area} className={s.areaPos} clipPath={`url(#${clipA})`} />
        <path d={area} className={s.areaNeg} clipPath={`url(#${clipB})`} />
        <path d={line} className={s.linePos} clipPath={`url(#${clipA})`} />
        <path d={line} className={s.lineNeg} clipPath={`url(#${clipB})`} />

        {running && (
          <g>
            <line x1={x(nowH)} x2={x(nowH)} y1={m.t - 6} y2={m.t + ih} className={s.nowLine} />
            <text x={x(nowH)} y={m.t - 10} textAnchor={nowH < 3 ? 'start' : nowH > 21 ? 'end' : 'middle'} fontSize={10} className={s.txInfo}>
              {nowLabel ?? `agora · ${formatClock(nowMinutes!)}`}
            </text>
          </g>
        )}
        {pts.length > 1 && (
          <g>
            <circle cx={x(last.t)} cy={y(last.p)} r={4.5} className={last.p < 0 ? s.dotNeg : s.dotPos} />
            <text
              x={x(last.t) + (last.t > 20 ? -8 : 8)} y={y(last.p) + 4}
              textAnchor={last.t > 20 ? 'end' : 'start'} fontSize={11.5} className={s.strong}
            >
              {formatMoney(last.p)}
            </text>
          </g>
        )}

        {points.map((p, i) => {
          const t0 = p.hour
          const t1 = Math.min(p.hour + 1, running ? nowH : 24)
          const inProgress = running && i === points.length - 1 && t1 < p.hour + 1
          return (
            <g
              key={p.hour}
              className={s.hourCol}
              tabIndex={0}
              role="img"
              aria-label={`até ${hh(p.hour + 1)}: lucro acumulado ${formatMoney(p.cumProfit)}`}
              data-tip={tipAttr({
                title: `${hh(t0)}–${hh(p.hour + 1)}${inProgress ? ' · em andamento' : ''}${tzNote}`,
                rows: [
                  ['lucro acumulado', formatMoney(p.cumProfit), p.cumProfit < 0 ? 'neg' : 'pos'],
                  ...(p.cumRevenue !== undefined ? [['receita acumulada', formatMoney(p.cumRevenue)] as [string, string]] : []),
                  ...(p.orders !== undefined ? [['pedidos na hora', formatCount(p.orders)] as [string, string]] : []),
                ],
                note: 'Anúncios e custos fixos do dia são espalhados igualmente pelas horas.',
              })}
            >
              <rect className={s.hit} x={x(t0)} y={m.t} width={Math.max(1, x(t1) - x(t0))} height={ih} />
            </g>
          )
        })}
      </svg>
    </ChartTips>
  )
}

/** Legend for IntradayCurve. */
export function IntradayLegend({ reference, now = true }: { reference?: string; now?: boolean }) {
  return (
    <div className={s.legend}>
      <span><i className={s.lgPos} />lucro acumulado</span>
      <span><i className={s.lgNeg} />abaixo de zero</span>
      {reference && <span><i className={s.lgRef} />{reference}</span>}
      {now && <span><i className={s.lgNow} />agora</span>}
    </div>
  )
}
