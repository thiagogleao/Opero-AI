'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTr } from '@/lib/translations'

type Status = 'idle' | 'loading' | 'done' | 'warn' | 'error'

const DAY_OPTIONS = [
  { label: '2 dias', value: 2 },
  { label: '7 dias', value: 7 },
  { label: '30 dias', value: 30 },
  { label: '90 dias', value: 90 },
]

export default function RefreshButton() {
  const router = useRouter()
  const tr = useTr()
  const [status, setStatus] = useState<Status>('idle')
  const [msg, setMsg] = useState('')
  const [days, setDays] = useState(2)
  const [open, setOpen] = useState(false)
  const ref = useRef<HTMLDivElement>(null)

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  async function handleRefresh() {
    setStatus('loading')
    setMsg('')
    try {
      const res  = await fetch('/api/refresh', { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify({ days }) })
      const data = await res.json()

      if (data.shopify.ok && data.facebook.ok) {
        setStatus('done'); setMsg(tr.refresh_done_both); router.refresh(); setTimeout(() => setStatus('idle'), 3000)
      } else if (data.shopify.ok && !data.facebook.ok) {
        setStatus('warn'); setMsg(data.facebook.tokenExpired ? tr.refresh_warn_token : tr.refresh_warn_fb); router.refresh(); setTimeout(() => setStatus('idle'), 6000)
      } else if (!data.shopify.ok && data.facebook.ok) {
        setStatus('warn'); setMsg(tr.refresh_warn_shopify); router.refresh(); setTimeout(() => setStatus('idle'), 6000)
      } else {
        console.error('[refresh] shopify:', data.shopify?.output)
        console.error('[refresh] facebook:', data.facebook?.output)
        setStatus('error'); setMsg(data.facebook?.tokenExpired ? tr.refresh_error_token : tr.refresh_error_both); setTimeout(() => setStatus('idle'), 6000)
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

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <div style={{ display: 'flex', border: `1px solid ${c.border}`, borderRadius: 8, overflow: 'hidden', transition: 'all 0.2s' }}>
        {/* Main button */}
        <button
          onClick={handleRefresh}
          disabled={status === 'loading'}
          title={isIdle ? tr.refresh_title : msg}
          style={{ background: c.bg, border: 'none', padding: '6px 10px', fontSize: 12, fontWeight: 600, color: c.color, cursor: status === 'loading' ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.2s', whiteSpace: 'nowrap' }}
        >
          {status === 'loading' ? <><Spinner />{tr.refresh_loading}</> :
           status === 'done'    ? <>✓ {msg}</> :
           status === 'warn'    ? <>⚠ {msg}</> :
           status === 'error'   ? <>✗ {msg}</> :
           <><RefreshIcon />{tr.refresh_idle} <span style={{ opacity: 0.6, fontWeight: 400 }}>({DAY_OPTIONS.find(o => o.value === days)?.label})</span></>}
        </button>

        {/* Dropdown toggle — only shown when idle */}
        {isIdle && (
          <button
            onClick={() => setOpen(o => !o)}
            style={{ background: c.bg, border: 'none', borderLeft: `1px solid ${c.border}`, padding: '6px 7px', color: c.color, cursor: 'pointer', display: 'flex', alignItems: 'center', transition: 'all 0.2s' }}
          >
            <svg width="10" height="10" viewBox="0 0 10 10" fill="none">
              <path d="M2 3.5L5 6.5L8 3.5" stroke="currentColor" strokeWidth="1.4" strokeLinecap="round" strokeLinejoin="round"/>
            </svg>
          </button>
        )}
      </div>

      {/* Dropdown menu */}
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#1A1D23', border: '1px solid #2A2D35', borderRadius: 8, overflow: 'hidden', zIndex: 50, minWidth: 120 }}>
          {DAY_OPTIONS.map(opt => (
            <button
              key={opt.value}
              onClick={() => { setDays(opt.value); setOpen(false) }}
              style={{ display: 'block', width: '100%', padding: '8px 14px', fontSize: 12, fontWeight: opt.value === days ? 700 : 400, color: opt.value === days ? '#A78BFA' : '#A1A1AA', background: 'transparent', border: 'none', cursor: 'pointer', textAlign: 'left', whiteSpace: 'nowrap' }}
            >
              {opt.label} {opt.value === days ? '✓' : ''}
            </button>
          ))}
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
