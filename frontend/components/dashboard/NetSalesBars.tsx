/**
 * NetSalesBars — revenue − ads per day, for a store WITHOUT cost settings.
 *
 * DailyProfitBars labels every bar "lucro" and colours it green; for a store
 * whose product costs are unknown that would call revenue − ads profit. This
 * chart draws the same days in neutral steel blue (above zero is NOT profit:
 * the products still have to be paid) and coral below zero (spending more on
 * ads than the store sold is a loss whatever the costs are). Server SVG with
 * the shared tooltip layer.
 *
 * Props: { days: { date; value; revenue; adSpend; orders }[]; share?: number;
 *          selected?: DateRange; selectedLabel?: string (replaces the band label,
 *          as in DailyProfitBars); partialDate?: string|null; partialNote?: string;
 *          today?: string; ariaLabel }
 *
 * `value` is the whole store's revenue − ads; `share` (the partner split,
 * ctx.splitFactor) scales what is drawn: the bars, the axis and the band total.
 * The verdict halves revenue − ads in the split view, so a chart titled "(sua
 * parte)" must too. The tooltip shows both the share and the whole day, next to
 * the whole revenue and ad spend it comes from.
 */

import type { DateRange } from '@/lib/engine/dates'
import { formatCount, formatMoney, formatMoneyAxis, formatPct, formatRangeLabel, formatWeekdayDate, monthShort } from '@/lib/format'
import { ChartTips, barPath, linear, niceTicks, tipAttr } from '@/components/charts'
import s from './dashboard.module.css'

export interface NetDay { date: string; value: number; revenue: number; adSpend: number; orders: number }

export function NetSalesBars({ days, share = 1, selected, selectedLabel, partialDate, partialNote, today, ariaLabel }: {
  days: NetDay[]; share?: number; selected?: DateRange | null; selectedLabel?: string; partialDate?: string | null; partialNote?: string; today?: string; ariaLabel: string
}) {
  const split = share !== 1
  const shown = (d: NetDay) => d.value * share
  const shareLabel = `sua parte (${formatPct(share * 100, { digits: 0 })})`
  const W = 1000, H = 240
  const m = { l: 56, r: 8, t: selected ? 30 : 14, b: 36 }
  const iw = W - m.l - m.r, ih = H - m.t - m.b
  const band = iw / Math.max(1, days.length)
  const bw = Math.min(18, band * 0.62)
  const values = days.map(shown)
  const lo = Math.min(0, ...values), hi = Math.max(0, ...values)
  const pad = (hi - lo) * 0.1
  const ticks = niceTicks(lo < 0 ? lo - pad : 0, hi > 0 ? hi + pad : 0, 5)
  const y = linear([ticks[0], ticks[ticks.length - 1]], [m.t + ih, m.t])
  const y0 = y(0)
  const x = (i: number) => m.l + i * band
  const inSel = (d: string) => !!selected && d >= selected.from && d <= selected.to
  const sel = days.map((d, i) => (inSel(d.date) ? i : -1)).filter(i => i >= 0)
  const selSum = days.filter(d => inSel(d.date)).reduce((a, d) => a + shown(d), 0)
  const labelEvery = Math.max(1, Math.ceil(18 / band))

  return (
    <ChartTips>
      <svg viewBox={`0 0 ${W} ${H}`} className={s.netSvg} role="group" aria-label={ariaLabel}>
        {sel.length > 0 && (
          <g>
            <rect x={x(sel[0]) + 1} y={m.t - 24} rx={6} width={(sel[sel.length - 1] - sel[0] + 1) * band - 2} height={ih + 24} className={s.netBand} />
            <text x={x(sel[0]) + 8} y={m.t - 9} className={s.netLabel} style={{ fontFamily: 'var(--sans)' }} fontSize={11.5}>
              {selectedLabel ?? <>{formatRangeLabel(selected!, today)} · <tspan style={{ fontFamily: 'var(--mono)' }}>{formatMoney(selSum)}</tspan></>}
            </text>
          </g>
        )}
        {ticks.map(t => (
          <g key={t}>
            <line x1={m.l} x2={W - m.r} y1={y(t)} y2={y(t)} className={t === 0 ? s.netZero : s.netGrid} />
            <text x={m.l - 10} y={y(t) + 4} textAnchor="end">{t === 0 ? '$0' : formatMoneyAxis(t)}</text>
          </g>
        ))}
        {days.map((d, i) => {
          const partial = d.date === partialDate
          const day = Number(d.date.slice(8, 10))
          const first = i === 0 || day === 1
          const v = shown(d)
          const tip = tipAttr({
            title: `${formatWeekdayDate(d.date, today)}${partial && partialNote ? ` · ${partialNote}` : ''}`,
            rows: [
              ...(split ? [[shareLabel, formatMoney(v), v < 0 ? 'neg' : null] as [string, string, 'neg' | null]] : []),
              ['receita − anúncios', formatMoney(d.value), !split && d.value < 0 ? 'neg' : null],
              ['receita', formatMoney(d.revenue)],
              ['anúncios', formatMoney(d.adSpend)],
              ['pedidos', formatCount(d.orders)],
            ],
            note: partial ? 'Dia em andamento: ainda vai mudar.' : 'Não é lucro: falta o custo dos produtos, do frete e as taxas.',
          })
          return (
            <g key={d.date} className={s.netCol} data-tip={tip} tabIndex={0} role="img"
               aria-label={`${formatWeekdayDate(d.date, today)}: receita menos anúncios ${formatMoney(v)}${split ? ` (${shareLabel})` : ''}${partial ? ' (parcial)' : ''}`}>
              <rect className={s.netHit} x={x(i)} y={m.t - 4} width={band} height={ih + 24} />
              <path d={barPath(x(i) + (band - bw) / 2, bw, y0, y(v), 4)} className={partial ? s.netPartial : v < 0 ? s.netNeg : s.netPos} />
              {(partial || i % labelEvery === 0 || first) && (
                <text x={x(i) + band / 2} y={H - m.b + 16} textAnchor="middle">{partial ? 'hoje' : day}</text>
              )}
              {first && <text x={x(i) + band / 2} y={H - m.b + 31} textAnchor="middle" style={{ fontFamily: 'var(--sans)' }} fontSize={10.5}>{monthShort(d.date)}</text>}
            </g>
          )
        })}
      </svg>
    </ChartTips>
  )
}

/** Goes in the Block's actions slot. That slot does not shrink (flex: none),
 *  so it takes the legend's one-line width: 430px here, which made Glooty's
 *  Resumo 444px wide on a 390px phone. `netLegend` caps the legend at the
 *  room a phone leaves, and the two items wrap under each other. */
export function NetSalesLegend() {
  return (
    <div className={`${s.legend} ${s.netLegend}`}>
      <span><i className={s.lgNeu} />vendeu mais do que gastou em anúncios</span>
      <span><i className={s.lgNeg} />gastou mais do que vendeu</span>
    </div>
  )
}
