import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getPageContext, type PageContext, type SearchParams } from '@/lib/views/page'
import { buildPortfolio } from '@/lib/views/portfolio'
import { computeStorePnL, type StorePnL } from '@/lib/engine/pnl'
import { formatRangeLabel, formatMoney, plural } from '@/lib/format'
import { listStores, type StoreRef } from '@/lib/access'
import { getAlertConfig } from '@/lib/alerts'
import { getSharedAdAccounts } from '@/lib/attribution'
import { decisionWindows, getCampaignReport, type CampaignReport } from '@/lib/data/campaigns'
import { getCreativesReport } from '@/lib/data/creatives'
import type { ScaleThresholds } from '@/lib/campaignSignal'
import { AppShell, PageHeader, PeriodNote } from '@/components/shell'
import { Block, Callout, EmptyState, ErrorState, RoasGauge, SkeletonBlock, Tabs, VerdictCard } from '@/components/ui'
import { buildAdsVerdict } from '@/components/campaigns/adsVerdict'
import { ReconciliationLedger } from '@/components/campaigns/ReconciliationLedger'
import { ScaleRoom } from '@/components/campaigns/ScaleRoom'
import { CampaignTable } from '@/components/campaigns/CampaignTable'
import { CreativesView } from '@/components/campaigns/CreativesView'
import { BilledElsewhere } from '@/components/campaigns/BilledElsewhere'
import { PortfolioAdsTable, SharedAccountsCallout, buildPortfolioAdsVerdict } from '@/components/campaigns/PortfolioAds'
import { storeMarginFromPnL } from '@/components/campaigns/margin'
import s from '@/components/campaigns/campaigns.module.css'

/**
 * Campanhas — the store's Meta ads: a verdict on them (ROAS against the
 * store's break-even, what Meta credits against what the store sold), where
 * there is room to scale (the one campaign verdict, last 7 closed days), the
 * campaigns (opening to ad sets and ads) and the creatives. "Todas as lojas"
 * compares the stores' Meta spend against each one's break-even.
 *
 * Page-specific URL keys (kept by ctx.hrefWith): ?aba=criativos,
 * ?campanha=<campaignId> (creatives of one campaign), ?mostrar=todos.
 */

export const metadata: Metadata = { title: 'Campanhas' }

const TABLE_LIMIT = 80
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v) ?? null

/** The owner's scale threshold (alert settings), the same number the push
 *  alerts use, so a badge and a push never disagree. */
async function thresholds(): Promise<Partial<ScaleThresholds>> {
  const cfg = await getAlertConfig()
  return { minMargin: cfg.scaleAlerts.threshold }
}

export default async function CampaignsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const sp = await searchParams
  const ctx = await getPageContext(sp)
  if (ctx.scope === 'all') return <AllStores ctx={ctx} />
  const store = ctx.store
  if (!store) {
    return (
      <AppShell ctx={ctx}>
        <PageHeader ctx={ctx} title="Campanhas" />
        <EmptyState icon="store" title="Nenhuma loja para mostrar">Este acesso ainda não tem loja conectada.</EmptyState>
      </AppShell>
    )
  }
  return (
    <StoreCampaigns
      ctx={ctx}
      store={store}
      tab={first(sp.aba) === 'criativos' ? 'criativos' : 'campanhas'}
      campaignId={first(sp.campanha)}
      showAll={first(sp.mostrar) === 'todos'}
    />
  )
}

async function StoreCampaigns({ ctx, store, tab, campaignId, showAll }: {
  ctx: PageContext; store: StoreRef; tab: 'campanhas' | 'criativos'; campaignId: string | null; showAll: boolean
}) {
  const decision = decisionWindows(store.timezone, ctx.now)
  const sameWindow = ctx.range.from === decision.window.from && ctx.range.to === decision.window.to
  const header = <PageHeader ctx={ctx} title={`Campanhas · ${store.name}`} />

  let pnl: StorePnL | null, report: CampaignReport, decisionReport: CampaignReport, storeNames: Map<string, string>
  try {
    const [all, th] = await Promise.all([listStores(ctx.viewer, { includeArchived: true }), thresholds()])
    storeNames = new Map(all.map(x => [x.id, x.name]))
    const opts = { thresholds: th, storeNames, now: ctx.now }
    // The decision block always judges the last 7 closed days; when the page
    // shows another window, that window gets its own report so a campaign that
    // did not spend today still appears there.
    const [p, r, d] = await Promise.all([
      computeStorePnL(store.id, ctx.range, {}, ctx.now),
      getCampaignReport(store, ctx.range, opts),
      sameWindow ? Promise.resolve(null) : getCampaignReport(store, decision.window, opts),
    ])
    pnl = p; report = r; decisionReport = d ?? r
  } catch (err) {
    console.error('[campaigns] report', err)
    return (
      <AppShell ctx={ctx}>
        {header}
        <ErrorState title="Não foi possível carregar as campanhas">
          A leitura das campanhas falhou. Nada foi alterado; recarregue a página em instantes.
        </ErrorState>
      </AppShell>
    )
  }
  if (!pnl) {
    return (
      <AppShell ctx={ctx}>
        {header}
        <EmptyState title="Loja sem dados">Ainda não há pedidos nem anúncios desta loja no Opero.</EmptyState>
      </AppShell>
    )
  }

  const opt = ctx.storeOptions.find(o => o.id === store.id)
  const decisionLabel = formatRangeLabel(decision.window, ctx.today)
  const billedElsewhere = report.billedElsewhere.length ? {
    spend: report.billedElsewhere.reduce((t, b) => t + b.spend, 0),
    campaigns: report.billedElsewhere.length,
    stores: [...new Set(report.billedElsewhere.map(b => b.billedStoreName))],
  } : null
  const { verdict, reconciliation } = buildAdsVerdict({
    storeName: store.name,
    report,
    pnl: pnl.totals,
    window: {
      period: ctx.period, rangeLabel: ctx.rangeLabel, periodPhrase: ctx.periodPhrase, partial: ctx.partial,
      partialLabel: ctx.partialLabel, minutesIntoDay: ctx.minutesIntoDay, dayLabel: opt?.dayLabel ?? null,
    },
    decision: { actions: decisionReport.totals.actions, rangeLabel: decisionLabel },
    billedElsewhere,
    split: ctx.split,
  })
  const shared = report.campaigns.filter(c => c.shared)
  const ownSpend = report.campaigns.filter(c => !c.shared).reduce((t, c) => t + c.spend, 0)
  const ownValue = report.campaigns.filter(c => !c.shared).reduce((t, c) => t + c.purchaseValue, 0)
  const margin = storeMarginFromPnL(ctx.range, pnl)

  return (
    <AppShell ctx={ctx}>
      {header}
      <PeriodNote ctx={ctx} />
      {shared.length > 0 && (
        <Callout tone="warn" title="Conta de anúncio compartilhada com outra loja.">
          {' '}{plural(shared.length, 'campanha desta lista rodou', 'campanhas desta lista rodaram')} numa conta que também veiculou anúncios de outra loja
          ({shared.map(c => c.name).join(', ')}). O gasto delas, {formatMoney(shared.reduce((t, c) => t + c.spend, 0))}, está nesta loja,
          mas as vendas podem ter caído na outra: ficam sem margem e sem veredito. Some as duas lojas para julgar o resultado.
        </Callout>
      )}
      <VerdictCard
        verdict={verdict}
        headingLevel="h2"
        aside={<ReconciliationLedger rec={reconciliation} rangeLabel={ctx.rangeLabel} split={ctx.split} elsewhere={billedElsewhere} />}
        footer={report.totals.spend > 0 ? (
          <div>
            <RoasGauge roas={ownSpend > 0 ? ownValue / ownSpend : null} breakEven={report.configured ? report.breakEvenRoas : null} label="ROAS atribuído" />
            <p className={s.small}>
              Vendas que o Meta credita às campanhas ÷ gasto. Fica abaixo do ROAS da loja quando há venda que o Meta não credita
              (orgânico, e-mail, recompra), e sobe sozinho quando o gasto cai — julgue as campanhas por ele e a loja pelo lucro real.
            </p>
          </div>
        ) : undefined}
      />
      <BilledElsewhere rows={report.billedElsewhere} storeName={store.name} hrefFor={id => ctx.hrefWith('/campaigns', { loja: id })} />
      <ScaleRoom report={decisionReport} windowLabel={decisionLabel} costsHref={ctx.hrefWith('/profit')} />
      <Tabs
        ariaLabel="Campanhas ou criativos"
        active={tab}
        items={[
          { key: 'campanhas', label: 'Campanhas', href: ctx.hrefWith('/campaigns'), count: report.totals.campaigns },
          { key: 'criativos', label: 'Criativos', href: ctx.hrefWith('/campaigns?aba=criativos') },
        ]}
      />
      <Suspense key={`${tab}:${campaignId ?? ''}:${showAll}`} fallback={<SkeletonBlock lines={6} height={260} />}>
        <TabContent ctx={ctx} store={store} tab={tab} report={report} campaignId={campaignId} showAll={showAll} storeNames={storeNames} margin={margin} />
      </Suspense>
    </AppShell>
  )
}

async function TabContent({ ctx, store, tab, report, campaignId, showAll, storeNames, margin }: {
  ctx: PageContext; store: StoreRef; tab: 'campanhas' | 'criativos'; report: CampaignReport
  campaignId: string | null; showAll: boolean; storeNames: Map<string, string>; margin: ReturnType<typeof storeMarginFromPnL>
}) {
  // A campaign filter only applies to the creatives tab, and only to a
  // campaign of this store's list (anything else reads as no filter).
  const filterRow = tab === 'criativos' && campaignId ? report.campaigns.find(c => c.campaignId === campaignId) ?? null : null
  let creatives
  try {
    creatives = await getCreativesReport(store, ctx.range, {
      storeNames, margin, now: ctx.now, campaignId: filterRow?.campaignId ?? undefined,
    })
  } catch (err) {
    console.error('[campaigns] creatives', err)
    return <Block title={tab === 'criativos' ? 'Criativos' : 'Campanhas'}><ErrorState compact /></Block>
  }

  if (tab === 'criativos') {
    return (
      <CreativesView
        report={creatives}
        hrefWith={p => ctx.hrefWith(p)}
        rangeLabel={ctx.rangeLabel}
        filter={filterRow ? { name: filterRow.name, clearHref: ctx.hrefWith('/campaigns?aba=criativos') } : null}
        limit={showAll ? null : TABLE_LIMIT}
        showAllHref={ctx.hrefWith(`/campaigns?aba=criativos${filterRow?.campaignId ? `&campanha=${encodeURIComponent(filterRow.campaignId)}` : ''}&mostrar=todos`)}
      />
    )
  }
  return (
    <Block
      title="Campanhas no Meta"
      howTo={`Gasto, vendas atribuídas e lucro estimado em ${ctx.rangeLabel}; o veredito e a tendência olham os últimos 7 dias fechados. Abra uma campanha para ver conjuntos e anúncios.`}
      info={report.formula}
      flush
      footer={report.campaigns.length === 0 ? undefined : report.reconciliation.gap === 0
        ? <span>A lista soma <b className="num">{formatMoney(report.reconciliation.listedSpend)}</b>, o mesmo gasto no Meta que a contabilidade da loja carrega.</span>
        : <span className="warn">A lista soma {formatMoney(report.reconciliation.listedSpend)} e a contabilidade {formatMoney(report.reconciliation.engineMetaSpend)}.</span>}
    >
      <CampaignTable report={report} creatives={creatives.creatives} hrefWith={p => ctx.hrefWith(p)} rangeLabel={ctx.rangeLabel} />
    </Block>
  )
}

async function AllStores({ ctx }: { ctx: PageContext }) {
  const header = <PageHeader ctx={ctx} title="Campanhas · todas as lojas" />
  const names = new Map(ctx.selected.map(x => [x.id, x.name]))
  const loaded = await Promise.all([
    buildPortfolio(ctx.selected, ctx.period, ctx.params.de, ctx.params.ate, ctx.now, { liveFeed: false, chargebackHealth: false, freshness: false }),
    getSharedAdAccounts(ctx.storeIds, ctx.range, names).catch(err => { console.error('[campaigns] shared accounts', err); return [] }),
  ]).catch(err => { console.error('[campaigns] all stores', err); return null })
  if (!loaded) {
    return (
      <AppShell ctx={ctx}>
        {header}
        <ErrorState title="Não foi possível carregar as lojas" />
      </AppShell>
    )
  }
  const [view, pairs] = loaded
  const verdict = buildPortfolioAdsVerdict({
    stores: view.stores, rangeLabel: ctx.rangeLabel, periodPhrase: ctx.periodPhrase, partialLabel: ctx.partialLabel, split: ctx.split,
  })
  return (
    <AppShell ctx={ctx}>
      {header}
      <PeriodNote ctx={ctx} />
      <VerdictCard verdict={verdict} roas={false} />
      <SharedAccountsCallout pairs={pairs} />
      <Block
        title="Meta por loja"
        howTo="Cada loja contra o próprio empate. Clique numa loja para ver as campanhas, os conjuntos e os anúncios dela."
        info="Campanhas, margens e vereditos são por loja: cada uma tem a sua conta de anúncio e o seu custo de produto."
        flush
      >
        <PortfolioAdsTable stores={view.stores} rangeLabel={ctx.rangeLabel} hrefFor={id => ctx.hrefWith('/campaigns', { loja: id })} />
      </Block>
    </AppShell>
  )
}
