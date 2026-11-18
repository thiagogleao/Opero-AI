'use client'

/**
 * ChartTips — the tiny client layer that gives a server-rendered SVG chart its
 * tooltips. Any descendant with a `data-tip` attribute (built with tipAttr()
 * from ./scale) shows a bubble on hover, on keyboard focus and on tap; Esc or
 * a tap elsewhere hides it. Everything else in the chart stays server-side.
 *
 *   <ChartTips><svg>…<g data-tip={tipAttr({ title, rows })} tabIndex={i === 0 ? 0 : -1}>…</g></svg></ChartTips>
 *
 * Keyboard: the points with a tooltip ([data-tip][tabindex]) share ONE tab stop
 * (./roving): Tab lands on one point, ←/→ move to the next or previous one and
 * show its tooltip, Home/End jump to the ends, the next Tab leaves the chart.
 * Render tabIndex={0} on the point that should hold the stop and -1 on the
 * rest; a chart that renders 0 everywhere is normalised after hydration (the
 * first point keeps the stop).
 *
 * Props: { children: ReactNode; className?: string }
 * The charts in this folder already wrap themselves; use it directly only for
 * your own SVG.
 */

import { useCallback, useEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
import { useIsClient } from '@/components/ui/InfoTip'
import { createPortal } from 'react-dom'
import { ROVING_KEYS, rovingStop, rovingTarget } from './roving'
import type { ChartTip } from './scale'
import s from './charts.module.css'

/** The focusable points of one chart, in document (left-to-right) order. */
function points(box: HTMLElement | null): Element[] {
  return box ? Array.from(box.querySelectorAll('[data-tip][tabindex]')) : []
}

/** Give the tab stop to points[stop]; every other point leaves the tab order. */
function setStop(els: Element[], stop: number) {
  els.forEach((el, i) => {
    const want = i === stop ? '0' : '-1'
    if (el.getAttribute('tabindex') !== want) el.setAttribute('tabindex', want)
    if (els.length > 1 && el.getAttribute('aria-keyshortcuts') !== ROVING_KEYS) el.setAttribute('aria-keyshortcuts', ROVING_KEYS)
  })
}

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

  // One tab stop per chart (see the header). Runs after hydration and whenever
  // the chart's markup is replaced; the focused point keeps the stop.
  useEffect(() => {
    const els = points(box.current)
    if (els.length < 2) return
    const focused = els.findIndex(el => el === document.activeElement)
    setStop(els, rovingStop(els.map(el => el.getAttribute('tabindex')), focused))
  }, [children])

  const target = (e: { target: EventTarget | null }) =>
    e.target instanceof Element ? e.target.closest('[data-tip]') : null

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const el = target(e)
    if (!el) return
    const els = points(box.current)
    const i = els.indexOf(el)
    const j = i < 0 ? null : rovingTarget(e.key, i, els.length)
    if (j === null) return
    e.preventDefault()
    if (j === i) return
    setStop(els, j)
    ;(els[j] as HTMLElement | SVGElement).focus()
  }

  return (
    <div
      ref={box}
      className={`${s.tipsBox}${className ? ` ${className}` : ''}`}
      onPointerMove={e => { const el = target(e); if (el) show(el, e.clientX, e.clientY); else if (e.pointerType === 'mouse') hide() }}
      onPointerLeave={e => { if (e.pointerType === 'mouse') hide() }}
      onPointerDown={e => { const el = target(e); if (el) show(el, e.clientX, e.clientY) }}
      onFocus={e => {
        const el = target(e)
        if (!el) return
        // A point focused by a click or by ←/→ becomes the chart's tab stop,
        // so Shift+Tab back into the chart returns to it.
        const els = points(box.current)
        const i = els.indexOf(el)
        if (i >= 0 && els.length > 1) setStop(els, i)
        show(el)
      }}
      onBlur={hide}
      onKeyDown={onKeyDown}
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
