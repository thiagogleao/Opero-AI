'use client'
import { ComposedChart, Bar, Line, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer, Legend } from 'recharts'

interface DailyRow {
  date: string; spend: number; revenue: number; roas: number
  impressions: number; clicks: number; purchases: number
}

interface Props { daily: DailyRow[] }

const fmt = (v: number) => v >= 1000 ? `$${(v / 1000).toFixed(1)}k` : `$${v.toFixed(0)}`

function CustomTooltip({ active, payload, label }: any) {
  if (!active || !payload?.length) return null
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
      <p style={{ color: 'var(--text-dim)', marginBottom: 6, fontWeight: 600 }}>{label}</p>
      {payload.map((p: any) => (
        <p key={p.name} style={{ color: p.color, fontWeight: 500 }}>
          {p.name}: {p.name === 'ROAS' ? `${Number(p.value).toFixed(2)}x` : fmt(Number(p.value))}
        </p>
      ))}
    </div>
  )
}

export default function CreativeDetailCharts({ daily }: Props) {
  if (daily.length === 0) {
    return (
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '60px 20px', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-faint)', fontSize: 14 }}>Sem dados diários para este período</p>
      </div>
    )
  }

  const chartData = daily.map(d => ({
    date: d.date.slice(5),
    Gasto: Number(d.spend),
    Receita: Number(d.revenue),
    ROAS: Number(d.roas),
  }))

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 12 }}>
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '20px' }}>
        <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4 }}>Receita vs Gasto</p>
        <p style={{ fontSize: 11, color: 'var(--text-faint)', marginBottom: 14 }}>Desempenho diário do criativo</p>
        <ResponsiveContainer width="100%" height={200}>
          <ComposedChart data={chartData} margin={{ top: 5, right: 5, left: 0, bottom: 0 }}>
            <CartesianGrid strokeDasharray="3 3" stroke="var(--border)" vertical={false} />
            <XAxis dataKey="date" tick={{ fill: 'var(--text-faint)', fontSize: 10 }} tickLine={false} axisLine={false} />
            <YAxis yAxisId="money" tick={{ fill: 'var(--text-faint)', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={fmt} width={46} />
            <YAxis yAxisId="roas" orientation="right" tick={{ fill: 'var(--text-faint)', fontSize: 10 }} tickLine={false} axisLine={false} tickFormatter={v => `${v}x`} width={36} />
            <Tooltip content={<CustomTooltip />} />
            <Bar yAxisId="money" dataKey="Gasto"   fill="rgba(139,92,246,0.7)"  radius={[3,3,0,0]} maxBarSize={24} />
            <Bar yAxisId="money" dataKey="Receita" fill="rgba(16,185,129,0.7)"  radius={[3,3,0,0]} maxBarSize={24} />
            <Line yAxisId="roas" type="monotone" dataKey="ROAS" stroke="#F59E0B" strokeWidth={2} dot={false} />
          </ComposedChart>
        </ResponsiveContainer>
      </div>

      {/* Summary stats table */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 20px' }}>
        <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-faint)', marginBottom: 10 }}>Melhor e Pior Dia</p>
        {(() => {
          const sorted = [...daily].sort((a, b) => Number(b.roas) - Number(a.roas))
          const best  = sorted[0]
          const worst = sorted[sorted.length - 1]
          return (
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 10 }}>
              {[{ label: 'Melhor dia', d: best, color: '#10B981' }, { label: 'Pior dia', d: worst, color: '#F43F5E' }].map(({ label, d, color }) => (
                <div key={label} style={{ background: 'var(--bg)', borderRadius: 8, padding: '10px 12px', border: `1px solid ${color}30` }}>
                  <p style={{ fontSize: 10, color: 'var(--text-ghost)', marginBottom: 4 }}>{label}</p>
                  <p style={{ fontSize: 12, color: 'var(--text-faint)', marginBottom: 6 }}>{d.date}</p>
                  <p style={{ fontSize: 16, fontWeight: 700, color }}>{Number(d.roas).toFixed(2)}x</p>
                  <p style={{ fontSize: 11, color: 'var(--text-ghost)' }}>
                    {fmt(Number(d.spend))} gasto · {fmt(Number(d.revenue))} receita
                  </p>
                </div>
              ))}
            </div>
          )
        })()}
      </div>
    </div>
  )
}
