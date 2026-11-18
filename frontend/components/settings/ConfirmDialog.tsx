'use client'

/**
 * A modal confirmation that says what will happen in words, on the native
 * <dialog> (focus trap, Esc and the backdrop handled by the browser).
 */

import { useEffect, useRef, type ReactNode } from 'react'
import { Button } from '@/components/ui'
import s from './settings.module.css'

export function ConfirmDialog({ open, title, children, confirmLabel, danger, pending, error, onConfirm, onClose }: {
  open: boolean
  title: ReactNode
  children: ReactNode
  confirmLabel: string
  danger?: boolean
  pending?: boolean
  /** Failure of the last attempt, shown inside the dialog (it stays open). */
  error?: string | null
  onConfirm: () => void
  onClose: () => void
}) {
  const ref = useRef<HTMLDialogElement>(null)
  useEffect(() => {
    const d = ref.current
    if (!d) return
    if (open && !d.open) d.showModal()
    if (!open && d.open) d.close()
  }, [open])

  return (
    <dialog
      ref={ref}
      className={s.dialog}
      onClose={onClose}
      onCancel={e => { if (pending) e.preventDefault() }}
      onClick={e => { if (e.target === ref.current && !pending) onClose() }}
    >
      {open && (
        <>
          <div className={s.dialogBody}>
            <div className={s.dialogTitle}>{title}</div>
            <div className={s.text}>{children}</div>
            {error && <div className={s.err} role="alert">{error}</div>}
          </div>
          <div className={s.dialogActions}>
            {/* A destructive choice (archive, unlink) never starts focused: Enter
                right after opening must not confirm it. */}
            <Button variant="ghost" onClick={onClose} disabled={pending} autoFocus={danger}>Cancelar</Button>
            <Button variant={danger ? 'danger' : 'primary'} pending={pending} onClick={onConfirm} autoFocus={!danger}>{confirmLabel}</Button>
          </div>
        </>
      )}
    </dialog>
  )
}
