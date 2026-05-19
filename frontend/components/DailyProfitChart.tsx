'use client'
import { motion } from 'framer-motion'
import {
  ComposedChart, Bar, Line, Cell, XAxis, YAxis, CartesianGrid,
  Tooltip, ResponsiveContainer, ReferenceLine,
} from 'recharts'
import type { DailyProfitPoint } from '@/lib/profitCalc'

interface Props {
  data: DailyProfitPoint[]
  days: number
}

const fmtMoney = (v: number) => {
  const n = Number(v)
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : n <= -1000 ? `-$${(Math.abs(n) / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`
}

function CustomTooltip({ active, payload, label }: {
  active?: boolean
  payload?: { name: string; value: number; color: string }[]
  label?: string
}) {
  if (!active || !payload?.length) return null
  const names: Record<string, string> = { profit: 'Lucro', revenue: 'Receita', fbSpend: 'Gasto FB', margin: 'Margem' }
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
      <p style={{ color: 'var(--text-dim)', marginBottom: 6 }}>{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color, fontWeight: 600, marginBottom: 2 }}>
          {names[p.name] ?? p.name}: {p.name === 'margin' ? `${p.value?.toFixed(1)}%` : fmtMoney(p.value)}
        </p>
      ))}
    </div>
  )
}

export default function DailyProfitChart({ data, days }: Props) {
  if (data.length < 2) return null

  const hasMargin = data.some(d => d.margin !== null)

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}
    >
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>Lucro Diário</h3>
        <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 2 }}>
          Últimos {days} dias · Barras = lucro estimado por dia
        </p>
      </div>
      <ResponsiveContainer width="100%" height={260}>
        <ComposedChart data={data} margin={{ top: 5, right: hasMargin ? 48 : 5, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date" tick={{ fill: 'var(--text-faint)', fontSize: 11 }}
            tickLine={false} axisLine={false} tickFormatter={v => v.slice(5)}
            interval="preserveStartEnd"
          />
          <YAxis
            yAxisId="money"
            tick={{ fill: 'var(--text-faint)', fontSize: 11 }}
            tickLine={false} axisLine={false} tickFormatter={fmtMoney} width={52}
          />
          {hasMargin && (
            <YAxis
              yAxisId="pct"
              orientation="right"
              tick={{ fill: '#F59E0B', fontSize: 11 }}
              tickLine={false} axisLine={false}
              tickFormatter={v => `${v.toFixed(0)}%`}
              width={42}
            />
          )}
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine yAxisId="money" y={0} stroke="var(--border-strong)" strokeDasharray="4 4" />
          {hasMargin && (
            <ReferenceLine yAxisId="pct" y={0} stroke="rgba(245,158,11,0.2)" strokeDasharray="4 4" />
          )}

          <Bar yAxisId="money" dataKey="revenue" name="revenue" fill="rgba(139,92,246,0.2)" radius={[2,2,0,0]} maxBarSize={28} />
          <Bar yAxisId="money" dataKey="profit" name="profit" radius={[3,3,0,0]} maxBarSize={16}>
            {data.map((entry, i) => (
              <Cell key={`cell-${i}`} fill={entry.profit >= 0 ? 'rgba(16,185,129,0.85)' : 'rgba(244,63,94,0.85)'} />
            ))}
          </Bar>
          <Line yAxisId="money" type="monotone" dataKey="fbSpend" name="fbSpend" stroke="#8B5CF6" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
          {hasMargin && (
            <Line
              yAxisId="pct" type="monotone" dataKey="margin" name="margin"
              stroke="#F59E0B" strokeWidth={2} dot={false}
              connectNulls
            />
          )}
        </ComposedChart>
      </ResponsiveContainer>

      <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: 'var(--text-faint)', flexWrap: 'wrap' }}>
        <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
          <span style={{ width: 10, height: 10, borderRadius: 2, background: 'rgba(139,92,246,0.4)', display: 'inline-block' }} />
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
          <span style={{ width: 16, height: 2, background: '#8B5CF6', display: 'inline-block' }} />
          Gasto FB
        </span>
        {hasMargin && (
          <span style={{ display: 'flex', alignItems: 'center', gap: 5 }}>
            <span style={{ width: 16, height: 2, background: '#F59E0B', display: 'inline-block' }} />
            Margem %
          </span>
        )}
      </div>
    </motion.div>
  )
}
