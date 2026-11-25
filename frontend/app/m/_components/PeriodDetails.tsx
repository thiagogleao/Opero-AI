'use client'

/**
 * "Detalhes do período" on the phone (spec §1.6): the one home of the
 * verdict's prose — headline, details, the comparison sentence, notes (with
 * the live countdown), the ROAS explanation, the previous window's absolute
 * numbers (C10) and the page callouts (shared ad accounts with "Ver as lojas
 * juntas", the archived store). Closed by default; one tap opens it.
 */

import { useId, useState, type ReactNode } from 'react'
import { Icon, RichLine } from '@/components/ui'
import type { NumberBand } from '@/lib/views/numberBand'
import s from './PeriodDetails.module.css'

export function PeriodDetails({ band, before, extra, extraCount = 0 }: {
  band: NumberBand
  /** "Antes (vs 1–25 out): lucro −$4.609 · vendas $35.283 · 552 pedidos". */
  before?: string | null
  /** Page callouts, full text and buttons. */
  extra?: ReactNode
  extraCount?: number
}) {
  const [open, setOpen] = useState(false)
  const id = useId()
  const d = band.details
  const count = d.count + (before ? 1 : 0) + extraCount
  if (count === 0) return null
  return (
    <section className={s.box} aria-label="Detalhes do período">
      <button type="button" className={s.summary} aria-expanded={open} aria-controls={id} onClick={() => setOpen(v => !v)}>
        <Icon name="chevRight" size={14} className={open ? s.chevOpen : s.chev} />
        <span>Detalhes do período</span>
        <small>{count}</small>
      </button>
      <div id={id} hidden={!open} className={s.body}>
        {d.headline && <p className={s.headline}>{d.headline}</p>}
        {d.lines.length > 0 && (
          <ul className={s.lines}>
            {d.lines.map((l, i) => <li key={i}><RichLine line={l} /></li>)}
          </ul>
        )}
        {d.when && <p className={s.when}>{d.when}</p>}
        {d.notes.length > 0 && (
          <ul className={s.notes}>
            {d.notes.map((l, i) => <li key={i}><RichLine line={l} /></li>)}
          </ul>
        )}
        {d.roasExplain && <p className={s.para}>{d.roasExplain}</p>}
        {before && <p className={s.para}>{before}</p>}
        {extra && <div className={s.extra}>{extra}</div>}
      </div>
    </section>
  )
}
