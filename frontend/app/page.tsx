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
import type { Metadata } from 'next'
import { getPageContext, type PageContext, type SearchParams } from '@/lib/views/page'
import type { StoreRef } from '@/lib/access'
import { empateGap, loadStoreSummary, type StoreSummary } from '@/lib/views/store'
import { buildVerdict, verdictInputFromPortfolio } from '@/lib/views/verdict'
import { AppShell, PageHeader, PeriodNote } from '@/components/shell'
import { BreakdownLedger, ButtonLink, Callout, Card, Chip, EmptyState, ErrorState, SkeletonBlock, VerdictCard } from '@/components/ui'
import { InsightsCard } from '@/components/ai/InsightsCard'
import { BlockBoundary } from '@/components/dashboard/BlockBoundary'
import { StoreKpis } from '@/components/dashboard/StoreKpis'
import { ProfitChartBlock } from '@/components/dashboard/ProfitChartBlock'
import { CampaignsBlock } from '@/components/dashboard/CampaignsBlock'
import { TopCountries, TopProducts } from '@/components/dashboard/TopLists'
import { RefundsBlock } from '@/components/dashboard/RefundsBlock'
import { SharedAccountNote } from '@/components/dashboard/SharedAccountNote'
import s from '@/components/dashboard/dashboard.module.css'

// Absolute: the root layout's "%s · Opero" template only reaches child
// segments, and this page sits in the layout's own segment (the tab read
// "Resumo" while every other page read "… · Opero").
export const metadata: Metadata = { title: { absolute: 'Resumo · Opero' } }

/** The code pill, unless the store's name already carries it ("Dumpling
 *  Squishy · 8jcp3a" read "… 8jcp3a 8jcp3a"). */
function headerCode(ctx: PageContext, store: StoreRef): string | null | undefined {
  const code = ctx.storeOptions.find(o => o.id === store.id)?.code
  return code && store.name.endsWith(code) ? null : undefined
}

/** For a custom window the default sub line repeated the range ("1–12 nov ·
 *  1–12 nov"): name it once. */
function customSub(ctx: PageContext) {
  if (ctx.period !== 'custom') return undefined
  return <><b>Período escolhido</b> · <span className="num">{ctx.rangeLabel}</span></>
}
export const dynamic = 'force-dynamic'

export default async function ResumoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getPageContext(searchParams, { scope: 'store' })
  const store = ctx.store

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
    summary = await loadStoreSummary(store, { period: ctx.period, range: ctx.range, comparison: ctx.comparison }, ctx.now)
  } catch (err) {
    console.error('[resumo] summary', store.id, err)
    return (
      <AppShell ctx={ctx}>
        <PageHeader ctx={ctx} code={headerCode(ctx, store)} sub={customSub(ctx)} />
        <Card>
          <ErrorState title="Os números desta loja não carregaram"
            action={<ButtonLink href={ctx.hrefWith('/')} icon="refresh">Tentar de novo</ButtonLink>}>
            Nada foi alterado. Costuma ser uma falha passageira na leitura do banco.
          </ErrorState>
        </Card>
      </AppShell>
    )
  }

  const v = buildVerdict(verdictInputFromPortfolio(summary.view, { split: ctx.split }))
  const configured = summary.pnl.configured
  const sold = summary.pnl.totals.revenue > 0
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
        <PeriodNote ctx={ctx} />
        {!configured && (
          <Callout tone="warn" title="Custos não configurados">
            Sem o custo dos produtos, do frete e das taxas, esta tela mostra receita − anúncios, que não é lucro.{' '}
            <ButtonLink href={ctx.hrefWith('/profit')} size="sm" icon="sliders">Configurar custos</ButtonLink>
          </Callout>
        )}
        <Suspense fallback={null}>
          <SharedAccountNote ctx={ctx} store={store} />
        </Suspense>

        <VerdictCard
          verdict={v}
          headingLevel="h2"
          // The verdict's ROAS box divides revenue by Meta spend only; when Shopify
          // ads carry real spend that would credit Meta with their sales, so the
          // box is left out and the KPI below measures the right spend. Without
          // sales, or without a break-even for a store that has costs, the box
          // would read "0,00× · custos não configurados" (wrong for EPOCH at 03h);
          // the sentence above already says what happened and the KPI says why.
          roas={summary.kpis.roasChannel === 'meta' && sold
            && !empateGap(configured, summary.kpis.breakEven, summary.pnl.totals)}
          aside={
            <BreakdownLedger pnl={v.totals} configured={v.basis !== 'revenue_minus_ads'} split={ctx.split}
              // "De cada $1: 0¢ Meta" over $0 of sales: no bar to split, and the sub says so.
              bar={sold}
              title="Para onde foi cada dólar"
              sub={sold ? `De cada $1,00 vendido em ${ctx.rangeLabel}` : `Nenhuma venda em ${ctx.rangeLabel}`} />
          }
        />

        <StoreKpis ctx={ctx} summary={summary} />

        <Suspense fallback={<SkeletonBlock height={240} lines={1} />}>
          <ProfitChartBlock ctx={ctx} summary={summary} />
        </Suspense>

        <Suspense fallback={<SkeletonBlock height={220} lines={2} />}>
          <CampaignsBlock ctx={ctx} summary={summary} storeNames={storeNames} />
        </Suspense>

        <div className={s.grid2}>
          <TopProducts ctx={ctx} summary={summary} />
          <TopCountries ctx={ctx} summary={summary} />
        </div>

        <div className={s.grid2}>
          <RefundsBlock ctx={ctx} summary={summary} />
          <Suspense fallback={<SkeletonBlock height={120} lines={2} />}>
            {/* Keyed: a soft navigation to another store or window keeps this
                class component mounted, and a failure would stick to the next one. */}
            <BlockBoundary key={`${store.id}:${ctx.range.from}:${ctx.range.to}:${ctx.split}`} title="Leitura da IA">
              <InsightsCard storeId={store.id} from={ctx.range.from} to={ctx.range.to} split={ctx.split} />
            </BlockBoundary>
          </Suspense>
        </div>
      </div>
    </AppShell>
  )
}
