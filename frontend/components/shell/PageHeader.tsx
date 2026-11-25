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
 *   sub?: ReactNode (default "<periodLabel> · <rangeLabel>"; a custom period,
 *   whose label is its range, reads "Período escolhido · 1–10 nov"); badges?: ReactNode;
 *   actions?: ReactNode; code?: string|null (default the store's domain code);
 *   halved?: boolean (default true) — under ?parte=50, whether this page shows
 *   a money result halved (profit, profit/order, cash result, refunds: it uses
 *   ctx.part). Pass false on a page with none of them (Produtos, Países e
 *   clientes, Atribuição, Campanhas · Todas, Ajustes): the chip then says
 *   nothing on the page is halved, instead of "sua parte (50%)" over a
 *   whole-store contribution that reads as the partner's half. }
 * SplitChip props: { halved: boolean } — that chip alone (splitChipText(halved)
 * gives its label and title).
 * PeriodNote props: { ctx: PageContext; compared?: boolean } — returns null when
 *   there is nothing to say. `compared`: the page sets the period against its
 *   comparison (the Resumo); an archived store's note then also says what its
 *   read days are compared with. Pages that compare nothing leave it out.
 * periodNoteText(ctx, { compared }) returns the same sentence as a string (or null).
 * periodName(ctx) is the bold name of the period, from lib/period's one naming
 * function (Resolution.label, R7): "Últimos 7 dias" for a preset (the range
 * follows), the dates themselves for a dates value ("1–15 nov", "24 nov
 * (hoje)", "25 nov · ainda não começou em Brasília"). Under the sub, the
 * landing notes (R4 scope change, R5 remembered store gone, R11 starts
 * inside…) read as one line.
 */

import type { ReactNode } from 'react'
import type { PageContext } from '@/lib/views/page'
import { formatDate, formatRangeLabel, tzCity } from '@/lib/format'
import { offsetDiffers } from '@/lib/period'
import { Callout } from '@/components/ui/Card'
import { Chip, CodePill } from '@/components/ui/Chip'
import { InfoTip } from '@/components/ui/InfoTip'
import { splitChipText } from './splitChip'
import s from './shell.module.css'

/** The period's name (R7): the preset's label, or the dates as asked. */
export function periodName(ctx: Pick<PageContext, 'resolution'>): string {
  const r = ctx.resolution
  return r.selection.period.kind === 'preset' ? r.label.short : r.label.full
}

/**
 * The period as a header names it (R7, one name from Resolution.label): a
 * preset's label and then its dates ("Últimos 7 dias · 17–23 nov"); a dates
 * value its range once ("10–20 nov") — never "10–20 nov · 10–20 nov". Every
 * header that prints the period (the default sub, Atribuição's) uses this.
 */
export function PeriodHeading({ ctx }: { ctx: Pick<PageContext, 'resolution' | 'rangeLabel'> }) {
  return <>
    <b>{periodName(ctx)}</b>
    {ctx.resolution.selection.period.kind === 'preset' && <> · <span className="num">{ctx.rangeLabel}</span></>}
  </>
}

export { splitChipText }

/** The header's chip under ?parte=50 (see PageHeader `halved`). */
export function SplitChip({ halved }: { halved: boolean }) {
  const { label, title } = splitChipText(halved)
  return <Chip tone={halved ? 'neu' : 'mut'} icon="split" size="sm" title={title}>{label}</Chip>
}

export function PageHeader({ ctx, title, sub, badges, actions, code, halved = true, periodInfo }: {
  ctx: PageContext; title?: ReactNode; sub?: ReactNode; badges?: ReactNode; actions?: ReactNode; code?: string | null; halved?: boolean
  /** The PeriodNote sentence as an ⓘ after the period sub-line, instead of a
   *  box above the content (pass { compared: true } on the Resumo). */
  periodInfo?: boolean | { compared?: boolean }
}) {
  const periodText = periodInfo ? periodNoteText(ctx, { compared: typeof periodInfo === 'object' && !!periodInfo.compared }) : null
  // The store itself, not a lookup in storeOptions: an archived store's
  // history page lost its code pill and "dia de …" chip that way.
  const opt = ctx.storeOption
  const pill = code === undefined ? opt?.code ?? null : code
  return (
    <div className={s.pageHead}>
      <div>
        <div className={s.pageTitle}>
          <h1>{title ?? ctx.scopeName}</h1>
          {pill && <CodePill>{pill}</CodePill>}
          {opt?.dayLabel && <Chip tone="info" icon="clock" size="sm">{opt.dayLabel}</Chip>}
          {ctx.store?.archived && <Chip tone="mut" size="sm">arquivada</Chip>}
          {ctx.split && <SplitChip halved={halved} />}
          {ctx.rangeNote && <Chip tone="warn" icon="alert" size="sm" title={ctx.rangeNote}>período ajustado</Chip>}
          {badges}
        </div>
        <div className={s.pageSub}>
          {sub ?? <>
            <PeriodHeading ctx={ctx} />
            {ctx.scope === 'all' ? ` · ${ctx.selected.length} lojas` : ''}
          </>}
          {periodText && <> <InfoTip label="Como o período é contado">{periodText}</InfoTip></>}
        </div>
        {ctx.noteLine && <div className={s.noteLine} role="note">{ctx.noteLine}</div>}
      </div>
      {actions && <div className={s.pageActions}>{actions}</div>}
    </div>
  )
}

/** "A", "A e B", "A, B e C". */
const joinPt = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`)

/** The one sentence that says which days are counted and on which clock. */
export function periodNoteText(ctx: PageContext, opts: { compared?: boolean } = {}): string | null {
  const city = ctx.scope === 'all' ? 'Brasília' : tzCity(ctx.timezone)
  const today = formatDate(ctx.today)
  const others = ctx.scope === 'all'
    ? ctx.selected.filter(st => offsetDiffers(st.timezone, ctx.now)).map(st => `${st.name} (${tzCity(st.timezone)})`)
    : []
  const tail = others.length
    ? ` Cada loja fecha o dia no próprio fuso: ${joinPt(others)} ${others.length === 1 ? 'conta' : 'contam'} as mesmas datas no relógio de lá.`
    : ''
  // An archived store reads nothing after its archive day: no day "em
  // andamento", no "hoje entra parcial" (Squishy World on Hoje said both).
  const archived = ctx.scope === 'store' && !!ctx.store?.archived
  if (archived) {
    const note = archivedNoteText(ctx, city, !!opts.compared)
    if (note) return note
  }
  switch (ctx.period) {
    case 'today':
      return `Dia em andamento no horário de ${city}: os números mudam até meia-noite.${tail}`
    case 'yesterday':
      return `Ontem inteiro, ${ctx.rangeLabel}, no horário de ${city}.${tail}`
    case '7d': case '14d': case '30d': case '90d': {
      const n = ctx.period.replace('d', '')
      // An archived store has no day in progress.
      return `São ${n} dias fechados no horário de ${city}.${archived ? '' : ` Hoje (${today}) ainda está em andamento: fica fora da soma.`}${tail}`
    }
    case 'mtd':
      return `Do dia 1º até agora, no horário de ${city}: hoje entra parcial e é comparado com os mesmos dias do mês passado.${tail}`
    case 'lastmonth':
      return `O mês passado inteiro, no horário de ${city}.${tail}`
    case 'custom':
      // The fit note (R9) is the header's own line (ctx.noteLine), not repeated here.
      return `${ctx.rangeLabel} no horário de ${city}${ctx.partial ? '; hoje entra parcial' : ''}.${tail}`
    default:
      return tail.trim() || null
  }
}

/** "1–10 nov" with "foi/foram lido(s)" agreeing with it. */
const readDays = (from: string, to: string, label: string) =>
  from === to ? `${label} foi lido` : `${label} foram lidos`

/** "os mesmos dias do mês passado", "os 17 dias anteriores", "o dia anterior". */
const withArticle = (label: string) => (label === 'dia anterior' ? `o ${label}` : `os ${label}`)

/**
 * The note of an archived store (lib/views/page archivedWindow) for a window
 * that reaches its archive day, or — the day unknown — today; null for a
 * window wholly before it, which reads like any other. It names the archive
 * day and the days that were read and, on a page that compares (`compared`),
 * what they are compared with: Squishy World · Este mês is compared on 1–10
 * nov against 1–10 out, and a chip reading "vs mesmos dias do mês passado
 * (1–10 out)" next to "1–24 nov" needs that said. Elsewhere (Atribuição sets
 * Meta against Shopify) a comparison sentence would describe nothing on screen.
 */
function archivedNoteText(ctx: PageContext, city: string, compared: boolean): string | null {
  const head = `${ctx.rangeLabel} no horário de ${city}.`
  // The fit note (R9) is the header's own line (ctx.noteLine).
  const tail = ''
  const on = ctx.archivedOn
  if (!on) {
    return ctx.range.to >= ctx.today
      ? `${head} A loja está arquivada e não sincroniza mais: nada depois do arquivamento é lido, e estes números não mudam.${tail}`
      : null
  }
  if (ctx.range.to < on) return null
  const day = formatDate(on, ctx.today)
  if (ctx.range.from > on) {
    return `${head} A loja foi arquivada em ${day} e não sincroniza mais: nada ${ctx.range.from === ctx.range.to ? 'desse dia' : 'desses dias'} foi lido.${tail}`
  }
  const read = ctx.readRange
  if (!read) {
    // The window ends on the archive day: every day of it was read.
    return `${head} A loja foi arquivada em ${day}, o último dia lido, e estes números não mudam.${tail}`
  }
  const readLabel = formatRangeLabel(read, ctx.today)
  return `${head} A loja foi arquivada em ${day} e não sincroniza mais: só ${readDays(read.from, read.to, readLabel)}, e estes números não mudam.${compared ? ` A comparação usa ${withArticle(ctx.comparison.label)}: ${ctx.comparisonRangeLabel}.` : ''}${tail}`
}

export function PeriodNote({ ctx, compared }: { ctx: PageContext; compared?: boolean }) {
  const text = periodNoteText(ctx, { compared })
  if (!text) return null
  return <Callout tone="neu" icon="clock">{text}</Callout>
}
