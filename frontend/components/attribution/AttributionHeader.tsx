/**
 * The attribution verdict card: chips in words, the serif sentence (what Meta
 * says against what Shopify links to its ads), the gap as the big number, two
 * or three plain lines and the fine print; the reconciliation on the right.
 *
 * Same anatomy and voice as the shared <VerdictCard>, which is typed for the
 * profit verdict (a dollar amount, profit chips). This card's number is a gap
 * in percent and its chips are attribution states, so it is its own component
 * built from the same primitives (Card, Chip, RichLine, Icon). Server-safe.
 */

import type { ReactNode } from 'react'
import { Card, Chip, Icon, RichLine } from '@/components/ui'
import type { AttributionVerdict } from './verdict'
import s from './AttributionHeader.module.css'

const HERO_TONE = { pos: s.heroPos, neg: s.heroNeg, warn: s.heroWarn, neu: '', mut: s.heroMut } as const

export function AttributionHeader({ verdict: v, aside }: { verdict: AttributionVerdict; aside?: ReactNode }) {
  return (
    <Card as="section" className={`${s.card}${aside ? '' : ` ${s.single}`}`} aria-label="Veredito da atribuição">
      <div className={s.left}>
        <div className={s.chips}>
          {v.chips.map(c => <Chip key={c.key} tone={c.tone} icon={c.icon}>{c.label}</Chip>)}
          <span className={s.when}>{v.when}</span>
        </div>
        <h2 className={s.headline}>{v.headline}</h2>
        <div className={s.hero}>
          <span className={`${s.amount} ${HERO_TONE[v.hero.tone]}`}>{v.hero.value}</span>
          <span className={s.caption}>{v.hero.caption}</span>
        </div>
        {v.details.length > 0 && (
          <ul className={s.details}>
            {v.details.map((d, i) => <li key={i}><RichLine line={d} /></li>)}
          </ul>
        )}
        {v.notes.length > 0 && (
          <div className={s.notes}>
            <Icon name="info" size={14} />
            <div>{v.notes.map((n, i) => <p key={i}><RichLine line={n} /></p>)}</div>
          </div>
        )}
      </div>
      {aside && <div className={s.right}>{aside}</div>}
    </Card>
  )
}

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
