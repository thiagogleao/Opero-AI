'use client'

/**
 * Bottom sheet (modal dialog) for the phone. A local primitive: the shared
 * library has no sheet. Esc and a tap on the backdrop close it; focus moves in
 * on open and back to the opener on close; the page behind does not scroll.
 */

import { useEffect, useId, useRef, type ReactNode } from 'react'
import { createPortal } from 'react-dom'
import { Icon } from '@/components/ui'
import s from '../sheet.module.css'

export function Sheet({ title, lede, onClose, children }: {
  title: ReactNode
  lede?: ReactNode
  onClose: () => void
  children: ReactNode
}) {
  const id = useId()
  const ref = useRef<HTMLDivElement>(null)
  const closeRef = useRef(onClose)

  useEffect(() => { closeRef.current = onClose }, [onClose])

  useEffect(() => {
    const opener = document.activeElement as HTMLElement | null
    const prevOverflow = document.body.style.overflow
    document.body.style.overflow = 'hidden'
    const first = ref.current?.querySelector<HTMLElement>('button, [href], input, select, textarea, [tabindex]:not([tabindex="-1"])')
    first?.focus()
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') { e.stopPropagation(); closeRef.current() }
      if (e.key === 'Tab' && ref.current) {
        // Keep Tab inside the sheet.
        const items = [...ref.current.querySelectorAll<HTMLElement>('button:not(:disabled), [href], input:not(:disabled), select, textarea, [tabindex]:not([tabindex="-1"])')]
        if (!items.length) return
        const [a, z] = [items[0], items[items.length - 1]]
        if (e.shiftKey && document.activeElement === a) { e.preventDefault(); z.focus() }
        else if (!e.shiftKey && document.activeElement === z) { e.preventDefault(); a.focus() }
      }
    }
    document.addEventListener('keydown', onKey)
    return () => {
      document.removeEventListener('keydown', onKey)
      document.body.style.overflow = prevOverflow
      opener?.focus?.()
    }
  }, [])

  return createPortal(
    <div className={s.backdrop} onClick={() => closeRef.current()}>
      <div
        ref={ref}
        className={s.sheet}
        role="dialog"
        aria-modal="true"
        aria-labelledby={`${id}-t`}
        onClick={e => e.stopPropagation()}
      >
        <div className={s.grab} aria-hidden="true" />
        <div className={s.head}>
          <h2 id={`${id}-t`}>{title}</h2>
          <button type="button" className={s.close} onClick={() => closeRef.current()} aria-label="Fechar">
            <Icon name="x" size={16} />
          </button>
        </div>
        {lede && <p className={s.lede}>{lede}</p>}
        {children}
      </div>
    </div>,
    document.body,
  )
}

export function Switch({ on, onChange, label, disabled }: {
  on: boolean; onChange: (v: boolean) => void; label: string; disabled?: boolean
}) {
  return (
    <button
      type="button" role="switch" aria-checked={on} aria-label={label} disabled={disabled}
      className={s.switch} onClick={() => onChange(!on)}
    >
      <span aria-hidden="true" />
    </button>
  )
}

/** Speaker icon (the shared set has none), on or off. */
export function SoundIcon({ on, size = 17 }: { on: boolean; size?: number }) {
  return (
    <svg width={size} height={size} viewBox="0 0 16 16" aria-hidden="true">
      <path d="M2.5 6h2.2L8 3.3v9.4L4.7 10H2.5Z" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinejoin="round" />
      {on ? (
        <path d="M10.6 5.6a3.4 3.4 0 0 1 0 4.8M12.4 3.9a5.8 5.8 0 0 1 0 8.2" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      ) : (
        <path d="m10.5 6 3.5 4m0-4-3.5 4" fill="none" stroke="currentColor" strokeWidth="1.5" strokeLinecap="round" />
      )}
    </svg>
  )
}
