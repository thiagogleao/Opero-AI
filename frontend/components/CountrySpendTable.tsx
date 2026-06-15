'use client'
import { motion } from 'framer-motion'

interface CountryRow {
  country: string
  spend: number | string
  purchases: number | string
  revenue: number | string
  clicks: number | string
  cpc: number | string
  roas: number | string
}

interface Props {
  data: CountryRow[]
  days: number
  fmt: (n: number) => string
}

export default function CountrySpendTable({ data, days, fmt }: Props) {
  if (data.length === 0) {
    return (
      <motion.div
        initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
        style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '40px 24px', marginBottom: 12, textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}
      >
        Sem dados de gasto por país no período
      </motion.div>
    )
  }

  const maxSpend = Math.max(...data.map(r => Number(r.spend)), 0)

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4 }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}
    >
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)' }}>
        <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Gasto FB por País</h3>
        <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>Últimos {days} dias · Dados do Meta Ads Manager</p>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {[
                { label: 'País',       align: 'left'  },
                { label: 'Gasto FB',   align: 'right' },
                { label: 'Receita FB', align: 'right' },
                { label: 'ROAS FB',    align: 'right' },
                { label: 'Compras',    align: 'right' },
                { label: 'Cliques',    align: 'right' },
                { label: 'CPC',        align: 'right' },
              ].map(h => (
                <th key={h.label} style={{
                  padding: '8px 16px',
                  textAlign: h.align as 'left' | 'right',
                  color: 'var(--text-faint)',
                  fontWeight: 600, fontSize: 10,
                  letterSpacing: '0.06em', textTransform: 'uppercase',
                  whiteSpace: 'nowrap',
                }}>
                  {h.label}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {data.map((row, i) => {
              const spend = Number(row.spend)
              const revenue = Number(row.revenue)
              const roas = Number(row.roas)
              const barPct = maxSpend > 0 ? (spend / maxSpend * 100) : 0
              const roasColor = roas >= 2 ? '#10B981' : roas >= 1 ? '#F59E0B' : '#F43F5E'

              return (
                <tr key={row.country} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                  <td style={{ padding: '10px 16px', fontWeight: 600, color: 'var(--text-primary)', minWidth: 80 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{ fontSize: 14 }}>
                        {countryFlag(row.country)}
                      </span>
                      <div>
                        <div>{row.country}</div>
                        {/* Spend bar */}
                        <div style={{ width: 100, height: 3, background: 'var(--bg-hover)', borderRadius: 2, marginTop: 3, overflow: 'hidden' }}>
                          <div style={{ width: `${barPct}%`, height: '100%', background: '#8B5CF6', borderRadius: 2 }} />
                        </div>
                      </div>
                    </div>
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-secondary)', fontWeight: 600 }}>
                    {fmt(spend)}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-muted)' }}>
                    {fmt(revenue)}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: roasColor }}>
                    {roas.toFixed(2)}x
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-muted)' }}>
                    {Number(row.purchases).toLocaleString('pt-BR')}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-ghost)', fontSize: 11 }}>
                    {Number(row.clicks).toLocaleString('pt-BR')}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-ghost)', fontSize: 11 }}>
                    {fmt(Number(row.cpc))}
                  </td>
                </tr>
              )
            })}
          </tbody>
          <tfoot>
            <tr style={{ borderTop: '2px solid var(--border)', background: 'rgba(139,92,246,0.04)' }}>
              <td style={{ padding: '10px 16px', fontWeight: 700, color: 'var(--text-primary)', fontSize: 11 }}>TOTAL</td>
              <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)', fontSize: 11 }}>
                {fmt(data.reduce((s, r) => s + Number(r.spend), 0))}
              </td>
              <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 600, color: 'var(--text-muted)', fontSize: 11 }}>
                {fmt(data.reduce((s, r) => s + Number(r.revenue), 0))}
              </td>
              <td colSpan={4} />
            </tr>
          </tfoot>
        </table>
      </div>
    </motion.div>
  )
}

// Simple flag emoji mapper — works for most ISO 3166-1 alpha-2 codes
function countryFlag(code: string): string {
  if (!code || code.length !== 2) return '🌐'
  const offset = 127397
  return String.fromCodePoint(...[...code.toUpperCase()].map(c => c.charCodeAt(0) + offset))
}
