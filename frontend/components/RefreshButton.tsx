'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter } from 'next/navigation'
import { useTr } from '@/lib/translations'

type Status = 'idle' | 'loading' | 'done' | 'warn' | 'error'

function toDateStr(d: Date) {
  return d.toISOString().split('T')[0]
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
  const [dateFrom, setDateFrom] = useState(() => daysAgo(2))
  const ref = useRef<HTMLDivElement>(null)
  const today = toDateStr(new Date())

  useEffect(() => {
    function close(e: MouseEvent) {
      if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', close)
    return () => document.removeEventListener('mousedown', close)
  }, [])

  async function handleRefresh() {
    setOpen(false)
    setStatus('loading')
    setMsg('')
    try {
      const res  = await fetch('/api/refresh', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({ dateFrom, dateTo: today }),
      })
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

  const quickOptions = [
    { label: 'Hoje',     date: today },
    { label: '7 dias',   date: daysAgo(7) },
    { label: '30 dias',  date: daysAgo(30) },
    { label: '90 dias',  date: daysAgo(90) },
  ]

  return (
    <div ref={ref} style={{ position: 'relative', display: 'inline-flex' }}>
      <div style={{ display: 'flex', border: `1px solid ${c.border}`, borderRadius: 8, overflow: 'visible', transition: 'all 0.2s' }}>
        {/* Main button */}
        <button
          onClick={isIdle ? handleRefresh : undefined}
          disabled={status === 'loading'}
          title={isIdle ? `Sincronizar de ${dateFrom} até hoje` : msg}
          style={{ background: c.bg, border: 'none', borderRadius: '8px 0 0 8px', padding: '6px 10px', fontSize: 12, fontWeight: 600, color: c.color, cursor: status === 'loading' ? 'not-allowed' : 'pointer', display: 'flex', alignItems: 'center', gap: 6, transition: 'all 0.2s', whiteSpace: 'nowrap' }}
        >
          {status === 'loading' ? <><Spinner />{tr.refresh_loading}</> :
           status === 'done'    ? <>✓ {msg}</> :
           status === 'warn'    ? <>⚠ {msg}</> :
           status === 'error'   ? <>✗ {msg}</> :
           <><RefreshIcon />{tr.refresh_idle} <span style={{ opacity: 0.55, fontWeight: 400 }}>desde {dateFrom}</span></>}
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

      {/* Dropdown */}
      {open && (
        <div style={{ position: 'absolute', top: '100%', right: 0, marginTop: 4, background: '#1A1D23', border: '1px solid #2A2D35', borderRadius: 8, zIndex: 50, minWidth: 200, padding: 12 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: '#52525B', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '0.05em' }}>Data inicial</div>

          {/* Quick options */}
          <div style={{ display: 'flex', flexWrap: 'wrap', gap: 4, marginBottom: 10 }}>
            {quickOptions.map(opt => (
              <button key={opt.label} onClick={() => setDateFrom(opt.date)}
                style={{ padding: '4px 8px', fontSize: 11, fontWeight: 500, borderRadius: 5, border: `1px solid ${dateFrom === opt.date ? '#7C3AED' : '#2A2D35'}`, background: dateFrom === opt.date ? 'rgba(124,58,237,0.15)' : 'transparent', color: dateFrom === opt.date ? '#A78BFA' : '#A1A1AA', cursor: 'pointer' }}>
                {opt.label}
              </button>
            ))}
          </div>

          {/* Custom date input */}
          <input
            type="date"
            value={dateFrom}
            max={today}
            onChange={e => setDateFrom(e.target.value)}
            style={{ width: '100%', background: '#111318', border: '1px solid #2A2D35', borderRadius: 6, padding: '6px 8px', fontSize: 12, color: '#F4F4F5', outline: 'none', boxSizing: 'border-box', marginBottom: 10 }}
          />

          <button onClick={handleRefresh}
            style={{ width: '100%', padding: '7px 0', fontSize: 12, fontWeight: 600, borderRadius: 6, border: 'none', background: 'rgba(124,58,237,0.2)', color: '#A78BFA', cursor: 'pointer' }}>
            Sincronizar desde {dateFrom}
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
