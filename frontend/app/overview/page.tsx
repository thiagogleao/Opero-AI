/**
 * Todas as lojas (/overview) — every active store of the viewer (owner: all of
 * them; partner: their account's), one period.
 *
 * Calendar (owner's rule, bug O1): the window is resolved once on Brasília's
 * clock and every store is read on those same dates in its OWN timezone, so a
 * Brazilian store never reads zero because a Tokyo store was picked, and
 * Hibikura's closed Tokyo day is named instead of hidden. Freshness is per
 * store and per source (bug O4). A row opens that store's Resumo by a plain
 * link that keeps the period (bug O5): no POST, nothing to get stuck on.
 *
 * Data: lib/views/portfolio buildPortfolio (one engine pass for the window,
 * one for the comparison) → the verdict and the ledger; the store table and the
 * archived section stream in <Suspense>.
 */

import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getPageContext, type PageContext, type SearchParams } from '@/lib/views/page'
import { buildPortfolio, type PortfolioView } from '@/lib/views/portfolio'
import { buildVerdict, verdictInputFromPortfolio } from '@/lib/views/verdict'
import { listStores } from '@/lib/access'
import { formatMoney, plural } from '@/lib/format'
import type { SharedAdAccount } from '@/lib/attributionModels'
import { AppShell, PageHeader, PeriodNote, periodName } from '@/components/shell'
import { BreakdownLedger, ButtonLink, Callout, Card, EmptyState, ErrorState, SkeletonBlock, VerdictCard } from '@/components/ui'
import { StoresTable } from '@/components/portfolio/StoresTable'
import { ProfitShare } from '@/components/portfolio/ProfitShare'
import { loadSharedInWindow, loadSharedPairs, SHARED_LOOKBACK_DAYS } from '@/components/portfolio/data'
import { pairBeforeSalesStart, pairBeforeStartText, pairOrdersIn, pairsMixedIn, sumMembers } from '@/components/portfolio/model'
import { dateBeside } from '@/components/campaigns/storeStart'
import { ARCHIVED_PARAM, ArchivedClosed, ArchivedList } from '@/components/portfolio/ArchivedSection'
import s from '@/components/portfolio/portfolio.module.css'

export const metadata: Metadata = { title: 'Todas as lojas' }
export const dynamic = 'force-dynamic'

/** For a custom window the default sub line repeated the range ("1–12 nov ·
 *  1–12 nov"): name it once. */
function customSub(ctx: PageContext) {
  if (ctx.period !== 'custom') return undefined
  return <><b>{periodName(ctx)}</b> · <span className="num">{ctx.rangeLabel}</span> · {ctx.selected.length} lojas</>
}

export default async function OverviewPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const ctx = await getPageContext(sp, { scope: 'all' })
  const showArchived = sp[ARCHIVED_PARAM] === '1'
  const archived = (await listStores(ctx.viewer, { includeArchived: true }).catch(() => [])).filter(st => st.archived)

  if (!ctx.selected.length) {
    return (
      <AppShell ctx={ctx}>
        <PageHeader ctx={ctx} title="Todas as lojas" code={null} sub={customSub(ctx)} />
        <Card>
          <EmptyState icon="store" title="Nenhuma loja ativa nesta conta"
            action={<ButtonLink href="/onboarding" variant="primary" icon="arrowRight">Conectar uma loja Shopify</ButtonLink>}>
            Quando houver lojas conectadas, o resultado de cada uma aparece aqui.
          </EmptyState>
        </Card>
        {archived.length > 0 && (showArchived ? <Suspense fallback={<SkeletonBlock height={80} lines={1} />}><ArchivedList ctx={ctx} /></Suspense> : <ArchivedClosed ctx={ctx} stores={archived} />)}
      </AppShell>
    )
  }

  let view: PortfolioView
  let shared: SharedAdAccount[]
  let sharedNow: SharedAdAccount[] | null
  try {
    ;[view, shared, sharedNow] = await Promise.all([
      buildPortfolio(ctx.selected, ctx.period, ctx.params.de, ctx.params.ate, ctx.now,
        { liveFeed: false, chargebackHealth: false, freshness: false, compareAs: ctx.comparePeriod }),
      loadSharedPairs(ctx.selected, ctx.timezone, ctx.now),
      loadSharedInWindow(ctx.selected, ctx.range),
    ])
  } catch (err) {
    console.error('[overview] portfolio', err)
    return (
      <AppShell ctx={ctx}>
        <PageHeader ctx={ctx} title="Todas as lojas" code={null} sub={customSub(ctx)} />
        <Card>
          <ErrorState title="Os números das lojas não carregaram"
            action={<ButtonLink href={ctx.hrefWith('/overview')} icon="refresh">Tentar de novo</ButtonLink>}>
            Nada foi alterado. Costuma ser uma falha passageira na leitura do banco.
          </ErrorState>
        </Card>
      </AppShell>
    )
  }

  const v = buildVerdict(verdictInputFromPortfolio(view, { subject: 'Suas lojas', split: ctx.split }))
  const mixed = pairsMixedIn(shared, sharedNow)
  const sold = v.totals.revenue > 0
  // The same stores as the verdict's "N lojas na soma": with costs, and with
  // something in the window.
  const { summed } = sumMembers(view.stores)
  const withCosts = v.excluded.length ? ' com custos' : ''
  // A window before every store's first sale (the verdict's beforeStart for
  // Todas): the ledger says so, as the single-store Resumo does, instead of
  // the dead-window "Sem vendas no período" next to "Nenhuma das lojas
  // vendia ainda".
  const notYet = v.beforeStart ?? null
  const ledgerSub = notYet
    ? `Nenhuma das lojas vendia em ${ctx.rangeLabel}`
    : !sold
    ? `Nenhuma venda em ${ctx.rangeLabel}${v.excluded.length ? ' nas lojas com custos' : ''}`
    : `De cada $1,00 vendido em ${ctx.rangeLabel}${v.storeCount > 1 ? `, somando ${plural(summed.length, 'loja', 'lojas')}${withCosts}` : ''}`

  return (
    <AppShell ctx={ctx}>
      <div className={s.page}>
        <PageHeader ctx={ctx} title="Todas as lojas" code={null} sub={customSub(ctx)} />
        <PeriodNote ctx={ctx} />

        <VerdictCard
          verdict={v}
          // Only pairs that mixed THIS window mark a store's profit as inflated or deflated.
          footer={<ProfitShare view={view} verdict={v} part={ctx.part} split={ctx.split} shared={mixed} />}
          aside={
            <BreakdownLedger pnl={v.totals} configured={v.basis !== 'revenue_minus_ads'} split={ctx.split}
              bar={sold} title="Para onde foi cada dólar" sub={ledgerSub}
              emptyTitle={notYet ? 'Nenhuma das lojas vendia ainda' : undefined}
              emptyText={notYet ? `A primeira venda foi em ${notYet.text}: escolha um período a partir dessa data.` : undefined} />
          }
        />

        {shared.map(p => {
          const now = pairOrdersIn(sharedNow, p)
          // A window before the sales store's first sale: it did not exist
          // yet, so there is no "períodos anteriores" to add up.
          const salesFirst = view.stores.find(r => r.id === p.salesStoreId)?.firstOrderDate ?? null
          const notYet = now === 0 && pairBeforeSalesStart(salesFirst, ctx.range)
          return (
            <Callout key={`${p.adStoreId}-${p.salesStoreId}`} tone={now === 0 ? 'info' : 'warn'} icon="swap" title={`${p.salesStoreName} ${now === 0 ? 'vendia' : 'vende'} com anúncios pagos pela ${p.adStoreName}`}>
              Nos últimos {SHARED_LOOKBACK_DAYS} dias, {plural(p.orders, 'pedido', 'pedidos')} da {p.salesStoreName} ({formatMoney(p.revenue)}) vieram de anúncios
              da conta da {p.adStoreName}.{' '}
              {notYet && salesFirst
                ? pairBeforeStartText(p.salesStoreName, dateBeside(salesFirst, [ctx.range.from, ctx.range.to, ctx.comparison.from, ctx.comparison.to], ctx.today), ctx.rangeLabel)
                : now === 0
                ? <>Em {ctx.rangeLabel}, nenhum pedido rastreado: o resultado deste período não está misturado. Para períodos anteriores, some as duas lojas.</>
                : <>{now !== null && <>Em {ctx.rangeLabel}, {plural(now, 'pedido', 'pedidos')}. </>}O gasto fica na {p.adStoreName} e a venda na {p.salesStoreName}: o lucro de uma parece maior e o da outra menor do que é. Some as duas para julgar.</>}
            </Callout>
          )
        })}

        <Suspense fallback={<SkeletonBlock height={320} lines={2} />}>
          <StoresTable ctx={ctx} view={view} verdict={v} shared={shared} sharedNow={sharedNow} />
        </Suspense>

        {archived.length > 0 && (showArchived
          ? <Suspense fallback={<SkeletonBlock height={80} lines={1} />}><ArchivedList ctx={ctx} /></Suspense>
          : <ArchivedClosed ctx={ctx} stores={archived} />)}
      </div>
    </AppShell>
  )
}
