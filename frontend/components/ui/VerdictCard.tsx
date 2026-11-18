/**
 * VerdictCard — every page opens with it: chips in words, the serif sentence,
 * the big number with what it means, two or three plain lines, the ROAS box
 * (one store) and the fine print; "Para onde foi cada dólar" on the right.
 * Server-safe.
 *
 *   const v = buildVerdict(verdictInputFromPortfolio(view, { split: ctx.split }))
 *   <VerdictCard verdict={v}
 *     aside={<BreakdownLedger pnl={v.totals} configured={v.basis !== 'revenue_minus_ads'} split={ctx.split}
 *                             title="Para onde foi cada dólar" sub={`De cada $1,00 vendido em ${ctx.rangeLabel}`} />} />
 *
 * Props: { verdict: Verdict (lib/views/verdict); aside?: ReactNode (right column);
 *          roas?: boolean (show the ROAS box when verdict.roas exists, default true);
 *          footer?: ReactNode (under the details, left column);
 *          compact?: boolean (phone: one column, smaller type);
 *          headingLevel?: 'h1'|'h2' (the sentence's element, default h2) }
 * The big number is verdict.amount (already halved in the split view).
 */

import type { ReactNode } from 'react'
import type { Verdict } from '@/lib/views/verdict'
import { formatMoney } from '@/lib/format'
import { Card } from './Card'
import { VerdictChips } from './Chip'
import { RichLine } from './Display'
import { Icon } from './Icon'
import { RoasGauge } from './RoasGauge'
import { breakEvenReason, REASON_WORDS } from './roasReason'
import s from './VerdictCard.module.css'

export interface VerdictCardProps {
  verdict: Verdict
  aside?: ReactNode
  roas?: boolean
  footer?: ReactNode
  compact?: boolean
  headingLevel?: 'h1' | 'h2'
}

export function VerdictCard({ verdict: v, aside, roas = true, footer, compact, headingLevel = 'h2' }: VerdictCardProps) {
  const H = headingLevel
  const amountClass = v.amount === null ? s.amountNone : v.amountTone === 'pos' ? s.amountPos : v.amountTone === 'neg' ? s.amountNeg : ''
  // The ROAS box is one store's: the verdict's basis says whether it has cost
  // settings, its totals whether it sold and what was left before ads — the
  // three different reasons a break-even can be missing.
  const facts = v.roas
    ? { breakEven: v.roas.breakEven, configured: v.basis !== 'revenue_minus_ads', revenue: v.totals.revenue, contribution: v.totals.contribution }
    : null
  const missing = facts ? breakEvenReason(facts) : null
  return (
    <Card as="section" className={`${s.card}${aside ? '' : ` ${s.single}`}${compact ? ` ${s.compact}` : ''}`} aria-label="Veredito">
      <div className={s.left}>
        <div className={s.chips}>
          <VerdictChips chips={v.chips} />
          <span className={s.when}>{v.when}</span>
        </div>
        <H className={s.headline}>{v.headline}</H>
        <div className={s.hero}>
          <span className={`${s.amount} ${amountClass}`}>{v.amount === null ? '—' : formatMoney(v.amount)}</span>
          <span className={s.caption}>{v.amountCaption}</span>
        </div>
        {v.details.length > 0 && (
          <ul className={s.details}>
            {v.details.map((d, i) => <li key={i}><RichLine line={d} /></li>)}
          </ul>
        )}
        {roas && v.roas && facts && (
          <div className={s.roasBox}>
            {/* The verdict names the spend its ROAS divides by (Meta, Anúncios
                Shopify or both) and words the sentence under it; the fallbacks
                are the Meta-only box. */}
            <RoasGauge roas={v.roas.roas} {...facts} reason={v.roas.reason ?? null} label={v.roas.label ?? 'ROAS da loja'} />
            <p className={s.roasExplain}>
              {v.roas.explain ?? (missing === null && v.roas.breakEven
                ? `Cada $1 no Meta trouxe ${formatMoney(v.roas.roas, { cents: 'always' })} em vendas da loja (todas as vendas, não só as que o Meta atribui a si). Abaixo de ${formatMoney(v.roas.breakEven, { cents: 'always' })} a loja passa a perder dinheiro com o Meta.`
                : REASON_WORDS[missing ?? 'unknown'].explain)}
            </p>
          </div>
        )}
        {v.notes.length > 0 && (
          <div className={s.notes}>
            <Icon name="info" size={14} />
            <div>{v.notes.map((n, i) => <p key={i}><RichLine line={n} /></p>)}</div>
          </div>
        )}
        {footer && <div className={s.footer}>{footer}</div>}
      </div>
      {aside && <div className={s.right}>{aside}</div>}
    </Card>
  )
}
