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
import { ALL_STORES, getPageContext, pageMetadata, type PageContext, type SearchParams } from '@/lib/views/page'
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
import { QuietStoreNote } from '@/components/dashboard/QuietStoreNote'
import { beforeStartText, isBeforeStart } from '@/components/campaigns/storeStart'
import s from '@/components/dashboard/dashboard.module.css'

// Absolute: the root layout's "%s · Opero" template only reaches child
// segments, and this page sits in the layout's own segment (the tab read
// "Resumo" while every other page read "… · Opero"). generateMetadata, not a
// static title: it 404s on a ?loja the viewer cannot see, so that tab reads
// "Página não encontrada · Opero" over the not-found card instead of "Resumo".
export const generateMetadata = pageMetadata({ absolute: 'Resumo · Opero' }, { scope: 'store' })

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

/**
 * The URL asked for "Todas" (a sidebar link from an all-stores page) and this
 * page reads one store at a time: getPageContext then shows the store the
 * browser last picked, which may have been chosen in another tab (ctx.fromAll).
 * Say which one, as Atribuição does, instead of switching silently. Not for a
 * one-store partner, who has no "Todas" to come from. The sidebar keeps
 * loja=todas meanwhile (ctx.navHref), so Campanhas or Produtos open Todas.
 */
function FromAllNote({ ctx, store }: { ctx: PageContext; store: StoreRef }) {
  return (
    <Callout tone="neu" icon="store" title={`Mostrando a ${store.name}`}>
      O Resumo mostra uma loja por vez. Escolha outra no seletor de loja, ou veja todas juntas
      em <Link href={ctx.hrefWith('/overview', { loja: ALL_STORES })}>Todas as lojas</Link>.
    </Callout>
  )
}

export default async function ResumoPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const ctx = await getPageContext(sp, { scope: 'store' })
  const store = ctx.store
  const fromAll = ctx.fromAll && !!store

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

  const v = buildVerdict(verdictInputFromPortfolio(summary.view, { split: ctx.split }))
  const configured = summary.pnl.configured
  const sold = summary.pnl.totals.revenue > 0
  const t = summary.pnl.totals
  // A window that ends before the first sale: the store did not sell yet, so
  // the ledger says that instead of "Sem vendas no período" next to a verdict
  // that reads "A Hibikura começou a vender em 7 nov" (components/campaigns/
  // storeStart: the rule and the words every page uses).
  const firstOrder = summary.row.firstOrderDate
  const beforeStart = firstOrder && isBeforeStart(firstOrder, ctx.range, { orders: t.orders, revenue: t.revenue, spend: t.adSpend })
    ? beforeStartText({ storeName: store.name, firstOrderDate: firstOrder, period: ctx.period, range: ctx.range, today: ctx.today })
    : null
  // "A Hibikura começou a vender em 7 nov — não há dados de …" → its first half.
  const startedLine = beforeStart ? beforeStart.headline.slice(0, beforeStart.headline.lastIndexOf(' — ')) : null
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
              sub={sold ? `De cada $1,00 vendido em ${ctx.rangeLabel}` : `Nenhuma venda em ${ctx.rangeLabel}`}
              emptyTitle={startedLine ? 'A loja ainda não vendia' : undefined}
              emptyText={startedLine ? `${startedLine}: escolha um período a partir dessa data.` : undefined} />
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
