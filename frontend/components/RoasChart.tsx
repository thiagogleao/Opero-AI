'use client'
import { motion } from 'framer-motion'
import { LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, ReferenceLine } from 'recharts'
import { useTr } from '@/lib/translations'

interface Props {
  data: { date: string; fb_roas: number; blended_roas: number }[]
  days: number
}

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '10px 14px', fontSize: 13 }}>
      <p style={{ color: 'var(--text-dim)', marginBottom: 6 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color, fontWeight: 600 }}>
          {p.name === 'fb_roas' ? 'ROAS Facebook' : 'ROAS Real'}: {Number(p.value).toFixed(2)}x
        </p>
      ))}
    </div>
  )
}

export default function RoasChart({ data, days }: Props) {
  const tr = useTr()
  const hasData = data.some(d => Number(d.fb_roas) > 0 || Number(d.blended_roas) > 0)
  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.4 }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}
    >
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>{tr.chart_roas_title}</h3>
        <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 2 }}>{tr.chart_roas_subtitle}</p>
      </div>
      {!hasData ? (
        <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
          <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>{tr.no_data}</p>
        </div>
      ) : (
        <ResponsiveContainer width="100%" height={220}>
          <LineChart data={data} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: 'var(--text-faint)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => v.slice(5)} />
            <YAxis tick={{ fill: 'var(--text-faint)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={(v) => `${v}x`} width={40} />
            <Tooltip content={<CustomTooltip />} />
            <ReferenceLine y={1} stroke="#F43F5E" strokeDasharray="4 4" />
            <Line type="monotone" dataKey="fb_roas" stroke="#8B5CF6" strokeWidth={2} dot={false} name="fb_roas" />
            <Line type="monotone" dataKey="blended_roas" stroke="#10B981" strokeWidth={2} dot={false} name="blended_roas" />
          </LineChart>
        </ResponsiveContainer>
      )}
    </motion.div>
  )
}
