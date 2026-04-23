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

const fmt = (v: number) => {
  const n = Number(v)
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : n <= -1000 ? `-$${(Math.abs(n) / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`
}

function CustomTooltip({ active, payload, label }: { active?: boolean; payload?: { name: string; value: number; color: string }[]; label?: string }) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
      <p style={{ color: 'var(--text-dim)', marginBottom: 6 }}>{label}</p>
      {payload.map(p => (
        <p key={p.name} style={{ color: p.color, fontWeight: 600, marginBottom: 2 }}>
          {p.name === 'profit' ? 'Lucro' : p.name === 'revenue' ? 'Receita' : 'FB Spend'}: {fmt(p.value)}
        </p>
      ))}
    </div>
  )
}

export default function DailyProfitChart({ data, days }: Props) {
  if (data.length < 2) return null

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.6 }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}
    >
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>Lucro Diário</h3>
        <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 2 }}>
          Últimos {days} dias · Barras = lucro estimado por dia
        </p>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <ComposedChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis
            dataKey="date" tick={{ fill: 'var(--text-faint)', fontSize: 11 }}
            tickLine={false} axisLine={false} tickFormatter={v => v.slice(5)}
            interval="preserveStartEnd"
          />
          <YAxis
            tick={{ fill: 'var(--text-faint)', fontSize: 11 }}
            tickLine={false} axisLine={false} tickFormatter={fmt} width={52}
          />
          <Tooltip content={<CustomTooltip />} />
          <ReferenceLine y={0} stroke="var(--border-strong)" strokeDasharray="4 4" />
          <Bar dataKey="revenue" name="revenue" fill="rgba(139,92,246,0.2)" radius={[2,2,0,0]} maxBarSize={28} />
          <Bar dataKey="profit" name="profit" radius={[3,3,0,0]} maxBarSize={16}>
            {data.map((entry, i) => (
              <Cell
                key={`cell-${i}`}
                fill={entry.profit >= 0 ? 'rgba(16,185,129,0.8)' : 'rgba(244,63,94,0.8)'}
              />
            ))}
          </Bar>
          <Line type="monotone" dataKey="fbSpend" name="FB Spend" stroke="#8B5CF6" strokeWidth={1.5} dot={false} strokeDasharray="4 2" />
        </ComposedChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 16, marginTop: 10, fontSize: 11, color: 'var(--text-faint)' }}>
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
      </div>
    </motion.div>
  )
}
