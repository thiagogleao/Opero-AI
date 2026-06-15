'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import Image from 'next/image'
import { makeFmt } from '@/lib/format'
import { useSettings } from '@/contexts/SettingsContext'

interface ProductRow {
  product_id: string
  title: string
  image_url: string | null
  units: number
  orders: number
  revenue: number
  cogs: number
  allocated_fb_spend: number
  estimated_profit: number
  margin: number
  configured: boolean
}

interface ApiResponse {
  products: ProductRow[]
  configured: boolean
  totalFbSpend: number
}

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`
}

function daysAgo(n: number) {
  const d = new Date(); d.setHours(0,0,0,0); d.setDate(d.getDate() - n + 1); return d
}

const PRESETS = [
  { label: '7d',  days: 7  },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
]

export default function ProductProfitTable() {
  const { currency } = useSettings()
  const fmt = makeFmt(currency)

  const [dateFrom, setDateFrom] = useState(() => toISO(daysAgo(30)))
  const [dateTo,   setDateTo]   = useState(() => toISO(new Date()))
  const [activePreset, setActivePreset] = useState(30)
  const [data, setData] = useState<ApiResponse | null>(null)
  const [loading, setLoading] = useState(false)

  const load = useCallback(async (from: string, to: string) => {
    setLoading(true)
    try {
      const res = await fetch(`/api/profit/products?dateFrom=${from}&dateTo=${to}`)
      setData(await res.json())
    } catch {}
    setLoading(false)
  }, [])

  useEffect(() => { load(dateFrom, dateTo) }, [load, dateFrom, dateTo])

  function applyPreset(days: number) {
    setActivePreset(days)
    setDateFrom(toISO(daysAgo(days)))
    setDateTo(toISO(new Date()))
  }

  const rows = data?.products ?? []

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.2 }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 24 }}
    >
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Lucro por Produto</h3>
          <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            Receita Shopify real · Gasto FB alocado proporcionalmente · COGS por produto
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {PRESETS.map(p => (
            <button
              key={p.days}
              onClick={() => applyPreset(p.days)}
              style={{
                padding: '4px 10px', fontSize: 11, borderRadius: 6, fontWeight: 600, cursor: 'pointer',
                background: activePreset === p.days ? 'rgba(139,92,246,0.2)' : 'var(--bg-hover)',
                border: `1px solid ${activePreset === p.days ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`,
                color: activePreset === p.days ? '#A78BFA' : 'var(--text-muted)',
              }}
            >
              {p.label}
            </button>
          ))}
        </div>
      </div>

      {/* Table */}
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {['Produto', 'Unidades', 'Pedidos', 'Receita', 'COGS', 'Gasto FB', 'Lucro Est.', 'Margem'].map(h => (
                <th key={h} style={{ padding: '8px 16px', textAlign: h === 'Produto' ? 'left' : 'right', color: 'var(--text-faint)', fontWeight: 600, fontSize: 10, letterSpacing: '0.06em', textTransform: 'uppercase', whiteSpace: 'nowrap' }}>
                  {h}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [0,1,2,3].map(i => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  {Array(8).fill(0).map((_, j) => (
                    <td key={j} style={{ padding: '10px 16px' }}>
                      <div style={{ height: 12, background: 'var(--bg-hover)', borderRadius: 4, width: j === 0 ? '70%' : '40%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
                  Nenhum produto com vendas no período
                </td>
              </tr>
            ) : rows.map((row, i) => {
              const profitColor = row.estimated_profit > 0 ? '#10B981' : row.estimated_profit < 0 ? '#F43F5E' : 'var(--text-muted)'
              return (
                <tr key={row.product_id || i} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                  <td style={{ padding: '10px 16px', color: 'var(--text-primary)', fontWeight: 500 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8, maxWidth: 240 }}>
                      {row.image_url ? (
                        <Image src={row.image_url} alt="" width={28} height={28} style={{ borderRadius: 4, objectFit: 'cover', flexShrink: 0 }} unoptimized />
                      ) : (
                        <div style={{ width: 28, height: 28, borderRadius: 4, background: 'var(--bg-hover)', flexShrink: 0 }} />
                      )}
                      <span style={{ overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }} title={row.title}>{row.title}</span>
                    </div>
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-muted)' }}>{row.units}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-muted)' }}>{row.orders}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-secondary)' }}>{fmt(row.revenue)}</td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: 'var(--text-muted)' }}>
                    {row.configured ? fmt(row.cogs) : '—'}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: '#F87171', fontSize: 11 }}>
                    {fmt(row.allocated_fb_spend)}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', fontWeight: 700, color: profitColor }}>
                    {row.configured ? fmt(row.estimated_profit) : fmt(row.estimated_profit)}
                  </td>
                  <td style={{ padding: '10px 16px', textAlign: 'right', color: profitColor }}>
                    {`${row.margin.toFixed(1)}%`}
                  </td>
                </tr>
              )
            })}
          </tbody>
        </table>
      </div>

      {!data?.configured && rows.length > 0 && (
        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', background: 'rgba(245,158,11,0.05)', fontSize: 11, color: '#F59E0B' }}>
          ⚠ Configure seus custos reais (COGS por produto, frete, taxas) em Calculadora de Lucro para ver margem real.
        </div>
      )}
    </motion.div>
  )
}
