'use client'
import { motion } from 'framer-motion'
import { PieChart, Pie, Cell, Tooltip, ResponsiveContainer } from 'recharts'
import type { ProfitSummary } from '@/lib/profitCalc'

interface Props {
  profit: ProfitSummary
}

function fmt(n: number) {
  return `$${Math.abs(n).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}`
}

function CustomTooltip({ active, payload }: any) {
  if (!active || !payload?.length) return null
  const d = payload[0].payload
  return (
    <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border-strong)', borderRadius: 8, padding: '8px 12px', fontSize: 12 }}>
      <p style={{ color: d.color, fontWeight: 600, marginBottom: 2 }}>{d.label}</p>
      <p style={{ color: 'var(--text-primary)' }}>{fmt(d.value)} · {d.pct.toFixed(1)}%</p>
    </div>
  )
}

export default function MarginBreakdownChart({ profit }: Props) {
  const {
    totalRevenue, fbSpend, totalCogs, totalShipping,
    totalFees, totalExtraCosts, netProfit, totalAdditionalUnitSavings,
  } = profit

  const effectiveCogs = Math.max(0, totalCogs - totalAdditionalUnitSavings)

  const segments = [
    { key: 'ads',      label: 'Ads (Meta)',  color: '#F43F5E', value: fbSpend },
    { key: 'cogs',     label: 'COGS',        color: '#38BDF8', value: effectiveCogs },
    { key: 'shipping', label: 'Frete',       color: '#F59E0B', value: totalShipping },
    { key: 'fees',     label: 'Taxas',       color: '#A78BFA', value: totalFees },
    { key: 'extras',   label: 'Extras',      color: '#6366F1', value: totalExtraCosts },
    { key: 'profit',   label: 'Lucro Final', color: '#10B981', value: Math.max(0, netProfit) },
  ]

  const isLoss = netProfit < 0
  const pieData = segments.filter(s => s.value > 0).map(s => ({
    ...s,
    pct: totalRevenue > 0 ? (s.value / totalRevenue) * 100 : 0,
  }))

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.3 }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}
    >
      <div style={{ marginBottom: 12 }}>
        <h3 style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>Composição da Receita</h3>
        <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 2 }}>
          {fmt(totalRevenue)} de receita — como cada $ é distribuído
        </p>
      </div>

      {isLoss && (
        <div style={{
          padding: '6px 10px', background: 'rgba(244,63,94,0.08)',
          border: '1px solid rgba(244,63,94,0.2)', borderRadius: 6,
          marginBottom: 10, fontSize: 11, color: '#F43F5E',
        }}>
          Atenção: custos totais excedem a receita no período
        </div>
      )}

      <div style={{ display: 'flex', gap: 16, alignItems: 'center' }}>
        {/* Donut */}
        <div style={{ flex: '0 0 150px', height: 150 }}>
          <ResponsiveContainer width="100%" height="100%">
            <PieChart>
              <Pie
                data={pieData}
                cx="50%" cy="50%"
                innerRadius={42} outerRadius={68}
                paddingAngle={2}
                dataKey="value"
                stroke="none"
              >
                {pieData.map((entry, i) => (
                  <Cell key={i} fill={entry.color} />
                ))}
              </Pie>
              <Tooltip content={<CustomTooltip />} />
            </PieChart>
          </ResponsiveContainer>
        </div>

        {/* Legend */}
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: 7 }}>
          {segments.map(seg => {
            const displayValue = seg.key === 'profit' && isLoss ? netProfit : seg.value
            const pct = totalRevenue > 0 ? (seg.value / totalRevenue) * 100 : 0
            const lossPct = totalRevenue > 0 ? (Math.abs(netProfit) / totalRevenue) * 100 : 0
            const color = seg.key === 'profit' && isLoss ? '#F43F5E' : seg.color

            if (seg.key !== 'profit' && seg.value === 0) return null

            return (
              <div key={seg.key} style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                <span style={{ width: 8, height: 8, borderRadius: 2, background: color, flexShrink: 0 }} />
                <span style={{ fontSize: 12, color: 'var(--text-dim)', flex: 1 }}>{seg.label}</span>
                <span style={{ fontSize: 12, color: 'var(--text-primary)', fontWeight: 600 }}>
                  {seg.key === 'profit' && isLoss ? `-${fmt(Math.abs(netProfit))}` : fmt(seg.value)}
                </span>
                <span style={{ fontSize: 11, color: 'var(--text-faint)', width: 38, textAlign: 'right' }}>
                  {seg.key === 'profit' && isLoss ? `${lossPct.toFixed(1)}%` : `${pct.toFixed(1)}%`}
                </span>
              </div>
            )
          })}
        </div>
      </div>
    </motion.div>
  )
}
