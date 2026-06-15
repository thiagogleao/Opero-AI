'use client'
import { useState, useEffect, useCallback } from 'react'
import { motion } from 'framer-motion'
import { makeFmt } from '@/lib/format'
import { useSettings } from '@/contexts/SettingsContext'

interface CampaignRow {
  campaign_id: string
  campaign_name: string
  spend: number
  fb_revenue: number
  purchases: number
  roas: number
  fb_profit: number
  fb_margin: number
  attributed_revenue: number
  real_profit: number
  real_margin: number
  configured: boolean
}

interface ApiResponse {
  campaigns: CampaignRow[]
  nonFbCostRate: number
  configured: boolean
  hasBreakdownData: boolean
  totalNetProfit: number
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

function ProfitBadge({ value, fmt }: { value: number; fmt: (n: number) => string }) {
  const color = value > 0 ? '#10B981' : value < 0 ? '#F43F5E' : 'var(--text-muted)'
  const bg    = value > 0 ? 'rgba(16,185,129,0.1)' : value < 0 ? 'rgba(244,63,94,0.1)' : 'transparent'
  return (
    <span style={{ display: 'inline-block', padding: '2px 8px', borderRadius: 5, background: bg, color, fontWeight: 700, fontSize: 12 }}>
      {fmt(value)}
    </span>
  )
}

export default function CampaignProfitTable() {
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
      const res = await fetch(`/api/profit/campaigns?dateFrom=${from}&dateTo=${to}`)
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

  const rows = data?.campaigns ?? []

  return (
    <motion.div
      initial={{ opacity: 0, y: 16 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.4, delay: 0.1 }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 24 }}
    >
      {/* Header */}
      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
        <div>
          <h3 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Lucro por Campanha</h3>
          <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            {data?.configured
              ? `Lucro FB = receita atribuída pelo Meta · Lucro Real = receita Shopify por país alocada à campanha${data.hasBreakdownData ? ' (por país)' : ' (proporcional ao gasto)'} · normalizado ao lucro total`
              : 'Configure custos em Calculadora de Lucro para ver margem estimada'}
          </p>
        </div>
        <div style={{ display: 'flex', gap: 6 }}>
          {PRESETS.map(p => (
            <button key={p.days} onClick={() => applyPreset(p.days)} style={{
              padding: '4px 10px', fontSize: 11, borderRadius: 6, fontWeight: 600, cursor: 'pointer',
              background: activePreset === p.days ? 'rgba(139,92,246,0.2)' : 'var(--bg-hover)',
              border: `1px solid ${activePreset === p.days ? 'rgba(139,92,246,0.4)' : 'var(--border)'}`,
              color: activePreset === p.days ? '#A78BFA' : 'var(--text-muted)',
            }}>
              {p.label}
            </button>
          ))}
        </div>
      </div>

      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '1px solid var(--border)' }}>
              {[
                { label: 'Campanha',       align: 'left'  },
                { label: 'Gasto FB',       align: 'right' },
                { label: 'Receita FB',     align: 'right' },
                { label: 'ROAS',           align: 'right' },
                { label: 'Lucro FB',       align: 'right', hint: 'Baseado na receita que o Meta atribuiu' },
                { label: 'Receita Real',   align: 'right', hint: 'Receita Shopify dos países que a campanha atingiu' },
                { label: 'Lucro Real Est.',align: 'right', hint: 'Lucro usando receita Shopify real (normalizado ao total)' },
                { label: 'Margem Real',    align: 'right' },
              ].map(h => (
                <th key={h.label} title={h.hint} style={{
                  padding: '8px 14px',
                  textAlign: h.align as 'left' | 'right',
                  color: h.hint ? '#A78BFA' : 'var(--text-faint)',
                  fontWeight: 600, fontSize: 10, letterSpacing: '0.06em',
                  textTransform: 'uppercase', whiteSpace: 'nowrap',
                  cursor: h.hint ? 'help' : 'default',
                }}>
                  {h.label}{h.hint ? ' ⓘ' : ''}
                </th>
              ))}
            </tr>
          </thead>
          <tbody>
            {loading ? (
              [0,1,2,3].map(i => (
                <tr key={i} style={{ borderBottom: '1px solid var(--border)' }}>
                  {Array(8).fill(0).map((_, j) => (
                    <td key={j} style={{ padding: '10px 14px' }}>
                      <div style={{ height: 12, background: 'var(--bg-hover)', borderRadius: 4, width: j === 0 ? '60%' : '45%' }} />
                    </td>
                  ))}
                </tr>
              ))
            ) : rows.length === 0 ? (
              <tr>
                <td colSpan={8} style={{ padding: '32px 16px', textAlign: 'center', color: 'var(--text-faint)', fontSize: 13 }}>
                  Nenhuma campanha com gasto no período
                </td>
              </tr>
            ) : rows.map((row, i) => {
              const fbProfitColor   = row.fb_profit > 0 ? '#10B981' : '#F43F5E'
              const realProfitColor = row.real_profit > 0 ? '#10B981' : '#F43F5E'
              const roasColor       = row.roas >= 2 ? '#10B981' : row.roas >= 1 ? '#F59E0B' : '#F43F5E'
              return (
                <tr key={row.campaign_id} style={{ borderBottom: '1px solid var(--border)', background: i % 2 === 0 ? 'transparent' : 'rgba(255,255,255,0.01)' }}>
                  <td style={{ padding: '10px 14px', color: 'var(--text-primary)', fontWeight: 500, maxWidth: 240, overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>
                    <span title={row.campaign_name}>{row.campaign_name}</span>
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--text-secondary)' }}>{fmt(row.spend)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--text-muted)' }}>{fmt(row.fb_revenue)}</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 600, color: roasColor }}>{row.roas.toFixed(2)}x</td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: row.configured ? fbProfitColor : 'var(--text-ghost)' }}>
                    {row.configured ? fmt(row.fb_profit) : '—'}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--text-secondary)' }}>
                    {fmt(row.attributed_revenue)}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right' }}>
                    {row.configured
                      ? <ProfitBadge value={row.real_profit} fmt={fmt} />
                      : <span style={{ color: 'var(--text-ghost)' }}>—</span>}
                  </td>
                  <td style={{ padding: '10px 14px', textAlign: 'right', color: row.configured ? realProfitColor : 'var(--text-ghost)', fontSize: 11 }}>
                    {row.configured ? `${row.real_margin.toFixed(1)}%` : '—'}
                  </td>
                </tr>
              )
            })}
          </tbody>
          {data?.configured && rows.length > 0 && (
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border)', background: 'rgba(139,92,246,0.04)' }}>
                <td style={{ padding: '10px 14px', fontWeight: 700, color: 'var(--text-primary)', fontSize: 11 }}>TOTAL</td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)', fontSize: 11 }}>
                  {fmt(rows.reduce((s, r) => s + r.spend, 0))}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--text-muted)', fontSize: 11 }}>
                  {fmt(rows.reduce((s, r) => s + r.fb_revenue, 0))}
                </td>
                <td />
                <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 11, color: rows.reduce((s, r) => s + r.fb_profit, 0) > 0 ? '#10B981' : '#F43F5E', fontWeight: 600 }}>
                  {fmt(rows.reduce((s, r) => s + r.fb_profit, 0))}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', color: 'var(--text-muted)', fontSize: 11 }}>
                  {fmt(rows.reduce((s, r) => s + r.attributed_revenue, 0))}
                </td>
                <td style={{ padding: '10px 14px', textAlign: 'right', fontSize: 11 }}>
                  <ProfitBadge value={rows.reduce((s, r) => s + r.real_profit, 0)} fmt={fmt} />
                </td>
                <td />
              </tr>
            </tfoot>
          )}
        </table>
      </div>

      {!data?.configured && rows.length > 0 && (
        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', background: 'rgba(245,158,11,0.05)', fontSize: 11, color: '#F59E0B' }}>
          ⚠ Configure seus custos reais (COGS, frete, taxas) em Calculadora de Lucro para ver o lucro estimado real.
        </div>
      )}
      {data?.configured && !data.hasBreakdownData && rows.length > 0 && (
        <div style={{ padding: '10px 20px', borderTop: '1px solid var(--border)', background: 'rgba(56,189,248,0.05)', fontSize: 11, color: '#38BDF8' }}>
          ℹ Dados de breakdown por país não encontrados — Receita Real alocada proporcionalmente ao gasto total de cada campanha.
        </div>
      )}
    </motion.div>
  )
}
