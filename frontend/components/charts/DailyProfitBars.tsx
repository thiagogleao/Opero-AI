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
 *                 shopSpend?; orders? }, oldest first. `profit` is the WHOLE day's
 *                 profit, in the partner split view too (pass `share` for the split).
 *   share?        the partner split (ctx.splitFactor; default 1 = no split). The bars,
 *                 the axis, the value labels, the band total and the aria labels use
 *                 profit × share; the tooltip shows "sua parte (50%)" next to the whole
 *                 day's profit, and its margin is always the whole day's. The split
 *                 halves money, never ratios: callers that passed a halved profit got
 *                 "margem 9,5%" for a 19,1% day.
 *   selected?     DateRange — the chosen window, drawn as a shaded band with its label
 *                 and sum ("10–16 nov · $1.313").
 *   selectedLabel? string — overrides that band label.
 *   partialDate?  the day still running: drawn hatched with a dashed outline.
 *   partialNote?  shown in that day's tooltip ("parcial · até 13h38").
 *   today?        anchor today, for year-aware labels.
 *   height?       viewBox height (default 260).
 *   width?        viewBox width (default 1000; ~340 in a phone column). The SVG is fluid.
 *   annotate?     label the best and the worst day (default true).
 *   labels?       DailyProfitLabels — the tooltip's and the aria labels' words for
 *                 profit, the whole day's profit (split view), revenue and orders
 *                 (defaults "lucro", "lucro do dia", "receita", "pedidos"). A chart
 *                 of something else names it honestly: the creative page plots an
 *                 estimate over Meta-attributed sales and Meta's credited purchases
 *                 ("lucro estimado", "vendas atribuídas", "compras (Meta)").
 *   ariaLabel     what the chart shows, in words.
 * Coral = loss, green = profit; the x axis says the day and the month in pt-BR.
 * Keyboard: the chart is one tab stop — Tab lands on the first day of the
 * window (else the latest day), ←/→ move day by day with the tooltip, Home/End
 * jump to the ends, the next Tab leaves the chart (ChartTips, ./roving).
 * Labels never overlap at any length (7 days to two years, 1000 or 340 wide):
 * day numbers thin out to calendar-regular days (1, 8, 15, 22, 29…) and give
 * way to the month row alone on long ranges; every month start gets a tick and
 * month names thin to a calendar step (every month, every 2nd, every quarter…);
 * "hoje" and the value labels stay inside the plot (./axis dailyAxis, clampLabel).
 */

import { useId } from 'react'
import type { DateRange } from '@/lib/engine/dates'
import { formatCount, formatMoney, formatMoneyAxis, formatPct, formatRangeLabel, formatWeekdayDate } from '@/lib/format'
import { boxesOverlap, clampLabel, dailyAxis, textWidth, valueBox, type ValueBox } from './axis'
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

/** The words the tooltip and the aria labels use; each one falls back to the
 *  store-profit wording. */
export interface DailyProfitLabels {
  profit?: string
  wholeProfit?: string
  revenue?: string
  orders?: string
}

export interface DailyProfitBarsProps {
  days: DailyPoint[]
  share?: number
  selected?: DateRange | null
  selectedLabel?: string
  partialDate?: string | null
  partialNote?: string
  today?: string
  height?: number
  width?: number
  annotate?: boolean
  labels?: DailyProfitLabels
  ariaLabel: string
}

export function DailyProfitBars({
  days: whole, share = 1, selected, selectedLabel, partialDate, partialNote, today, height = 260, width = 1000, annotate = true, labels, ariaLabel,
}: DailyProfitBarsProps) {
  const uid = useId()
  const hatch = svgId(uid, 'hatch')
  const W = width
  const H = height
  const split = share !== 1
  const shareLabel = `sua parte (${formatPct(share * 100, { digits: 0 })})`
  const profitWord = labels?.profit ?? 'lucro'
  const wholeProfitWord = labels?.wholeProfit ?? 'lucro do dia'
  const revenueWord = labels?.revenue ?? 'receita'
  const ordersWord = labels?.orders ?? 'pedidos'
  // What is drawn is the viewer's share of each day; the whole day (whole[i])
  // stays at hand for the tooltip, whose margin is never halved.
  const days = split ? whole.map(d => ({ ...d, profit: d.profit * share })) : whole

  const values = days.map(d => d.profit)
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  // Headroom past the extreme bars: the best/worst/partial values are printed
  // just beyond them, and must not run into the day labels or the band label.
  const pad = (hi - lo) * 0.12
  const ticks = niceTicks(lo < 0 ? lo - pad : 0, hi > 0 ? hi + pad : 0, 5)
  // One format for the whole axis: cents on every tick when the step is
  // under a dollar (small ads), whole dollars otherwise.
  const tickText = (t: number) => formatMoneyAxis(t, ticks)
  // The left margin fits the widest tick ("−$1.000" spilled out of a 340-wide
  // phone chart with a fixed 44).
  const m = {
    l: Math.max(W < 600 ? 44 : 56, Math.ceil(Math.max(...ticks.map(t => textWidth(tickText(t), 11))) + 14)),
    r: 8, t: selected ? 30 : 14, b: 36,
  }
  const iw = W - m.l - m.r
  const ih = H - m.t - m.b
  const n = Math.max(1, days.length)
  const band = iw / n
  const bw = Math.min(18, band * 0.62)
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
  const partialIdx = partialDate ? days.findIndex(d => d.date === partialDate) : -1
  // The chart is one tab stop (ChartTips roving: ←/→ between days). Tab lands
  // on the first day of the chosen window, else on the most recent day.
  const tabStop = selIdx.length ? selIdx[0] : days.length - 1
  const right = W - m.r

  // x axis: labels thinned by the room each day has (lib: ./axis), one month
  // name per month change, a tick where a month starts, "hoje" kept inside.
  const axis = dailyAxis(days.map(d => d.date), { x0: m.l, band, right, partialIdx })
  const dayLabel = new Map(axis.days.map(l => [l.i, l]))
  const monthLabel = new Map(axis.months.map(l => [l.i, l]))

  // Value labels (today first, then the best and the worst day): centred on
  // their bar, moved inside the plot at the edges, dropped when they would sit
  // on a label already drawn.
  const valueLabels = new Map<number, { text: string; x: number; y: number; anchor: 'start' | 'middle' | 'end'; cls: string }>()
  {
    const kept: ValueBox[] = []
    const put = (i: number, v: number, baseline: number, cls: string, prefix = '') => {
      const text = `${prefix}${formatMoney(v)}`
      const c = clampLabel(x(i) + band / 2, textWidth(text, 11), m.l, right)
      const box = valueBox(c, baseline)
      if (kept.some(k => boxesOverlap(k, box))) return
      kept.push(box)
      valueLabels.set(i, { text, x: c.x, y: baseline, anchor: c.anchor, cls })
    }
    if (partialIdx >= 0) {
      // Today sits at the right edge, so its label is pulled left over the
      // bars before it: lift it above every bar it spans, not just its own.
      // Once it is no longer centred on its own bar it says whose it is.
      const p = days[partialIdx].profit
      const plain = clampLabel(x(partialIdx) + band / 2, textWidth(formatMoney(p), 11), m.l, right)
      const prefix = plain.anchor === 'middle' ? '' : 'hoje '
      const c = clampLabel(x(partialIdx) + band / 2, textWidth(`${prefix}${formatMoney(p)}`, 11), m.l, right)
      const i0 = Math.max(0, Math.floor((c.from - m.l) / band))
      const i1 = Math.min(days.length - 1, Math.floor((c.to - m.l) / band))
      let top = Math.min(y(p), y0)
      for (let i = i0; i <= i1; i++) top = Math.min(top, y(days[i].profit), y0)
      put(partialIdx, p, Math.max(m.t + 10, top - 7), s.txInfo, prefix)
    }
    if (best && best.d.profit > 0) put(best.i, best.d.profit, y(best.d.profit) - 7, s.strong)
    if (worst && worst.d.profit < 0) put(worst.i, worst.d.profit, y(worst.d.profit) + 15, s.strong)
  }

  // The band label starts inside the band and is pulled left when it would
  // run past the plot (a band at the right edge: "hoje", "ontem").
  const bandText = selected ? (selectedLabel ?? `${formatRangeLabel(selected, today)} · `) : ''
  const bandW = textWidth(bandText, 11.5, 'sans') + (selectedLabel ? 0 : textWidth(formatMoney(selSum), 11.5))
  const bandX = selIdx.length ? Math.max(m.l, Math.min(x(selIdx[0]) + 8, right - bandW)) : 0

  const tipFor = (d: DailyPoint, i: number): ChartTip => {
    const w = whole[i]
    const rows: ChartTip['rows'] = split
      ? [[shareLabel, formatMoney(d.profit), d.profit < 0 ? 'neg' : 'pos'], [wholeProfitWord, formatMoney(w.profit)]]
      : [[profitWord, formatMoney(d.profit), d.profit < 0 ? 'neg' : 'pos']]
    if (d.revenue !== undefined) rows.push([revenueWord, formatMoney(d.revenue)])
    if (d.metaSpend !== undefined) rows.push(['Anúncios Meta', formatMoney(d.metaSpend)])
    if (d.shopSpend) rows.push(['Anúncios Shopify', formatMoney(d.shopSpend)])
    if (d.orders !== undefined) rows.push([ordersWord, formatCount(d.orders)])
    if (d.revenue) rows.push(['margem', formatPct((w.profit / d.revenue) * 100)])
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
            <text x={bandX} y={m.t - 9} className={`${s.sans} ${s.tx2}`} fontSize={11.5}>
              {bandText}
              {!selectedLabel && <tspan className={`${s.mono} ${selSum < 0 ? s.txNeg : s.txPos}`} fontWeight={500}>{formatMoney(selSum)}</tspan>}
            </text>
          </g>
        )}

        {ticks.map(t => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className={t === 0 ? s.zero : s.grid} />
            <text x={m.l - 10} y={y(t) + 4} textAnchor="end">{tickText(t)}</text>
          </g>
        ))}

        {axis.boundaries.map(i => (
          <line key={`m${i}`} x1={x(i)} x2={x(i)} y1={H - m.b + 21} y2={H - m.b + 34} className={s.monthSep} aria-hidden="true" />
        ))}

        {days.map((d, i) => {
          const partial = d.date === partialDate
          // A running day with a tiny result was a sliver a couple of units
          // tall whose dashed outline broke into loose dashes on the zero line,
          // read as a clipped label ("ho…"): give it a minimum height and a
          // solid outline. The tooltip and the value label carry the number.
          const tiny = partial && Math.abs(y(d.profit) - y0) < 8
          const yv = tiny ? y0 + (d.profit < 0 ? 1 : -1) * Math.max(4, Math.abs(y(d.profit) - y0)) : y(d.profit)
          const bx = x(i) + (band - bw) / 2
          const cls = partial ? `${s.barPartial}${tiny ? ` ${s.barPartialSolid}` : ''}` : d.profit >= 0 ? s.barPos : s.barNeg
          const dl = dayLabel.get(i)
          const ml = monthLabel.get(i)
          const vl = valueLabels.get(i)
          return (
            <g key={d.date} className={s.col} data-tip={tipAttr(tipFor(d, i))} tabIndex={i === tabStop ? 0 : -1} role="img"
               aria-label={`${formatWeekdayDate(d.date, today)}: ${split ? `${shareLabel} ${formatMoney(d.profit)}, ${wholeProfitWord} ${formatMoney(whole[i].profit)}` : `${profitWord} ${formatMoney(d.profit)}`}${partial ? ' (parcial)' : ''}`}>
              <rect className={s.hit} x={x(i)} y={m.t - (selected ? 24 : 4)} width={band} height={ih + (selected ? 24 : 4) + 20} />
              <path className={`${s.bar} ${cls}`} d={barPath(bx, bw, y0, yv, 4)} fill={partial ? `url(#${hatch})` : undefined} />
              {dl && (
                <text x={dl.x} y={H - m.b + 16} textAnchor={dl.anchor} className={inSel(d.date) || partial ? s.tx2 : undefined}>{dl.text}</text>
              )}
              {ml && (
                <text x={ml.x} y={H - m.b + 31} textAnchor={ml.anchor} className={s.sans} fontSize={10.5}>{ml.text}</text>
              )}
              {vl && <text x={vl.x} y={vl.y} textAnchor={vl.anchor} className={`${vl.cls} ${s.halo}`}>{vl.text}</text>}
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
