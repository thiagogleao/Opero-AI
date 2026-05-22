'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTr } from '@/lib/translations'

type Status = 'idle' | 'loading' | 'done' | 'warn' | 'error'

// Use local date to avoid UTC-shift bugs
function toDateStr(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function daysAgo(n: number) {
  const d = new Date(); d.setDate(d.getDate() - n); return toDateStr(d)
}

export default function RefreshButton() {
  const router = useRouter()
  const tr = useTr()
  const [status, setStatus] = useState<Status>('idle')
  const [msg, setMsg] = useState('')
  const [open, setOpen] = useState(false)
  // customFrom is only used when the user explicitly picks a range in the dropdown
  const [customFrom, setCustomFrom] = useState(() => daysAgo(7))
  const ref = useRef<HTMLDivElement>(null)
  const pollRef = useRef<ReturnType<typeof setInterval> | null>(null)
  const fallbackRef = useRef<ReturnType<typeof setTimeout> | null>(null)
  const today = toDateStr(new Date())

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  function stopPolling() {
    if (pollRef.current) { clearInterval(pollRef.current); pollRef.current = null }
    if (fallbackRef.current) { clearTimeout(fallbackRef.current); fallbackRef.current = null }
  }

  function startPolling(triggerTime: number) {
    pollRef.current = setInterval(async () => {
      try {
        const res = await fetch('/api/sync-status')
        const { lastSync } = await res.json()
        if (lastSync && new Date(lastSync).getTime() > triggerTime) {
          stopPolling()
          setStatus('done')
          setMsg('Dados atualizados!')
          router.refresh()
          setTimeout(() => setStatus('idle'), 3000)
        }
      } catch { /* keep polling */ }
    }, 5000)

    // Fallback: force refresh after 3 minutes
    fallbackRef.current = setTimeout(() => {
      stopPolling()
      setStatus('done')
      setMsg('Pronto!')
      router.refresh()
      setTimeout(() => setStatus('idle'), 3000)
    }, 180_000)
  }

  // Main button: smart incremental (no explicit dates)
  async function handleRefresh() {
    setOpen(false)
    setStatus('loading')
    setMsg('Sincronizando...')
    stopPolling()
    const triggerTime = Date.now()
    try {
      const res = await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({}),
      })
      const data = await res.json()

      if (data.started) {
        setMsg('Sincronizando...')
        startPolling(triggerTime)
      } else {
        setStatus('error'); setMsg(tr.refresh_error_conn); setTimeout(() => setStatus('idle'), 4000)
      }
    } catch {
      setStatus('error'); setMsg(tr.refresh_error_conn); setTimeout(() => setStatus('idle'), 4000)
    }
  }

  const theme: Record<Status, { bg: string; border: string; color: string }> = {
    idle:    { bg: 'var(--bg-surface)',         border: 'var(--border)',              color: 'var(--text-dim)' },
    loading: { bg: 'rgba(139,92,246,0.1)',       border: 'rgba(139,92,246,0.4)',       color: '#A78BFA' },
    done:    { bg: 'rgba(16,185,129,0.1)',        border: 'rgba(16,185,129,0.4)',       color: '#10B981' },
    warn:    { bg: 'rgba(245,158,11,0.1)',        border: 'rgba(245,158,11,0.4)',       color: '#F59E0B' },
    error:   { bg: 'rgba(244,63,94,0.1)',         border: 'rgba(244,63,94,0.4)',        color: '#F43F5E' },
  }
  const c = theme[status]
  const isIdle = status === 'idle'

  // Explicit range sync (from dropdown date picker)
  async function handleRefreshCustom() {
    setOpen(false)
    setStatus('loading')
    setMsg('Sincronizando...')
    stopPolling()
    const triggerTime = Date.now()
    try {
      const res = await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFrom: customFrom, dateTo: today }),
      })
      const data = await res.json()
      if (data.started) {
        startPolling(triggerTime)
      } else {
        setStatus('error'); setMsg(tr.refresh_error_conn); setTimeout(() => setStatus('idle'), 4000)
      }
    } catch {
      setStatus('error'); setMsg(tr.refresh_error_conn); setTimeout(() => setStatus('idle'), 4000)
    }
  }

  const quickOptions = [
    { label: '7 dias',  date: daysAgo(7) },
    { label: '30 dias', date: daysAgo(30) },
    { label: '60 dias', date: daysAgo(60) },
    { label: '90 dias', date: daysAgo(90) },
  ]

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <div style={{ display: 'flex', border: `1px solid ${c.border}`, borderRadius: 8, overflow: 'visible', transition: 'all 0.2s' }}>
        {/* Main button — smart incremental */}
        <button
          onClick={isIdle ? handleRefresh : undefined}
          disabled={status === 'loading'}
          title={isIdle ? 'Sincronizar dados (incremental automático)' : msg}
          style={{ background: c.bg, border: 'none', borderRadius: '8px 0 0 8px', padding: '6px 10px', fontSize: 12, fontWeight: 600, color: c.color, cursor: status === 'loading' ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.2s', whiteSpace: 'nowrap' }}
        >
          {status === 'loading' ? <><Spinner />{tr.refresh_loading}</> :
           status === 'done'    ? <>✓ {msg}</> :
           status === 'warn'    ? <>⚠ {msg}</> :
           status === 'error'   ? <>✗ {msg}</> :
           <><RefreshIcon />{tr.refresh_idle}</>}
        </button>

        {/* Dropdown toggle */}
        {isIdle && (
          <button
            onClick={() => setOpen(o => !o)}
            style={{ background: c.bg, border: 'none', borderLeft: `1px solid ${c.border}`, borderRadius: '0 8px 8px 0', padding: '6px 7px', color: c.color, cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'all 0.2s' }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown — re-sync historical range */}
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#1A1D23', border: '1px solid #2A2D35', borderRadius: 8, zIndex: 50, minWidth: 210, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#52525B', marginBottom: 4, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Re-sincronizar período</div>
          <div style={{ fontSize: 11, color: '#52525B', marginBottom: 10 }}>Use para corrigir dados históricos</div>

          {/* Quick options */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
            {quickOptions.map(opt => (
              <button key={opt.label} onClick={() => setCustomFrom(opt.date)}
                style={{ padding: '4px 8px', fontSize: 11, fontWeight: 500, borderRadius: 5, border: `1px solid ${customFrom === opt.date ? '#7C3AED' : '#2A2D35'}`, background: customFrom === opt.date ? 'rgba(124,58,237,0.15)' : 'transparent', color: customFrom === opt.date ? '#A78BFA' : '#A1A1AA', cursor: 'pointer' }}>
                {opt.label}
              </button>
            ))}
          </div>

          {/* Custom date input */}
          <input
            type="date"
            value={customFrom}
            max={today}
            onChange={e => setCustomFrom(e.target.value)}
            style={{ width: '100%', background: '#111318', border: '1px solid #2A2D35', borderRadius: 6, padding: '6px 8px', fontSize: 12, color: '#F4F4F5', outline: 'none', boxSizing: 'border-box', marginBottom: 10 }}
          />

          <button onClick={handleRefreshCustom}
            style={{ width: '100%', padding: '7px 0', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', background: 'rgba(124,58,237,0.2)', color: '#A78BFA', cursor: 'pointer' }}>
            Re-sincronizar desde {customFrom}
          </button>
        </div>
      )}
    </div>
  )
}

function Spinner() {
  return (
    <svg width="13" height="13" viewBox="0 0 13 13" fill="none" style={{ animation: 'spin 0.8s linear infinite', flexShrink: 0 }}>
      <style>{`@keyframes spin { to { transform: rotate(360deg) } }`}</style>
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
