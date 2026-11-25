/**
 * The attribution page's aside pieces (AsideTitle, AsideNote) for the
 * "O que cada lado conta" block. The verdict card that lived here was replaced
 * by the page number row (AttributionRow) and removed in review round 1.
 * Server-safe.
 */

import type { ReactNode } from 'react'
import s from './AttributionHeader.module.css'

/** The right column's title block ("O que cada lado conta"). */
export function AsideTitle({ title, sub }: { title: ReactNode; sub?: ReactNode }) {
  return (
    <div className={s.asideHead}>
      <h3 className={s.asideTitle}>{title}</h3>
      {sub && <p className={s.asideSub}>{sub}</p>}
    </div>
  )
}

export function AsideNote({ children }: { children: ReactNode }) {
  return <p className={s.asideNote}>{children}</p>
}
