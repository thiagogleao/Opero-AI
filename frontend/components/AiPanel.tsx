'use client'
import { useState, useEffect } from 'react'
import { motion } from 'framer-motion'
import { useTr } from '@/lib/translations'
import AgentChat from './AgentChat'

interface Insight {
  type: 'kill' | 'scale' | 'creative' | 'urgent' | 'warning' | 'opportunity' | 'tip'
  title: string
  detail: string
  action: string
}

const CACHE_TTL_MS = 6 * 60 * 60 * 1000 // 6 hours

interface CachedInsights {
  insights: Insight[]
  generatedAt: number
}

function loadCache(key: string): CachedInsights | null {
  try {
    const raw = localStorage.getItem(`opero_insights_${key}`)
    if (!raw) return null
    const parsed: CachedInsights = JSON.parse(raw)
    if (Date.now() - parsed.generatedAt > CACHE_TTL_MS) return null
    return parsed
  } catch { return null }
}

function saveCache(key: string, insights: Insight[]) {
  try {
    localStorage.setItem(`opero_insights_${key}`, JSON.stringify({ insights, generatedAt: Date.now() }))
  } catch {}
}

interface Props { systemPrompt: string; cacheKey: string }

const TYPE_COLORS = {
  kill:        { color: '#F43F5E', bg: 'rgba(244,63,94,0.10)',  border: 'rgba(244,63,94,0.35)'  },
  scale:       { color: '#10B981', bg: 'rgba(16,185,129,0.10)', border: 'rgba(16,185,129,0.35)' },
  creative:    { color: '#38BDF8', bg: 'rgba(56,189,248,0.08)', border: 'rgba(56,189,248,0.28)' },
  urgent:      { color: '#FB923C', bg: 'rgba(251,146,60,0.08)', border: 'rgba(251,146,60,0.25)' },
  warning:     { color: '#F59E0B', bg: 'rgba(245,158,11,0.08)', border: 'rgba(245,158,11,0.25)' },
  opportunity: { color: '#A78BFA', bg: 'rgba(167,139,250,0.08)', border: 'rgba(167,139,250,0.25)' },
  tip:         { color: '#8B5CF6', bg: 'rgba(139,92,246,0.08)', border: 'rgba(139,92,246,0.25)' },
}

function InsightCard({ insight, index }: { insight: Insight; index: number }) {
  const tr = useTr()
  const cfg = TYPE_COLORS[insight.type] ?? TYPE_COLORS.tip
  const labelMap: Record<string, string> = {
    kill: '⏹ PARAR',
    scale: '↑ ESCALAR',
    creative: '🎨 CRIATIVO',
    urgent: tr.insight_urgent,
    warning: tr.insight_warning,
    opportunity: tr.insight_opportunity,
    tip: tr.insight_tip,
  }
  return (
    <motion.div initial={{ opacity: 0, y: 12 }} animate={{ opacity: 1, y: 0 }} transition={{ delay: index * 0.08 }}
      style={{ background: cfg.bg, border: `1px solid ${cfg.border}`, borderRadius: 10, padding: '14px 16px' }}>
      <div style={{ display: 'flex', alignItems: 'center', gap: 6, marginBottom: 6 }}>
        <span style={{ fontSize: 10, fontWeight: 700, color: cfg.color, letterSpacing: '0.08em' }}>
          {labelMap[insight.type]}
        </span>
      </div>
      <p style={{ fontSize: 13, fontWeight: 600, color: 'var(--text-primary)', marginBottom: 4, lineHeight: 1.4 }}>{insight.title}</p>
      <p style={{ fontSize: 12, color: 'var(--text-muted)', lineHeight: 1.6, marginBottom: 8 }}>{insight.detail}</p>
      <p style={{ fontSize: 11, color: cfg.color, fontWeight: 500 }}>→ {insight.action}</p>
    </motion.div>
  )
}

function SkeletonCard() {
  return (
    <motion.div style={{ background: 'var(--bg-hover)', border: '1px solid var(--border)', borderRadius: 10, padding: '14px 16px' }}
      animate={{ opacity: [0.4, 0.7, 0.4] }} transition={{ duration: 1.6, repeat: Infinity }}>
      <div style={{ height: 10, width: '30%', background: 'var(--border-strong)', borderRadius: 4, marginBottom: 8 }} />
      <div style={{ height: 14, width: '70%', background: 'var(--border-strong)', borderRadius: 4, marginBottom: 6 }} />
      <div style={{ height: 11, width: '90%', background: 'var(--border)', borderRadius: 4, marginBottom: 4 }} />
      <div style={{ height: 11, width: '60%', background: 'var(--border)', borderRadius: 4, marginBottom: 8 }} />
      <div style={{ height: 10, width: '45%', background: 'var(--border-strong)', borderRadius: 4 }} />
    </motion.div>
  )
}

export default function AiPanel({ systemPrompt, cacheKey }: Props) {
  const tr = useTr()
  const [insights, setInsights] = useState<Insight[]>([])
  const [loading, setLoading] = useState(false)
  const [insightError, setInsightError] = useState('')
  const [generatedAt, setGeneratedAt] = useState<number | null>(null)

  async function loadInsights(forceRefresh = false) {
    if (!forceRefresh) {
      const cached = loadCache(cacheKey)
      if (cached) {
        setInsights(cached.insights)
        setGeneratedAt(cached.generatedAt)
        return
      }
    }
    setLoading(true); setInsights([]); setInsightError('')
    try {
      const res = await fetch('/api/ai', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ mode: 'insights', systemPrompt }) })
      const data = await res.json()
      if (data.error && (!data.insights || data.insights.length === 0)) {
        setInsightError(data.error)
      } else {
        const fresh = data.insights ?? []
        setInsights(fresh)
        setGeneratedAt(Date.now())
        saveCache(cacheKey, fresh)
      }
    } catch (err: unknown) {
      setInsightError(err instanceof Error ? err.message : tr.refresh_error_conn)
    }
    setLoading(false)
  }

  useEffect(() => { loadInsights(false) }, [cacheKey])

  return (
    <motion.div initial={{ opacity: 0, y: 20 }} animate={{ opacity: 1, y: 0 }} transition={{ duration: 0.5, delay: 0.7 }}
      style={{ background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, overflow: 'hidden', marginBottom: 12 }}>

      <div style={{ padding: '14px 20px', borderBottom: '1px solid var(--border)', display: 'flex', justifyContent: 'space-between', alignItems: 'center', background: 'linear-gradient(90deg,rgba(139,92,246,0.07),transparent)' }}>
        <div style={{ display: 'flex', alignItems: 'center', gap: 10 }}>
          <div style={{ width: 30, height: 30, borderRadius: 8, background: 'linear-gradient(135deg,#8B5CF6,#6D28D9)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 14 }}>✦</div>
          <div>
            <h3 style={{ color: 'var(--text-primary)', fontWeight: 700, fontSize: 14 }}>{tr.ai_title}</h3>
            <p style={{ color: 'var(--text-ghost)', fontSize: 11 }}>
              {generatedAt
                ? `Gerado ${Math.round((Date.now() - generatedAt) / 60000)}min atrás · salvo por 6h`
                : tr.ai_subtitle}
            </p>
          </div>
        </div>
        <button onClick={() => loadInsights(true)} disabled={loading} style={{ background: 'rgba(139,92,246,0.1)', border: '1px solid rgba(139,92,246,0.25)', borderRadius: 7, padding: '5px 12px', fontSize: 12, color: '#A78BFA', cursor: loading ? 'not-allowed' : 'pointer', opacity: loading ? 0.5 : 1, fontWeight: 500 }}>
          {loading ? tr.ai_refreshing : tr.ai_refresh}
        </button>
      </div>

      <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', minHeight: 420 }}>
        {/* Insights */}
        <div style={{ padding: 16, borderRight: '1px solid var(--border)' }}>
          <p style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase', marginBottom: 12 }}>
            {tr.ai_insights_title}
          </p>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: 8 }}>
            {loading
              ? [0, 1, 2, 3].map(i => <SkeletonCard key={i} />)
              : insightError
              ? <div style={{ gridColumn: '1/-1', padding: '20px 0', color: '#F43F5E', fontSize: 12 }}>
                  {tr.ai_error}: {insightError}
                  <button onClick={loadInsights} style={{ marginLeft: 10, color: '#A78BFA', background: 'none', border: 'none', cursor: 'pointer', fontSize: 12 }}>{tr.ai_retry}</button>
                </div>
              : insights.length === 0
              ? <div style={{ gridColumn: '1/-1', padding: '32px 0', textAlign: 'center' }}>
                  <p style={{ color: 'var(--text-faint)', fontSize: 13, marginBottom: 12 }}>Nenhuma análise gerada ainda</p>
                  <button onClick={() => loadInsights(true)} style={{ background: 'rgba(139,92,246,0.15)', border: '1px solid rgba(139,92,246,0.3)', borderRadius: 8, padding: '8px 20px', color: '#A78BFA', cursor: 'pointer', fontSize: 13, fontWeight: 600 }}>✦ Gerar análise agora</button>
                </div>
              : insights.map((ins, i) => <InsightCard key={i} insight={ins} index={i} />)
            }
          </div>
        </div>

        {/* Agent Chat */}
        <div style={{ display: 'flex', flexDirection: 'column' }}>
          <div style={{ padding: '10px 16px', borderBottom: '1px solid var(--border)' }}>
            <p style={{ fontSize: 10, color: 'var(--text-faint)', fontWeight: 700, letterSpacing: '0.1em', textTransform: 'uppercase' }}>
              Copiloto — Pergunte ou peça ações
            </p>
          </div>
          <AgentChat systemPrompt={systemPrompt} />
        </div>
      </div>
    </motion.div>
  )
}
