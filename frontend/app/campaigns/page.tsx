import { Suspense } from 'react'
import { getPageContext, pageMetadata, type PageContext, type SearchParams } from '@/lib/views/page'
import { buildPortfolio } from '@/lib/views/portfolio'
import { todayInTz } from '@/lib/engine/dates'
import { resumoLinkOverrides } from '@/components/portfolio/model'
import { computeStorePnL, type StorePnL } from '@/lib/engine/pnl'
import { formatRangeLabel, formatMoney, plural } from '@/lib/format'
import { listStores, type StoreRef } from '@/lib/access'
import { getAlertConfig } from '@/lib/alerts'
import { getSharedAdAccounts } from '@/lib/attribution'
import { decisionWindows, getCampaignReport, getOwnAttribution, getStoreCampaignName, type CampaignReport } from '@/lib/data/campaigns'
import { getCreativesReport } from '@/lib/data/creatives'
import type { ScaleThresholds } from '@/lib/campaignSignal'
import { AppShell, PageHeader, PeriodNote } from '@/components/shell'
import { Block, Callout, EmptyState, ErrorState, RoasGauge, SkeletonBlock, Tabs, VerdictCard } from '@/components/ui'
import { attributedRoasNote, buildAdsVerdict } from '@/components/campaigns/adsVerdict'
import { ReconciliationLedger } from '@/components/campaigns/ReconciliationLedger'
import { ScaleRoom } from '@/components/campaigns/ScaleRoom'
import { CampaignTable } from '@/components/campaigns/CampaignTable'
import { CreativesView } from '@/components/campaigns/CreativesView'
import { campaignFilterText, type CreativesFilter } from '@/components/campaigns/campaignFilter'
import { noSpendWhen } from '@/components/campaigns/creativeVerdict'
import { BilledElsewhere } from '@/components/campaigns/BilledElsewhere'
import { PortfolioAdsTable, SharedAccountsCallout, buildPortfolioAdsVerdict } from '@/components/campaigns/PortfolioAds'
import { storeMarginFromPnL } from '@/components/campaigns/margin'
import { loadFirstSale } from '@/components/campaigns/firstSale'
import type { BeforeStartInput } from '@/components/campaigns/storeStart'
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

export const generateMetadata = pageMetadata('Campanhas')

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
        <PageHeader ctx={ctx} title="Campanhas" halved={false} />
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
  let firstSale: BeforeStartInput | null
  try {
    const [all, th] = await Promise.all([listStores(ctx.viewer, { includeArchived: true }), thresholds()])
    storeNames = new Map(all.map(x => [x.id, x.name]))
    const opts = { thresholds: th, storeNames, now: ctx.now }
    // The decision block always judges the last 7 closed days; when the page
    // shows another window, that window gets its own report so a campaign that
    // did not spend today still appears there.
    const [p, r, d, f] = await Promise.all([
      computeStorePnL(store.id, ctx.range, {}, ctx.now),
      getCampaignReport(store, ctx.range, opts),
      sameWindow ? Promise.resolve(null) : getCampaignReport(store, decision.window, opts),
      loadFirstSale(ctx),
    ])
    pnl = p; report = r; decisionReport = d ?? r; firstSale = f
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

  const opt = ctx.storeOption
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
    firstSale,
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
            <RoasGauge roas={ownSpend > 0 ? ownValue / ownSpend : null} breakEven={report.breakEvenRoas} configured={report.configured}
              revenue={pnl.totals.revenue} contribution={pnl.totals.contribution} label="ROAS atribuído" />
            <p className={s.small}>{attributedRoasNote({ sharedSpend: shared.reduce((t, c) => t + c.spend, 0), shopSpend: pnl.totals.shopSpend })}</p>
          </div>
        ) : undefined}
      />
      <BilledElsewhere rows={report.billedElsewhere} storeName={store.name} rangeLabel={ctx.rangeLabel} hrefFor={id => otherStoreHref(ctx, id)} />
      <ScaleRoom report={decisionReport} windowLabel={decisionLabel} costsHref={ctx.hrefWith('/profit')} split={ctx.split} />
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
  // A campaign filter only applies to the creatives tab. It stays on even when
  // the campaign has no row in this window (a period change keeps ?campanha=)
  // or is not this store's: the tab then lists none of its ads and says why.
  // Read as "no filter", it listed every ad of the store under the totals of
  // an unfiltered list, and the filter came back by itself later.
  const filterId = tab === 'criativos' && campaignId ? campaignId : null
  let creatives, filter: CreativesFilter | null = null
  try {
    const filterRow = filterId ? report.campaigns.find(c => c.campaignId === filterId) ?? null : null
    if (filterId) filter = await campaignFilter(ctx, store, filterId, filterRow?.name ?? null)
    // The ads are judged on the campaigns' window and margin: pass the
    // report's decision margin so it is not priced twice.
    creatives = await getCreativesReport(store, ctx.range, {
      storeNames, margin, now: ctx.now, campaignId: filterId ?? undefined,
      windowDays: report.thresholds.windowDays,
      verdictMargin: { configured: report.configured, contributionRate: report.decisionContributionRate, breakEvenRoas: report.decisionBreakEvenRoas },
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
        filter={filter}
        limit={showAll ? null : TABLE_LIMIT}
        showAllHref={ctx.hrefWith(`/campaigns?aba=criativos${filterId ? `&campanha=${encodeURIComponent(filterId)}` : ''}&mostrar=todos`)}
        split={ctx.split}
        storeRevenue={margin.revenue}
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
      <CampaignTable report={report} creatives={creatives.creatives} hrefWith={p => ctx.hrefWith(p)} rangeLabel={ctx.rangeLabel} split={ctx.split} />
    </Block>
  )
}

/** The Criativos filter of ?campanha=<id>: the row's name when the campaign
 *  has one in this window, else the store's own campaign name (or none for
 *  another store's campaign) and why its ads are not listed. */
async function campaignFilter(ctx: PageContext, store: StoreRef, id: string, rowName: string | null): Promise<CreativesFilter> {
  const name = rowName ?? await getStoreCampaignName(store.id, id)
  return {
    ...campaignFilterText({ name, inWindow: rowName !== null, storeName: store.name, when: noSpendWhen(ctx.range, ctx.today) }),
    clearHref: ctx.hrefWith('/campaigns?aba=criativos'),
  }
}

/**
 * A link to another store's Campanhas on the dates this page shows. The same
 * `periodo` resolves on that store's own clock, which can be a day ahead
 * (Tokyo after noon in Brasília); then the exact dates travel instead.
 */
function otherStoreHref(ctx: PageContext, storeId: string): string {
  const other = ctx.stores.find(x => x.id === storeId)
  const storeToday = other ? todayInTz(other.timezone, ctx.now) : ctx.today
  return ctx.hrefWith('/campaigns', resumoLinkOverrides({ id: storeId, storeToday }, ctx))
}

async function AllStores({ ctx }: { ctx: PageContext }) {
  const header = <PageHeader ctx={ctx} title="Campanhas · todas as lojas" halved={false} />
  const names = new Map(ctx.selected.map(x => [x.id, x.name]))
  const loaded = await Promise.all([
    buildPortfolio(ctx.selected, ctx.period, ctx.params.de, ctx.params.ate, ctx.now, { liveFeed: false, chargebackHealth: false, freshness: false }),
    getSharedAdAccounts(ctx.storeIds, ctx.range, names).catch(err => { console.error('[campaigns] shared accounts', err); return [] }),
    // Own vs shared-account campaigns per store, so ROAS atribuído follows
    // the store pages' rule; on failure those columns say "—" instead of
    // falling back to a mixed number.
    getOwnAttribution(ctx.storeIds, ctx.range).catch(err => { console.error('[campaigns] own attribution', err); return null }),
  ]).catch(err => { console.error('[campaigns] all stores', err); return null })
  if (!loaded) {
    return (
      <AppShell ctx={ctx}>
        {header}
        <ErrorState title="Não foi possível carregar as lojas" />
      </AppShell>
    )
  }
  const [view, pairs, attribution] = loaded
  const verdict = buildPortfolioAdsVerdict({
    stores: view.stores, attribution, pairs, rangeLabel: ctx.rangeLabel, periodPhrase: ctx.periodPhrase, partialLabel: ctx.partialLabel, split: ctx.split,
  })
  return (
    <AppShell ctx={ctx}>
      {header}
      <PeriodNote ctx={ctx} />
      <VerdictCard verdict={verdict} roas={false} />
      <SharedAccountsCallout pairs={pairs} />
      <Block
        title="Anúncios por loja"
        howTo="Cada loja contra o próprio empate, no canal em que anuncia (como no Resumo). Clique numa loja para ver as campanhas, os conjuntos e os anúncios dela."
        info="Campanhas, margens e vereditos são por loja: cada uma tem a sua conta de anúncio e o seu custo de produto."
        flush
      >
        <PortfolioAdsTable
          stores={view.stores} attribution={attribution} pairs={pairs} rangeLabel={ctx.rangeLabel}
          // Each row is priced on Brasília's calendar dates; Hibikura's own
          // "ontem" turns a day later at noon here. The link carries the exact
          // dates then, so the page opened shows the row that was clicked.
          hrefFor={row => ctx.hrefWith('/campaigns', resumoLinkOverrides(row, ctx))}
        />
      </Block>
    </AppShell>
  )
}
