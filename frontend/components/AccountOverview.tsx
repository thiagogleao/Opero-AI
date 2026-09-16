'use client'
import { useState } from 'react'
import { useRouter } from 'next/navigation'
import { motion } from 'framer-motion'
import MetricCard from './MetricCard'
import DailyProfitChart from './DailyProfitChart'
import { makeFmt } from '@/lib/format'
import { useSettings } from '@/contexts/SettingsContext'
import type { AccountOverview as Overview } from '@/lib/accountOverview'

interface Props {
  data: Overview
  days: number
}

function marginColor(margin: number) {
  return margin >= 20 ? '#10B981' : margin >= 10 ? '#F59E0B' : '#F43F5E'
}

export default function AccountOverview({ data, days }: Props) {
  const { currency } = useSettings()
  const fmt = makeFmt(currency)
  const router = useRouter()
  const [switching, setSwitching] = useState<string | null>(null)

  const { totals, stores, daily, unconfigured, failed } = data

  /** Open one store's own dashboard — same cookie the switcher writes. */
  async function openStore(storeId: string) {
    setSwitching(storeId)
    await fetch('/api/active-store', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ storeId }),
    })
    router.push('/')
  }

  // Bars are scaled to the biggest absolute profit so a loss-making store reads
  // as clearly as the best one.
  const maxAbsProfit = Math.max(1, ...stores.map(s => Math.abs(s.profit)))

  return (
    <>
      {/* Account-wide profit */}
      <motion.div
        initial={{ opacity: 0, y: 12 }}
        animate={{ opacity: 1, y: 0 }}
        transition={{ duration: 0.4 }}
        style={{
          background: 'linear-gradient(135deg, rgba(16,185,129,0.08) 0%, rgba(139,92,246,0.08) 100%)',
          border: '1px solid rgba(16,185,129,0.25)',
          borderRadius: 12, padding: '18px 22px', marginBottom: 20,
          display: 'flex', alignItems: 'center',
        }}
      >
        <div style={{ flex: 1.2, display: 'flex', alignItems: 'center', gap: 10, borderRight: '1px solid var(--border)', paddingRight: 20 }}>
          <span style={{ fontSize: 22 }}>🏦</span>
          <div>
            <p style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 500, marginBottom: 2 }}>
              Lucro da conta ({stores.length} lojas)
            </p>
            <p style={{ fontSize: 30, fontWeight: 700, letterSpacing: '-0.6px', color: totals.profit >= 0 ? '#10B981' : '#F43F5E' }}>
              {fmt(totals.profit)}
            </p>
          </div>
        </div>
        <div style={{ flex: 1, borderRight: '1px solid var(--border)', padding: '0 20px' }}>
          <p style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 500, marginBottom: 2 }}>Margem</p>
          <p style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.5px', color: marginColor(totals.margin) }}>
            {totals.revenue > 0 ? `${totals.margin.toFixed(1)}%` : '—'}
          </p>
        </div>
        <div style={{ flex: 1, borderRight: '1px solid var(--border)', padding: '0 20px' }}>
          <p style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 500, marginBottom: 2 }}>Lucro por pedido</p>
          <p style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.5px', color: totals.profit >= 0 ? '#A78BFA' : '#F43F5E' }}>
            {totals.orders > 0 ? fmt(totals.profit / totals.orders) : '—'}
          </p>
        </div>
        <div style={{ flex: 1, paddingLeft: 20 }}>
          <p style={{ fontSize: 11, color: 'var(--text-dim)', fontWeight: 500, marginBottom: 2 }}>ROAS real</p>
          <p style={{ fontSize: 24, fontWeight: 700, letterSpacing: '-0.5px', color: '#38BDF8' }}>
            {totals.roas > 0 ? `${totals.roas.toFixed(2)}x` : '—'}
          </p>
        </div>
      </motion.div>

      {(unconfigured.length > 0 || failed.length > 0) && (
        <div style={{
          background: 'rgba(245,158,11,0.06)', border: '1px dashed rgba(245,158,11,0.3)',
          borderRadius: 10, padding: '10px 16px', marginBottom: 20, fontSize: 12, color: '#F59E0B',
        }}>
          {unconfigured.length > 0 && (
            <p>
              ⚠️ Sem custos configurados em: <b>{unconfigured.join(', ')}</b> — o lucro dessas lojas
              conta só receita − anúncios. Configure na aba Lucro para o total ficar real.
            </p>
          )}
          {failed.length > 0 && (
            <p style={{ marginTop: unconfigured.length > 0 ? 6 : 0, color: '#F43F5E' }}>
              ✗ Não foi possível ler os dados de: <b>{failed.join(', ')}</b> — essas lojas entram como zero no total.
            </p>
          )}
        </div>
      )}

      <div style={{
        display: 'grid', gridTemplateColumns: 'repeat(auto-fit, minmax(170px, 1fr))',
        gap: 12, marginBottom: 20,
      }}>
        <MetricCard title="Receita"          value={fmt(totals.revenue)}                   sub={`${stores.length} lojas somadas`}   icon="💰" gradient="linear-gradient(135deg,#10B981,#059669)" delay={0}    />
        <MetricCard title="Pedidos"          value={String(totals.orders)}                 sub={`Ticket médio ${fmt(totals.aov)}`}  icon="🛒" gradient="linear-gradient(135deg,#8B5CF6,#6D28D9)" delay={0.07} />
        <MetricCard title="Anúncios"         value={fmt(totals.adSpend)}                   sub="Gasto Facebook"                     icon="📣" gradient="linear-gradient(135deg,#F59E0B,#D97706)" delay={0.14} />
        <MetricCard title="Receita líquida"  value={fmt(totals.revenue - totals.adSpend)}  sub="Receita − anúncios"                 icon="📈" gradient="linear-gradient(135deg,#38BDF8,#0284C7)" delay={0.21} />
      </div>

      {daily.length > 1 && (
        <div style={{ marginBottom: 20 }}>
          <DailyProfitChart data={daily} days={days} />
        </div>
      )}

      {/* Per-store breakdown */}
      <div style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden' }}>
        <div style={{ padding: '16px 20px', borderBottom: '1px solid var(--border)' }}>
          <h2 style={{ fontSize: 14, fontWeight: 700, color: 'var(--text-primary)' }}>Lucro por loja</h2>
          <p style={{ fontSize: 11, color: 'var(--text-faint)', marginTop: 2 }}>
            Clique numa loja para abrir o dashboard dela
          </p>
        </div>

        <div style={{ overflowX: 'auto' }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
            <thead>
              <tr style={{ color: 'var(--text-faint)', fontSize: 10, textTransform: 'uppercase', letterSpacing: '0.06em' }}>
                <th style={{ textAlign: 'left',  padding: '10px 20px', fontWeight: 600 }}>Loja</th>
                <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600 }}>Receita</th>
                <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600 }}>Anúncios</th>
                <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600 }}>Pedidos</th>
                <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600 }}>ROAS</th>
                <th style={{ textAlign: 'right', padding: '10px 12px', fontWeight: 600 }}>Margem</th>
                <th style={{ textAlign: 'right', padding: '10px 20px', fontWeight: 600 }}>Lucro</th>
              </tr>
            </thead>
            <tbody>
              {stores.map(s => (
                <tr
                  key={s.id}
                  onClick={() => openStore(s.id)}
                  style={{
                    borderTop: '1px solid var(--border)',
                    cursor: switching ? 'wait' : 'pointer',
                    opacity: switching && switching !== s.id ? 0.5 : 1,
                  }}
                >
                  <td style={{ padding: '12px 20px', color: 'var(--text-primary)', fontWeight: 600 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 8 }}>
                      <span style={{
                        width: 6, height: 6, borderRadius: '50%', flexShrink: 0,
                        background: s.failed ? '#F43F5E' : s.profit >= 0 ? '#10B981' : '#F59E0B',
                      }} />
                      <span>
                        {s.name}
                        {!s.configured && !s.failed && (
                          <span style={{ color: '#F59E0B', fontWeight: 500, marginLeft: 6, fontSize: 10 }}>
                            sem custos
                          </span>
                        )}
                        {s.domain && (
                          <span style={{ display: 'block', fontSize: 10, color: 'var(--text-faint)', fontWeight: 400 }}>
                            {s.domain.replace('.myshopify.com', '')}
                          </span>
                        )}
                      </span>
                    </div>
                  </td>
                  <td style={{ padding: 12, textAlign: 'right', color: 'var(--text-secondary)' }}>{fmt(s.revenue)}</td>
                  <td style={{ padding: 12, textAlign: 'right', color: 'var(--text-muted)' }}>{fmt(s.adSpend)}</td>
                  <td style={{ padding: 12, textAlign: 'right', color: 'var(--text-muted)' }}>{s.orders}</td>
                  <td style={{ padding: 12, textAlign: 'right', color: 'var(--text-muted)' }}>
                    {s.roas > 0 ? `${s.roas.toFixed(2)}x` : '—'}
                  </td>
                  <td style={{ padding: 12, textAlign: 'right', color: marginColor(s.margin), fontWeight: 600 }}>
                    {s.revenue > 0 ? `${s.margin.toFixed(1)}%` : '—'}
                  </td>
                  <td style={{ padding: '12px 20px', textAlign: 'right' }}>
                    <span style={{ color: s.profit >= 0 ? '#10B981' : '#F43F5E', fontWeight: 700, fontSize: 13 }}>
                      {fmt(s.profit)}
                    </span>
                    <span style={{
                      display: 'block', marginTop: 4, marginLeft: 'auto',
                      height: 3, borderRadius: 2,
                      width: `${Math.max(2, (Math.abs(s.profit) / maxAbsProfit) * 100)}%`,
                      background: s.profit >= 0 ? '#10B981' : '#F43F5E', opacity: 0.5,
                    }} />
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '1px solid var(--border-strong)', background: 'var(--bg-hover)' }}>
                <td style={{ padding: '12px 20px', fontWeight: 700, color: 'var(--text-primary)' }}>Total da conta</td>
                <td style={{ padding: 12, textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>{fmt(totals.revenue)}</td>
                <td style={{ padding: 12, textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>{fmt(totals.adSpend)}</td>
                <td style={{ padding: 12, textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>{totals.orders}</td>
                <td style={{ padding: 12, textAlign: 'right', fontWeight: 700, color: 'var(--text-primary)' }}>
                  {totals.roas > 0 ? `${totals.roas.toFixed(2)}x` : '—'}
                </td>
                <td style={{ padding: 12, textAlign: 'right', fontWeight: 700, color: marginColor(totals.margin) }}>
                  {totals.revenue > 0 ? `${totals.margin.toFixed(1)}%` : '—'}
                </td>
                <td style={{ padding: '12px 20px', textAlign: 'right', fontWeight: 700, fontSize: 13, color: totals.profit >= 0 ? '#10B981' : '#F43F5E' }}>
                  {fmt(totals.profit)}
                </td>
              </tr>
            </tfoot>
          </table>
        </div>
      </div>
    </>
  )
}
