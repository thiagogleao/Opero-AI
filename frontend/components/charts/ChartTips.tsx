'use client'

/**
 * ChartTips — the tiny client layer that gives a server-rendered SVG chart its
 * tooltips. Any descendant with a `data-tip` attribute (built with tipAttr()
 * from ./scale) shows a bubble on hover, on keyboard focus and on tap; Esc or
 * a tap elsewhere hides it. Everything else in the chart stays server-side.
 *
 *   <ChartTips><svg>…<g data-tip={tipAttr({ title, rows })} tabIndex={0}>…</g></svg></ChartTips>
 *
 * Props: { children: ReactNode; className?: string }
 * The charts in this folder already wrap themselves; use it directly only for
 * your own SVG.
 */

import { useCallback, useEffect, useRef, useState, type ReactNode } from 'react'
import { useIsClient } from '@/components/ui/InfoTip'
import { createPortal } from 'react-dom'
import type { ChartTip } from './scale'
import s from './charts.module.css'

export function ChartTips({ children, className }: { children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const [tip, setTip] = useState<ChartTip | null>(null)
  const mounted = useIsClient()
  const at = useRef<{ x: number; y: number }>({ x: 0, y: 0 })
  const active = useRef<Element | null>(null)

  const place = useCallback(() => {
    const b = bubble.current
    if (!b) return
    const { x, y } = at.current
    const w = b.offsetWidth, h = b.offsetHeight
    let left = x + 14, top = y + 14
    if (left + w > window.innerWidth - 8) left = x - w - 14
    if (top + h > window.innerHeight - 8) top = y - h - 14
    b.style.transform = `translate(${Math.round(Math.max(8, left))}px, ${Math.round(Math.max(8, top))}px)`
  }, [])

  useEffect(() => { if (tip) place() }, [tip, place])

  const show = useCallback((el: Element, x?: number, y?: number) => {
    const raw = el.getAttribute('data-tip')
    if (!raw) return
    try {
      if (x === undefined || y === undefined) {
        const r = el.getBoundingClientRect()
        at.current = { x: r.left + r.width / 2, y: r.top }
      } else at.current = { x, y }
      if (active.current !== el) {
        active.current?.removeAttribute('data-active')
        el.setAttribute('data-active', '')
        active.current = el
        setTip(JSON.parse(raw) as ChartTip)
      } else place()
    } catch { /* a malformed tip is just not shown */ }
  }, [place])

  const hide = useCallback(() => {
    active.current?.removeAttribute('data-active')
    active.current = null
    setTip(null)
  }, [])

  useEffect(() => {
    if (!tip) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') hide() }
    const onDown = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) hide() }
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', hide, true)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', hide, true)
    }
  }, [tip, hide])

  const target = (e: { target: EventTarget | null }) =>
    e.target instanceof Element ? e.target.closest('[data-tip]') : null

  return (
    <div
      ref={box}
      className={`${s.tipsBox}${className ? ` ${className}` : ''}`}
      onPointerMove={e => { const el = target(e); if (el) show(el, e.clientX, e.clientY); else if (e.pointerType === 'mouse') hide() }}
      onPointerLeave={e => { if (e.pointerType === 'mouse') hide() }}
      onPointerDown={e => { const el = target(e); if (el) show(el, e.clientX, e.clientY) }}
      onFocus={e => { const el = target(e); if (el) show(el) }}
      onBlur={hide}
    >
      {children}
      {mounted && tip && createPortal(
        <div ref={bubble} className={s.bubble} role="tooltip">
          <div className={s.bubbleTitle}>{tip.title}</div>
          {tip.rows?.map(([k, v, tone], i) => (
            <div key={i} className={s.bubbleRow}>
              <span>{k}</span>
              <span className={tone ? s[tone] : undefined}>{v}</span>
            </div>
          ))}
          {tip.note && <div className={s.bubbleNote}>{tip.note}</div>}
        </div>,
        document.body,
      )}
    </div>
  )
}
