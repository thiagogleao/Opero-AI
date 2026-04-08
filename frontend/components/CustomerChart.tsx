'use client'
import { motion } from 'framer-motion'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useTr } from '@/lib/translations'

interface Props {
  data: { date: string; new_customers: number; returning_customers: number }[]
  days: number
}

function CustomTooltip({ active, payload, label }: any) {
  const tr = useTr()
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
      <p style={{ color: 'var(--text-dim)', marginBottom: 6 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color, fontWeight: 600 }}>
          {p.name === 'new_customers' ? tr.metric_new_customers : tr.metric_returning}: {p.value}
        </p>
      ))}
    </div>
  )
}

export default function CustomerChart({ data, days }: Props) {
  const tr = useTr()
  const newLabel       = tr.metric_new_customers
  const returningLabel = tr.metric_returning.charAt(0).toUpperCase() + tr.metric_returning.slice(1)

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.6 }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}
    >
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>{tr.chart_customers_title}</h3>
        <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 2 }}>
          {tr.days === 'days' ? `Customers per day — last ${days} days` : `Clientes por dia — últimos ${days} ${tr.days}`}
        </p>
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: 'var(--text-faint)', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => v.slice(5)} interval="preserveStartEnd" />
          <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 10 }} tickLine={false} axisLine={false} />
          <Tooltip content={<CustomTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Bar dataKey="new_customers" stackId="a" fill="#8B5CF6" radius={[0,0,0,0]} maxBarSize={20} />
          <Bar dataKey="returning_customers" stackId="a" fill="#10B981" radius={[4,4,0,0]} maxBarSize={20} />
        </BarChart>
      </ResponsiveContainer>
      <div style={{ display: 'flex', gap: 16, marginTop: 12 }}>
        {[['#8B5CF6', newLabel], ['#10B981', returningLabel]].map(([color, label]) => (
          <div key={label} style={{ display: 'flex', alignItems: 'center', gap: 6, fontSize: 12 }}>
            <div style={{ width: 8, height: 8, borderRadius: 2, background: color }} />
            <span style={{ color: 'var(--text-muted)' }}>{label}</span>
          </div>
        ))}
      </div>
    </motion.div>
  )
}
