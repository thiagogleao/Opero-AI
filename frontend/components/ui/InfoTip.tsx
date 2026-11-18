'use client'

/**
 * InfoTip — the ⓘ next to a label, with the full definition in a tooltip.
 * Accessible: a real button; opens on hover, keyboard focus and tap; the
 * bubble can be hovered without closing; Esc (focus stays put) or a tap
 * elsewhere closes; the content is linked with aria-describedby so screen
 * readers read it with the button. Rendered in a portal and positioned
 * `fixed`, so cards and table scrollers never clip it.
 *
 *   <InfoTip label="O que é lucro real">Receita − produto − frete − …</InfoTip>
 *   <InfoTip trigger="empate 1,58×">Receita ÷ contribuição …</InfoTip>  (text trigger)
 *
 * Props: { children: ReactNode (tooltip content, may be server-rendered);
 *          label?: string (accessible name of the ⓘ button, default "Mais informações");
 *          trigger?: ReactNode (render this inline text as the trigger instead of ⓘ);
 *          className? }
 */

import { useCallback, useEffect, useId, useLayoutEffect, useRef, useState, useSyncExternalStore, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import s from './InfoTip.module.css'

const noop = () => () => {}
/** False during SSR and hydration, true after: portals need document.body. */
export function useIsClient(): boolean {
  return useSyncExternalStore(noop, () => true, () => false)
}

export interface InfoTipProps {
  children: ReactNode
  label?: string
  trigger?: ReactNode
  className?: string
}

export function InfoTip({ children, label = 'Mais informações', trigger, className }: InfoTipProps) {
  const id = useId()
  const btn = useRef<HTMLButtonElement>(null)
  const tip = useRef<HTMLDivElement>(null)
  const [open, setOpen] = useState(false)
  const pinned = useRef(false) // opened by a click/tap: stays until dismissed
  // The bubble lives in document.body: no card or table scroller clips it,
  // and block content cannot end up nested inside a <p> or <h3>.
  const mounted = useIsClient()

  const place = useCallback(() => {
    const b = btn.current?.getBoundingClientRect()
    const t = tip.current
    if (!b || !t) return
    const tw = t.offsetWidth, th = t.offsetHeight
    const vw = window.innerWidth, vh = window.innerHeight
    let top = b.top - th - 8
    if (top < 8) top = Math.min(b.bottom + 8, vh - th - 8)
    let left = b.left + b.width / 2 - tw / 2
    left = Math.max(8, Math.min(left, vw - tw - 8))
    t.style.transform = `translate(${Math.round(left)}px, ${Math.round(top)}px)`
  }, [])

  useLayoutEffect(() => { if (open) place() }, [open, place])

  // Mouse users may move from the ⓘ onto the bubble (to read or select it)
  // without it vanishing: closing waits a beat and the bubble cancels it.
  const closeTimer = useRef<ReturnType<typeof setTimeout> | null>(null)
  const cancelClose = useCallback(() => {
    if (closeTimer.current) { clearTimeout(closeTimer.current); closeTimer.current = null }
  }, [])
  const closeSoon = useCallback(() => {
    cancelClose()
    closeTimer.current = setTimeout(() => { if (!pinned.current) setOpen(false) }, 140)
  }, [cancelClose])
  useEffect(() => cancelClose, [cancelClose])

  useEffect(() => {
    if (!open) return
    // Esc dismisses without moving focus (WCAG 1.4.13); refocusing the button
    // would reopen a tooltip that was opened by hover.
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') { pinned.current = false; cancelClose(); setOpen(false) } }
    const onDown = (e: PointerEvent) => {
      const t = e.target as Node
      if (btn.current?.contains(t) || tip.current?.contains(t)) return
      pinned.current = false
      setOpen(false)
    }
    const onMove = () => place()
    document.addEventListener('keydown', onKey)
    document.addEventListener('pointerdown', onDown)
    window.addEventListener('scroll', onMove, true)
    window.addEventListener('resize', onMove)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.removeEventListener('pointerdown', onDown)
      window.removeEventListener('scroll', onMove, true)
      window.removeEventListener('resize', onMove)
    }
  }, [open, place, cancelClose])

  return (
    <>
      <button
        ref={btn}
        type="button"
        className={`${trigger ? s.textTrigger : s.trigger}${className ? ` ${className}` : ''}`}
        aria-label={trigger ? undefined : label}
        aria-describedby={`${id}-tip`}
        aria-expanded={open}
        onPointerEnter={e => { if (e.pointerType === 'mouse') { cancelClose(); setOpen(true) } }}
        onPointerLeave={e => { if (e.pointerType === 'mouse' && !pinned.current) closeSoon() }}
        onFocus={() => setOpen(true)}
        onBlur={() => { if (!pinned.current) setOpen(false) }}
        onClick={() => { cancelClose(); pinned.current = !open || !pinned.current; setOpen(pinned.current) }}
      >
        {trigger ?? 'i'}
      </button>
      {mounted && createPortal(
        <div
          ref={tip} id={`${id}-tip`} role="tooltip" className={s.tip} hidden={!open}
          onPointerEnter={e => { if (e.pointerType === 'mouse') cancelClose() }}
          onPointerLeave={e => { if (e.pointerType === 'mouse' && !pinned.current) closeSoon() }}
        >
          {children}
        </div>,
        document.body,
      )}
    </>
  )
}
