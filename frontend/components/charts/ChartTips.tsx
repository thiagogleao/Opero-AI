'use client'

/**
 * ChartTips — the tiny client layer that gives a server-rendered SVG chart its
 * tooltips. Any descendant with a `data-tip` attribute (built with tipAttr()
 * from ./scale) shows a bubble on hover and on keyboard focus.
 *
 * Pin: a click or a tap on a point (or Enter/Space on a focused one) PINS its
 * bubble — anchored above the point, never under the cursor, with a thin
 * outline — so a number can be read without holding the pointer still. It
 * stays when the pointer leaves and when the page scrolls (repositioned, not
 * hidden). While pinned, hovering another point shows that point's transient
 * bubble; leaving returns to the pinned one. Unpin: click the pinned point
 * again, Esc, or click outside the chart. A drag (8 px or more) never pins.
 * The pinned point carries `data-pinned`; the shown one `data-active`.
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

import { useCallback, useEffect, useLayoutEffect, useRef, useState, type KeyboardEvent as ReactKeyboardEvent, type ReactNode } from 'react'
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

/** Movement past this many pixels between press and release is a drag. */
const DRAG_PX = 8

interface Shown { el: Element; tip: ChartTip; pinned: boolean }

export function ChartTips({ children, className }: { children: ReactNode; className?: string }) {
  const box = useRef<HTMLDivElement>(null)
  const bubble = useRef<HTMLDivElement>(null)
  const [shown, setShown] = useState<Shown | null>(null)
  const mounted = useIsClient()
  /** The pointer, for a transient (hover) bubble. */
  const at = useRef<{ x: number; y: number } | null>(null)
  /** The point under the pointer or focus (transient) and the pinned one. */
  const hover = useRef<Element | null>(null)
  const pin = useRef<Element | null>(null)
  const down = useRef<{ x: number; y: number; el: Element | null } | null>(null)

  const place = useCallback(() => {
    const b = bubble.current
    const cur = hover.current ?? pin.current
    if (!b || !cur) return
    const w = b.offsetWidth, h = b.offsetHeight
    const vw = window.innerWidth, vh = window.innerHeight
    // The shell's sticky top bar is 56 px on one row and ~100 px when it wraps
    // (1024): the bubble never goes under it, so it never covers its buttons.
    const minTop = Math.max(8, (document.querySelector('[data-shell-top]')?.getBoundingClientRect().bottom ?? 0) + 8)
    let left: number, top: number
    if (cur === pin.current || !at.current) {
      // Anchored above the point (below it when there is no room).
      const r = cur.getBoundingClientRect()
      left = r.left + r.width / 2 - w / 2
      top = r.top - h - 10
      if (top < minTop) top = Math.max(minTop, Math.min(r.bottom + 10, vh - h - 8))
      left = Math.max(8, Math.min(left, vw - w - 8))
    } else {
      const { x, y } = at.current
      left = x + 14; top = y + 14
      if (left + w > vw - 8) left = x - w - 14
      if (top + h > vh - 8) top = y - h - 14
      left = Math.max(8, left); top = Math.max(minTop, top)
    }
    b.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
  }, [])

  /** Reflect hover/pin in the DOM attributes and the bubble state. */
  const sync = useCallback(() => {
    const el = hover.current ?? pin.current
    box.current?.querySelectorAll('[data-active]').forEach(n => { if (n !== el) n.removeAttribute('data-active') })
    box.current?.querySelectorAll('[data-pinned]').forEach(n => { if (n !== pin.current) n.removeAttribute('data-pinned') })
    pin.current?.setAttribute('data-pinned', '')
    if (!el) { setShown(null); return }
    el.setAttribute('data-active', '')
    const pinned = el === pin.current
    setShown(prev => {
      if (prev && prev.el === el && prev.pinned === pinned) return prev
      try {
        const raw = el.getAttribute('data-tip')
        return raw ? { el, tip: JSON.parse(raw) as ChartTip, pinned } : null
      } catch { return null /* a malformed tip is just not shown */ }
    })
  }, [])

  useLayoutEffect(() => { if (shown) place() }, [shown, place])

  const setHover = useCallback((el: Element | null, x?: number, y?: number) => {
    at.current = x === undefined || y === undefined ? null : { x, y }
    const same = hover.current === el
    hover.current = el
    if (same) place()
    else sync()
  }, [place, sync])

  const togglePin = useCallback((el: Element, touch = false) => {
    if (pin.current === el) {
      pin.current = null
      // A finger does not hover: unpinning clears the bubble too.
      if (touch) hover.current = null
    } else {
      pin.current = el
    }
    sync()
    requestAnimationFrame(place)
  }, [place, sync])

  const clearAll = useCallback(() => {
    pin.current = null
    hover.current = null
    sync()
  }, [sync])

  useEffect(() => {
    if (!shown) return
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') clearAll() }
    const onDown = (e: PointerEvent) => { if (box.current && !box.current.contains(e.target as Node)) clearAll() }
    // A scroll drops the transient bubble and keeps the pinned one, moved.
    const onScroll = () => {
      if (hover.current && hover.current !== pin.current) { hover.current = null; sync() }
      requestAnimationFrame(place)
    }
    const onResize = () => place()
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', onScroll, true)
    window.addEventListener('resize', onResize)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', onScroll, true)
      window.removeEventListener('resize', onResize)
    }
  }, [shown, clearAll, place, sync])

  // One tab stop per chart (see the header). Runs after hydration and whenever
  // the chart's markup is replaced; the focused point keeps the stop. A pin
  // whose point left the DOM (new data) is dropped.
  useEffect(() => {
    const els = points(box.current)
    if (pin.current && !box.current?.contains(pin.current)) { pin.current = null; hover.current = null; requestAnimationFrame(sync) }
    if (els.length < 2) return
    const focused = els.findIndex(el => el === document.activeElement)
    setStop(els, rovingStop(els.map(el => el.getAttribute('tabindex')), focused))
  }, [children, sync])

  const target = (e: { target: EventTarget | null }) =>
    e.target instanceof Element ? e.target.closest('[data-tip]') : null

  const onKeyDown = (e: ReactKeyboardEvent) => {
    const el = target(e)
    if (!el) return
    if (e.key === 'Enter' || e.key === ' ') {
      e.preventDefault()
      togglePin(el)
      return
    }
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
      onPointerMove={e => {
        const el = target(e)
        if (el) setHover(el, e.clientX, e.clientY)
        else if (e.pointerType === 'mouse' && hover.current) setHover(null)
      }}
      onPointerLeave={e => { if (e.pointerType === 'mouse') setHover(null) }}
      onPointerDown={e => {
        const el = target(e)
        down.current = { x: e.clientX, y: e.clientY, el }
        if (el && e.pointerType !== 'mouse') setHover(el, e.clientX, e.clientY)
      }}
      onPointerUp={e => {
        const d = down.current
        down.current = null
        const el = target(e)
        if (!d || !el || d.el !== el) return
        if (Math.hypot(e.clientX - d.x, e.clientY - d.y) >= DRAG_PX) return
        togglePin(el, e.pointerType !== 'mouse')
      }}
      onPointerCancel={() => { down.current = null }}
      onFocus={e => {
        const el = target(e)
        if (!el) return
        // A point focused by a click or by ←/→ becomes the chart's tab stop,
        // so Shift+Tab back into the chart returns to it.
        const els = points(box.current)
        const i = els.indexOf(el)
        if (i >= 0 && els.length > 1) setStop(els, i)
        // Focus from a click keeps the pointer's position; from the keyboard
        // the bubble is anchored on the point.
        setHover(el, down.current?.x, down.current?.y)
      }}
      onBlur={() => { if (hover.current && hover.current !== pin.current) setHover(null) }}
      onKeyDown={onKeyDown}
    >
      {children}
      {mounted && shown && createPortal(
        <div ref={bubble} className={`${s.bubble}${shown.pinned ? ` ${s.bubblePinned}` : ''}`} role="tooltip">
          <div className={s.bubbleTitle}>{shown.tip.title}</div>
          {shown.tip.rows?.map(([k, v, tone], i) => (
            <div key={i} className={s.bubbleRow}>
              <span>{k}</span>
              <span className={tone ? s[tone] : undefined}>{v}</span>
            </div>
          ))}
          {shown.tip.note && <div className={s.bubbleNote}>{shown.tip.note}</div>}
        </div>,
        document.body,
      )}
    </div>
  )
}
