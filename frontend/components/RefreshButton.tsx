'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTr } from '@/lib/translations'

type ButtonStatus = 'idle' | 'loading' | 'done' | 'partial' | 'error'
type RunStatus    = 'waiting' | 'running' | 'success' | 'error'

interface SourceRun {
  status: RunStatus
  records: number
  errorMessage: string | null
  startedAt: string | null
  estimatedDurationSeconds: number | null
}
interface SyncProgress {
  shopify:  SourceRun
  facebook: SourceRun
}

// Use local date to avoid UTC-shift bugs on the date picker max attribute
function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n); return toDateStr(d)
}

const EMPTY_RUN: SourceRun = { status: 'waiting', records: 0, errorMessage: null, startedAt: null, estimatedDurationSeconds: null }

/** Classify the most recent sync_run for a source relative to the trigger time. */
function classifyRun(
  run: {
    status: string
    startedAt: string | null
    recordsCollected: number
    errorMessage?: string | null
    estimatedDurationSeconds?: number | null
  } | null,
  triggerMs: number,
): SourceRun {
  if (!run || !run.startedAt) return EMPTY_RUN
  const startedMs = new Date(run.startedAt).getTime()
  // 5 s tolerance for server spawn latency. Runs older than this are from a
  // previous auto-sync and should not be counted as belonging to this click.
  if (startedMs < triggerMs - 5_000) return EMPTY_RUN
  const s = run.status === 'running' ? 'running'
           : run.status === 'success' ? 'success'
           : 'error'
  return {
    status: s,
    records: run.recordsCollected ?? 0,
    errorMessage: run.errorMessage ?? null,
    startedAt: run.startedAt,
    estimatedDurationSeconds: run.estimatedDurationSeconds ?? null,
  }
}

/** Format remaining seconds into a human-readable string. */
function fmtRemaining(seconds: number): string {
  if (seconds <= 5)  return 'finalizando...'
  if (seconds < 60)  return `~${seconds}s`
  return `~${Math.ceil(seconds / 60)}min`
}

// ── Sub-components ──────────────────────────────────────────────────────────

function ProgressBar({ runStatus, color }: { runStatus: RunStatus; color: string }) {
  const track: React.CSSProperties = {
    height: 4, background: '#2A2D35', borderRadius: 2,
    overflow: 'hidden', position: 'relative',
  }
  if (runStatus === 'running' || runStatus === 'waiting') {
    return (
      <div style={track}>
        <style>{`@keyframes bar-slide{0%{transform:translateX(-100%)}100%{transform:translateX(350%)}}`}</style>
        <div style={{
          position: 'absolute', height: '100%', width: '30%',
          background: color, borderRadius: 2, opacity: 0.85,
          animation: runStatus === 'running' ? 'bar-slide 1.1s ease-in-out infinite' : 'none',
        }} />
      </div>
    )
  }
  return (
    <div style={track}>
      <div style={{
        height: '100%', width: '100%', borderRadius: 2,
        background: runStatus === 'success' ? '#10B981' : '#F43F5E',
        transition: 'width 0.3s ease',
      }} />
    </div>
  )
}

function SourceRow({ label, run, color, recordLabel, nowMs }: {
  label: string; run: SourceRun; color: string; recordLabel: string; nowMs: number
}) {
  // ETA / elapsed display while running
  let timeText = ''
  if (run.status === 'running' && run.startedAt) {
    const elapsedSec = Math.max(0, Math.floor((nowMs - new Date(run.startedAt).getTime()) / 1000))
    if (run.estimatedDurationSeconds && run.estimatedDurationSeconds > 0) {
      const remaining = run.estimatedDurationSeconds - elapsedSec
      timeText = remaining > 0 ? fmtRemaining(remaining) : 'finalizando...'
    } else {
      // No historical estimate yet — just show elapsed time
      timeText = elapsedSec >= 60
        ? `${Math.floor(elapsedSec / 60)}min ${elapsedSec % 60}s`
        : `${elapsedSec}s`
    }
  }

  const statusText =
    run.status === 'waiting' ? 'aguardando...' :
    run.status === 'running' ? timeText || 'buscando...' :
    run.status === 'success' ? (run.records > 0 ? `✓ ${run.records} ${recordLabel}` : '✓ concluído') :
    '✗ erro'

  const statusColor =
    run.status === 'success' ? '#10B981' :
    run.status === 'error'   ? '#F43F5E' : '#71717A'

  // Truncate long error messages to keep the panel compact
  const errMsg = run.errorMessage
    ? (run.errorMessage.length > 80 ? run.errorMessage.slice(0, 80) + '…' : run.errorMessage)
    : null

  return (
    <div style={{ marginBottom: 10 }}>
      <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 5 }}>
        <span style={{ fontSize: 12, fontWeight: 600, color: '#A1A1AA' }}>{label}</span>
        <span style={{ fontSize: 11, color: statusColor, transition: 'color 0.2s' }}>{statusText}</span>
      </div>
      <ProgressBar runStatus={run.status} color={color} />
      {run.status === 'error' && errMsg && (
        <div style={{ marginTop: 4, fontSize: 10, color: '#71717A', lineHeight: 1.4, wordBreak: 'break-word' }}>
          {errMsg}
        </div>
      )}
    </div>
  )
}

// ── Main component ───────────────────────────────────────────────────────────

export default function RefreshButton() {
  const router  = useRouter()
  const tr      = useTr()

  const [btnStatus,    setBtnStatus]    = useState<ButtonStatus>('idle')
  const [open,         setOpen]         = useState(false)
  const [customFrom,   setCustomFrom]   = useState(() => daysAgo(7))
  const [progress,     setProgress]     = useState<SyncProgress | null>(null)
  const [otherStores,  setOtherStores]  = useState(0)
  const [showProgress, setShowProgress] = useState(false)
  const [nowMs,        setNowMs]        = useState(Date.now())

  const ref          = useRef<HTMLDivElement>(null)
  const pollRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const fallbackRef  = useRef<ReturnType<typeof setTimeout> | null>(null)
  const tickRef      = useRef<ReturnType<typeof setInterval> | null>(null)
  const triggerMsRef = useRef(0)
  const today        = toDateStr(new Date())

  // Close dropdown on outside click
  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  function stopPolling() {
    if (pollRef.current)     { clearInterval(pollRef.current);   pollRef.current    = null }
    if (fallbackRef.current) { clearTimeout(fallbackRef.current); fallbackRef.current = null }
    if (tickRef.current)     { clearInterval(tickRef.current);   tickRef.current    = null }
  }

  function startTick() {
    if (tickRef.current) clearInterval(tickRef.current)
    tickRef.current = setInterval(() => setNowMs(Date.now()), 1_000)
  }

  function finishSync(hasError: boolean) {
    stopPolling()
    setBtnStatus(hasError ? 'partial' : 'done')
    router.refresh()
    // Keep panel open longer when there's an error so the user can read it
    setTimeout(() => {
      setBtnStatus('idle')
      setShowProgress(false)
      setProgress(null)
    }, hasError ? 8_000 : 3_500)
  }

  function startPolling() {
    const triggerMs = triggerMsRef.current

    pollRef.current = setInterval(async () => {
      try {
        const res  = await fetch('/api/sync-status')
        const data = await res.json()

        const shopifyRun  = classifyRun(data.shopify,  triggerMs)
        const facebookRun = classifyRun(data.facebook, triggerMs)

        setProgress({ shopify: shopifyRun, facebook: facebookRun })

        const bothSettled =
          (shopifyRun.status  === 'success' || shopifyRun.status  === 'error') &&
          (facebookRun.status === 'success' || facebookRun.status === 'error')

        if (bothSettled) {
          const hasError = shopifyRun.status === 'error' || facebookRun.status === 'error'
          finishSync(hasError)
        }
      } catch { /* keep polling on transient errors */ }
    }, 3_000)

    // Safety valve: give up after 3 minutes
    fallbackRef.current = setTimeout(() => finishSync(false), 180_000)
  }

  async function triggerRefresh(body: object) {
    setOpen(false)
    setBtnStatus('loading')
    setShowProgress(true)
    setProgress({ shopify: { ...EMPTY_RUN }, facebook: { ...EMPTY_RUN } })
    stopPolling()
    triggerMsRef.current = Date.now()

    try {
      const res  = await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify(body),
      })
      const data = await res.json()

      if (data.started) {
        setOtherStores(data.otherStoresCount ?? 0)
        startTick()
        startPolling()
      } else {
        setBtnStatus('error')
        setTimeout(() => { setBtnStatus('idle'); setShowProgress(false); setProgress(null) }, 4_000)
      }
    } catch {
      setBtnStatus('error')
      setTimeout(() => { setBtnStatus('idle'); setShowProgress(false); setProgress(null) }, 4_000)
    }
  }

  const handleRefresh       = () => triggerRefresh({})
  const handleRefreshCustom = () => triggerRefresh({ dateFrom: customFrom, dateTo: today })

  // ── Styles ─────────────────────────────────────────────────────────────────
  const isLoading = btnStatus === 'loading'
  const isDone    = btnStatus === 'done'
  const isPartial = btnStatus === 'partial'
  const isError   = btnStatus === 'error'
  const isIdle    = btnStatus === 'idle'

  const accent =
    isLoading  ? { bg: 'rgba(139,92,246,0.1)', border: 'rgba(139,92,246,0.4)', color: '#A78BFA' } :
    isDone     ? { bg: 'rgba(16,185,129,0.1)',  border: 'rgba(16,185,129,0.4)',  color: '#10B981' } :
    isPartial  ? { bg: 'rgba(245,158,11,0.1)',  border: 'rgba(245,158,11,0.4)',  color: '#F59E0B' } :
    isError    ? { bg: 'rgba(244,63,94,0.1)',   border: 'rgba(244,63,94,0.4)',   color: '#F43F5E' } :
                 { bg: 'var(--bg-surface)',      border: 'var(--border)',          color: 'var(--text-dim)' }

  const quickOptions = [
    { label: '7 dias',  date: daysAgo(7)  },
    { label: '30 dias', date: daysAgo(30) },
    { label: '60 dias', date: daysAgo(60) },
    { label: '90 dias', date: daysAgo(90) },
  ]

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>

      {/* ── Button row ──────────────────────────────────────────────────── */}
      <div style={{ display: 'flex', border: `1px solid ${accent.border}`, borderRadius: 8, overflow: 'visible', transition: 'all 0.2s' }}>

        {/* Main button */}
        <button
          onClick={isIdle ? handleRefresh : undefined}
          disabled={isLoading}
          title={isIdle ? 'Sincronizar dados de todas as lojas' : undefined}
          style={{
            background: accent.bg, border: 'none', borderRadius: '8px 0 0 8px',
            padding: '6px 10px', fontSize: 12, fontWeight: 600, color: accent.color,
            cursor: isLoading ? 'not-allowed' : 'pointer',
            display: 'flex', alignItems: 'center', gap: 6,
            transition: 'all 0.2s', whiteSpace: 'nowrap',
          }}
        >
          {isLoading  ? <><Spinner />{tr.refresh_loading}</> :
           isDone     ? <>✓ Dados atualizados!</> :
           isPartial  ? <>⚠ Atualizado com erros</> :
           isError    ? <>✗ {tr.refresh_error_conn}</> :
                        <><RefreshIcon />{tr.refresh_idle}</>}
        </button>

        {/* Dropdown toggle — only when idle */}
        {isIdle && (
          <button
            onClick={() => setOpen(o => !o)}
            style={{
              background: accent.bg, border: 'none', borderLeft: `1px solid ${accent.border}`,
              borderRadius: '0 8px 8px 0', padding: '6px 7px', color: accent.color,
              cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'all 0.2s',
            }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* ── Progress panel (shown while syncing / just after done) ─────── */}
      {showProgress && progress && (
        <div style={{
          position: 'absolute', top: 'calc(100% + 6px)', right: 0,
          background: '#1A1D23', border: '1px solid #2A2D35',
          borderRadius: 10, padding: '14px 16px', minWidth: 260, zIndex: 50,
          boxShadow: '0 8px 24px rgba(0,0,0,0.4)',
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#52525B', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: 12 }}>
            Atualizando dados
          </div>

          <SourceRow label="Shopify"  run={progress.shopify}  color="#10B981" recordLabel="registros" nowMs={nowMs} />
          <SourceRow label="Facebook" run={progress.facebook} color="#3B82F6" recordLabel="métricas"  nowMs={nowMs} />

          {otherStores > 0 && (
            <div style={{ marginTop: 6, fontSize: 11, color: '#52525B', borderTop: '1px solid #2A2D35', paddingTop: 8 }}>
              + {otherStores} loja{otherStores > 1 ? 's' : ''} em segundo plano
            </div>
          )}
        </div>
      )}

      {/* ── Dropdown — re-sync historical range ────────────────────────── */}
      {open && (
        <div style={{
          position: 'absolute', top: '100%', right: 0, marginTop: 4,
          background: '#1A1D23', border: '1px solid #2A2D35',
          borderRadius: 8, zIndex: 50, minWidth: 210, padding: 12,
        }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#52525B', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>
            Re-sincronizar período
          </div>
          <div style={{ fontSize: 11, color: '#52525B', marginBottom: 10 }}>
            Use para corrigir dados históricos
          </div>

          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
            {quickOptions.map(opt => (
              <button key={opt.label} onClick={() => setCustomFrom(opt.date)}
                style={{
                  padding: '4px 8px', fontSize: 11, fontWeight: 500, borderRadius: 5,
                  border: `1px solid ${customFrom === opt.date ? '#7C3AED' : '#2A2D35'}`,
                  background: customFrom === opt.date ? 'rgba(124,58,237,0.15)' : 'transparent',
                  color: customFrom === opt.date ? '#A78BFA' : '#A1A1AA', cursor: 'pointer',
                }}>
                {opt.label}
              </button>
            ))}
          </div>

          <input
            type="date" value={customFrom} max={today}
            onChange={e => setCustomFrom(e.target.value)}
            style={{
              width: '100%', background: '#111318', border: '1px solid #2A2D35',
              borderRadius: 6, padding: '6px 8px', fontSize: 12, color: '#F4F4F5',
              outline: 'none', boxSizing: 'border-box', marginBottom: 10,
            }}
          />

          <button onClick={handleRefreshCustom}
            style={{
              width: '100%', padding: '7px 0', fontSize: 12, fontWeight: 600,
              borderRadius: 6, border: 'none', background: 'rgba(124,58,237,0.2)',
              color: '#A78BFA', cursor: 'pointer',
            }}>
            Re-sincronizar desde {customFrom}
          </button>
        </div>
      )}
    </div>
  )
}

// ── Icons ────────────────────────────────────────────────────────────────────

function Spinner() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none"
      style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }}>
      <style>{`@keyframes spin{to{transform:rotate(360deg)}}`}</style>
      <circle cx="6.5" cy="6.5" r="5" stroke="currentColor" strokeWidth="1.5" strokeOpacity="0.25" />
      <path d="M11.5 6.5A5 5 0 0 0 6.5 1.5" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
    </svg>
  )
}

function RefreshIcon() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ flexShrink: 0 }}>
      <path d="M11 6.5A4.5 4.5 0 1 1 6.5 2a4.5 4.5 0 0 1 3.18 1.32" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" />
      <path d="M9 1.5v2.5h-2.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  )
}
