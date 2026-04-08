'use client'
import { useState } from 'react'
import { motion, AnimatePresence } from 'framer-motion'
import { useTr } from '@/lib/translations'

interface Creative {
  ad_id: string; name: string; spend: number
  revenue: number; roas: number; ctr: number; purchases: number; score: number
}

interface Props { data: Creative[]; days: number; breakEvenRoas?: number }

const PAGE_SIZE = 8

function RoasBadge({ roas }: { roas: number }) {
  const r = Number(roas)
  const color = r >= 3 ? '#10B981' : r >= 1.5 ? '#F59E0B' : '#F43F5E'
  const bg    = r >= 3 ? 'rgba(16,185,129,0.12)' : r >= 1.5 ? 'rgba(245,158,11,0.12)' : 'rgba(244,63,94,0.12)'
  return (
    <span style={{ background: bg, color, fontSize: 12, fontWeight: 600, padding: '3px 8px', borderRadius: 6 }}>
      {r.toFixed(2)}x
    </span>
  )
}

function SpendBar({ spend, maxSpend }: { spend: number; maxSpend: number }) {
  const pct   = maxSpend > 0 ? Math.max((spend / maxSpend) * 100, 2) : 0
  const color = spend >= 50 ? '#8B5CF6' : spend >= 15 ? '#F59E0B' : 'var(--text-faint)'
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
      <div style={{ width: 40, height: 4, background: 'var(--border)', borderRadius: 2, overflow: 'hidden', flexShrink: 0 }}>
        <div style={{ width: `${pct}%`, height: '100%', background: color, borderRadius: 2 }} />
      </div>
      <span style={{ fontSize: 12, color: 'var(--text-muted)', minWidth: 44, textAlign: 'right' }}>
        ${Number(spend).toLocaleString()}
      </span>
    </div>
  )
}

function ActionBadge({ verdict }: { verdict: 'off' | 'review' | 'scale' }) {
  const tr = useTr()
  const cfg = {
    off:    { label: tr.action_off,    color: '#F43F5E', bg: 'rgba(244,63,94,0.12)',  border: 'rgba(244,63,94,0.3)'  },
    review: { label: tr.action_review, color: '#F59E0B', bg: 'rgba(245,158,11,0.1)', border: 'rgba(245,158,11,0.3)' },
    scale:  { label: tr.action_scale,  color: '#10B981', bg: 'rgba(16,185,129,0.1)', border: 'rgba(16,185,129,0.3)' },
  }[verdict]
  return (
    <span style={{ fontSize: 10, fontWeight: 600, color: cfg.color, background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 5, padding: '2px 6px', whiteSpace: 'nowrap' }}>
      {cfg.label}
    </span>
  )
}

const COLS = '1fr 100px 76px 70px 46px 88px'

function TableHeader() {
  const tr = useTr()
  return (
    <div style={{ display: 'grid', gridTemplateColumns: COLS, padding: '5px 8px', fontSize: 10, color: 'var(--text-faint)', fontWeight: 600, letterSpacing: '0.06em', textTransform: 'uppercase' }}>
      <span>{tr.creative_id}</span>
      <span>{tr.creative_spend}</span>
      <span style={{ textAlign: 'right' }}>{tr.creative_revenue}</span>
      <span style={{ textAlign: 'right' }}>ROAS</span>
      <span style={{ textAlign: 'right' }}>CTR</span>
      <span style={{ textAlign: 'right' }}>{tr.settings_display}</span>
    </div>
  )
}

export default function CreativesTable({ data, days, breakEvenRoas = 1.5 }: Props) {
  const tr = useTr()
  const [view, setView] = useState<'best' | 'worst'>('best')
  const [page, setPage] = useState(0)

  function getVerdict(spend: number, score: number, roas: number): 'off' | 'review' | 'scale' | null {
    if (spend < 15) return null
    if (score < 0 || roas < 1)                                    return 'off'
    if (roas < breakEvenRoas && spend >= 30)                       return 'review'
    if (score > 0 && roas >= breakEvenRoas * 1.5 && spend >= 30)  return 'scale'
    return null
  }

  const worst = data
    .filter(c => { const v = getVerdict(Number(c.spend), Number(c.score), Number(c.roas)); return v === 'off' || v === 'review' })
    .sort((a, b) => Number(b.spend) - Number(a.spend))

  const best = data
    .filter(c => !worst.includes(c))
    .sort((a, b) => Number(b.score) - Number(a.score))

  const list       = view === 'best' ? best : worst
  const totalPages = Math.ceil(list.length / PAGE_SIZE)
  const safePage   = Math.min(page, Math.max(0, totalPages - 1))
  const visible    = list.slice(safePage * PAGE_SIZE, (safePage + 1) * PAGE_SIZE)

  const maxSpend = Math.max(...data.map(c => Number(c.spend)), 1)
  const maxScore = Math.max(...data.filter(c => Number(c.score) > 0).map(c => Number(c.score)), 1)

  function switchView(v: 'best' | 'worst') { setView(v); setPage(0) }

  return (
    <motion.div
      initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }}
      transition={{ duration: 0.5, delay: 0.55 }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: 20 }}
    >
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 14 }}>
        <div>
          <h3 style={{ fontWeight: 600, color: 'var(--text-primary)', fontSize: 15 }}>{tr.chart_creatives_title}</h3>
          <p style={{ color: 'var(--text-faint)', fontSize: 12, marginTop: 2 }}>
            {tr.chart_creatives_sub} · {days} {tr.days}
          </p>
        </div>
        <div style={{ display: 'flex', background: 'var(--bg)', border: '1px solid var(--border)', borderRadius: 8, padding: 3, gap: 2 }}>
          {(['best', 'worst'] as const).map(v => (
            <button key={v} onClick={() => switchView(v)} style={{
              padding: '5px 14px', borderRadius: 6, fontSize: 12, fontWeight: 600,
              border: 'none', cursor: 'pointer', transition: 'all 0.15s',
              background: view === v ? (v === 'best' ? 'rgba(139,92,246,0.2)' : 'rgba(244,63,94,0.18)') : 'transparent',
              color: view === v ? (v === 'best' ? '#A78BFA' : '#F43F5E') : 'var(--text-faint)',
            }}>
              {v === 'best'
                ? `↑ ${tr.creative_best}${best.length > 0 ? ` (${best.length})` : ''}`
                : `⏹ ${tr.creative_worst}${worst.length > 0 ? ` (${worst.length})` : ''}`}
            </button>
          ))}
        </div>
      </div>

      {data.length === 0 ? (
        <div style={{ padding: '40px 0', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>{tr.no_data}</p>
        </div>
      ) : list.length === 0 ? (
        <div style={{ padding: '30px 0', textAlign: 'center' }}>
          <p style={{ color: 'var(--text-faint)', fontSize: 13 }}>
            {view === 'worst' ? tr.ai_no_insights : tr.no_data}
          </p>
        </div>
      ) : (
        <>
          <TableHeader />
          <AnimatePresence mode="wait">
            <motion.div key={`${view}-${safePage}`} initial={{ opacity: 0, y: 6 }} animate={{ opacity: 1, y: 0 }} exit={{ opacity: 0, y: -6 }} transition={{ duration: 0.15 }}>
              {visible.map((creative, i) => {
                const spend    = Number(creative.spend)
                const score    = Number(creative.score)
                const roas     = Number(creative.roas)
                const scorePct = score > 0 && maxScore > 0 ? (score / maxScore) * 100 : 0
                const lowData  = spend < 15
                const midData  = spend >= 15 && spend < 50
                const verdict  = getVerdict(spend, score, roas)

                return (
                  <div key={creative.ad_id} style={{ display: 'grid', gridTemplateColumns: COLS, padding: '8px 8px', borderRadius: 8, alignItems: 'center', opacity: lowData ? 0.5 : 1, borderBottom: i < visible.length - 1 ? '1px solid rgba(255,255,255,0.03)' : 'none' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: 6, minWidth: 0 }}>
                      <div style={{ width: 3, height: 34, background: 'var(--border)', borderRadius: 2, flexShrink: 0 }}>
                        <div style={{ width: '100%', height: `${Math.max(scorePct, score < 0 ? 100 : 0)}%`, background: score < 0 ? '#F43F5E' : lowData ? 'var(--text-ghost)' : midData ? '#F59E0B' : '#8B5CF6', borderRadius: 2, marginTop: score < 0 ? '0%' : `${100 - scorePct}%` }} />
                      </div>
                      <div style={{ minWidth: 0 }}>
                        <div style={{ fontSize: 12, fontWeight: 500, color: score < 0 ? '#F43F5E' : lowData ? 'var(--text-faint)' : 'var(--text-secondary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis', maxWidth: 190 }}>
                          {creative.name}
                        </div>
                        <div style={{ display: 'flex', gap: 8, marginTop: 2, alignItems: 'center' }}>
                          <span style={{ fontSize: 9, color: 'var(--text-ghost)', fontFamily: 'monospace', background: 'var(--bg)', borderRadius: 3, padding: '1px 4px' }}>
                            {creative.ad_id}
                          </span>
                          <span style={{ fontSize: 10, color: 'var(--text-ghost)' }}>
                            {creative.purchases} {tr.creative_purchases}
                            {lowData && ` · ${tr.creative_insufficient}`}
                          </span>
                        </div>
                      </div>
                    </div>

                    <SpendBar spend={spend} maxSpend={maxSpend} />

                    <span style={{ textAlign: 'right', fontSize: 12, color: score < 0 ? '#F43F5E' : '#10B981', fontWeight: 600 }}>
                      ${Number(creative.revenue).toLocaleString()}
                    </span>
                    <div style={{ textAlign: 'right' }}>
                      <RoasBadge roas={creative.roas} />
                    </div>
                    <span style={{ textAlign: 'right', fontSize: 12, color: 'var(--text-muted)' }}>
                      {Number(creative.ctr).toFixed(1)}%
                    </span>
                    <div style={{ textAlign: 'right' }}>
                      {verdict && <ActionBadge verdict={verdict} />}
                    </div>
                  </div>
                )
              })}
            </motion.div>
          </AnimatePresence>

          {totalPages > 1 && (
            <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginTop: 10, paddingTop: 10, borderTop: '1px solid var(--border)' }}>
              <span style={{ fontSize: 11, color: 'var(--text-faint)' }}>
                {safePage * PAGE_SIZE + 1}–{Math.min((safePage + 1) * PAGE_SIZE, list.length)} {tr.page_of} {list.length}
              </span>
              <div style={{ display: 'flex', gap: 4 }}>
                <button onClick={() => setPage(p => Math.max(0, p - 1))} disabled={safePage === 0}
                  style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '4px 10px', color: safePage === 0 ? 'var(--border-strong)' : 'var(--text-muted)', fontSize: 13, cursor: safePage === 0 ? 'not-allowed' : 'pointer' }}>←</button>
                <span style={{ fontSize: 11, color: 'var(--text-faint)', padding: '4px 8px', lineHeight: '22px' }}>
                  {safePage + 1} / {totalPages}
                </span>
                <button onClick={() => setPage(p => Math.min(totalPages - 1, p + 1))} disabled={safePage >= totalPages - 1}
                  style={{ background: 'var(--bg)', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '4px 10px', color: safePage >= totalPages - 1 ? 'var(--border-strong)' : 'var(--text-muted)', fontSize: 13, cursor: safePage >= totalPages - 1 ? 'not-allowed' : 'pointer' }}>→</button>
              </div>
            </div>
          )}

          <div style={{ display: 'flex', gap: 14, marginTop: 10, fontSize: 10, color: 'var(--text-ghost)' }}>
            {[['#8B5CF6', tr.confidence_high], ['#F59E0B', tr.confidence_mid], ['var(--text-ghost)', tr.confidence_low]].map(([c, l]) => (
              <span key={l} style={{ display: 'flex', alignItems: 'center', gap: 4 }}>
                <span style={{ width: 8, height: 8, borderRadius: 1, background: c, display: 'inline-block' }} />{l}
              </span>
            ))}
          </div>
        </>
      )}
    </motion.div>
  )
}
