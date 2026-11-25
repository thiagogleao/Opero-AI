/**
 * Resumo (/) — one store, one period: the verdict and where each dollar went,
 * the key numbers, the daily profit with 30 days of context, refunds and
 * chargebacks, the biggest campaigns, top products and countries, and the AI's
 * reading.
 *
 * Data: lib/views/store loadStoreSummary — ONE engine pass over the window
 * (daily, hourly, products, countries) plus the comparison, assembled like the
 * portfolio so this verdict is the one the phone and the overview show. Slow
 * or secondary blocks (context days, campaigns, 90-day chargebacks, AI) stream
 * in <Suspense>, each with its own error state: one failing block never blanks
 * the page or sends anyone to onboarding.
 *
 * Store and period come only from the URL via getPageContext (scope 'store':
 * "Todas" lives at /overview).
 */

import { Suspense } from 'react'
import Link from 'next/link'
import { getPageContext, pageMetadata, type PageContext, type SearchParams } from '@/lib/views/page'
import type { StoreRef } from '@/lib/access'
import { empateGap, loadStoreSummary, type StoreSummary } from '@/lib/views/store'
import { buildVerdict, verdictInputFromPortfolio } from '@/lib/views/verdict'
import { AppShell, PageHeader, PeriodNote, periodName } from '@/components/shell'
import { BreakdownLedger, ButtonLink, Callout, Card, Chip, EmptyState, ErrorState, SkeletonBlock, VerdictCard } from '@/components/ui'
import { InsightsSlot } from '@/components/ai/InsightsSlot'
import { BlockBoundary } from '@/components/dashboard/BlockBoundary'
import { StoreKpis } from '@/components/dashboard/StoreKpis'
import { ProfitChartBlock } from '@/components/dashboard/ProfitChartBlock'
import { CampaignsBlock } from '@/components/dashboard/CampaignsBlock'
import { TopCountries, TopProducts } from '@/components/dashboard/TopLists'
import { RefundsBlock } from '@/components/dashboard/RefundsBlock'
import { SharedAccountNote } from '@/components/dashboard/SharedAccountNote'
import { QuietStoreNote } from '@/components/dashboard/QuietStoreNote'
import { emptyWindowOf, frozenTailOf } from '@/components/dashboard/emptyWindow'
import s from '@/components/dashboard/dashboard.module.css'
import { rangeBeside } from '@/lib/period'

// Absolute: the root layout's "%s · Opero" template only reaches child
// segments, and this page sits in the layout's own segment (the tab read
// "Resumo" while every other page read "… · Opero"). generateMetadata, not a
// static title: it 404s on a ?loja the viewer cannot see, so that tab reads
// "Página não encontrada · Opero" over the not-found card instead of "Resumo".
export const generateMetadata = pageMetadata({ absolute: 'Resumo · Opero' }, { scope: 'store' })

/** The code pill, unless the store's name already carries it ("Dumpling
 *  Squishy · 8jcp3a" read "… 8jcp3a 8jcp3a"). */
function headerCode(ctx: PageContext, store: StoreRef): string | null | undefined {
  const code = ctx.storeOption?.code
  return code && store.name.endsWith(code) ? null : undefined
}

/** For a custom window the default sub line repeated the range ("1–12 nov ·
 *  1–12 nov"): name it once. */
function customSub(ctx: PageContext) {
  if (ctx.selection.period.kind !== 'dates') return undefined
  return <b>{periodName(ctx)}</b>
}
export const dynamic = 'force-dynamic'

/**
 * Opened from Todas (`vem=todas`: a sidebar link from an all-stores page, an
 * old ?loja=todas link redirected to the remembered store): this page reads
 * one store at a time, so say which one, as Atribuição does. The dates it
 * reads are announced by the header's landing note (lib/period announce).
 */
function FromAllNote({ ctx, store }: { ctx: PageContext; store: StoreRef }) {
  // R4: null when the viewer cannot open Todas (text, never a dead link).
  const all = ctx.scopeHref('/overview', { kind: 'all' })
  return (
    <Callout tone="neu" icon="store" title={`Mostrando a ${store.name}`}>
      O Resumo mostra uma loja por vez. Escolha outra no seletor de loja{all ? <>, ou veja todas juntas
      em <Link href={all}>Todas as lojas</Link></> : null}.
    </Callout>
  )
}

export default async function ResumoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const ctx = await getPageContext(sp, { path: '/', scope: 'store' })
  const store = ctx.store
  const fromAll = ctx.cameFrom?.kind === 'all' && !!store

  if (!store) {
    return (
      <AppShell ctx={ctx}>
        <PageHeader ctx={ctx} title="Resumo" code={null} />
        <Card>
          <EmptyState icon="store" title="Nenhuma loja conectada a esta conta"
            action={<ButtonLink href="/onboarding" variant="primary" icon="arrowRight">Conectar uma loja Shopify</ButtonLink>}>
            Quando uma loja estiver conectada, o lucro dela aparece aqui.
          </EmptyState>
        </Card>
      </AppShell>
    )
  }

  let summary: StoreSummary
  try {
    summary = await loadStoreSummary(store, { period: ctx.period, range: ctx.range, comparison: ctx.comparison, resolution: ctx.resolution, facts: ctx.viewerStores }, ctx.now)
  } catch (err) {
    console.error('[resumo] summary', store.id, err)
    return (
      <AppShell ctx={ctx}>
        <PageHeader ctx={ctx} code={headerCode(ctx, store)} sub={customSub(ctx)} />
        {fromAll && <FromAllNote ctx={ctx} store={store} />}
        <Card>
          <ErrorState title="Os números desta loja não carregaram"
            action={<ButtonLink href={ctx.hrefWith('/')} icon="refresh">Tentar de novo</ButtonLink>}>
            Nada foi alterado. Costuma ser uma falha passageira na leitura do banco.
          </ErrorState>
        </Card>
      </AppShell>
    )
  }

  const input = verdictInputFromPortfolio(summary.view, { split: ctx.split })
  const judged = buildVerdict(input)
  // Nothing in the window was read (an archived store after its archive day):
  // there is nothing to compare, and "hoje · vs ontem até esta hora" sat
  // beside "não há dados hoje".
  const v = judged.frozen ? buildVerdict({ ...input, comparison: null }) : judged
  const configured = summary.pnl.configured
  const sold = summary.pnl.totals.revenue > 0
  // A window before the first sale (the store did not sell yet) or after an
  // archived store's archive day (nothing is read): the verdict says so, and
  // every block beside it says the same instead of "$0 · nenhum pedido no
  // período" — the ledger, the KPIs, the lists, refunds, the chart, the
  // campaigns and the AI card. One reading, the verdict's (beforeStart /
  // frozen), with its dates as it prints them ("7 nov", "11 abr 2026").
  const empty = emptyWindowOf(v)
  const notYet = v.beforeStart ?? null
  const frozen = v.frozen ?? null
  // A window read only up to the archive day (the verdict's "não teve vendas
  // em 1–10 nov"): the ledger names those days, not the whole window.
  const tail = summary.row.archived ? frozenTailOf(summary.row.archivedOn, ctx.range) : null
  const readLabel = tail ? rangeBeside({ from: ctx.range.from, to: tail }, { window: ctx.range, comparison: ctx.comparison, clockToday: ctx.today }) : ctx.rangeLabel
  const storeNames = new Map(ctx.stores.map(st => [st.id, st.name]))
  if (!storeNames.has(store.id)) storeNames.set(store.id, store.name)

  return (
    <AppShell ctx={ctx}>
      <div className={s.page}>
        <PageHeader
          ctx={ctx}
          code={headerCode(ctx, store)}
          sub={customSub(ctx)}
          badges={summary.sellsIn && (
            <Chip tone="info" size="sm" title={`A loja vende em ${summary.sellsIn}; os valores aparecem convertidos em dólar, no câmbio de cada pedido.`}>
              vende em {summary.sellsIn} · convertido em US$
            </Chip>
          )}
        />
        {fromAll && <FromAllNote ctx={ctx} store={store} />}
        <PeriodNote ctx={ctx} compared />
        {/* Before the first sale the verdict says so; costs change nothing
            in a window with no activity (R11: "ainda não vendia" first). */}
        {!configured && !notYet && (
          <Callout tone="warn" title="Custos não configurados">
            Sem o custo dos produtos, do frete e das taxas, esta tela mostra receita − anúncios, que não é lucro.{' '}
            <ButtonLink href={ctx.hrefWith('/profit')} size="sm" icon="sliders">Configurar custos</ButtonLink>
          </Callout>
        )}
        <Suspense fallback={null}>
          <SharedAccountNote ctx={ctx} store={store} />
        </Suspense>
        {/* No orders and a last sale days old: when it last sold and whether the
            order reading is current, so a quiet store does not read as a broken sync. */}
        <Suspense fallback={null}>
          <QuietStoreNote ctx={ctx} store={store} summary={summary} />
        </Suspense>

        <VerdictCard
          verdict={v}
          headingLevel="h2"
          // The verdict's ROAS box (components/ui/VerdictCard) still words it as
          // "ROAS da loja" and "Cada $1 no Meta trouxe…", so it is shown only when
          // the store's ad channel IS Meta; for Shopify ads or both the KPI below
          // names the right channel. Without sales or without a break-even the
          // sentence above already says what happened and the KPI says why, so
          // the box would only repeat it.
          roas={summary.kpis.roasChannel === 'meta' && sold
            && !empateGap(configured, summary.kpis.breakEven, summary.pnl.totals)}
          aside={
            <BreakdownLedger pnl={v.totals} configured={v.basis !== 'revenue_minus_ads'} split={ctx.split}
              // "De cada $1: 0¢ Meta" over $0 of sales: no bar to split, and the sub says so.
              bar={sold}
              title="Para onde foi cada dólar"
              sub={sold ? `De cada $1,00 vendido em ${ctx.rangeLabel}` : frozen ? `Sem dados de ${ctx.rangeLabel}` : `Nenhuma venda em ${readLabel}`}
              // The phone's words (app/m/_components/Home.tsx VerdictBlock).
              emptyTitle={notYet ? 'A loja ainda não vendia' : frozen ? 'Sem dados neste período' : undefined}
              emptyText={notYet
                ? `A ${store.name} começou a vender em ${notYet.text}: escolha um período a partir dessa data.`
                : frozen ? `A loja está arquivada${frozen.text ? ` desde ${frozen.text}` : ''} e não sincroniza mais: nada é lido depois disso.`
                  : tail ? `Nenhum pedido e nenhum gasto com anúncios em ${readLabel}. Depois disso a loja já estava arquivada: nada foi lido.` : undefined} />
          }
        />

        <StoreKpis ctx={ctx} summary={summary} empty={empty} />

        <Suspense fallback={<SkeletonBlock height={240} lines={1} />}>
          <ProfitChartBlock ctx={ctx} summary={summary} empty={empty} />
        </Suspense>

        <Suspense fallback={<SkeletonBlock height={220} lines={2} />}>
          <CampaignsBlock ctx={ctx} summary={summary} storeNames={storeNames} empty={empty} />
        </Suspense>

        <div className={s.grid2}>
          <TopProducts ctx={ctx} summary={summary} empty={empty} />
          <TopCountries ctx={ctx} summary={summary} empty={empty} />
        </div>

        <div className={s.grid2}>
          <RefundsBlock ctx={ctx} summary={summary} empty={empty} />
          <Suspense fallback={<SkeletonBlock height={120} lines={2} />}>
            {/* Keyed: a soft navigation to another store or window keeps this
                class component mounted, and a failure would stick to the next one. */}
            <BlockBoundary key={`${store.id}:${ctx.range.from}:${ctx.range.to}:${ctx.split}`} title="Leitura da IA">
              {/* A window the server would refuse (before the first sale, an
                  archived store after its archive day, this window and the one
                  before it empty) says so, as the verdict does, with no paid
                  "Gerar leitura" that can only come back as "no data". */}
              <InsightsSlot store={store} range={ctx.range} split={ctx.split} daily={summary.pnl.daily} now={ctx.now}
                notStarted={notYet ? { storeName: store.name, firstSale: notYet.text } : null}
                frozen={frozen ? { archivedOn: frozen.text } : undefined} />
            </BlockBoundary>
          </Suspense>
        </div>
      </div>
    </AppShell>
  )
}
