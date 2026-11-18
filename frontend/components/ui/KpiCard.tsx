/**
 * KpiCard and KpiGrid — a label, one mono number, a one-line note, an optional
 * delta, a small chart and the full definition in an ⓘ tooltip. Server-safe.
 *
 *   <KpiGrid>
 *     <KpiCard label="Receita" value={<Money value={10942} />}
 *       note={<><b>134</b> pedidos · ticket <b>$81,66</b></>}
 *       delta={<Delta current={10942} previous={19281} label="vs 3–9 nov" goodWhen="neutral" />}
 *       spark={<Sparkline values={revenueByDay} ariaLabel="Receita por dia" />}
 *       info="Total pago pelos clientes nos pedidos não reembolsados, impostos incluídos." />
 *   </KpiGrid>
 *
 * KpiCard props: { label: string; value: ReactNode; note?: ReactNode; delta?: ReactNode;
 *   spark?: ReactNode; info?: ReactNode; swatch?: 'cogs'|'fees'|'shop'|'meta'|'profit'|'ship'|'fixed';
 *   tone?: 'pos'|'neg'|'mut' (colours the value); footnote?: ReactNode; wide?: boolean (2 columns) }
 * KpiGrid props: { children; columns?: number (fixed count; default auto-fill ≥200px) }
 */

import type { ReactNode } from 'react'
import { Card } from './Card'
import { InfoTip } from './InfoTip'
import s from './Kpi.module.css'

export interface KpiCardProps {
  label: string
  value: ReactNode
  note?: ReactNode
  delta?: ReactNode
  spark?: ReactNode
  info?: ReactNode
  swatch?: 'cogs' | 'fees' | 'shop' | 'meta' | 'profit' | 'ship' | 'fixed'
  tone?: 'pos' | 'neg' | 'mut'
  footnote?: ReactNode
  wide?: boolean
}

const TONE = { pos: s.valuePos, neg: s.valueNeg, mut: s.valueMut } as const

export function KpiCard({ label, value, note, delta, spark, info, swatch, tone, footnote, wide }: KpiCardProps) {
  return (
    <Card className={`${s.kpi}${wide ? ` ${s.wide}` : ''}`}>
      <div className={s.kh}>
        {swatch && <i className={`${s.swatch} ${s[swatch]}`} aria-hidden="true" />}
        <span className={s.label}>{label}</span>
        {info && <InfoTip label={`O que é: ${label}`}>{info}</InfoTip>}
      </div>
      <div className={`${s.value}${tone ? ` ${TONE[tone]}` : ''}`}>{value}</div>
      {note && <div className={s.note}>{note}</div>}
      {spark && <div className={s.viz}>{spark}</div>}
      {delta && <div>{delta}</div>}
      {footnote && <div className={s.foot}>{footnote}</div>}
    </Card>
  )
}

export function KpiGrid({ children, columns }: { children: ReactNode; columns?: number }) {
  return (
    <div className={s.grid} style={columns ? { gridTemplateColumns: `repeat(${columns}, minmax(0, 1fr))` } : undefined}>
      {children}
    </div>
  )
}
