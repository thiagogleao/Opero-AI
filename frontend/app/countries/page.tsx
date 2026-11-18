import { Suspense } from 'react'
import type { Metadata } from 'next'
import { getPageContext, type PageContext, type SearchParams } from '@/lib/views/page'
import { computePnL, type CountryPnL, type PnL } from '@/lib/engine/pnl'
import type { StoreRef } from '@/lib/access'
import { getCountryReport, rollUpCountries, TERRITORIES_NOTE, type CountryReport, type CountryRow } from '@/lib/data/countries'
import { getCustomerLtv, getCustomerSplit, type CustomerSplit } from '@/lib/data/customers'
import { buildMetaSteps, getFunnel, META_STEPS, type FunnelReport, type MetaStepKey } from '@/lib/data/funnel'
import { sumTotals } from '@/lib/views/verdict'
import { formatMoney, formatPct } from '@/lib/format'
import { AppShell, PageHeader, PeriodNote } from '@/components/shell'
import { Block, Callout, EmptyState, ErrorState, SkeletonBlock, VerdictCard } from '@/components/ui'
import { HorizontalBars } from '@/components/charts'
import { CountryTable, MetaCountries, coverageText } from '@/components/countries/CountryTables'
import { CustomersByStore, CustomersSplit, FunnelBlock, LtvBlock, type StoreCustomers } from '@/components/countries/CustomerBlocks'
import { buildCountriesVerdict } from '@/components/countries/countriesVerdict'
import { countryCounts, foldCountryRows, meaningfulCountries } from '@/components/countries/fold'
import s from '@/components/countries/countries.module.css'

/**
 * Países e clientes — contribution per country from the profit engine (every
 * country kept, an "outros" row so the table adds up), Meta's own country
 * split shown apart and labelled as Meta's claim, new vs returning vs guest
 * orders and lifetime value (lib/data/customers), and the funnel with only the
 * steps the pixel measures (lib/data/funnel). "Todas" sums the stores with
 * cost settings per country and lists customers per store.
 */

export const metadata: Metadata = { title: 'Países e clientes' }

const ROWS = 15
const CAVEAT_LINE =
  'Divisão feita pelo próprio Meta: na EPOCH ela captou de 17% a 140% dos pedidos reais conforme o país — compare com os pedidos da Shopify, não decida geografia por ela.'

export default async function CountriesPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getPageContext(searchParams)
  if (ctx.scope === 'all') return <AllStores ctx={ctx} />
  const store = ctx.store
  const header = <PageHeader ctx={ctx} title={`Países e clientes · ${store?.name ?? ''}`} />
  if (!store) {
    return <AppShell ctx={ctx}>{header}<EmptyState icon="store" title="Nenhuma loja para mostrar" /></AppShell>
  }

  const loaded = await Promise.all([
    // Every country (the max), folded to ROWS below: the full list is what
    // tells how many countries had orders.
    getCountryReport(store, ctx.range, { limit: 250 }),
    getCustomerSplit(store, ctx.range),
  ]).catch(err => { console.error('[countries]', err); return null })
  if (!loaded || !loaded[0]) {
    return (
      <AppShell ctx={ctx}>
        {header}
        <ErrorState title="Não foi possível carregar os países">A leitura dos pedidos falhou. Nada foi alterado; recarregue a página em instantes.</ErrorState>
      </AppShell>
    )
  }
  const [report, split] = loaded as [CountryReport, CustomerSplit]
  const all = meaningfulCountries(report.rows)
  const rows = foldCountryRows(all, ROWS, report.totals.revenue)
  const opt = ctx.storeOptions.find(o => o.id === store.id)
  const verdict = buildCountriesVerdict({
    subjectOf: `da ${store.name}`, subjectIn: `na ${store.name}`, rows, counts: countryCounts(all), totals: report.totals,
    configured: report.configured, customers: split, rangeLabel: ctx.rangeLabel, periodPhrase: ctx.periodPhrase,
    partialLabel: ctx.partialLabel, dayLabel: opt?.dayLabel ?? null, split: ctx.split,
  })
  const notes = report.notes.filter(n => n !== TERRITORIES_NOTE)
  const coverage = coverageText(report.meta)

  return (
    <AppShell ctx={ctx}>
      {header}
      <PeriodNote ctx={ctx} />
      <VerdictCard verdict={verdict} roas={false} aside={<CountryAside rows={rows} totals={report.totals} configured={report.configured} rangeLabel={ctx.rangeLabel} />} />
      <Block
        title={report.configured ? 'Contribuição por país' : 'Vendas por país'}
        howTo={`Pedidos reais da Shopify por país de entrega em ${ctx.rangeLabel}${report.configured ? ', cada um com o custo do próprio país' : ' — sem custos configurados, só vendas e pedidos'}.${rows.some(r => r.country === 'outros') ? ' A linha "outros" fecha a conta com a loja.' : ''}`}
        info="Os anúncios ficam numa linha só da loja, não divididos por país: a divisão por país do Meta não é confiável para isso."
        flush
        footer={<>
          <span>{TERRITORIES_NOTE}</span>
          {notes.map((n, i) => <span key={i}>{n}</span>)}
        </>}
      >
        <CountryTable rows={rows} totals={report.totals} configured={report.configured} rangeLabel={ctx.rangeLabel} />
      </Block>
      <Block
        title="O que o Meta atribui a cada país"
        eyebrow="Atribuído pelo Meta"
        howTo={CAVEAT_LINE}
        info={report.meta.caveat}
        flush
        footer={coverage ? <span>{coverage}</span> : undefined}
      >
        <MetaCountries rows={rows} purchasesKnown rangeLabel={ctx.rangeLabel} />
      </Block>
      <CustomersSplit split={split} today={ctx.today} rangeLabel={ctx.rangeLabel} />
      <div className={s.grid2}>
        <Suspense fallback={<SkeletonBlock lines={4} height={140} />}>
          <StoreLtv store={store} today={ctx.today} />
        </Suspense>
        <Suspense fallback={<SkeletonBlock lines={4} height={140} />}>
          <StoreFunnel store={store} ctx={ctx} />
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
            key: r.country, label: r.name, sub: `${r.orders} ${r.orders === 1 ? 'pedido' : 'pedidos'}${r.smallSample ? ' · amostra pequena' : ''}`,
            value: v, tone: v < 0 ? 'neg' : configured ? 'pos' : 'neu', note: formatPct(base > 0 ? (v / base) * 100 : null, { digits: 0 }),
          }
        })}
      />
      {Math.abs(rest) >= 0.5 && <p className={`${s.small} ${s.asideFoot}`}>Os demais países somam {formatMoney(rest)}.</p>}
    </div>
  )
}

async function StoreLtv({ store, today }: { store: StoreRef; today: string }) {
  const ltv = await getCustomerLtv(store).catch(err => { console.error('[countries] ltv', err); return null })
  if (!ltv) return <Block title="Valor do cliente (LTV)"><ErrorState compact /></Block>
  return <LtvBlock ltv={ltv} today={today} />
}

async function StoreFunnel({ store, ctx }: { store: StoreRef; ctx: PageContext }) {
  const funnel = await getFunnel(store, ctx.range).catch(err => { console.error('[countries] funnel', err); return null })
  if (!funnel) return <Block title="Funil"><ErrorState compact /></Block>
  return <FunnelBlock funnel={funnel} rangeLabel={ctx.rangeLabel} />
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

async function AllStores({ ctx }: { ctx: PageContext }) {
  const header = <PageHeader ctx={ctx} title="Países e clientes · todas as lojas" />
  const pnls = await computePnL(ctx.storeIds, ctx.range, { countries: true }, ctx.now)
    .catch(err => { console.error('[countries] all stores', err); return null })
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
  const full = meaningfulCountries(rollUpCountries(summed, totals.revenue, summed.length))
  const rows = foldCountryRows(full, ROWS, totals.revenue)
  const counts = countryCounts(full)
  // Named as "fora da soma" only when they sold something; a store without
  // costs that only spent on Meta changes no contribution, but its country
  // spend is missing from the Meta block, which says so.
  const excludedNames = configured ? excluded.filter(p => p.totals.revenue > 0).map(p => name.get(p.store.id) ?? p.store.name) : []
  const metaLeftOut = configured ? excluded.map(p => name.get(p.store.id) ?? p.store.name) : []
  const verdict = buildCountriesVerdict({
    subjectOf: 'das suas lojas', subjectIn: 'nas suas lojas', rows, counts, totals, configured, customers: null,
    excludedStores: excludedNames, rangeLabel: ctx.rangeLabel, periodPhrase: ctx.periodPhrase,
    partialLabel: ctx.partialLabel, dayLabel: null, split: ctx.split,
  })

  return (
    <AppShell ctx={ctx}>
      {header}
      <PeriodNote ctx={ctx} />
      <VerdictCard verdict={verdict} roas={false} aside={<CountryAside rows={rows} totals={totals} configured={configured} rangeLabel={ctx.rangeLabel} />} />
      {excludedNames.length > 0 && (
        <Callout tone="warn" title="Fora da soma por país:">
          {' '}{excluded.filter(p => p.totals.revenue > 0).map(p => `${name.get(p.store.id) ?? p.store.name} (${formatMoney(p.totals.revenue)} em vendas)`).join(', ')} — custos não configurados, então não há contribuição por país para somar.
        </Callout>
      )}
      <Block
        title="Contribuição por país"
        howTo={`Pedidos reais de ${configured && excludedNames.length ? 'todas as lojas com custos' : 'todas as lojas'} por país de entrega em ${ctx.rangeLabel}, cada pedido com o custo da própria loja.`}
        info="Os anúncios não são divididos por país: a divisão do Meta não é confiável para isso."
        flush
        footer={<span>{TERRITORIES_NOTE}</span>}
      >
        <CountryTable rows={rows} totals={totals} configured={configured} rangeLabel={ctx.rangeLabel} storesLabel={excludedNames.length ? 'das lojas com custos' : 'das lojas'} />
      </Block>
      <Block title="Gasto no Meta por país" eyebrow="Atribuído pelo Meta" howTo={`${CAVEAT_LINE}${metaLeftOut.length ? ` Sem ${metaLeftOut.join(', ')} (custos não configurados).` : ''}`} flush>
        <MetaCountries rows={rows} purchasesKnown={false} rangeLabel={ctx.rangeLabel} />
      </Block>
      <Suspense fallback={<SkeletonBlock lines={5} height={160} />}>
        <AllCustomers stores={ctx.selected} rangeLabel={ctx.rangeLabel} ctx={ctx} />
      </Suspense>
    </AppShell>
  )
}

async function AllCustomers({ stores, rangeLabel, ctx }: { stores: StoreRef[]; rangeLabel: string; ctx: PageContext }) {
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
      <CustomersByStore stores={customers} rangeLabel={rangeLabel} />
      {funnels.length > 0 && <FunnelBlock funnel={sumFunnels(funnels, ctx)} rangeLabel={rangeLabel} />}
    </>
  )
}

/** One funnel for several stores: Meta's step counts and Shopify's counts add
 *  up; the rates are recomputed by the same rule (lib/data/funnel). */
function sumFunnels(list: FunnelReport[], ctx: PageContext): FunnelReport {
  const values = Object.fromEntries(META_STEPS.map(s => [s.key, 0])) as Record<MetaStepKey, number>
  let spend = 0, orders = 0, abandoned = 0
  for (const f of list) {
    spend += f.spend
    orders += f.shopify.orders
    abandoned += f.shopify.abandonedCheckouts
    for (const st of f.meta.steps) values[st.key] += st.value
  }
  return {
    storeId: 'todas',
    range: ctx.range,
    spend,
    meta: buildMetaSteps(values, spend),
    shopify: {
      orders, abandonedCheckouts: abandoned,
      abandonmentPct: orders + abandoned > 0 ? (abandoned / (orders + abandoned)) * 100 : null,
      costPerOrder: orders > 0 && spend > 0 ? spend / orders : null,
    },
    metaCapturePct: orders > 0 && spend > 0 ? (values.purchases / orders) * 100 : null,
    notes: [...new Set(list.flatMap(f => f.notes))],
  }
}

