'use client'

/**
 * Revenue − ads per day, for the phone, when the bars are NOT profit: the
 * stores the verdict judges have no cost settings (Glooty alone).
 *
 * components/charts DailyProfitBars calls every bar "lucro", colours it green
 * and its legend reads "lucro / prejuízo"; for a store whose product costs are
 * unknown that presents revenue − ads as profit, which the brief forbids. This
 * is the phone-sized twin of the desktop's components/dashboard NetSalesBars
 * (whose 1000-wide viewBox prints unreadable 4 px text at 340): steel blue
 * above zero (sold more than the ads cost — NOT profit, the products are still
 * unpaid), coral below (ads above sales is a loss whatever the costs are),
 * the running day hatched. Same axis and label rules as the shared charts
 * (components/charts axis/scale helpers).
 */

import { useId } from 'react'
import { ChartTips, barPath, clampLabel, dailyAxis, linear, niceTicks, textWidth, tipAttr, type ChartTip } from '@/components/charts'
import { formatCount, formatMoney, formatMoneyAxis, formatWeekdayDate } from '@/lib/format'
import s from '../m.module.css'

export interface NetDay {
  date: string
  /** Revenue − Meta − Shopify ads. */
  value: number
  revenue: number
  metaSpend: number
  shopSpend: number
  orders: number
}

export function NetBars({ days, partialDate, partialNote, today, width = 340, height = 210, ariaLabel }: {
  days: NetDay[]
  partialDate?: string
  partialNote?: string
  today?: string
  width?: number
  height?: number
  ariaLabel: string
}) {
  const uid = useId().replace(/[^a-zA-Z0-9_-]/g, '')
  const hatch = `net-${uid}-hatch`
  const W = width
  const H = height
  const values = days.map(d => d.value)
  const lo = Math.min(0, ...values)
  const hi = Math.max(0, ...values)
  const pad = (hi - lo) * 0.12
  const ticks = niceTicks(lo < 0 ? lo - pad : 0, hi > 0 ? hi + pad : 0, 5)
  const tickText = (t: number) => (t === 0 ? '$0' : formatMoneyAxis(t))
  const m = { l: Math.max(44, Math.ceil(Math.max(...ticks.map(t => textWidth(tickText(t), 11))) + 14)), r: 8, t: 14, b: 36 }
  const iw = W - m.l - m.r
  const ih = H - m.t - m.b
  const band = iw / Math.max(1, days.length)
  const bw = Math.min(18, band * 0.62)
  const y = linear([ticks[0], ticks[ticks.length - 1]], [m.t + ih, m.t])
  const y0 = y(0)
  const x = (i: number) => m.l + i * band
  const right = W - m.r
  const partialIdx = partialDate ? days.findIndex(d => d.date === partialDate) : -1
  const axis = dailyAxis(days.map(d => d.date), { x0: m.l, band, right, partialIdx })
  const dayLabel = new Map(axis.days.map(l => [l.i, l]))
  const monthLabel = new Map(axis.months.map(l => [l.i, l]))

  // The worst complete day gets its value printed: below zero is the one
  // number on this chart that is certain (a loss whatever the costs).
  const complete = days.map((d, i) => ({ d, i })).filter(({ d }) => d.date !== partialDate)
  const worst = complete.length ? complete.reduce((a, b) => (b.d.value < a.d.value ? b : a)) : null
  const worstLabel = worst && worst.d.value < 0
    ? (() => {
        const text = formatMoney(worst.d.value)
        const c = clampLabel(x(worst.i) + band / 2, textWidth(text, 11), m.l, right)
        return { text, x: c.x, anchor: c.anchor, y: y(worst.d.value) + 15 }
      })()
    : null

  const tipFor = (d: NetDay): ChartTip => {
    const rows: ChartTip['rows'] = [['vendas − anúncios', formatMoney(d.value), d.value < 0 ? 'neg' : null]]
    rows.push(['vendas', formatMoney(d.revenue)])
    rows.push(['Anúncios Meta', formatMoney(d.metaSpend)])
    if (d.shopSpend) rows.push(['Anúncios Shopify', formatMoney(d.shopSpend)])
    rows.push(['pedidos', formatCount(d.orders)])
    return {
      title: `${formatWeekdayDate(d.date, today)}${d.date === partialDate && partialNote ? ` · ${partialNote}` : ''}`,
      rows,
      note: d.date === partialDate
        ? 'Dia em andamento: o número ainda vai mudar. Sem custos configurados: não é lucro.'
        : 'Sem o custo dos produtos, do frete e das taxas: não é lucro.',
    }
  }

  return (
    <ChartTips>
      <svg viewBox={`0 0 ${W} ${H}`} className={s.netSvg} role="group" aria-label={ariaLabel}>
        <defs>
          <pattern id={hatch} width="5" height="5" patternUnits="userSpaceOnUse" patternTransform="rotate(45)">
            <rect width="5" height="5" className={s.netHatchBg} />
            <line x1="0" y1="0" x2="0" y2="5" className={s.netHatchLine} />
          </pattern>
        </defs>
        {ticks.map(t => (
          <g key={t}>
            <line x1={m.l} x2={right} y1={y(t)} y2={y(t)} className={t === 0 ? s.netZero : s.netGrid} />
            <text x={m.l - 10} y={y(t) + 4} textAnchor="end">{tickText(t)}</text>
          </g>
        ))}
        {axis.boundaries.map(i => (
          <line key={`m${i}`} x1={x(i)} x2={x(i)} y1={H - m.b + 21} y2={H - m.b + 34} className={s.netMonthSep} aria-hidden="true" />
        ))}
        {days.map((d, i) => {
          const partial = i === partialIdx
          const bx = x(i) + (band - bw) / 2
          const cls = partial ? s.netBarPartial : d.value >= 0 ? s.netBarPos : s.netBarNeg
          const dl = dayLabel.get(i)
          const ml = monthLabel.get(i)
          return (
            <g key={d.date} className={s.netCol} data-tip={tipAttr(tipFor(d))} tabIndex={0} role="img"
              aria-label={`${formatWeekdayDate(d.date, today)}: vendas − anúncios ${formatMoney(d.value)}${partial ? ' (parcial)' : ''}`}>
              <rect className={s.netHit} x={x(i)} y={m.t - 4} width={band} height={ih + 24} />
              <path className={`${s.netBar} ${cls}`} d={barPath(bx, bw, y0, y(d.value), 4)} fill={partial ? `url(#${hatch})` : undefined} />
              {dl && <text x={dl.x} y={H - m.b + 16} textAnchor={dl.anchor} className={partial ? s.netTx2 : undefined}>{dl.text}</text>}
              {ml && <text x={ml.x} y={H - m.b + 31} textAnchor={ml.anchor} className={s.netSans} fontSize={10.5}>{ml.text}</text>}
            </g>
          )
        })}
        {worstLabel && (
          <text x={worstLabel.x} y={worstLabel.y} textAnchor={worstLabel.anchor} className={s.netStrong}>{worstLabel.text}</text>
        )}
      </svg>
    </ChartTips>
  )
}

/** The legend under NetBars: words that match what the bars are. */
export function NetBarsLegend({ partial }: { partial: boolean }) {
  return (
    <div className={s.netLegend}>
      <span><i className={s.netLgPos} />vendeu mais do que gastou em anúncios</span>
      <span><i className={s.netLgNeg} />gastou mais do que vendeu</span>
      {partial && <span><i className={s.netLgPartial} />hoje, parcial</span>}
    </div>
  )
}
