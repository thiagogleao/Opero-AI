'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import type { BreakdownRow } from '@/lib/queries'

interface Props {
  device: BreakdownRow[]
  placement: BreakdownRow[]
  ageGender: BreakdownRow[]
  days: number
}

type Tab = 'device' | 'placement' | 'age_gender'

const TABS: { key: Tab; label: string }[] = [
  { key: 'device',     label: 'Device'    },
  { key: 'placement',  label: 'Placement' },
  { key: 'age_gender', label: 'Idade/Gênero' },
]

function fmt(n: number) {
  return n >= 1000 ? `$${(n / 1000).toFixed(1)}k` : `$${n.toFixed(0)}`
}

function RoasBadge({ roas }: { roas: number }) {
  const color = roas >= 3 ? '#10B981' : roas >= 1.5 ? '#F59E0B' : '#F43F5E'
  const bg    = roas >= 3 ? 'rgba(16,185,129,0.12)' : roas >= 1.5 ? 'rgba(245,158,11,0.12)' : 'rgba(244,63,94,0.12)'
  return (
    <span style={{ background: bg, color, fontSize: 11, fontWeight: 600, padding: '2px 6px', borderRadius: 5 }}>
      {roas.toFixed(2)}x
    </span>
  )
}

function BreakdownList({ rows }: { rows: BreakdownRow[] }) {
  if (rows.length === 0) {
    return (
      <div style={{ padding: '28px 0', textAlign: 'center' }}>
        <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>
          Sem dados — breakdowns disponíveis a partir da próxima coleta
        </p>
      </div>
    )
  }
  const maxSpend = Math.max(...rows.map(r => Number(r.spend)), 1)
  return (
    <div>
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 110px 80px 60px 60px', gap: 0, padding: '4px 6px', fontSize: 10, color: 'var(--text-ghost)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase', borderBottom: '1px solid var(--border)' }}>
        <span>Segmento</span>
        <span>Gasto</span>
        <span style={{ textAlign: 'right' }}>Receita</span>
        <span style={{ textAlign: 'right' }}>CTR</span>
        <span style={{ textAlign: 'right' }}>ROAS</span>
      </div>
      {rows.map((row, i) => {
        const spend  = Number(row.spend)
        const spendPct = maxSpend > 0 ? (spend / maxSpend) * 100 : 0
        return (
          <div key={row.label} style={{ display: 'grid', gridTemplateColumns: '1fr 110px 80px 60px 60px', alignItems: 'center', padding: '8px 6px', borderBottom: i < rows.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none' }}>
            <span style={{ fontSize: 12, color: 'var(--text-secondary)', fontWeight: 500 }}>{row.label}</span>
            <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
              <div style={{ width: 44, height: 3, background: 'var(--border)', borderRadius: 2, overflow: 'hidden' }}>
                <div style={{ width: `${spendPct}%`, height: '100%', background: '#8B5CF6', borderRadius: 2 }} />
              </div>
              <span style={{ fontSize: 11, color: 'var(--text-muted)' }}>{fmt(spend)}</span>
            </div>
            <span style={{ textAlign: 'right', fontSize: 11, color: '#10B981', fontWeight: 500 }}>{fmt(Number(row.revenue))}</span>
            <span style={{ textAlign: 'right', fontSize: 11, color: 'var(--text-muted)' }}>{Number(row.ctr).toFixed(1)}%</span>
            <div style={{ textAlign: 'right' }}><RoasBadge roas={Number(row.roas)} /></div>
          </div>
        )
      })}
    </div>
  )
}

export default function BreakdownTabs({ device, placement, ageGender, days }: Props) {
  const [tab, setTab] = useState<Tab>('device')

  const dataMap: Record<Tab, BreakdownRow[]> = {
    device,
    placement,
    age_gender: ageGender,
  }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.5 }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 14 }}>
        <div>
          <h3 style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>Breakdowns FB Ads</h3>
          <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 2 }}>
            Gasto + ROAS por segmento · últimos 14 dias
          </p>
        </div>
        <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 3, gap: 2 }}>
          {TABS.map(t => (
            <button key={t.key} onClick={() => setTab(t.key)} style={{
              padding: '4px 12px', borderRadius: 6, fontSize: 11, fontWeight: 600,
              border: 'none', cursor: 'pointer', transition: 'all 0.15s',
              background: tab === t.key ? 'rgba(139,92,246,0.2)' : 'transparent',
              color: tab === t.key ? '#A78BFA' : 'var(--text-faint)',
            }}>{t.label}</button>
          ))}
        </div>
      </div>
      <AnimatePresence mode="wait">
        <motion.div key={tab} initial={{ opacity: 0, y: 4 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -4 }} transition={{ duration: 0.12 }}>
          <BreakdownList rows={dataMap[tab]} />
        </motion.div>
      </AnimatePresence>
    </motion.div>
  )
}
