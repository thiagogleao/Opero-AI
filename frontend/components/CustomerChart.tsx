'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { BarChart, Bar, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from 'recharts'
import { useTr } from '@/lib/translations'

interface Props {
  data: { date: string; new_customers: number; returning_customers: number
          new_revenue?: number; returning_revenue?: number }[]
  days: number
}

type View = 'orders' | 'revenue'

function CustomTooltip({ active, payload, label, view }: any) {
  const tr = useTr()
  if (!active || !payload?.length) return null
  const fmt = (v: number) => view === 'revenue'
    ? `$${Number(v).toLocaleString('en-US', { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`
    : String(v)
  const newKey      = view === 'revenue' ? 'new_revenue'       : 'new_customers'
  const returningKey = view === 'revenue' ? 'returning_revenue' : 'returning_customers'
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
      <p style={{ color: 'var(--text-dim)', marginBottom: 6 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.dataKey} style={{ color: p.color, fontWeight: 600 }}>
          {p.dataKey === newKey ? tr.metric_new_customers : tr.metric_returning}: {fmt(p.value ?? 0)}
        </p>
      ))}
    </div>
  )
}

const fmt = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`

export default function CustomerChart({ data, days }: Props) {
  const tr = useTr()
  const [view, setView] = useState<View>('orders')

  const hasRevenue = data.some(d => (d.new_revenue ?? 0) > 0 || (d.returning_revenue ?? 0) > 0)
  const newLabel       = tr.metric_new_customers
  const returningLabel = tr.metric_returning.charAt(0).toUpperCase() + tr.metric_returning.slice(1)

  const newKey      = view === 'revenue' ? 'new_revenue'       : 'new_customers'
  const returningKey = view === 'revenue' ? 'returning_revenue' : 'returning_customers'

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.6 }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h3 style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>{tr.chart_customers_title}</h3>
          <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 2 }}>
            {tr.days === 'days' ? `Last ${days} days` : `Últimos ${days} ${tr.days}`}
          </p>
        </div>
        {hasRevenue && (
          <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7, padding: 3, gap: 2 }}>
            {(['orders', 'revenue'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '3px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: view === v ? 'rgba(139,92,246,0.2)' : 'transparent',
                color: view === v ? '#A78BFA' : 'var(--text-faint)',
              }}>{v === 'orders' ? 'Pedidos' : 'Receita'}</button>
            ))}
          </div>
        )}
      </div>
      <ResponsiveContainer width="100%" height={180}>
        <BarChart data={data} margin={{ top: 5, right: 5, left: -20, bottom: 0 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
          <XAxis dataKey="date" tick={{ fill: 'var(--text-faint)', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={(v) => v.slice(5)} interval="preserveStartEnd" />
          <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 10 }} tickLine={false} axisLine={false}
            tickFormatter={view === 'revenue' ? fmt : undefined} />
          <Tooltip content={<CustomTooltip view={view} />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
          <Bar dataKey={newKey}       stackId="a" fill="#8B5CF6" radius={[0,0,0,0]} maxBarSize={20} />
          <Bar dataKey={returningKey} stackId="a" fill="#10B981" radius={[4,4,0,0]} maxBarSize={20} />
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
