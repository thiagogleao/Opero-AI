'use client'
import { motion } from 'framer-motion'

interface LtvRow {
  segment: string; customers: number; avg_orders: number
  avg_ltv: number; avg_aov: number; pct: number
}

interface Props { data: LtvRow[] }

const COLORS = ['#8B5CF6', '#3B82F6', '#10B981', '#F59E0B']

export default function LtvSection({ data }: Props) {
  if (data.length === 0) return null

  const maxLtv = Math.max(...data.map(d => Number(d.avg_ltv)), 1)
  const totalCustomers = data.reduce((s, d) => s + Number(d.customers), 0)

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.65 }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}
    >
      <div style={{ marginBottom: 16 }}>
        <h3 style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>Retenção & LTV</h3>
        <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 2 }}>
          Valor por cliente · {totalCustomers.toLocaleString()} clientes únicos
        </p>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(200px, 1fr))', gap: 10 }}>
        {data.map((row, i) => {
          const ltv       = Number(row.avg_ltv)
          const ltvPct    = maxLtv > 0 ? (ltv / maxLtv) * 100 : 0
          const customers = Number(row.customers)
          const custPct   = totalCustomers > 0 ? (customers / totalCustomers) * 100 : 0
          const color     = COLORS[i % COLORS.length]
          return (
            <div key={row.segment} style={{ background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 10 }}>
                <div>
                  <p style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)' }}>{row.segment}</p>
                  <p style={{ fontSize: 11, color: 'var(--text-ghost)', marginTop: 2 }}>
                    {customers.toLocaleString()} clientes · {Number(row.pct).toFixed(1)}%
                  </p>
                </div>
                <div style={{ width: 10, height: 10, borderRadius: '50%', background: color, marginTop: 2 }} />
              </div>
              {/* Customer bar */}
              <div style={{ marginBottom: 8 }}>
                <div style={{ height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                  <div style={{ width: `${custPct}%`, height: '100%', background: color, borderRadius: 2, opacity: 0.5 }} />
                </div>
              </div>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-end' }}>
                <div>
                  <p style={{ fontSize: 10, color: 'var(--text-ghost)' }}>LTV médio</p>
                  <p style={{ fontSize: 20, fontWeight: 700, color, letterSpacing: '-0.4px' }}>
                    ${ltv.toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </p>
                </div>
                <div style={{ textAlign: 'right' }}>
                  <p style={{ fontSize: 10, color: 'var(--text-ghost)' }}>AOV médio</p>
                  <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-secondary)' }}>
                    ${Number(row.avg_aov).toLocaleString('en-US', { minimumFractionDigits: 0, maximumFractionDigits: 0 })}
                  </p>
                  <p style={{ fontSize: 10, color: 'var(--text-ghost)', marginTop: 1 }}>
                    ~{Number(row.avg_orders).toFixed(1)} pedidos
                  </p>
                </div>
              </div>
              {/* LTV bar */}
              <div style={{ marginTop: 8, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${ltvPct}%`, height: '100%', background: color, borderRadius: 2 }} />
              </div>
            </div>
          )
        })}
      </div>
    </motion.div>
  )
}
