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
 * periodName(ctx) is the bold name before the range ("Últimos 7 dias", or
 * "Período escolhido" for a custom range; row dates name their preset and
 * whose they are: "Hoje de Todas as lojas", "Ontem da Hibikura"): use it in a
 * custom sub so the range is not printed twice.
 */

import type { ReactNode } from 'react'
import type { PageContext } from '@/lib/views/page'
import { PERIODS, type Period } from '@/lib/engine/dates'
import { formatDate, formatRangeLabel, tzCity, dayOfLabel } from '@/lib/format'
import { Callout } from '@/components/ui/Card'
import { Chip, CodePill } from '@/components/ui/Chip'
import s from './shell.module.css'

/** "Últimos 7 dias"; a custom period, whose label IS its range ("1–10 nov"),
 *  is named "Período escolhido" so a header never prints the range twice. */
export function periodName(
  ctx: Pick<PageContext, 'periodLabel' | 'rangeLabel'> & { params?: { volta?: Period }; scope?: 'store' | 'all'; rowDatesOf?: string | null },
): string {
  // Dates a link read on another clock (lib/views/page PageParams.volta) are
  // not a period the owner chose: name the preset they stand for, and whose
  // (ctx.rowDatesOf: Todas on a store page, the store they came from on Todas).
  const volta = ctx.params?.volta
  if (volta) return `${presetLabel(volta)} ${ctx.scope === 'all' ? `da ${ctx.rowDatesOf ?? 'outra loja'}` : 'de Todas as lojas'}`
  return ctx.periodLabel === ctx.rangeLabel ? 'Período escolhido' : ctx.periodLabel
}

/** "Hoje", "Últimos 7 dias": a preset's name. */
const presetLabel = (p: Period) => PERIODS.find(x => x.key === p)?.label ?? p

/** The partner-view chip's words: what the page halves, and what it never does. */
export function splitChipText(halved: boolean): { label: string; title: string } {
  return halved
    ? {
        label: 'sua parte (50%)',
        title: 'Visão de sócio: lucro, lucro por pedido, resultado de caixa e reembolsos aparecem pela metade, a sua parte. Vendas, gastos, contribuição, margens, ROAS e empate ficam inteiros.',
      }
    : {
        label: 'sua parte (50%) · nada é dividido aqui',
        title: 'Visão de sócio: só lucro, lucro por pedido, resultado de caixa e reembolsos aparecem pela metade, e esta página não mostra nenhum deles. Vendas, gastos, contribuição, margens e ROAS aparecem inteiros.',
      }
}

/** The header's chip under ?parte=50 (see PageHeader `halved`). */
export function SplitChip({ halved }: { halved: boolean }) {
  const { label, title } = splitChipText(halved)
  return <Chip tone={halved ? 'neu' : 'mut'} icon="split" size="sm" title={title}>{label}</Chip>
}

export function PageHeader({ ctx, title, sub, badges, actions, code, halved = true }: {
  ctx: PageContext; title?: ReactNode; sub?: ReactNode; badges?: ReactNode; actions?: ReactNode; code?: string | null; halved?: boolean
}) {
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
            <b>{periodName(ctx)}</b> · <span className="num">{ctx.rangeLabel}</span>
            {ctx.scope === 'all' ? ` · ${ctx.selected.length} lojas` : ''}
          </>}
        </div>
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
    ? ctx.selected.filter(st => dayOfLabel(st.timezone)).map(st => `${st.name} (${tzCity(st.timezone)})`)
    : []
  const tail = others.length
    ? ` Cada loja fecha o dia no próprio fuso: ${joinPt(others)} ${others.length === 1 ? 'conta' : 'contam'} as mesmas datas no relógio de lá.`
    : ''
  // Dates a store row (or Atribuição's link) read on another clock: whose
  // they are, and that leaving brings the owner's preset back.
  if (ctx.period === 'custom' && ctx.params.volta) {
    const preset = presetLabel(ctx.params.volta)
    return ctx.scope === 'all'
      ? `As datas de “${preset}” ${ctx.rowDatesOf ? `da ${ctx.rowDatesOf}` : 'da loja de onde você veio'}: ${ctx.rangeLabel}${ctx.partial ? ', com hoje parcial' : ''}. Ao escolher uma loja, o período volta para “${preset}”.${tail}`
      : `As datas de “${preset}” em Todas as lojas: ${ctx.rangeLabel} no horário de ${city}${ctx.partial ? '; hoje entra parcial' : ''}. Ao trocar de loja, o período volta para “${preset}”.`
  }
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
      return `${ctx.rangeLabel} no horário de ${city}${ctx.partial ? '; hoje entra parcial' : ''}.${ctx.rangeNote ? ` ${ctx.rangeNote}` : ''}${tail}`
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
  const tail = ctx.rangeNote ? ` ${ctx.rangeNote}` : ''
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
  return `${head} A loja foi arquivada em ${day} e não sincroniza mais: só ${readDays(read.from, read.to, readLabel)}, e estes números não mudam.${compared ? ` A comparação usa ${withArticle(ctx.comparison.label)} (${ctx.comparisonRangeLabel}).` : ''}${tail}`
}

export function PeriodNote({ ctx, compared }: { ctx: PageContext; compared?: boolean }) {
  const text = periodNoteText(ctx, { compared })
  if (!text) return null
  return <Callout tone="neu" icon="clock">{text}</Callout>
}
