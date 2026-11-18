/**
 * PageHeader and PeriodNote — the top of a page's content. Server-safe.
 *
 *   <PageHeader ctx={ctx} title="MOKOO" actions={<ButtonLink …/>} />
 *     → "MOKOO [6k7fjw] [dia de Tóquio]" / "Últimos 7 dias · 10–16 nov"
 *   <PeriodNote ctx={ctx} />
 *     → "São 7 dias fechados no horário de Belém. Hoje (17 nov) ainda está em
 *        andamento: fica fora da soma."
 *
 * PageHeader props: { ctx: PageContext; title?: ReactNode (default ctx.scopeName);
 *   sub?: ReactNode (default "<periodLabel> · <rangeLabel>"); badges?: ReactNode;
 *   actions?: ReactNode; code?: string|null (default the store's domain code) }
 * PeriodNote props: { ctx: PageContext } — returns null when there is nothing to say.
 * periodNoteText(ctx) returns the same sentence as a string (or null).
 */

import type { ReactNode } from 'react'
import type { PageContext } from '@/lib/views/page'
import { formatDate, tzCity, dayOfLabel } from '@/lib/format'
import { Callout } from '@/components/ui/Card'
import { Chip, CodePill } from '@/components/ui/Chip'
import s from './shell.module.css'

export function PageHeader({ ctx, title, sub, badges, actions, code }: {
  ctx: PageContext; title?: ReactNode; sub?: ReactNode; badges?: ReactNode; actions?: ReactNode; code?: string | null
}) {
  const opt = ctx.scope === 'store' ? ctx.storeOptions.find(o => o.id === ctx.store?.id) : undefined
  const pill = code === undefined ? opt?.code ?? null : code
  return (
    <div className={s.pageHead}>
      <div>
        <div className={s.pageTitle}>
          <h1>{title ?? ctx.scopeName}</h1>
          {pill && <CodePill>{pill}</CodePill>}
          {opt?.dayLabel && <Chip tone="info" icon="clock" size="sm">{opt.dayLabel}</Chip>}
          {ctx.store?.archived && <Chip tone="mut" size="sm">arquivada</Chip>}
          {ctx.split && <Chip tone="neu" icon="split" size="sm">sua parte (50%)</Chip>}
          {badges}
        </div>
        <div className={s.pageSub}>
          {sub ?? <><b>{ctx.periodLabel}</b> · <span className="num">{ctx.rangeLabel}</span>{ctx.scope === 'all' ? ` · ${ctx.selected.length} lojas` : ''}</>}
        </div>
      </div>
      {actions && <div className={s.pageActions}>{actions}</div>}
    </div>
  )
}

/** "A", "A e B", "A, B e C". */
const joinPt = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`)

/** The one sentence that says which days are counted and on which clock. */
export function periodNoteText(ctx: PageContext): string | null {
  const city = ctx.scope === 'all' ? 'Brasília' : tzCity(ctx.timezone)
  const today = formatDate(ctx.today)
  const others = ctx.scope === 'all'
    ? ctx.selected.filter(st => dayOfLabel(st.timezone)).map(st => `${st.name} (${tzCity(st.timezone)})`)
    : []
  const tail = others.length
    ? ` Cada loja fecha o dia no próprio fuso: ${joinPt(others)} ${others.length === 1 ? 'conta' : 'contam'} as mesmas datas no relógio de lá.`
    : ''
  switch (ctx.period) {
    case 'today':
      return `Dia em andamento no horário de ${city}: os números mudam até meia-noite.${tail}`
    case 'yesterday':
      return `Ontem inteiro, ${ctx.rangeLabel}, no horário de ${city}.${tail}`
    case '7d': case '14d': case '30d': case '90d': {
      const n = ctx.period.replace('d', '')
      return `São ${n} dias fechados no horário de ${city}. Hoje (${today}) ainda está em andamento: fica fora da soma.${tail}`
    }
    case 'mtd':
      return `Do dia 1º até agora, no horário de ${city}: hoje entra parcial e é comparado com os mesmos dias do mês passado.${tail}`
    case 'lastmonth':
      return `O mês passado inteiro, no horário de ${city}.${tail}`
    case 'custom':
      return `${ctx.rangeLabel} no horário de ${city}${ctx.partial ? '; hoje entra parcial' : ''}.${tail}`
    default:
      return tail.trim() || null
  }
}

export function PeriodNote({ ctx }: { ctx: PageContext }) {
  const text = periodNoteText(ctx)
  if (!text) return null
  return <Callout tone="neu" icon="clock">{text}</Callout>
}
