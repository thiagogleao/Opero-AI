'use client'

/**
 * StatusLine — the band's one row of chips (two at most), with the comparison
 * words at its right end. Chips that do not fit in two rows fold, lowest
 * priority first (each chip wrapper carries `data-rank`, lib/views/numberBand
 * chipRank), into a "+N" chip that expands the line in place: a chip is never
 * dropped, only folded. Chips streamed in later (a Suspense slot) are measured
 * too. The fold is DOM-only (display and the button's text), so measuring
 * never re-renders.
 *
 * Props: { children: the chip nodes (each root an element with data-rank);
 *          comparison?: ReactNode (right end); maxRows?: number (default 2) }
 */

import { useCallback, useLayoutEffect, useRef, useState, type ReactNode } from 'react'
import s from './numbers.module.css'

export function StatusLine({ children, comparison, maxRows = 2 }: { children: ReactNode; comparison?: ReactNode; maxRows?: number }) {
  const box = useRef<HTMLDivElement>(null)
  const more = useRef<HTMLButtonElement>(null)
  const [open, setOpen] = useState(false)
  /** The first chip the "+N" revealed: focus moves there, since the button
   *  itself disappears and focus would otherwise drop to <body>. */
  const reveal = useRef<HTMLElement | null>(null)

  const fit = useCallback(() => {
    const el = box.current
    const btn = more.current
    if (!el || !btn) return
    const items = Array.from(el.querySelectorAll<HTMLElement>(':scope > [data-rank]'))
    items.forEach(it => { it.style.display = '' })
    btn.hidden = true
    btn.setAttribute('aria-expanded', String(open))
    if (open) {
      const first = reveal.current
      reveal.current = null
      if (first) {
        const target = first.querySelector<HTMLElement>('button, a[href], [tabindex]') ?? first
        if (target === first) first.tabIndex = -1
        target.focus()
      }
      return
    }
    const rows = () => {
      const tops = new Set<number>()
      for (const c of Array.from(el.children) as HTMLElement[]) {
        if (c.hidden || c.style.display === 'none' || c.offsetParent === null) continue
        tops.add(Math.round(c.offsetTop / 6))
      }
      return tops.size
    }
    if (rows() <= maxRows) return
    btn.hidden = false
    const order = [...items].sort((a, b) => Number(b.dataset.rank) - Number(a.dataset.rank))
    let n = 0
    for (const it of order) {
      it.style.display = 'none'
      n += 1
      btn.textContent = `+${n}`
      btn.setAttribute('aria-label', `Mostrar mais ${n} ${n === 1 ? 'aviso' : 'avisos'}`)
      if (rows() <= maxRows) break
    }
  }, [open, maxRows])

  useLayoutEffect(() => {
    fit()
    const el = box.current
    if (!el) return
    const ro = new ResizeObserver(() => fit())
    ro.observe(el)
    // A chip streamed in by Suspense after the first paint.
    const mo = new MutationObserver(muts => { if (muts.some(m => m.type === 'childList')) fit() })
    mo.observe(el, { childList: true })
    return () => { ro.disconnect(); mo.disconnect() }
  }, [fit])

  return (
    <div ref={box} className={s.status}>
      {children}
      <button
        ref={more} type="button" className={s.more} hidden aria-expanded="false"
        onClick={() => {
          // The first folded chip in reading order.
          reveal.current = Array.from(box.current?.querySelectorAll<HTMLElement>(':scope > [data-rank]') ?? []).find(it => it.style.display === 'none') ?? null
          setOpen(true)
        }}
      >+</button>
      {comparison && <span className={s.cmp}>{comparison}</span>}
    </div>
  )
}
