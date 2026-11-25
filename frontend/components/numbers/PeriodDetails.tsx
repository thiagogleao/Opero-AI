/**
 * PeriodDetails — "Detalhes do período": the one home of the explanatory
 * prose that used to sit above the numbers (the verdict's sentence, its
 * lines, the comparison, the fine print, the ROAS explanation, the period
 * sentence and the page's callouts). A native <details>, closed by default,
 * right under the band. Server-safe.
 *
 *   <PeriodDetails details={band.details} extraCount={2}>
 *     <p>{periodNoteText(ctx, { compared: true })}</p>
 *     <SharedAccountNote … />
 *   </PeriodDetails>
 *
 * Props: { details?: NumberBand['details'] | null; children?: ReactNode (page items,
 *          after the verdict's); extraCount?: number (page items, for the summary
 *          count); title?: string (default "Detalhes do período"); open?: boolean }
 */

import type { ReactNode } from 'react'
import type { NumberBand } from '@/lib/views/numberBand'
import { RichLine } from '@/components/ui/Display'
import s from './numbers.module.css'

export function PeriodDetails({ details, children, extraCount = 0, title = 'Detalhes do período', open }: {
  details?: NumberBand['details'] | null; children?: ReactNode; extraCount?: number; title?: string; open?: boolean
}) {
  const count = (details?.count ?? 0) + extraCount
  if (!count && !children) return null
  return (
    <details className={s.details} open={open}>
      <summary className={s.summary}>
        {title}
        {count > 0 && <span className={s.count}>· {count} {count === 1 ? 'item' : 'itens'}: o resumo em frases, comparação e avisos</span>}
      </summary>
      <div className={s.detBody}>
        {details?.headline && <p className={s.headline}>{details.headline}</p>}
        {details && details.lines.length > 0 && (
          <ul className={s.lines}>{details.lines.map((l, i) => <li key={i}><RichLine line={l} /></li>)}</ul>
        )}
        {details?.when && <p className={s.when}>{details.when}</p>}
        {details && details.notes.length > 0 && (
          <div className={s.notes}>{details.notes.map((n, i) => <p key={i}><RichLine line={n} /></p>)}</div>
        )}
        {details?.roasExplain && <p className={s.para}>{details.roasExplain}</p>}
        {children && <div className={s.extra}>{children}</div>}
      </div>
    </details>
  )
}

/** A paragraph of page prose inside PeriodDetails (the period sentence…). */
export function DetailPara({ children }: { children: ReactNode }) {
  return <p className={s.para}>{children}</p>
}
