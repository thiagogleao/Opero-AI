'use client'
import { useState } from 'react'
import { motion } from 'framer-motion'
import { BarChart, Bar, XAxis, YAxis, Tooltip, ResponsiveContainer, Cell, ReferenceLine } from 'recharts'
import { useTr } from '@/lib/translations'
import { useSettings } from '@/contexts/SettingsContext'
import { makeFmt } from '@/lib/format'

interface CountryRevenue { country_code: string; revenue: number; orders: number }
interface CountryProfit  { country_code: string; revenue: number; orders: number; fbSpend: number; netProfit: number; margin: number; roas: number; configured: boolean }

interface Props {
  data: CountryRevenue[]
  days: number
  profitData?: CountryProfit[]
}

const COLORS = ['#8B5CF6','#10B981','#38BDF8','#F59E0B','#F43F5E','#A78BFA','#34D399','#7DD3FC']

function makeTooltips(fmt: (n: number) => string) {
  function RevenueTooltip({ active, payload, label }: any) {
    const tr = useTr()
    if (!active || !payload?.length) return null
    return (
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
        <p style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 4 }}>{label}</p>
        <p style={{ color: '#10B981' }}>{tr.metric_revenue}: {fmt(Number(payload[0].value))}</p>
        {payload[0].payload.orders && <p style={{ color: 'var(--text-muted)' }}>{tr.country_orders}: {payload[0].payload.orders}</p>}
      </div>
    )
  }
  function ProfitTooltip({ active, payload, label }: any) {
    const tr = useTr()
    if (!active || !payload?.length) return null
    const d = payload[0].payload as CountryProfit
    return (
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '10px 14px', fontSize: 12 }}>
        <p style={{ color: 'var(--text-primary)', fontWeight: 600, marginBottom: 6 }}>{label}</p>
        <p style={{ color: d.netProfit >= 0 ? '#10B981' : '#F43F5E', fontWeight: 600 }}>
          {tr.profit_net.charAt(0) + tr.profit_net.slice(1).toLowerCase()}: {fmt(d.netProfit)}
        </p>
        <p style={{ color: 'var(--text-muted)', marginTop: 2 }}>{tr.profit_margin.charAt(0) + tr.profit_margin.slice(1).toLowerCase()}: {d.margin.toFixed(1)}%</p>
        <p style={{ color: 'var(--text-muted)' }}>{tr.metric_revenue}: {fmt(d.revenue)}</p>
        <p style={{ color: 'var(--text-muted)' }}>FB: {fmt(d.fbSpend)}</p>
        <p style={{ color: 'var(--text-muted)' }}>{tr.country_orders}: {d.orders}</p>
        {d.roas > 0 && <p style={{ color: 'var(--text-muted)' }}>{tr.country_roas}: {d.roas.toFixed(2)}x</p>}
      </div>
    )
  }
  return { RevenueTooltip, ProfitTooltip }
}

export default function CountryChart({ data, days, profitData }: Props) {
  const tr = useTr()
  const { currency } = useSettings()
  const $fmt = makeFmt(currency)
  const { RevenueTooltip, ProfitTooltip } = makeTooltips($fmt)
  const hasProfitData = profitData && profitData.length > 0 && profitData[0].configured
  const [view, setView] = useState<'revenue' | 'profit'>(hasProfitData ? 'profit' : 'revenue')

  const profitChartData = profitData
    ? [...profitData].sort((a, b) => b.netProfit - a.netProfit)
    : []

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.5 }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 16 }}>
        <div>
          <h3 style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>{tr.chart_countries_title}</h3>
          <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 2 }}>
            {view === 'profit' ? tr.chart_countries_net : tr.chart_countries_rev} {tr.chart_countries_sub} — {days} {tr.days}
          </p>
        </div>
        {hasProfitData && (
          <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 7, padding: 3, gap: 2 }}>
            {(['profit', 'revenue'] as const).map(v => (
              <button key={v} onClick={() => setView(v)} style={{
                padding: '4px 10px', borderRadius: 5, fontSize: 11, fontWeight: 600,
                border: 'none', cursor: 'pointer', transition: 'all 0.15s',
                background: view === v ? (v === 'profit' ? 'rgba(16,185,129,0.2)' : 'rgba(139,92,246,0.2)') : 'transparent',
                color: view === v ? (v === 'profit' ? '#10B981' : '#A78BFA') : 'var(--text-faint)',
              }}>
                {v === 'profit' ? tr.country_profit_btn : tr.country_revenue_btn}
              </button>
            ))}
          </div>
        )}
      </div>

      {view === 'revenue' || !hasProfitData ? (
        data.length === 0 ? (
          <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>{tr.no_data}</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={220}>
            <BarChart data={data} layout="vertical" margin={{ top: 0, right: 10, left: 10, bottom: 0 }}>
              <XAxis type="number" tick={{ fill: 'var(--text-faint)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `${$fmt(v / 1000).replace(/\.00$/, '')}k`} />
              <YAxis type="category" dataKey="country_code" tick={{ fill: 'var(--text-muted)', fontSize: 12, fontWeight: 500 }} tickLine={false} axisLine={false} width={32} />
              <Tooltip content={<RevenueTooltip />} cursor={{ fill: 'rgba(139,92,246,0.06)' }} />
              <Bar dataKey="revenue" radius={[0, 6, 6, 0]} maxBarSize={16}>
                {data.map((_, i) => <Cell key={i} fill={COLORS[i % COLORS.length]} />)}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )
      ) : (
        profitChartData.length === 0 ? (
          <div style={{ height: 220, display: 'flex', alignItems: 'center', justifyContent: 'center' }}>
            <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>{tr.no_data}</p>
          </div>
        ) : (
          <ResponsiveContainer width="100%" height={Math.max(220, profitChartData.length * 32)}>
            <BarChart data={profitChartData} layout="vertical" margin={{ top: 0, right: 40, left: 10, bottom: 0 }}>
              <XAxis type="number" tick={{ fill: 'var(--text-faint)', fontSize: 11 }} tickLine={false} axisLine={false} tickFormatter={v => `${$fmt(v / 1000).replace(/\.00$/, '')}k`} />
              <YAxis type="category" dataKey="country_code" tick={{ fill: 'var(--text-muted)', fontSize: 12, fontWeight: 500 }} tickLine={false} axisLine={false} width={32} />
              <ReferenceLine x={0} stroke="var(--border-strong)" strokeWidth={1} />
              <Tooltip content={<ProfitTooltip />} cursor={{ fill: 'rgba(255,255,255,0.03)' }} />
              <Bar dataKey="netProfit" radius={[0, 6, 6, 0]} maxBarSize={16}>
                {profitChartData.map((d, i) => (
                  <Cell key={i} fill={d.netProfit >= 0 ? COLORS[i % 4] : '#F43F5E'} />
                ))}
              </Bar>
            </BarChart>
          </ResponsiveContainer>
        )
      )}

      {hasProfitData && view === 'profit' && (
        <div style={{ marginTop: 12, borderTop: '1px solid var(--border)', paddingTop: 10, display: 'flex', flexDirection: 'column', gap: 4 }}>
          {profitChartData.slice(0, 5).map(d => (
            <div key={d.country_code} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '2px 4px' }}>
              <span style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 600, minWidth: 32 }}>{d.country_code}</span>
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>{d.orders} {tr.country_orders} · {tr.country_roas} {d.roas.toFixed(2)}x</span>
              <span style={{ fontSize: 12, fontWeight: 600, color: d.netProfit >= 0 ? '#10B981' : '#F43F5E' }}>
                {d.netProfit >= 0 ? '+' : ''}{$fmt(d.netProfit)} <span style={{ fontWeight: 400, color: 'var(--text-faint)', fontSize: 10 }}>({d.margin.toFixed(1)}%)</span>
              </span>
            </div>
          ))}
        </div>
      )}
    </motion.div>
  )
}
