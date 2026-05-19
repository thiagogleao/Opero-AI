'use client'
import { motion } from 'framer-motion'
import {
  ComposedChart, Bar, Line, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine, Area,
} from 'recharts'
import type { DailyProfitPoint } from '@/lib/profitCalc'

interface Props {
  data: DailyProfitPoint[]
  days: number
}

function fmtMoney(v: number) {
  const n = Number(v)
  if (n >= 1000)  return `$${(n / 1000).toFixed(1)}k`
  if (n <= -1000) return `-$${(Math.abs(n) / 1000).toFixed(1)}k`
  return `$${n.toFixed(0)}`
}

// Handles both "2024-05-13" and "2024-05-13 00:00:00+00"
function fmtAxisDate(v: string) {
  const iso = v.substring(0, 10)
  const [, m, d] = iso.split('-')
  return `${d}/${m}`
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { name: string; value: number; color: string; dataKey: string }[]
  label?: string
}) {
  if (!active || !payload?.length) return null

  const byKey = Object.fromEntries(payload.map(p => [p.dataKey, p]))
  const profit  = byKey['profit']
  const revenue = byKey['revenue']
  const margin  = byKey['margin']

  return (
    <div style={{
      background: '#1A1D23', border: '1px solid #2A2D35',
      borderRadius: 10, padding: '12px 16px', fontSize: 12, minWidth: 160,
      boxShadow: '0 8px 24px rgba(0,0,0,0.5)',
    }}>
      <p style={{ color: '#71717A', marginBottom: 8, fontSize: 11, fontWeight: 600, letterSpacing: '0.05em' }}>
        {fmtAxisDate(label ?? '')}
      </p>
      {revenue && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, marginBottom: 4 }}>
          <span style={{ color: '#71717A' }}>Receita</span>
          <span style={{ color: '#A78BFA', fontWeight: 600 }}>{fmtMoney(revenue.value)}</span>
        </div>
      )}
      {profit && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, marginBottom: 4 }}>
          <span style={{ color: '#71717A' }}>Lucro</span>
          <span style={{ color: profit.value >= 0 ? '#10B981' : '#F43F5E', fontWeight: 700 }}>{fmtMoney(profit.value)}</span>
        </div>
      )}
      {margin && margin.value !== null && (
        <div style={{ display: 'flex', justifyContent: 'space-between', gap: 24, borderTop: '1px solid #2A2D35', paddingTop: 6, marginTop: 4 }}>
          <span style={{ color: '#71717A' }}>Margem</span>
          <span style={{ color: '#F59E0B', fontWeight: 700 }}>{Number(margin.value).toFixed(1)}%</span>
        </div>
      )}
    </div>
  )
}

export default function DailyProfitChart({ data, days }: Props) {
  if (data.length < 2) return null

  // Clamp extreme margin outliers (e.g. $5 revenue + $400 FB spend = -8000%)
  // so the Y axis scale stays meaningful
  const MARGIN_CLAMP = 150
  const chartData = data.map(d => ({
    ...d,
    margin: d.margin === null ? null : Math.max(-MARGIN_CLAMP, Math.min(MARGIN_CLAMP, d.margin)),
  }))

  // Symmetric domains so the $0 and 0% zero lines align visually
  const moneyValues = data.flatMap(d => [d.revenue, d.profit]).filter(isFinite)
  const maxMoneyAbs = Math.max(100, ...moneyValues.map(Math.abs))
  const moneyDomain: [number, number] = [-maxMoneyAbs, maxMoneyAbs]

  const clampedMargins = chartData.filter(d => d.margin !== null).map(d => d.margin as number)
  const maxMarginAbs   = Math.max(30, ...clampedMargins.map(Math.abs))
  const marginDomain: [number, number] = [-maxMarginAbs, maxMarginAbs]

  // Summary stats for header
  const rawMargins   = data.filter(d => d.margin !== null).map(d => d.margin as number)
  const avgMargin    = rawMargins.length ? rawMargins.reduce((a, b) => a + b, 0) / rawMargins.length : null
  const totalProfit  = data.reduce((s, d) => s + d.profit, 0)
  const profitDays   = data.filter(d => d.profit > 0).length
  const marginColor  = avgMargin === null ? '#71717A' : avgMargin >= 20 ? '#10B981' : avgMargin >= 10 ? '#F59E0B' : '#F43F5E'

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.4, delay: 0.2 }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px 20px 16px' }}
    >
      {/* Header */}
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 20 }}>
        <div>
          <h3 style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>Lucro Diário</h3>
          <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 3 }}>
            Últimos {days} dias · {profitDays}/{data.length} dias lucrativos
          </p>
        </div>
        <div style={{ display: 'flex', gap: 20, alignItems: 'center' }}>
          <div style={{ textAlign: 'right' }}>
            <p style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 2 }}>Lucro total</p>
            <p style={{ fontSize: 16, fontWeight: 700, color: totalProfit >= 0 ? '#10B981' : '#F43F5E' }}>{fmtMoney(totalProfit)}</p>
          </div>
          {avgMargin !== null && (
            <div style={{ textAlign: 'right' }}>
              <p style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 2 }}>Margem média</p>
              <p style={{ fontSize: 16, fontWeight: 700, color: marginColor }}>{avgMargin.toFixed(1)}%</p>
            </div>
          )}
        </div>
      </div>

      {/* Chart */}
      <ResponsiveContainer width="100%" height={240}>
        <ComposedChart data={chartData} margin={{ top: 4, right: 48, left: 0, bottom: 0 }} barCategoryGap="25%">
          <defs>
            <linearGradient id="revenueGrad" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%"  stopColor="#8B5CF6" stopOpacity={0.15} />
              <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0.02} />
            </linearGradient>
          </defs>

          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />

          <XAxis
            dataKey="date"
            tick={{ fill: 'var(--text-faint)', fontSize: 11 }}
            tickLine={false} axisLine={false}
            tickFormatter={fmtAxisDate}
            interval="preserveStartEnd"
          />

          {/* Left axis — money (symmetric so $0 sits at center) */}
          <YAxis
            yAxisId="money"
            domain={moneyDomain}
            tick={{ fill: 'var(--text-faint)', fontSize: 11 }}
            tickLine={false} axisLine={false}
            tickFormatter={fmtMoney}
            width={52}
          />

          {/* Right axis — margin % (same symmetric logic, zero aligns with left) */}
          <YAxis
            yAxisId="pct"
            orientation="right"
            domain={marginDomain}
            tick={{ fill: '#F59E0B', fontSize: 11, fillOpacity: 0.7 }}
            tickLine={false} axisLine={false}
            tickFormatter={v => `${v.toFixed(0)}%`}
            width={40}
          />

          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />

          {/* Zero line */}
          <ReferenceLine yAxisId="money" y={0} stroke="rgba(255,255,255,0.12)" strokeDasharray="0" />

          {/* Revenue area (background context) */}
          <Area
            yAxisId="money"
            type="monotone"
            dataKey="revenue"
            fill="url(#revenueGrad)"
            stroke="#8B5CF6"
            strokeWidth={1.5}
            strokeOpacity={0.5}
            dot={false}
          />

          {/* Profit bars (main element) */}
          <Bar yAxisId="money" dataKey="profit" radius={[3, 3, 2, 2]}>
            {data.map((entry, i) => (
              <Cell
                key={`cell-${i}`}
                fill={entry.profit >= 0 ? '#10B981' : '#F43F5E'}
                fillOpacity={entry.profit >= 0 ? 0.9 : 0.8}
              />
            ))}
          </Bar>

          {/* Margin % line */}
          <Line
            yAxisId="pct"
            type="monotone"
            dataKey="margin"
            stroke="#F59E0B"
            strokeWidth={2}
            dot={{ fill: '#F59E0B', r: 3, strokeWidth: 0 }}
            activeDot={{ r: 5, strokeWidth: 0 }}
            connectNulls
          />
        </ComposedChart>
      </ResponsiveContainer>

      {/* Legend */}
      <div style={{ display: 'flex', gap: 20, marginTop: 12, fontSize: 11, color: 'var(--text-faint)', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="#8B5CF6" strokeWidth="1.5" strokeOpacity="0.6" /></svg>
          Receita
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: '#10B981', display: 'inline-block' }} />
          Lucro positivo
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: '#F43F5E', display: 'inline-block' }} />
          Lucro negativo
        </span>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <svg width="16" height="8"><line x1="0" y1="4" x2="16" y2="4" stroke="#F59E0B" strokeWidth="2" /><circle cx="8" cy="4" r="2.5" fill="#F59E0B" /></svg>
          Margem %
        </span>
      </div>
    </motion.div>
  )
}
