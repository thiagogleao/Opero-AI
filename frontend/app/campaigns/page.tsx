import { Suspense } from 'react'
import { getPageContext, pageMetadata, type PageContext, type SearchParams } from '@/lib/views/page'
import { buildPortfolio } from '@/lib/views/portfolio'
import { shiftDate } from '@/lib/engine/dates'
import { computeStorePnL, type StorePnL } from '@/lib/engine/pnl'
import Link from 'next/link'
import { formatCount, formatRangeLabel, formatMoney, formatRoas, plural } from '@/lib/format'
import { storeRoas, type Verdict } from '@/lib/views/verdict'
import { adChannelOf } from '@/lib/views/adChannel'
import { detailsOf, roasChannelTag, statusChipsOf, type BandTile } from '@/lib/views/numberBand'
import { DetailPara, NumberBandView, PeriodDetails, pageTile, roasPageTile } from '@/components/numbers'
import { listStores, type StoreRef } from '@/lib/access'
import { getAlertConfig } from '@/lib/alerts'
import { getSharedAdAccounts, getSharedAdAccountsForStore } from '@/lib/attribution'
import { decisionWindows, getCampaignReport, getMetaSpendSpan, getOwnAttribution, getStoreCampaignName, type CampaignReport } from '@/lib/data/campaigns'
import { getCreativesReport } from '@/lib/data/creatives'
import type { ScaleThresholds } from '@/lib/campaignSignal'
import { AppShell, PageHeader, periodNoteText } from '@/components/shell'
import { Block, Callout, Card, EmptyState, ErrorState, SkeletonBlock, Tabs } from '@/components/ui'
import { attributedRoasNote, buildAdsVerdict, type MetaHistory, type Reconciliation } from '@/components/campaigns/adsVerdict'
import { ReconciliationLedger } from '@/components/campaigns/ReconciliationLedger'
import { ScaleRoom } from '@/components/campaigns/ScaleRoom'
import { CampaignTable } from '@/components/campaigns/CampaignTable'
import { CreativesView } from '@/components/campaigns/CreativesView'
import { campaignFilterText, type CreativesFilter } from '@/components/campaigns/campaignFilter'
import { sharedCampaignsNote } from '@/components/campaigns/text'
import { noSpendWhen } from '@/components/campaigns/creativeVerdict'
import { BilledElsewhere } from '@/components/campaigns/BilledElsewhere'
import { PortfolioAdsTable, SharedAccountsCallout, buildPortfolioAdsVerdict } from '@/components/campaigns/PortfolioAds'
import { portfolioAttribution } from '@/components/campaigns/portfolioAdsModel'
import { storeMarginFromPnL } from '@/components/campaigns/margin'
import { loadFirstSale } from '@/components/campaigns/firstSale'
import { loadArchivedStore, type ArchivedStoreInput } from '@/components/dashboard/archivedStore'
import type { BeforeStartInput } from '@/components/campaigns/storeStart'
import { emptyWhy, windowWhy, type EmptyWindowText } from '@/components/campaigns/emptyWhy'
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
  const ctx = await getPageContext(sp, { path: '/campaigns' })
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
  // R10/R12: an archived store is consultation only, never given a decision
  // block ("Onde há folga para escalar" over days it never read).
  const consultOnly = store.archived
  // The days actually read: an archived store's window stops at its archive day.
  const readLabel = ctx.readRange ? formatRangeLabel(ctx.readRange, ctx.today) : ctx.rangeLabel
  const sameWindow = ctx.range.from === decision.window.from && ctx.range.to === decision.window.to
  // One header for every path (error, empty, the page): the period ⓘ on all.
  const header = <PageHeader ctx={ctx} title={`Campanhas · ${store.name}`} periodInfo />

  let pnl: StorePnL | null, report: CampaignReport, decisionReport: CampaignReport, storeNames: Map<string, string>
  let firstSale: BeforeStartInput | null
  let archived: ArchivedStoreInput | null
  try {
    const [all, th] = await Promise.all([listStores(ctx.viewer, { includeArchived: true }), thresholds()])
    storeNames = new Map(all.map(x => [x.id, x.name]))
    const opts = { thresholds: th, storeNames, now: ctx.now }
    // The decision block always judges the last 7 closed days; when the page
    // shows another window, that window gets its own report so a campaign that
    // did not spend today still appears there.
    const [p, r, d, f, a] = await Promise.all([
      computeStorePnL(store.id, ctx.range, {}, ctx.now),
      getCampaignReport(store, ctx.range, opts),
      sameWindow || consultOnly ? Promise.resolve(null) : getCampaignReport(store, decision.window, opts),
      loadFirstSale(ctx),
      loadArchivedStore(ctx),
    ])
    pnl = p; report = r; decisionReport = d ?? r; firstSale = f; archived = a
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
  // Only a window without Meta spend asks when the store last spent.
  const metaHistory = report.totals.spend > 0 ? null : await loadMetaHistory(ctx, store)
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
    archived,
    metaHistory,
  })
  // Before the first sale or after the archive day, the blocks say the
  // verdict's reason. "Onde há folga" judges its own window (the last closed
  // days), so it gets that window's reason.
  const why = emptyWhy(verdict, ctx.rangeLabel)
  const decisionWhy = windowWhy({
    range: decision.window, rangeLabel: decisionLabel, today: ctx.today, spend: decisionReport.totals.spend,
    firstOrderDate: firstSale?.firstOrderDate ?? null, archived,
  })
  const shared = report.campaigns.filter(c => c.shared)
  const sharedNote = sharedCampaignsNote(shared, ctx.rangeLabel)
  const ownSpend = report.campaigns.filter(c => !c.shared).reduce((t, c) => t + c.spend, 0)
  const ownValue = report.campaigns.filter(c => !c.shared).reduce((t, c) => t + c.purchaseValue, 0)
  const margin = storeMarginFromPnL(ctx.range, pnl)

  // ── The page row: numbers first, the ads verdict's prose in Detalhes.
  const acts = decisionReport.totals.actions
  const attributedRoas = ownSpend > 0 ? ownValue / ownSpend : null
  const storeR = storeRoas(pnl.totals, report.configured)
  const storeRoasTag = storeR ? roasChannelTag(pnl.totals, adChannelOf(pnl.totals)) : null
  const roasNote = report.totals.spend > 0
    ? attributedRoasNote({ sharedSpend: shared.reduce((t, c) => t + c.spend, 0), shopSpend: pnl.totals.shopSpend, credited: ownValue, storeRevenue: pnl.totals.revenue })
    : null
  const actionWindow = `ação: 7 dias fechados (${decisionLabel})`
  const tiles = [
    campaignsResultTile(verdict),
    storeResultTile(reconciliation, ctx),
    pageTile({
      slot: 'receita', label: 'Gasto no Meta', value: formatMoney(report.totals.spend), raw: report.totals.spend,
      subs: [{ text: `${formatCount(report.totals.campaigns)} ${report.totals.campaigns === 1 ? 'campanha' : 'campanhas'}` }],
      info: 'Gasto no Meta das campanhas desta loja no período.',
    }),
    roasPageTile({
      slot: 'pedidos', label: 'ROAS atribuído × empate', roas: attributedRoas,
      facts: { breakEven: report.breakEvenRoas, configured: report.configured, revenue: pnl.totals.revenue, contribution: pnl.totals.contribution },
      // Without spend there is no note to give, but the tile still says what it measures.
      info: roasNote ?? 'Vendas que o Meta credita às campanhas desta loja ÷ o gasto delas no Meta, contra o empate da loja. Sem gasto no Meta no período, não há ROAS para medir.',
    }),
    roasPageTile({
      slot: 'anuncios', label: `${storeR?.label ?? 'ROAS da loja'} × empate`, roas: storeR?.roas ?? null,
      facts: { breakEven: storeR?.breakEven ?? null, configured: report.configured, revenue: pnl.totals.revenue, contribution: pnl.totals.contribution, reason: storeR?.reason ?? null },
      // The Resumo tile's channel tag ("só Meta" when Shopify spend sits outside).
      tags: storeRoasTag ? [storeRoasTag] : undefined,
      info: `Receita da loja (todas as vendas) ÷ gasto em anúncios, como no Resumo. ${storeR?.explain ?? ''}`.trim(),
    }),
    pageTile({
      slot: 'roas', label: 'Ações · 7 dias fechados',
      value: consultOnly ? '—' : `${formatCount(acts.cortar)} cortar`, tone: consultOnly ? 'mut' : acts.cortar > 0 ? 'neg' : 'neu',
      subs: consultOnly
        ? [{ text: 'loja arquivada: sem ações', tone: 'mut' }]
        : [{ text: `${formatCount(acts.escalar)} escalar · ${formatCount(acts.observar)} observar` }, { text: `${formatCount(acts.manter)} manter` }],
      tags: [{ code: 'janela_acao', label: decisionLabel, tone: 'info', icon: 'clock', info: `As ações são julgadas nos últimos 7 dias fechados (${decisionLabel}), seja qual for o período escolhido acima; o dinheiro dos outros números é do período escolhido.` }],
      info: `${actionWindow}. Cortar, escalar, observar e manter são as decisões das campanhas nesses dias.`,
    }),
  ]
  const status = statusChipsOf(verdict)
  if (sharedNote) status.push({ code: 'campanhas_compartilhadas', label: 'campanhas compartilhadas', tone: sharedNote.tone === 'warn' ? 'warn' : 'neu', info: `${sharedNote.title} ${sharedNote.text}` })
  const periodText = periodNoteText(ctx)
  const det = detailsOf(verdict, roasNote)

  return (
    <AppShell ctx={ctx}>
      {header}
      <NumberBandView
        tiles={tiles} status={status} costsHref={ctx.hrefWith('/profit')} ariaLabel="Números das campanhas"
        tileExtra={reconciliation.bridge ? { margem: <Link className={s.small} href={ctx.hrefWith('/')}>Resumo →</Link> } : undefined}
        details={
          <PeriodDetails details={det} extraCount={(periodText ? 1 : 0) + (sharedNote ? 1 : 0)}>
            {periodText && <DetailPara>{periodText}</DetailPara>}
            {sharedNote && <Callout tone={sharedNote.tone} title={sharedNote.title}>{' '}{sharedNote.text}</Callout>}
          </PeriodDetails>
        }
      />
      <Card className={s.recCard} as="section" aria-label="Das campanhas ao lucro da loja">
        <ReconciliationLedger rec={reconciliation} rangeLabel={readLabel} split={ctx.split} elsewhere={billedElsewhere} why={why} />
      </Card>
      <BilledElsewhere rows={report.billedElsewhere} storeName={store.name} rangeLabel={ctx.rangeLabel} hrefFor={id => otherStoreHref(ctx, id)} />
      {!consultOnly && <ScaleRoom report={decisionReport} windowLabel={decisionLabel} costsHref={ctx.hrefWith('/profit')} split={ctx.split} tableHasRows={report.campaigns.length > 0} why={decisionWhy} />}
      <Tabs
        ariaLabel="Campanhas ou criativos"
        active={tab}
        items={[
          { key: 'campanhas', label: 'Campanhas', href: ctx.hrefWith('/campaigns'), count: report.totals.campaigns },
          { key: 'criativos', label: 'Criativos', href: ctx.hrefWith('/campaigns?aba=criativos') },
        ]}
      />
      <Suspense key={`${tab}:${campaignId ?? ''}:${showAll}`} fallback={<SkeletonBlock lines={6} height={260} />}>
        <TabContent ctx={ctx} store={store} tab={tab} report={report} campaignId={campaignId} showAll={showAll} storeNames={storeNames} margin={margin} why={why} actionLabel={decisionLabel} />
      </Suspense>
    </AppShell>
  )
}

/**
 * Tile 1: the ads verdict's own number, worded by its basis. With costs it is
 * the campaigns' estimate (attribution × margin − spend); without costs the
 * verdict's amount is the store's revenue − ads, never an estimate.
 */
function campaignsResultTile(verdict: Verdict): BandTile {
  const none = verdict.amount === null
  const value = verdict.amount === null ? '—' : formatMoney(verdict.amount)
  const tone = none ? 'mut' : verdict.amountTone
  if (verdict.basis === 'revenue_minus_ads') {
    return pageTile({
      slot: 'lucro', label: 'Receita − anúncios', value, raw: verdict.amount, tone,
      tags: [{ code: 'sem_custos', label: 'sem custos', tone: 'cfg', info: 'Sem o custo dos produtos não há margem para estimar o lucro das campanhas: este número é vendas da loja − anúncios, que não é lucro.' }],
      subs: [{ text: verdict.amountCaption, tone: 'mut' }],
      info: 'Vendas da loja − gasto em anúncios (Meta e Anúncios Shopify), sem o custo dos produtos. Configure os custos para ver o lucro estimado das campanhas. Na visão de sócio, a sua parte.',
    })
  }
  return pageTile({
    slot: 'lucro', label: 'Lucro estimado das campanhas', value, raw: verdict.amount, tone,
    tags: none ? [] : [{ code: 'estimado', label: 'estimado · atribuição do Meta', tone: 'neu', info: `${verdict.amountCaption}. Vendas que o Meta atribui às campanhas × a margem da loja − o gasto: uma estimativa, não o lucro real da loja.` }],
    subs: none ? [{ text: verdict.amountCaption, tone: 'mut' }] : [],
    info: 'Vendas atribuídas pelo Meta às campanhas desta loja × a margem da loja − o gasto no Meta. Na visão de sócio, a sua parte.',
  })
}

/**
 * Tile 2: the reconciliation ledger's final row, as the ledger prints it.
 * With a bridge: "Lucro real da loja" (the Resumo's number). Without one:
 * "Vendas − anúncios", "—" when the window had neither sales nor ad spend
 * (never a $0 the Resumo lacks), and — without costs, where that row is tile
 * 1's number — the ledger's other half, what Meta credits.
 */
function storeResultTile(rec: Reconciliation, ctx: PageContext): BandTile {
  if (rec.bridge) {
    const v = ctx.part(rec.bridge.storeProfit)
    return pageTile({
      slot: 'margem', label: 'Lucro real da loja', value: formatMoney(v), raw: v, tone: v < 0 ? 'neg' : 'pos',
      subs: [{ text: `o número do Resumo${ctx.split ? ' · sua parte' : ''}` }],
      info: 'O lucro da loja inteira no período, de todas as vendas e todos os custos (Anúncios Shopify e custos fixos incluídos). O quadro abaixo liga um ao outro.',
    })
  }
  const empty = rec.orders === 0 && rec.storeRevenue <= 0 && Math.abs(rec.revenueMinusAds) < 0.005
  if (empty) {
    return pageTile({
      slot: 'margem', label: 'Vendas − anúncios', value: '—', tone: 'mut',
      subs: [{ text: 'nenhuma venda nem gasto em anúncios', tone: 'mut' }],
      info: 'Sem vendas e sem gasto em anúncios na janela, não há resultado a ligar ao da loja. Reembolsos e chargebacks do período estão no Resumo.',
    })
  }
  if (!rec.configured) {
    return pageTile({
      slot: 'margem', label: 'Creditado pelo Meta', value: formatMoney(rec.credited), raw: rec.credited, tone: 'neu',
      subs: [{ text: `de ${formatMoney(rec.storeRevenue)} vendidos na loja` }],
      info: 'Vendas que o Meta credita às campanhas desta loja, contra o que a loja vendeu de verdade (as duas barras do quadro abaixo). Sem custos, não há margem para transformar isso em lucro estimado.',
    })
  }
  return pageTile({
    slot: 'margem', label: 'Vendas − anúncios', value: formatMoney(rec.revenueMinusAds), raw: rec.revenueMinusAds,
    tone: rec.revenueMinusAds < 0 ? 'neg' : 'neu',
    subs: [{ text: 'sem vendas, não há margem para estimar', tone: 'mut' }],
    info: 'A última linha do quadro abaixo: vendas da loja − anúncios (Meta e Anúncios Shopify), da loja inteira.',
  })
}

async function TabContent({ ctx, store, tab, report, campaignId, showAll, storeNames, margin, why, actionLabel }: {
  ctx: PageContext; store: StoreRef; tab: 'campanhas' | 'criativos'; report: CampaignReport
  campaignId: string | null; showAll: boolean; storeNames: Map<string, string>; margin: ReturnType<typeof storeMarginFromPnL>
  why: EmptyWindowText | null
  /** The 7 closed days the actions are judged on ("18–24 nov"). */
  actionLabel: string
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
        why={why}
      />
    )
  }
  return (
    <Block
      title="Campanhas no Meta"
      eyebrow={`ação: 7 dias fechados (${actionLabel})`}
      howTo={`Gasto, vendas atribuídas e lucro estimado em ${ctx.rangeLabel}; o veredito e a tendência olham os últimos 7 dias fechados. Abra uma campanha para ver conjuntos e anúncios.`}
      info={report.formula}
      flush
      footer={report.campaigns.length === 0 ? undefined : report.reconciliation.gap === 0
        ? <span>A lista soma <b className="num">{formatMoney(report.reconciliation.listedSpend)}</b>, o mesmo gasto no Meta que a contabilidade da loja carrega.</span>
        : <span className="warn">A lista soma {formatMoney(report.reconciliation.listedSpend)} e a contabilidade {formatMoney(report.reconciliation.engineMetaSpend)}.</span>}
    >
      <CampaignTable report={report} creatives={creatives.creatives} hrefWith={p => ctx.hrefWith(p)} rangeLabel={ctx.rangeLabel} split={ctx.split} why={why} />
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

/** How far back "the ads that sell here run in another store's account" is
 *  looked for: the pairing is a property of the stores, not of the window
 *  (CAMP HALLOW's last sale on EPOCH's ads was 30 out). */
const ADS_ELSEWHERE_LOOKBACK_DAYS = 90

/**
 * When the store spent on Meta, for a window without spend (adsVerdict
 * noSpendHistory) and, for a store with none ever, whose account carries the
 * ads that sell there (only stores the viewer may see). Null when the read
 * fails: the verdict then says only what the window holds.
 */
async function loadMetaHistory(ctx: PageContext, store: StoreRef): Promise<MetaHistory | null> {
  try {
    const span = await getMetaSpendSpan(store.id, ctx.range.to)
    let adsRunIn: string[] = []
    if (!span.firstSpendDay) {
      const visible = new Map(ctx.stores.map(x => [x.id, x.name]))
      const lookback = { from: shiftDate(ctx.today, -(ADS_ELSEWHERE_LOOKBACK_DAYS - 1)), to: ctx.today }
      const pairs = await getSharedAdAccountsForStore(store.id, lookback, visible)
      adsRunIn = [...new Set(pairs
        .filter(p => p.salesStoreId === store.id && p.adStoreId !== store.id && visible.has(p.adStoreId))
        .map(p => p.adStoreName))]
    }
    return { ...span, range: ctx.range, today: ctx.today, adsRunIn }
  } catch (err) {
    console.error('[campaigns] meta history', err)
    return null
  }
}

/**
 * A link to the campaigns of another store of the viewer (the account a
 * campaign is billed in): an R4 link (lib/period carry), null when the viewer
 * cannot see that store (the text then renders without a link).
 */
function otherStoreHref(ctx: PageContext, storeId: string): string | null {
  return ctx.scopeHref('/campaigns', { kind: 'store', id: storeId })
}

async function AllStores({ ctx }: { ctx: PageContext }) {
  const header = <PageHeader ctx={ctx} title="Campanhas · todas as lojas" halved={false} periodInfo />
  const names = new Map(ctx.selected.map(x => [x.id, x.name]))
  const loaded = await Promise.all([
    buildPortfolio(ctx.selected, ctx.resolution, { liveFeed: false, chargebackHealth: false, freshness: false }, ctx.viewerStores),
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
  // R4 on the link's help line: the same clause as the Overview table.
  const opensOther = ctx.rowsAnnouncement(view.stores.map(r => r.id))
  const verdict = buildPortfolioAdsVerdict({
    stores: view.stores, attribution, pairs, rangeLabel: ctx.rangeLabel, periodPhrase: ctx.periodPhrase, partialLabel: ctx.partialLabel, split: ctx.split,
    range: ctx.range,
  })
  // ── The page row: the ads verdict's own numbers (its amount is the Meta
  // spend, its totals the stores' sum) and the attribution sum its sentence
  // uses — no arithmetic in the page.
  const shopSpend = verdict.totals.shopSpend
  const shopStores = view.stores.filter(r => r.totals.shopSpend > 0).map(r => r.name)
  const att = portfolioAttribution(view.stores, attribution)
  const tiles = [
    pageTile({
      slot: 'lucro', label: 'Gasto no Meta',
      value: verdict.amount === null ? '—' : formatMoney(verdict.amount), raw: verdict.amount, tone: verdict.amount === null ? 'mut' : 'neu',
      subs: [{ text: verdict.amountCaption, tone: verdict.amount === null ? 'mut' : undefined }],
      info: 'Todo o gasto no Meta que a contabilidade das lojas carrega, inclusive campanhas de conta compartilhada.',
    }),
    pageTile({
      slot: 'margem', label: 'Vendas creditadas', value: att ? formatMoney(att.ownValue) : '—', raw: att?.ownValue ?? null, tone: att ? 'neu' : 'mut',
      subs: att ? [] : [{ text: 'a divisão por campanha não carregou', tone: 'mut' }],
      info: 'O que o Meta credita às campanhas da própria loja, somado. Campanhas de conta compartilhada ficam fora.',
    }),
    pageTile({
      slot: 'receita', label: 'ROAS atribuído', value: att && att.roas !== null ? formatRoas(att.roas) : '—',
      raw: att?.roas ?? null, tone: att && att.roas !== null ? 'neu' : 'mut',
      subs: [{ text: 'vendas creditadas ÷ gasto das campanhas próprias' }],
      info: 'Vendas creditadas ÷ gasto das campanhas da própria loja, somando as lojas. Cada loja contra o próprio empate está na tabela.',
    }),
    pageTile({
      slot: 'pedidos', label: 'Anúncios Shopify', value: formatMoney(shopSpend), raw: shopSpend, tone: shopSpend > 0 ? 'neu' : 'mut',
      subs: [{ text: shopStores.length ? shopStores.join(', ') : 'nenhuma loja', tone: shopStores.length ? undefined : 'mut' }],
      info: 'Shop Campaigns, cobrados na fatura da Shopify, fora do Meta.',
    }),
  ]
  const status = statusChipsOf(verdict)
  if (pairs.length) {
    status.push({
      code: 'conta_compartilhada', label: 'conta compartilhada', tone: 'warn',
      info: `${pairs.map(p => `Anúncios pagos pela ${p.adStoreName} trouxeram ${plural(p.orders, 'pedido', 'pedidos')} (${formatMoney(p.revenue)}) da ${p.salesStoreName}`).join('; ')}. O gasto fica na loja dona da conta e as vendas na loja que vendeu: some as duas para julgar o resultado.`,
    })
  }
  const periodText = periodNoteText(ctx)
  return (
    <AppShell ctx={ctx}>
      {header}
      <NumberBandView
        tiles={tiles} status={status} ariaLabel="Números das campanhas, todas as lojas"
        details={
          <PeriodDetails details={detailsOf(verdict)} extraCount={(periodText ? 1 : 0) + (pairs.length ? 1 : 0)}>
            {periodText && <DetailPara>{periodText}</DetailPara>}
            <SharedAccountsCallout pairs={pairs} />
          </PeriodDetails>
        }
      />
      <Block
        title="Anúncios por loja"
        howTo={`Cada loja contra o próprio empate, no canal em que anuncia (como no Resumo). Clique numa loja para ver as campanhas, os conjuntos e os anúncios dela${opensOther ? ` ${opensOther}` : ''}.`}
        info="Campanhas, margens e vereditos são por loja: cada uma tem a sua conta de anúncio e o seu custo de produto."
        flush
      >
        <PortfolioAdsTable
          stores={view.stores} attribution={attribution} pairs={pairs} rangeLabel={ctx.rangeLabel}
          // An R4 link (lib/period carry): the period travels as asked and
          // the store's page resolves it on its own clock, announcing other
          // dates on landing (vem=todas).
          hrefFor={row => ctx.scopeHref('/campaigns', { kind: 'store', id: row.id }) ?? ctx.hrefWith('/campaigns')}
        />
      </Block>
    </AppShell>
  )
}
