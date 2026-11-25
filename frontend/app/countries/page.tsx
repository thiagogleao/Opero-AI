import { Suspense } from 'react'
import { getPageContext, pageMetadata, type PageContext, type SearchParams } from '@/lib/views/page'
import { computePnL, type CountryPnL, type PnL, type StorePnL } from '@/lib/engine/pnl'
import type { StoreRef } from '@/lib/access'
import { getCountryReport, getMetaSplitCoverage, rollUpCountries, SMALL_SAMPLE, TERRITORIES_NOTE, type CountryReport, type CountryRow, type MetaSplitCoverage } from '@/lib/data/countries'
import { getCustomerLtv, getCustomerSplit, type CustomerSplit } from '@/lib/data/customers'
import { getFunnel, sumFunnels, type FunnelReport } from '@/lib/data/funnel'
import { sumTotals } from '@/lib/views/verdict'
import { formatCount, formatMoney, formatShare, plural } from '@/lib/format'
import { AppShell, PageHeader, periodNoteText } from '@/components/shell'
import { Block, Callout, Card, EmptyState, ErrorState, SkeletonBlock } from '@/components/ui'
import { HorizontalBars } from '@/components/charts'
import { CountryTable, MetaCountries, allStoresCoverageText, coverageText } from '@/components/countries/CountryTables'
import { metaElsewhereText } from '@/components/countries/metaEmpty'
import { getSharedAdAccountsForStore } from '@/lib/attribution'
import { CustomersByStore, CustomersSplit, FunnelBlock, LtvBlock, type StoreCustomers } from '@/components/countries/CustomerBlocks'
import { buildCountriesVerdict, customerMixShares } from '@/components/countries/countriesVerdict'
import { detailsOf, statusChipsOf } from '@/lib/views/numberBand'
import { DetailPara, NumberBandView, PeriodDetails, pageTile } from '@/components/numbers'
import { countryCounts, foldCountryRows, shopifyCountryRows } from '@/components/countries/fold'
import { sharedLeftOutText } from '@/components/countries/sharedText'
import { loadFirstSale, loadFirstSales } from '@/components/campaigns/firstSale'
import { firstSaleOfAll } from '@/components/campaigns/storeStart'
import { emptyWhy, type EmptyWindowText } from '@/components/campaigns/emptyWhy'
import { loadArchivedStore } from '@/components/dashboard/archivedStore'
import s from '@/components/countries/countries.module.css'

/**
 * Países e clientes — contribution per country from the profit engine (every
 * country kept, an "outros" row so the table adds up), Meta's own country
 * split shown apart and labelled as Meta's claim, new vs returning vs guest
 * orders and lifetime value (lib/data/customers), and the funnel with only the
 * steps the pixel measures (lib/data/funnel). "Todas" sums the stores with
 * cost settings per country and lists customers per store.
 */

export const generateMetadata = pageMetadata('Países e clientes')

const ROWS = 15
const CAVEAT_LINE =
  'Divisão feita pelo próprio Meta: na EPOCH ela captou de 17% a 140% dos pedidos reais conforme o país — compare com os pedidos da Shopify, não decida geografia por ela.'

export default async function CountriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getPageContext(searchParams, { path: '/countries' })
  if (ctx.scope === 'all') return <AllStores ctx={ctx} />
  const store = ctx.store
  const header = <PageHeader ctx={ctx} title={`Países e clientes · ${store?.name ?? ''}`} halved={false} periodInfo />
  if (!store) {
    return <AppShell ctx={ctx}>{header}<EmptyState icon="store" title="Nenhuma loja para mostrar" /></AppShell>
  }

  const loaded = await Promise.all([
    // Every country (the max), folded to ROWS below: the full list is what
    // tells how many countries had orders.
    getCountryReport(store, ctx.range, { limit: 250 }),
    getCustomerSplit(store, ctx.range),
    loadFirstSale(ctx),
    loadArchivedStore(ctx),
  ]).catch(err => { console.error('[countries]', err); return null })
  if (!loaded || !loaded[0]) {
    return (
      <AppShell ctx={ctx}>
        {header}
        <ErrorState title="Não foi possível carregar os países">A leitura dos pedidos falhou. Nada foi alterado; recarregue a página em instantes.</ErrorState>
      </AppShell>
    )
  }
  const [report, split, firstSale, archived] = loaded as [CountryReport, CustomerSplit, Awaited<ReturnType<typeof loadFirstSale>>, Awaited<ReturnType<typeof loadArchivedStore>>]
  const all = report.rows
  // Meta's table keeps the countries where only Meta spent; the Shopify
  // table, its aside and the verdict list countries with orders only.
  const rows = foldCountryRows(all, ROWS, report.totals.revenue)
  const shopRows = foldCountryRows(shopifyCountryRows(all), ROWS, report.totals.revenue)
  const opt = ctx.storeOption
  const verdict = buildCountriesVerdict({
    subjectOf: `da ${store.name}`, subjectIn: `na ${store.name}`, rows: shopRows, counts: countryCounts(all), totals: report.totals,
    configured: report.configured, customers: split, rangeLabel: ctx.rangeLabel, periodPhrase: ctx.periodPhrase,
    partialLabel: ctx.partialLabel, dayLabel: opt?.dayLabel ?? null, split: ctx.split, firstSale, archived,
  })
  // Before the first sale or after the archive day, every block says the
  // verdict's reason instead of "Nenhum pedido" / "Sem gasto no Meta".
  const why = emptyWhy(verdict, ctx.rangeLabel)
  const notes = report.notes.filter(n => n !== TERRITORIES_NOTE)
  const coverage = coverageText(report.meta)
  const nameOf = (id: string) => ctx.stores.find(x => x.id === id)?.name ?? null
  const metaShared = report.sharedLeftOut ? sharedLeftOutText(report.sharedLeftOut, nameOf, 'das colunas do Meta e da captura') : null
  const sharedSpend = report.sharedLeftOut?.spend ?? 0
  // Only a store with no Meta spend of its own asks where its ads are paid
  // (CAMP HALLOW's run in EPOCH's account): the table then says so instead
  // of blaming a missing Meta report.
  const elsewhere = why || report.meta.totalSpend > 0 || sharedSpend > 0 ? null : await adsPaidElsewhere(store, ctx)

  // ── The page row: numbers the verdict's input already has.
  const counts = countryCounts(all)
  const named = shopRows.filter(r => r.country !== 'outros' && r.orders > 0)
  const top = [...named].sort((a, b) => b.revenue - a.revenue)[0] ?? null
  const mix = split.orders > 0 ? customerMixShares(split) : null
  const dash = '—'
  const tiles = [
    pageTile({
      slot: 'lucro', label: report.configured ? 'Contribuição' : 'Vendas',
      value: why || verdict.amount === null ? dash : formatMoney(verdict.amount), raw: why ? null : verdict.amount,
      tone: why || verdict.amount === null ? 'mut' : verdict.amount < 0 ? 'neg' : 'neu',
      tags: report.configured ? [{ code: 'antes_anuncios', label: 'antes dos anúncios', tone: 'neu', info: `${verdict.amountCaption}. Contribuição = receita − produto, frete e taxas, antes dos anúncios: não é lucro.` }] : [],
      subs: why ? [{ text: why.title, tone: 'mut' }] : [],
      info: 'Pedidos reais da Shopify por país de entrega, cada um com o custo do próprio país, antes dos anúncios.',
    }),
    pageTile({
      slot: 'margem', label: 'País nº 1', value: top && !why ? formatShare(top.revenueShare) : dash, raw: top?.revenueShare ?? null,
      tone: top && !why ? 'neu' : 'mut',
      subs: top && !why ? [{ text: `das vendas · ${top.name}` }] : [],
      tags: top?.country === 'US' && !why ? [{ code: 'territorios', label: 'inclui Porto Rico e territórios', tone: 'neu', info: TERRITORIES_NOTE }] : [],
      info: 'O país de entrega com mais receita no período e a parte dele nas vendas.',
    }),
    pageTile({
      slot: 'receita', label: 'Países com pedidos', value: why ? dash : formatCount(counts.withOrders), raw: why ? null : counts.withOrders, tone: why ? 'mut' : 'neu',
      subs: why || !counts.small ? [] : [{ text: `${formatCount(counts.small)} com amostra pequena` }],
      info: `Países de entrega com pelo menos um pedido. Amostra pequena: menos de ${SMALL_SAMPLE} pedidos, não decida por ele sozinho.`,
    }),
    pageTile({ slot: 'pedidos', label: 'Clientes novos', value: mix && !why ? mix.new : dash, tone: mix && !why ? 'neu' : 'mut', subs: mix && !why ? [{ text: 'dos pedidos' }] : [], info: 'Pedidos que são o primeiro do cliente.' }),
    pageTile({
      slot: 'anuncios', label: 'Recompra', value: mix && !why ? mix.returning : dash, tone: mix && !why ? 'neu' : 'mut', subs: mix && !why ? [{ text: 'dos pedidos' }] : [],
      // The guest-order clause is long ("2 pedidos sem cadastro (menos de…"): in the ⓘ, not cut off in the sub.
      info: `Pedidos de clientes que já tinham comprado antes.${mix?.guest ? ` Fora da conta de novos e recompra: ${mix.guest}.` : ''}`,
    }),
    pageTile({ slot: 'roas', label: 'Pedidos', value: why ? dash : formatCount(report.totals.orders), raw: why ? null : report.totals.orders, tone: why ? 'mut' : 'neu', info: 'Pedidos pagos no período.' }),
  ]
  const periodText = periodNoteText(ctx)
  const asideNode = <CountryAside rows={shopRows} totals={report.totals} configured={report.configured} rangeLabel={ctx.rangeLabel} />

  return (
    <AppShell ctx={ctx}>
      {header}
      <NumberBandView
        tiles={tiles} status={statusChipsOf(verdict)} costsHref={ctx.hrefWith('/profit')} ariaLabel="Números dos países"
        details={
          <PeriodDetails details={detailsOf(verdict)} extraCount={periodText ? 1 : 0}>
            {periodText && <DetailPara>{periodText}</DetailPara>}
          </PeriodDetails>
        }
      />
      {named.length > 0 && <Card className={s.asideCard} as="section" aria-label="Por país">{asideNode}</Card>}
      <Block
        title={report.configured ? 'Contribuição por país' : 'Vendas por país'}
        howTo={`Pedidos reais da Shopify por país de entrega em ${ctx.rangeLabel}${report.configured ? ', cada um com o custo do próprio país' : ' — sem custos configurados, só vendas e pedidos'}.${shopRows.some(r => r.country === 'outros') ? ' A linha "outros" fecha a conta com a loja.' : ''}`}
        info="Os anúncios ficam numa linha só da loja, não divididos por país: a divisão por país do Meta não é confiável para isso."
        flush
        // The territories note is about US orders: over an empty table it
        // explained rows that are not there.
        footer={shopRows.some(r => r.country === 'US') || notes.length ? <>
          {shopRows.some(r => r.country === 'US') && <span>{TERRITORIES_NOTE}</span>}
          {notes.map((n, i) => <span key={i}>{n}</span>)}
        </> : undefined}
      >
        <CountryTable rows={shopRows} totals={report.totals} configured={report.configured} rangeLabel={ctx.rangeLabel} why={why} />
      </Block>
      <Block
        title="O que o Meta atribui a cada país"
        eyebrow="Atribuído pelo Meta"
        // A caveat: one visible line, the whole of it in the ⓘ.
        howTo="não serve para decidir geografia"
        howToVisible
        info={<>{CAVEAT_LINE} {report.meta.caveat}</>}
        flush
        footer={coverage || metaShared ? <>
          {metaShared && <span>{metaShared}</span>}
          {coverage && <span>{coverage}</span>}
        </> : undefined}
      >
        <MetaCountries rows={rows} purchasesKnown rangeLabel={ctx.rangeLabel} metaSpend={report.meta.totalSpend} sharedSpend={sharedSpend} elsewhere={elsewhere} why={why} />
      </Block>
      <CustomersSplit split={split} today={ctx.today} rangeLabel={ctx.rangeLabel} why={why} />
      <div className={s.grid2}>
        <Suspense fallback={<SkeletonBlock lines={4} height={140} />}>
          <StoreLtv store={store} today={ctx.today} />
        </Suspense>
        <Suspense fallback={<SkeletonBlock lines={4} height={140} />}>
          <StoreFunnel store={store} ctx={ctx} why={why} />
        </Suspense>
      </div>
    </AppShell>
  )
}

function CountryAside({ rows, totals, configured, rangeLabel }: { rows: CountryRow[]; totals: PnL; configured: boolean; rangeLabel: string }) {
  const named = rows.filter(r => r.country !== 'outros' && r.orders > 0)
  if (!named.length) return null
  const base = configured ? totals.contribution : totals.revenue
  const top = [...named].sort((a, b) => (configured ? b.contribution - a.contribution : b.revenue - a.revenue)).slice(0, 8)
  const rest = base - top.reduce((t, r) => t + (configured ? r.contribution : r.revenue), 0)
  return (
    <div>
      <div className={s.asideHead}>
        <div className={s.asideTitle}>{configured ? 'De onde veio a contribuição' : 'De onde vieram as vendas'}</div>
        <div className={s.asideSub}>{configured ? 'Contribuição por país, antes dos anúncios' : 'Vendas por país'}, em {rangeLabel}</div>
      </div>
      <HorizontalBars
        ariaLabel={configured ? 'Contribuição por país' : 'Vendas por país'}
        items={top.map(r => {
          const v = configured ? r.contribution : r.revenue
          return {
            key: r.country, label: r.name, sub: `${plural(r.orders, 'pedido', 'pedidos')}${r.smallSample ? ' · amostra pequena' : ''}`,
            value: v, tone: v < 0 ? 'neg' : configured ? 'pos' : 'neu', note: formatShare(base > 0 ? (v / base) * 100 : null),
          }
        })}
      />
      {Math.abs(rest) >= 0.5 && <p className={`${s.small} ${s.asideFoot}`}>Os demais países somam {formatMoney(rest)}.</p>}
    </div>
  )
}

/** Where the window's orders of this store came from ads paid in another
 *  store's account, named only among the stores the viewer may see; null
 *  when none (or when the lookup fails: the table then keeps the plain
 *  "sem gasto" line). */
async function adsPaidElsewhere(store: StoreRef, ctx: PageContext): Promise<string | null> {
  const visible = new Map(ctx.stores.map(x => [x.id, x.name]))
  const pairs = await getSharedAdAccountsForStore(store.id, ctx.range, visible)
    .catch(err => { console.error('[countries] shared accounts', err); return [] })
  return metaElsewhereText(pairs
    .filter(p => p.salesStoreId === store.id && p.adStoreId !== store.id && visible.has(p.adStoreId))
    .map(p => ({ name: p.adStoreName, orders: p.orders })))
}

async function StoreLtv({ store, today }: { store: StoreRef; today: string }) {
  const ltv = await getCustomerLtv(store).catch(err => { console.error('[countries] ltv', err); return null })
  if (!ltv) return <Block title="Valor do cliente (LTV)"><ErrorState compact /></Block>
  return <LtvBlock ltv={ltv} today={today} />
}

async function StoreFunnel({ store, ctx, why }: { store: StoreRef; ctx: PageContext; why: EmptyWindowText | null }) {
  const funnel = await getFunnel(store, ctx.range).catch(err => { console.error('[countries] funnel', err); return null })
  if (!funnel) return <Block title="Funil"><ErrorState compact /></Block>
  const nameOf = (id: string) => ctx.stores.find(x => x.id === id)?.name ?? null
  const sharedNote = funnel.sharedLeftOut ? sharedLeftOutText(funnel.sharedLeftOut, nameOf, 'do funil, da captura e do gasto por pedido') : null
  return <FunnelBlock funnel={funnel} rangeLabel={ctx.rangeLabel} sharedNote={sharedNote} why={why} />
}

// ─── Todas as lojas ──────────────────────────────────────────────────────────

/** Countries summed over stores (each priced with its own costs). */
function sumCountries(lists: CountryPnL[][]): (CountryPnL & { purchases: number })[] {
  const by = new Map<string, CountryPnL & { purchases: number }>()
  for (const list of lists) {
    for (const c of list) {
      const cur = by.get(c.country) ?? { country: c.country, revenue: 0, orders: 0, variableCosts: 0, contribution: 0, metaSpend: 0, metaPurchaseValue: 0, purchases: 0 }
      cur.revenue += c.revenue; cur.orders += c.orders; cur.variableCosts += c.variableCosts
      cur.contribution += c.contribution; cur.metaSpend += c.metaSpend; cur.metaPurchaseValue += c.metaPurchaseValue
      by.set(c.country, cur)
    }
  }
  return [...by.values()]
}

/** The "Todas" Meta block's coverage line over the stores whose country rows
 *  it sums; null when none of them spent on Meta or the read fails (the
 *  table then stands without it, as before). */
async function loadAllCoverage(pnls: StorePnL[], ctx: PageContext, name: Map<string, string>): Promise<string | null> {
  const spent = pnls.filter(p => p.totals.metaSpend > 0)
  if (!spent.length) return null
  let byStore: Map<string, MetaSplitCoverage>
  try {
    byStore = await getMetaSplitCoverage(spent.map(p => ({ storeId: p.store.id, daily: p.daily, totalSpend: p.totals.metaSpend })), ctx.range)
  } catch (err) {
    console.error('[countries] meta coverage', err)
    return null
  }
  return allStoresCoverageText(spent.flatMap(p => {
    const c = byStore.get(p.store.id)
    return c ? [{ name: name.get(p.store.id) ?? p.store.name, ...c }] : []
  }))
}

async function AllStores({ ctx }: { ctx: PageContext }) {
  const header = <PageHeader ctx={ctx} title="Países e clientes · todas as lojas" halved={false} periodInfo />
  const [pnls, firstSales] = await Promise.all([
    computePnL(ctx.storeIds, ctx.range, { countries: true }, ctx.now)
      .catch(err => { console.error('[countries] all stores', err); return null }),
    loadFirstSales(ctx),
  ])
  if (!pnls) {
    return <AppShell ctx={ctx}>{header}<ErrorState title="Não foi possível carregar os países" /></AppShell>
  }
  const name = new Map(ctx.selected.map(x => [x.id, x.name]))
  const list = [...pnls.values()]
  // The verdict rule for sums: stores without costs stay out of the amount
  // (their "contribution" would be their whole revenue) and are named.
  const priced = list.filter(p => p.configured)
  const excluded = list.filter(p => !p.configured && (p.totals.revenue > 0 || p.totals.metaSpend > 0))
  const judged = priced.length ? priced : list
  const configured = priced.length > 0
  const totals = sumTotals(judged.map(p => p.totals))
  const summed = sumCountries(judged.map(p => p.countries ?? []))
  const full = rollUpCountries(summed, totals.revenue, summed.length)
  // As one store: the Meta table keeps Meta-only countries, the Shopify table
  // and the verdict list countries with orders.
  const rows = foldCountryRows(full, ROWS, totals.revenue)
  const shopRows = foldCountryRows(shopifyCountryRows(full), ROWS, totals.revenue)
  const counts = countryCounts(full)
  // The Meta table sums the judged stores' country rows: say how much of
  // their Meta spend that is, and whose split is missing.
  const coverage = await loadAllCoverage(judged, ctx, name)
  // Named as "fora da soma" only when they sold something; a store without
  // costs that only spent on Meta changes no contribution, but its country
  // spend is missing from the Meta block, which says so.
  const excludedNames = configured ? excluded.filter(p => p.totals.revenue > 0).map(p => name.get(p.store.id) ?? p.store.name) : []
  const metaLeftOut = configured ? excluded.map(p => name.get(p.store.id) ?? p.store.name) : []
  // No store had made its first sale yet: the Overview's reading, not
  // "Nenhum pedido nas suas lojas".
  const firstOfAll = firstSaleOfAll(list.map(p => ({ totals: p.totals, firstOrderDate: firstSales.get(p.store.id) ?? null })), ctx.range)
  const verdict = buildCountriesVerdict({
    subjectOf: 'das suas lojas', subjectIn: 'nas suas lojas', rows: shopRows, counts, totals, configured, customers: null,
    excludedStores: excludedNames, rangeLabel: ctx.rangeLabel, periodPhrase: ctx.periodPhrase,
    partialLabel: ctx.partialLabel, dayLabel: null, split: ctx.split,
    firstSaleAll: firstOfAll ? { firstOrderDate: firstOfAll, range: ctx.range, today: ctx.today, storeCount: list.length } : null,
  })
  const why = emptyWhy(verdict, ctx.rangeLabel)

  const named = shopRows.filter(r => r.country !== 'outros' && r.orders > 0)
  const top = [...named].sort((a, b) => b.revenue - a.revenue)[0] ?? null
  const dash = '—'
  const tiles = [
    pageTile({
      slot: 'lucro', label: configured ? 'Contribuição' : 'Vendas',
      value: why || verdict.amount === null ? dash : formatMoney(verdict.amount), raw: why ? null : verdict.amount,
      tone: why || verdict.amount === null ? 'mut' : verdict.amount < 0 ? 'neg' : 'neu',
      tags: configured ? [{ code: 'antes_anuncios', label: 'antes dos anúncios', tone: 'neu', info: `${verdict.amountCaption}. Contribuição = receita − produto, frete e taxas, antes dos anúncios: não é lucro.` }] : [],
      subs: why ? [{ text: why.title, tone: 'mut' }] : [],
      info: 'Pedidos reais da Shopify por país de entrega, cada pedido com o custo da própria loja, antes dos anúncios.',
    }),
    pageTile({
      slot: 'margem', label: 'País nº 1', value: top && !why ? formatShare(top.revenueShare) : dash, raw: top?.revenueShare ?? null, tone: top && !why ? 'neu' : 'mut',
      subs: top && !why ? [{ text: `das vendas · ${top.name}` }] : [],
      tags: top?.country === 'US' && !why ? [{ code: 'territorios', label: 'inclui Porto Rico e territórios', tone: 'neu', info: TERRITORIES_NOTE }] : [],
      info: 'O país de entrega com mais receita no período e a parte dele nas vendas.',
    }),
    pageTile({
      slot: 'receita', label: 'Países com pedidos', value: why ? dash : formatCount(counts.withOrders), raw: why ? null : counts.withOrders, tone: why ? 'mut' : 'neu',
      subs: why || !counts.small ? [] : [{ text: `${formatCount(counts.small)} com amostra pequena` }],
      info: `Países de entrega com pelo menos um pedido. Amostra pequena: menos de ${SMALL_SAMPLE} pedidos.`,
    }),
    pageTile({ slot: 'pedidos', label: 'Pedidos', value: why ? dash : formatCount(totals.orders), raw: why ? null : totals.orders, tone: why ? 'mut' : 'neu', info: 'Pedidos pagos no período, das lojas somadas.' }),
  ]
  const status = statusChipsOf(verdict)
  const outText = excludedNames.length
    ? `Fora da soma por país: ${excluded.filter(p => p.totals.revenue > 0).map(p => `${name.get(p.store.id) ?? p.store.name} (${formatMoney(p.totals.revenue)} em vendas)`).join(', ')} — custos não configurados, então não há contribuição por país para somar.`
    : null
  // The verdict's own 'N lojas sem custos' chip has no ⓘ (it is built with no
  // excluded list): it carries the names instead of a second chip.
  const semCustos = status.findIndex(c => c.code === 'sem_custos')
  if (outText && semCustos < 0) status.push({ code: 'sem_custos', label: plural(excludedNames.length, 'loja fora da soma', 'lojas fora da soma'), tone: 'cfg', icon: 'sliders', info: outText })
  else if (outText && !status[semCustos].info) status[semCustos] = { ...status[semCustos], info: outText }
  const periodText = periodNoteText(ctx)

  return (
    <AppShell ctx={ctx}>
      {header}
      <NumberBandView
        tiles={tiles} status={status} ariaLabel="Números dos países, todas as lojas"
        details={
          <PeriodDetails details={detailsOf(verdict)} extraCount={(periodText ? 1 : 0) + (outText ? 1 : 0)}>
            {periodText && <DetailPara>{periodText}</DetailPara>}
            {outText && <Callout tone="warn">{outText}</Callout>}
          </PeriodDetails>
        }
      />
      {named.length > 0 && <Card className={s.asideCard} as="section" aria-label="Por país"><CountryAside rows={shopRows} totals={totals} configured={configured} rangeLabel={ctx.rangeLabel} /></Card>}
      <Block
        title="Contribuição por país"
        howTo={`Pedidos reais de ${configured && excludedNames.length ? 'todas as lojas com custos' : 'todas as lojas'} por país de entrega em ${ctx.rangeLabel}, cada pedido com o custo da própria loja.`}
        info="Os anúncios não são divididos por país: a divisão do Meta não é confiável para isso."
        flush
        footer={shopRows.some(r => r.country === 'US') ? <span>{TERRITORIES_NOTE}</span> : undefined}
      >
        <CountryTable rows={shopRows} totals={totals} configured={configured} rangeLabel={ctx.rangeLabel} storesLabel={excludedNames.length ? 'das lojas com custos' : 'das lojas'} why={why} />
      </Block>
      <Block
        title="Gasto no Meta por país" eyebrow="Atribuído pelo Meta"
        howTo="não serve para decidir geografia"
        howToVisible
        info={`${CAVEAT_LINE}${metaLeftOut.length ? ` Sem ${metaLeftOut.join(', ')} (custos não configurados).` : ''}`}
        flush
        footer={coverage ? <span>{coverage}</span> : undefined}
      >
        <MetaCountries rows={rows} purchasesKnown={false} rangeLabel={ctx.rangeLabel} metaSpend={totals.metaSpend} many why={why} />
      </Block>
      <Suspense fallback={<SkeletonBlock lines={5} height={160} />}>
        <AllCustomers stores={ctx.selected} rangeLabel={ctx.rangeLabel} ctx={ctx} why={why} />
      </Suspense>
    </AppShell>
  )
}

async function AllCustomers({ stores, rangeLabel, ctx, why }: { stores: StoreRef[]; rangeLabel: string; ctx: PageContext; why: EmptyWindowText | null }) {
  const each = await Promise.all(stores.map(async st => {
    const [split, ltv, funnel] = await Promise.all([
      getCustomerSplit(st, ctx.range).catch(err => { console.error('[countries] split', st.id, err); return null }),
      getCustomerLtv(st).catch(err => { console.error('[countries] ltv', st.id, err); return null }),
      getFunnel(st, ctx.range).catch(err => { console.error('[countries] funnel', st.id, err); return null }),
    ])
    return { id: st.id, name: st.name, split, ltv, funnel }
  }))
  const customers: StoreCustomers[] = each.map(({ id, name, split, ltv }) => ({ id, name, split, ltv }))
  const funnels = each.map(e => e.funnel).filter((f): f is FunnelReport => !!f)
  return (
    <>
      <CustomersByStore stores={customers} rangeLabel={rangeLabel} why={why} />
      {funnels.length > 0 && <SummedFunnel funnels={funnels} ctx={ctx} rangeLabel={rangeLabel} why={why} />}
    </>
  )
}

function SummedFunnel({ funnels, ctx, rangeLabel, why }: { funnels: FunnelReport[]; ctx: PageContext; rangeLabel: string; why: EmptyWindowText | null }) {
  const funnel = sumFunnels(funnels, new Set(ctx.storeIds), ctx.range)
  const nameOf = (id: string) => ctx.stores.find(x => x.id === id)?.name ?? null
  const sharedNote = funnel.sharedLeftOut ? sharedLeftOutText(funnel.sharedLeftOut, nameOf, 'do funil, da captura e do gasto por pedido') : null
  return <FunnelBlock funnel={funnel} rangeLabel={rangeLabel} sharedNote={sharedNote} stores={funnels.length} why={why} />
}
