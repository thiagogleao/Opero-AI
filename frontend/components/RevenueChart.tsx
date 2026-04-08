'use client'
import { motion } from 'framer-motion'
import { AreaChart, Area, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useTr } from '@/lib/translations'

interface Props {
  data: { date: string; revenue: number; spend: number }[]
  days: number
}

const fmt = (v: number) => {
  const n = Number(v)
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`
}

function CustomTooltip({ active, payload, label }: any) {
  const tr = useTr()
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
      <p style={{ color: 'var(--text-dim)', marginBottom: 6 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color, fontWeight: 600 }}>
          {p.name === 'revenue' ? tr.metric_revenue : tr.metric_fb_spend}: {fmt(p.value)}
        </p>
      ))}
    </div>
  )
}

export default function RevenueChart({ data, days }: Props) {
  const tr = useTr()
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}
    >
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>{tr.chart_revenue_title}</h3>
        <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 2 }}>{tr.days === 'days' ? `Last ${days} days` : `Últimos ${days} ${tr.days}`}</p>
      </div>
      <ResponsiveContainer width="100%" height={220}>
        <AreaChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
          <defs>
            <linearGradient id="gRevenue" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#10B981" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#10B981" stopOpacity={0} />
            </linearGradient>
            <linearGradient id="gSpend" x1="0" y1="0" x2="0" y2="1">
              <stop offset="5%" stopColor="#8B5CF6" stopOpacity={0.3} />
              <stop offset="95%" stopColor="#8B5CF6" stopOpacity={0} />
            </linearGradient>
          </defs>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: 'var(--text-faint)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => v.slice(5)} />
          <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={fmt} width={50} />
          <Tooltip content={<CustomTooltip />} />
          <Area type="monotone" dataKey="revenue" stroke="#10B981" strokeWidth={2} fill="url(#gRevenue)" name="revenue" />
          <Area type="monotone" dataKey="spend" stroke="#8B5CF6" strokeWidth={2} fill="url(#gSpend)" name="spend" />
        </AreaChart>
      </ResponsiveContainer>
    </motion.div>
  )
}
