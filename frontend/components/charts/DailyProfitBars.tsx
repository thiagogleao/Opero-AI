/**
 * DailyProfitBars — profit per day as bars around a zero line (server SVG +
 * tiny client tooltip layer).
 *
 *   <DailyProfitBars
 *     days={pnl.daily.map(d => ({ date: d.date, profit: d.operatingProfit, revenue: d.revenue,
 *                                 metaSpend: d.metaSpend, shopSpend: d.shopSpend, orders: d.orders }))}
 *     selected={{ from: '2026-11-10', to: '2026-11-16' }}
 *     partialDate="2026-11-17" partialNote="parcial · até 13h38"
 *     ariaLabel="Lucro real por dia da MOKOO, últimos 30 dias e hoje parcial" />
 *
 * Props:
 *   days          DailyPoint[] — { date: 'YYYY-MM-DD'; profit: number; revenue?; metaSpend?;
 *                 shopSpend?; orders? }, oldest first. Pass already-halved profit in the
 *                 partner split view.
 *   selected?     DateRange — the chosen window, drawn as a shaded band with its label
 *                 and sum ("10–16 nov · $1.313").
 *   selectedLabel? string — overrides that band label.
 *   partialDate?  the day still running: drawn hatched with a dashed outline.
 *   partialNote?  shown in that day's tooltip ("parcial · até 13h38").
 *   today?        anchor today, for year-aware labels.
 *   height?       viewBox height (default 260).
 *   width?        viewBox width (default 1000; ~340 in a phone column). The SVG is fluid.
 *   annotate?     label the best and the worst day (default true).
 *   ariaLabel     what the chart shows, in words.
 * Coral = loss, green = profit; the x axis says the day and the month in pt-BR.
 */

import { useId } from 'react'
import type { DateRange } from '@/lib/engine/dates'
import { formatCount, formatMoney, formatMoneyAxis, formatPct, formatRangeLabel, formatWeekdayDate, monthShort } from '@/lib/format'
import { ChartTips } from './ChartTips'
import { barPath, linear, niceTicks, svgId, tipAttr, type ChartTip } from './scale'
import s from './charts.module.css'

export interface DailyPoint {
  date: string
  profit: number
  revenue?: number
  metaSpend?: number
  shopSpend?: number
  orders?: number
}

export interface DailyProfitBarsProps {
  days: DailyPoint[]
  selected?: DateRange | null
  selectedLabel?: string
  partialDate?: string | null
  partialNote?: string
  today?: string
  height?: number
  width?: number
  annotate?: boolean
  ariaLabel: string
}

export function DailyProfitBars({
  days, selected, selectedLabel, partialDate, partialNote, today, height = 260, width = 1000, annotate = true, ariaLabel,
}: DailyProfitBarsProps) {
  const uid = useId()
  const hatch = svgId(uid, 'hatch')
  const W = width
  const H = height
  const m = { l: W < 600 ? 44 : 56, r: 8, t: selected ? 30 : 14, b: 36 }
  const iw = W - m.l - m.r
  const ih = H - m.t - m.b
  const n = Math.max(1, days.length)
  const band = iw / n
  const bw = Math.min(18, band * 0.62)

  const values = days.map(d => d.profit)
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  // Headroom past the extreme bars: the best/worst/partial values are printed
  // just beyond them, and must not run into the day labels or the band label.
  const pad = (hi - lo) * 0.12
  const ticks = niceTicks(lo < 0 ? lo - pad : 0, hi > 0 ? hi + pad : 0, 5)
  const y = linear([ticks[0], ticks[ticks.length - 1]], [m.t + ih, m.t])
  const y0 = y(0)
  const x = (i: number) => m.l + i * band

  const inSel = (d: string) => !!selected && d >= selected.from && d <= selected.to
  const selIdx = days.map((d, i) => (inSel(d.date) ? i : -1)).filter(i => i >= 0)
  const selSum = days.filter(d => inSel(d.date)).reduce((a, d) => a + d.profit, 0)

  // Best and worst complete days get their value printed.
  const complete = days.map((d, i) => ({ d, i })).filter(({ d }) => d.date !== partialDate)
  const best = annotate && complete.length ? complete.reduce((a, b) => (b.d.profit > a.d.profit ? b : a)) : null
  const worst = annotate && complete.length ? complete.reduce((a, b) => (b.d.profit < a.d.profit ? b : a)) : null
  // A day number needs ~18 units of room; thin out the labels when bars are narrower.
  const labelEvery = Math.max(1, Math.ceil(18 / band))
  const partialIdx = partialDate ? days.findIndex(d => d.date === partialDate) : -1

  const tipFor = (d: DailyPoint): ChartTip => {
    const rows: ChartTip['rows'] = [['lucro', formatMoney(d.profit), d.profit < 0 ? 'neg' : 'pos']]
    if (d.revenue !== undefined) rows.push(['receita', formatMoney(d.revenue)])
    if (d.metaSpend !== undefined) rows.push(['Anúncios Meta', formatMoney(d.metaSpend)])
    if (d.shopSpend) rows.push(['Anúncios Shopify', formatMoney(d.shopSpend)])
    if (d.orders !== undefined) rows.push(['pedidos', formatCount(d.orders)])
    if (d.revenue) rows.push(['margem', formatPct((d.profit / d.revenue) * 100)])
    return {
      title: `${formatWeekdayDate(d.date, today)}${d.date === partialDate && partialNote ? ` · ${partialNote}` : ''}`,
      rows,
      note: d.date === partialDate ? 'Dia em andamento: o número ainda vai mudar.' : undefined,
    }
  }

  return (
    <ChartTips>
      <svg viewBox={`0 0 ${W} ${H}`} className={s.svg} role="group" aria-label={ariaLabel}>
        <defs>
          <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" className={s.hatchBg} />
            <line x1="0" y1="0" x2="0" y2="5" className={s.hatchLine} />
          </pattern>
        </defs>

        {selIdx.length > 0 && (
          <g>
            <rect
              x={x(selIdx[0]) + 1} y={m.t - 24} rx={6}
              width={(selIdx[selIdx.length - 1] - selIdx[0] + 1) * band - 2} height={ih + 24}
              className={s.band}
            />
            <text x={x(selIdx[0]) + 8} y={m.t - 9} className={`${s.sans} ${s.tx2}`} fontSize={11.5}>
              {selectedLabel ?? `${formatRangeLabel(selected!, today)} · `}
              {!selectedLabel && <tspan className={`${s.mono} ${selSum < 0 ? s.txNeg : s.txPos}`} fontWeight={500}>{formatMoney(selSum)}</tspan>}
            </text>
          </g>
        )}

        {ticks.map(t => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className={t === 0 ? s.zero : s.grid} />
            <text x={m.l - 10} y={y(t) + 4} textAnchor="end">{t === 0 ? '$0' : formatMoneyAxis(t)}</text>
          </g>
        ))}

        {days.map((d, i) => {
          const partial = d.date === partialDate
          const yv = y(d.profit)
          const bx = x(i) + (band - bw) / 2
          const cls = partial ? s.barPartial : d.profit >= 0 ? s.barPos : s.barNeg
          const day = Number(d.date.slice(8, 10))
          const first = i === 0 || day === 1
          // "hoje" keeps its label; a day label right before it would collide.
          const showDay = partial || ((i % labelEvery === 0 || first) && (partialIdx < 0 || i > partialIdx || partialIdx - i >= labelEvery))
          return (
            <g key={d.date} className={s.col} data-tip={tipAttr(tipFor(d))} tabIndex={0} role="img"
               aria-label={`${formatWeekdayDate(d.date, today)}: lucro ${formatMoney(d.profit)}${partial ? ' (parcial)' : ''}`}>
              <rect className={s.hit} x={x(i)} y={m.t - (selected ? 24 : 4)} width={band} height={ih + (selected ? 24 : 4) + 20} />
              <path className={`${s.bar} ${cls}`} d={barPath(bx, bw, y0, yv, 4)} fill={partial ? `url(#${hatch})` : undefined} />
              {showDay && (
                <text x={x(i) + band / 2} y={H - m.b + 16} textAnchor="middle" className={inSel(d.date) || partial ? s.tx2 : undefined}>
                  {partial ? 'hoje' : day}
                </text>
              )}
              {first && (
                <text x={x(i) + band / 2} y={H - m.b + 31} textAnchor="middle" className={s.sans} fontSize={10.5}>{monthShort(d.date)}</text>
              )}
              {partial && (
                <text x={x(i) + band / 2} y={Math.min(yv, y0) - 7} textAnchor="middle" className={s.txInfo}>{formatMoney(d.profit)}</text>
              )}
              {!partial && best && best.i === i && d.profit > 0 && (
                <text x={x(i) + band / 2} y={yv - 7} textAnchor="middle" className={s.strong}>{formatMoney(d.profit)}</text>
              )}
              {!partial && worst && worst.i === i && d.profit < 0 && (
                <text x={x(i) + band / 2} y={yv + 15} textAnchor="middle" className={s.strong}>{formatMoney(d.profit)}</text>
              )}
            </g>
          )
        })}
      </svg>
    </ChartTips>
  )
}

/** The legend that goes with DailyProfitBars (put it in the Block's actions). */
export function DailyProfitLegend({ partial = true, selected = true }: { partial?: boolean; selected?: boolean }) {
  return (
    <div className={s.legend}>
      <span><i className={s.lgPos} />lucro</span>
      <span><i className={s.lgNeg} />prejuízo</span>
      {partial && <span><i className={s.lgPartial} />hoje, parcial</span>}
      {selected && <span><i className={s.lgBand} />período escolhido</span>}
    </div>
  )
}
