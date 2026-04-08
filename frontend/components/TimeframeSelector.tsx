'use client'
import { useState, useRef, useEffect } from 'react'
import { useRouter, useSearchParams } from 'next/navigation'
import { useTr } from '@/lib/translations'

function toISO(d: Date) {
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`
}
function fromISO(s: string) {
  const [y, m, d] = s.split('-').map(Number)
  return new Date(y, m - 1, d)
}
function addDays(d: Date, n: number) {
  const r = new Date(d); r.setDate(r.getDate() + n); return r
}
function today0() {
  const d = new Date(); d.setHours(0, 0, 0, 0); return d
}

const PRESETS = [
  { label: '7d',  days: 7  },
  { label: '14d', days: 14 },
  { label: '30d', days: 30 },
  { label: '90d', days: 90 },
]

interface Props { from: string; to: string }

export default function TimeframeSelector({ from, to }: Props) {
  const router  = useRouter()
  const params  = useSearchParams()
  const wrapRef = useRef<HTMLDivElement>(null)
  const tr = useTr()

  const MONS = tr.cal_months.split('_')
  const DOW  = tr.cal_dow.split('_')

  const [open, setOpen]       = useState(false)
  const [picking, setPicking] = useState<'start' | 'end'>('start')
  const [tStart, setTStart]   = useState<Date | null>(null)
  const [tEnd,   setTEnd]     = useState<Date | null>(null)
  const [hovered, setHovered] = useState<Date | null>(null)
  const [month1,  setMonth1]  = useState(() => {
    const d = fromISO(from); return new Date(d.getFullYear(), d.getMonth(), 1)
  })

  const month2   = new Date(month1.getFullYear(), month1.getMonth() + 1, 1)
  const todayISO = toISO(today0())

  useEffect(() => {
    function onDown(e: MouseEvent) {
      if (wrapRef.current && !wrapRef.current.contains(e.target as Node)) setOpen(false)
    }
    document.addEventListener('mousedown', onDown)
    return () => document.removeEventListener('mousedown', onDown)
  }, [])

  useEffect(() => {
    const d = fromISO(from)
    setMonth1(new Date(d.getFullYear(), d.getMonth(), 1))
  }, [from])

  function applyRange(f: string, t: string) {
    const p = new URLSearchParams(params.toString())
    p.set('from', f); p.set('to', t); p.delete('days')
    router.push(`?${p.toString()}`)
    setOpen(false); setPicking('start'); setTStart(null); setTEnd(null); setHovered(null)
  }

  function selectPreset(days: number) {
    const t = today0()
    applyRange(toISO(addDays(t, -(days - 1))), toISO(t))
  }

  function handleDayClick(day: Date) {
    if (day > today0()) return
    if (picking === 'start' || (tStart && day < tStart)) {
      setTStart(day); setTEnd(null); setPicking('end')
    } else {
      setTEnd(day); setPicking('start')
    }
  }

  function handleApply() {
    if (!tStart || !tEnd) return
    const [f, t] = tStart <= tEnd ? [tStart, tEnd] : [tEnd, tStart]
    applyRange(toISO(f), toISO(t))
  }

  function isPresetActive(days: number) {
    return from === toISO(addDays(today0(), -(days - 1))) && to === todayISO
  }
  const anyPreset = PRESETS.some(p => isPresetActive(p.days))

  function displayLabel() {
    const fmt = (d: Date) => `${String(d.getDate()).padStart(2,'0')}/${String(d.getMonth()+1).padStart(2,'0')}`
    return `${fmt(fromISO(from))} – ${fmt(fromISO(to))}`
  }

  function renderCalendar(monthStart: Date, showBack: boolean, showFwd: boolean) {
    const yr    = monthStart.getFullYear()
    const mo    = monthStart.getMonth()
    const first = new Date(yr, mo, 1).getDay()
    const daysN = new Date(yr, mo + 1, 0).getDate()

    let hlStart: Date | null = null
    let hlEnd:   Date | null = null
    if (tStart && tEnd) {
      [hlStart, hlEnd] = tStart <= tEnd ? [tStart, tEnd] : [tEnd, tStart]
    } else if (tStart && picking === 'end' && hovered) {
      [hlStart, hlEnd] = tStart <= hovered ? [tStart, hovered] : [hovered, tStart]
    } else if (!open || (!tStart && !tEnd)) {
      hlStart = fromISO(from); hlEnd = fromISO(to)
    }

    const cells: React.ReactNode[] = []
    for (let i = 0; i < first; i++) cells.push(<div key={`gap${i}`} />)

    for (let d = 1; d <= daysN; d++) {
      const date = new Date(yr, mo, d)
      const iso  = toISO(date)
      const isFut = date > today0()
      const isHlStart = hlStart && toISO(hlStart) === iso
      const isHlEnd   = hlEnd   && toISO(hlEnd)   === iso
      const inRange   = hlStart && hlEnd && date > hlStart && date < hlEnd
      const isEdge    = isHlStart || isHlEnd
      const isTodayD  = iso === todayISO
      const dayOfWeek = date.getDay()
      const borderR   = isEdge ? '6px' : (inRange && (dayOfWeek === 6 || d === daysN)) ? '6px 0 0 6px' : '0'
      const borderL   = isEdge ? '6px' : (inRange && (dayOfWeek === 0 || d === 1))     ? '0 6px 6px 0' : '0'

      cells.push(
        <div key={d}
          onMouseEnter={() => setHovered(date)}
          onMouseLeave={() => setHovered(null)}
          onClick={() => handleDayClick(date)}
          style={{
            height: 30, display: 'flex', alignItems: 'center', justifyContent: 'center',
            fontSize: 12, cursor: isFut ? 'default' : 'pointer', borderRadius: isEdge ? 6 : 0,
            color: isFut ? 'var(--text-ghost)' : isEdge ? '#fff' : inRange ? 'var(--text-secondary)' : 'var(--text-muted)',
            background: isEdge ? 'linear-gradient(135deg,#8B5CF6,#6D28D9)' : inRange ? 'rgba(139,92,246,0.14)' : 'transparent',
            fontWeight: isEdge || isTodayD ? 700 : 400,
            outline: isTodayD && !isEdge ? '1px solid rgba(139,92,246,0.45)' : 'none',
            outlineOffset: -1, userSelect: 'none',
          }}
        >{d}</div>
      )
    }

    return (
      <div style={{ width: 210 }}>
        <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', marginBottom: 10 }}>
          <button onClick={() => showBack && setMonth1(new Date(month1.getFullYear(), month1.getMonth() - 1, 1))}
            style={{ background: 'none', border: 'none', cursor: showBack ? 'pointer' : 'default', color: showBack ? 'var(--text-muted)' : 'transparent', fontSize: 16, padding: '2px 8px', lineHeight: 1 }}>‹</button>
          <span style={{ fontSize: 12, fontWeight: 600, color: 'var(--text-secondary)', letterSpacing: '0.3px' }}>{MONS[mo]} {yr}</span>
          <button onClick={() => showFwd && setMonth1(new Date(month1.getFullYear(), month1.getMonth() + 1, 1))}
            style={{ background: 'none', border: 'none', cursor: showFwd ? 'pointer' : 'default', color: showFwd ? 'var(--text-muted)' : 'transparent', fontSize: 16, padding: '2px 8px', lineHeight: 1 }}>›</button>
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)', marginBottom: 4 }}>
          {DOW.map((d, i) => (
            <div key={i} style={{ height: 22, display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: 10, color: 'var(--text-ghost)', fontWeight: 600 }}>{d}</div>
          ))}
        </div>
        <div style={{ display: 'grid', gridTemplateColumns: 'repeat(7,1fr)' }}>{cells}</div>
      </div>
    )
  }

  return (
    <div ref={wrapRef} style={{ position: 'relative' }}>
      <div style={{ display: 'flex', gap: 4, background: 'var(--bg-sidebar)', border: '1px solid var(--border)', borderRadius: 8, padding: 4 }}>
        {PRESETS.map(opt => (
          <button key={opt.days} onClick={() => { setOpen(false); selectPreset(opt.days) }}
            style={{ padding: '5px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s',
              background: isPresetActive(opt.days) && !open ? 'linear-gradient(135deg,#8B5CF6,#6D28D9)' : 'transparent',
              color: isPresetActive(opt.days) && !open ? '#fff' : 'var(--text-dim)' }}
          >{opt.label}</button>
        ))}
        <button onClick={() => setOpen(o => !o)}
          style={{ padding: '5px 12px', borderRadius: 6, border: 'none', fontSize: 12, fontWeight: 600, cursor: 'pointer', transition: 'all 0.15s', display: 'flex', alignItems: 'center', gap: 5,
            background: open || !anyPreset ? 'linear-gradient(135deg,#8B5CF6,#6D28D9)' : 'transparent',
            color: open || !anyPreset ? '#fff' : 'var(--text-dim)' }}>
          <svg width="11" height="11" viewBox="0 0 11 11" fill="none" style={{ flexShrink: 0 }}>
            <rect x="0.5" y="1.5" width="10" height="9" rx="1.5" stroke="currentColor" strokeWidth="1"/>
            <path d="M3 0.5V2.5M8 0.5V2.5" stroke="currentColor" strokeWidth="1" strokeLinecap="round"/>
            <path d="M0.5 4.5H10.5" stroke="currentColor" strokeWidth="1"/>
          </svg>
          {!anyPreset ? displayLabel() : tr.cal_custom}
        </button>
      </div>

      {open && (
        <div style={{ position: 'absolute', top: 'calc(100% + 8px)', right: 0, zIndex: 200, background: 'var(--bg-surface)', border: '1px solid var(--border)', borderRadius: 12, padding: '16px 18px', boxShadow: '0 24px 64px rgba(0,0,0,0.5)', minWidth: 460 }}>
          <div style={{ display: 'flex', gap: 24 }}>
            {renderCalendar(month1, true, false)}
            <div style={{ width: 1, background: 'var(--border)', alignSelf: 'stretch' }} />
            {renderCalendar(month2, false, true)}
          </div>
          <div style={{ borderTop: '1px solid var(--border)', marginTop: 14, paddingTop: 12, display: 'flex', justifyContent: 'space-between', alignItems: 'center' }}>
            <div style={{ fontSize: 11 }}>
              {!tStart ? (
                <span style={{ color: 'var(--text-faint)' }}>{tr.cal_select_start}</span>
              ) : !tEnd ? (
                <span style={{ color: '#8B5CF6' }}>{toISO(tStart)} · {tr.cal_select_end}</span>
              ) : (
                <span style={{ color: 'var(--text-muted)' }}>
                  {toISO(tStart <= tEnd ? tStart : tEnd)}
                  <span style={{ color: 'var(--text-faint)', margin: '0 5px' }}>→</span>
                  {toISO(tStart <= tEnd ? tEnd : tStart)}
                  <span style={{ color: 'var(--text-faint)', marginLeft: 6 }}>
                    ({Math.round(Math.abs(tEnd.getTime() - tStart.getTime()) / 86400000) + 1} {tr.cal_days_count})
                  </span>
                </span>
              )}
            </div>
            <div style={{ display: 'flex', gap: 8 }}>
              <button onClick={() => { setTStart(null); setTEnd(null); setPicking('start') }}
                style={{ background: 'transparent', border: '1px solid var(--border-strong)', borderRadius: 6, padding: '5px 12px', fontSize: 11, color: 'var(--text-dim)', cursor: 'pointer' }}>
                {tr.cal_clear}
              </button>
              <button onClick={handleApply} disabled={!tStart || !tEnd}
                style={{ background: tStart && tEnd ? 'linear-gradient(135deg,#8B5CF6,#6D28D9)' : 'var(--bg-input)', border: 'none', borderRadius: 6, padding: '5px 16px', fontSize: 11, fontWeight: 700, color: tStart && tEnd ? '#fff' : 'var(--text-ghost)', cursor: tStart && tEnd ? 'pointer' : 'default' }}>
                {tr.cal_apply}
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  )
}
