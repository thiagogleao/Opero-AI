import type { ReactNode } from 'react'
import { getPageContext, pageMetadata, type PageContext, type SearchParams } from '@/lib/views/page'
import { computePnL, type PnL } from '@/lib/engine/pnl'
import { getProductReport, type ProductReport } from '@/lib/data/products'
import { sumTotals } from '@/lib/views/verdict'
import { formatMoney, formatPct, plural } from '@/lib/format'
import { AppShell, PageHeader, PeriodNote } from '@/components/shell'
import { Block, Callout, Count, EmptyState, ErrorState, Icon, Money, Pct, VerdictCard, type DataColumn } from '@/components/ui'
import { HorizontalBars } from '@/components/charts'
import { ProductTable, type SearchableRow } from '@/components/products/ProductTable'
import { buildProductsVerdict, type ProductLike } from '@/components/products/productsVerdict'
import { metaSpendSplitText } from '@/components/products/metaSpendSplit'
import { restLine, topBars, unpricedLine } from '@/components/products/topBars'
import { loadFirstSale } from '@/components/campaigns/firstSale'
import s from '@/components/products/products.module.css'

/**
 * Produtos — what each product sold and what it left after its own costs,
 * from the profit engine (lib/data/products for one store; computePnL with
 * products for "Todas"). Revenue is each order's total spread over its lines
 * by line value, so the products add up to the store to the cent; contribution
 * is revenue − the engine's variable costs. Ads are not charged to products:
 * the optional "Meta ligado" column is journey attribution, labelled as such.
 */

export const generateMetadata = pageMetadata('Produtos')

const COLUMNS_NOTE =
  'Pedidos = pedidos que tinham o produto (um pedido com dois produtos conta nos dois). Custos = produto, embalagem e taxa do fornecedor, frete, taxas da Shopify e do pagamento e extras por pedido, na parte do produto. Contribuição = receita − custos: o que o produto deixa para pagar anúncios e custos fixos. Margem = contribuição ÷ receita.'

const REVENUE_NOTE =
  'Receita do produto = o total pago no pedido, dividido entre os itens pelo valor de cada um. Frete cobrado, imposto e desconto entram na proporção, por isso os produtos somam exatamente as vendas da loja.'

interface Row extends ProductLike {
  productId: string | null
  imageUrl: string | null
  revenueShare: number | null
  /** Null for a store without cost settings ("Todas"). */
  variableCosts: number | null
  contributionMargin: number | null
  attributedSpend: number | null
}

const pct = (a: number, b: number) => (b > 0 ? (a / b) * 100 : null)

export default async function ProductsPage({ searchParams }: { searchParams: Promise<SearchParams> }) {
  const ctx = await getPageContext(searchParams)
  const title = ctx.scope === 'all' ? 'Produtos · todas as lojas' : `Produtos · ${ctx.store?.name ?? ''}`
  const header = <PageHeader ctx={ctx} title={title} halved={false} />
  if (ctx.scope === 'store' && !ctx.store) {
    return <AppShell ctx={ctx}>{header}<EmptyState icon="store" title="Nenhuma loja para mostrar" /></AppShell>
  }

  const [loaded, firstSale] = await Promise.all([
    load(ctx).catch(err => { console.error('[products]', err); return null }),
    loadFirstSale(ctx),
  ])
  if (!loaded) {
    return (
      <AppShell ctx={ctx}>
        {header}
        <ErrorState title="Não foi possível carregar os produtos">A leitura dos pedidos falhou. Nada foi alterado; recarregue a página em instantes.</ErrorState>
      </AppShell>
    )
  }
  const { rows, totals, configured, attribution, contributionTotal, costsTotal, excludedStores, pricedTotals } = loaded
  const all = ctx.scope === 'all'
  const opt = ctx.storeOption
  const verdict = buildProductsVerdict({
    subject: all ? 'suas lojas' : `a ${ctx.store?.name}`,
    subjectOf: all ? 'das suas lojas' : `da ${ctx.store?.name}`,
    subjectIn: all ? 'nas suas lojas' : `na ${ctx.store?.name}`,
    products: rows, totals, configured, contributionTotal, excludedStores, rangeLabel: ctx.rangeLabel, periodPhrase: ctx.periodPhrase,
    partialLabel: ctx.partialLabel, dayLabel: opt?.dayLabel ?? null, split: ctx.split, firstSale,
  })

  const money = (p: Row) => (configured ? p.contribution ?? 0 : p.revenue)
  // The bars, the rest line's count and its amount all come from one list:
  // the products with a contribution (a store without costs has none). The
  // count used every row, so "Os outros 184 produtos somam $19.948" counted
  // Glooty's 5 unpriced products whose money is not in the $19.948.
  const ranked = rows.filter(p => !configured || p.contribution !== null).sort((a, b) => money(b) - money(a))
  const byMoney = topBars(ranked)
  const base = configured ? contributionTotal : totals.revenue
  const aside = rows.length ? (
    <div>
      <div className={s.asideHead}>
        <div className={s.asideTitle}>{configured ? 'Quem mais contribuiu' : 'Quem mais vendeu'}</div>
        <div className={s.asideSub}>{configured ? `Contribuição de cada produto, antes dos anúncios, em ${ctx.rangeLabel}` : `Vendas de cada produto em ${ctx.rangeLabel}`}</div>
      </div>
      <HorizontalBars
        ariaLabel={configured ? 'Contribuição por produto' : 'Vendas por produto'}
        items={byMoney.map(p => {
          const v = money(p)
          return {
            key: `${p.store ?? ''}:${p.key}`,
            label: p.title,
            sub: p.store ?? `${plural(p.units, 'unidade', 'unidades')} · ${plural(p.orders, 'pedido', 'pedidos')}`,
            value: v,
            tone: v < 0 ? 'neg' : configured ? 'pos' : 'neu',
            note: formatPct(pct(v, base), { digits: 0 }),
          }
        })}
      />
      <p className={`${s.small} ${s.asideFoot}`}>
        {restLine(ranked.length - byMoney.length, base - byMoney.reduce((t, p) => t + money(p), 0))}
        {ranked.length < rows.length ? ` ${unpricedLine(rows.length - ranked.length, excludedStores)}` : null}
      </p>
    </div>
  ) : undefined

  const columns: DataColumn[] = [
    { key: 'product', label: 'Produto' },
    // Units, share and costs fold into the orders, revenue and contribution
    // cells below ~1140px of table box (products.module.css, container
    // query): at 1024 the margin and "Meta ligado" columns started behind a
    // scrollbar nobody saw.
    { key: 'units', label: <span className={s.colUnits}>Unid.</span>, numeric: true, sortable: true },
    { key: 'orders', label: 'Pedidos', numeric: true, sortable: true },
    { key: 'revenue', label: 'Receita', numeric: true, sortable: true, info: REVENUE_NOTE },
    { key: 'share', label: <span className={s.colShare}>% vendas</span>, numeric: true, sortable: true },
    ...(configured ? [
      { key: 'costs', label: <span className={s.colCosts}>Custos</span>, numeric: true, sortable: true },
      { key: 'contribution', label: 'Contribuição', numeric: true, sortable: true },
      { key: 'margin', label: 'Margem', numeric: true, sortable: true },
    ] as DataColumn[] : []),
    ...(attribution ? [{ key: 'meta', label: 'Meta ligado', numeric: true, sortable: true, info: attribution.note } as DataColumn] : []),
  ]
  const tableRows: SearchableRow[] = rows.map(p => ({
    key: `${p.store ?? ''}:${p.key}`,
    search: `${p.title} ${p.store ?? ''}`,
    cells: {
      product: (
        <span className={s.prod}>
          <span className={s.thumb}>
            {p.imageUrl
              // Shopify CDN thumbnails; next/image would only re-proxy them.
              // eslint-disable-next-line @next/next/no-img-element
              ? <img src={p.imageUrl} alt="" loading="lazy" />
              : <Icon name="box" size={15} />}
          </span>
          <span className={s.prodText}>
            <span className={s.prodName} title={p.title}>{p.title}</span>
            <span className={s.prodSub}>{p.store ? `${p.store} · ` : ''}{p.orders > 0 ? `${(p.units / p.orders).toLocaleString('pt-BR', { maximumFractionDigits: 1 })} un./pedido` : ''}</span>
          </span>
        </span>
      ),
      units: <span className={s.colUnits}><Count value={p.units} /></span>,
      orders: <><Count value={p.orders} /><span className={s.inline}>{plural(p.units, 'unidade', 'unidades')}</span></>,
      revenue: <><Money value={p.revenue} /><span className={s.inline}>{formatPct(p.revenueShare)} das vendas</span></>,
      share: <span className={s.colShare}><Pct value={p.revenueShare} /></span>,
      costs: <span className={s.colCosts}>{p.variableCosts === null ? <span className="mut">sem custos</span> : <Money value={p.variableCosts} tone="none" />}</span>,
      contribution: p.contribution === null ? <span className="mut">—</span> : (
        <><Money value={p.contribution} />{p.variableCosts !== null && <span className={s.inline}>custos {formatMoney(p.variableCosts)}</span>}</>
      ),
      margin: <Pct value={p.contributionMargin} tone="auto" />,
      meta: p.attributedSpend !== null && p.attributedSpend > 0 ? <Money value={p.attributedSpend} /> : <span className="mut">—</span>,
    },
    sort: {
      product: p.title, units: p.units, orders: p.orders, revenue: p.revenue, share: p.revenueShare,
      costs: p.variableCosts, contribution: p.contribution, margin: p.contributionMargin, meta: p.attributedSpend,
    },
  }))
  // The totals row adds up across its own columns (receita − custos =
  // contribuição): with a store without costs in "Todas" it is the stores
  // with costs, as on Países, and the store left out is named under the
  // table. Mixing Glooty's $1.118 into the revenue next to costs and a
  // contribution without it read $135.519 − $40.211 ≠ $94.191.
  const foot = pricedTotals ?? totals
  const footer: Record<string, ReactNode> = {
    product: <span>Total {all ? (pricedTotals ? 'das lojas com custos' : 'das lojas') : 'da loja'}</span>,
    units: <span className={s.colUnits}><Count value={foot.units} /></span>,
    orders: <><Count value={foot.orders} /><span className={s.inline}>{plural(foot.units, 'unidade', 'unidades')}</span></>,
    revenue: <Money value={foot.revenue} />,
    share: <span className={s.colShare}><Pct value={pct(foot.revenue, totals.revenue)} /></span>,
    costs: <span className={s.colCosts}><Money value={costsTotal} tone="none" /></span>,
    contribution: <><Money value={contributionTotal} /><span className={s.inline}>custos {formatMoney(costsTotal)}</span></>,
    margin: <Pct value={pricedTotals ? pricedTotals.contributionMargin : excludedStores.length ? null : totals.contributionMargin} tone="auto" />,
    meta: attribution ? <Money value={attribution.attributedSpend} /> : null,
  }
  const leftOut = pricedTotals
    ? ` A linha de total fica com as lojas com custos: ${excludedStores.join(', ')} (${formatMoney(totals.revenue - pricedTotals.revenue)} em ${plural(totals.orders - pricedTotals.orders, 'pedido', 'pedidos')}) não ${excludedStores.length === 1 ? 'tem' : 'têm'} custos configurados.`
    : ''

  return (
    <AppShell ctx={ctx}>
      {header}
      <PeriodNote ctx={ctx} />
      <VerdictCard verdict={verdict} aside={aside} roas={false} />
      {!configured && (
        <Callout tone="warn" title="Custos não configurados.">
          {' '}Sem o custo dos produtos não há contribuição nem margem por produto: a tabela mostra só vendas, unidades e pedidos.
        </Callout>
      )}
      <Block
        title="Produtos vendidos"
        howTo={`Ordene por qualquer coluna e busque pelo nome. Receita = total do pedido dividido entre os itens pelo valor de cada um, em ${ctx.rangeLabel}.`}
        info={<>{REVENUE_NOTE} {COLUMNS_NOTE}</>}
        flush
        footer={<>
          <span>Os produtos somam as vendas {all ? 'das lojas' : 'da loja'}: <b className="num">{formatMoney(totals.revenue)}</b> em <b className="num">{plural(totals.orders, 'pedido', 'pedidos')}</b>.{leftOut}</span>
          {attribution && (
            // Linked here + credited in another store + linked to nothing = the
            // store's Meta spend in the books (EPOCH's October left $15.203 out).
            <span>{metaSpendSplitText(attribution, totals.metaSpend, id => ctx.stores.find(x => x.id === id)?.name ?? null)}</span>
          )}
        </>}
      >
        <div className={s.tableBox}>
          <ProductTable
            // A new store or window starts with an empty search box.
            key={`${ctx.params.loja ?? ''}:${ctx.range.from}:${ctx.range.to}`}
            caption={`Produtos em ${ctx.rangeLabel}`}
            noun={['produto', 'produtos']}
            columns={columns}
            rows={tableRows}
            footer={footer}
            initialSort={{ key: configured ? 'contribution' : 'revenue', dir: 'desc' }}
            maxHeight={760}
            dense
            empty={<EmptyState compact title="Nenhum produto vendido no período" />}
          />
        </div>
      </Block>
    </AppShell>
  )
}

interface Loaded {
  rows: Row[]
  totals: PnL
  /** At least one store in scope has cost settings. */
  configured: boolean
  /** Contribution and variable costs of the stores with costs. */
  contributionTotal: number
  costsTotal: number
  excludedStores: string[]
  /** "Todas" with a store left out of the costs: the stores with costs
   *  summed, for the totals row. Null otherwise (the row is `totals`). */
  pricedTotals: PnL | null
  attribution: ProductReport['attribution'] | null
}

async function load(ctx: PageContext): Promise<Loaded> {
  if (ctx.scope === 'store' && ctx.store) {
    const r = await getProductReport(ctx.store, ctx.range)
    if (!r) throw new Error(`no P&L for store ${ctx.store.id}`)
    return {
      rows: r.products.map(p => ({
        key: p.key, productId: p.productId, title: p.title, imageUrl: p.imageUrl, units: p.units, orders: p.orders,
        revenue: p.revenue, revenueShare: p.revenueShare, variableCosts: p.variableCosts, contribution: p.contribution,
        contributionMargin: p.contributionMargin, attributedSpend: p.attributedSpend,
      })),
      totals: r.totals,
      configured: r.configured,
      contributionTotal: r.totals.contribution,
      costsTotal: r.totals.variableCosts,
      excludedStores: [],
      pricedTotals: null,
      attribution: r.attribution,
    }
  }
  // Todas: one engine pass for every store, each priced with its own costs.
  // A store without costs shows sales only: the engine gives it zero costs, so
  // its "contribution" would be its revenue — kept out of every contribution.
  const pnls = await computePnL(ctx.storeIds, ctx.range, { products: true }, ctx.now)
  const name = new Map(ctx.selected.map(x => [x.id, x.name]))
  const list = [...pnls.values()]
  const totals = sumTotals(list.map(p => p.totals))
  const withCosts = list.filter(p => p.configured)
  const configured = withCosts.length > 0
  const rows: Row[] = list.flatMap(p => (p.products ?? []).map(x => ({
    key: x.key, productId: x.productId, title: x.title, imageUrl: null, store: name.get(p.store.id) ?? p.store.name,
    units: x.units, orders: x.orders, revenue: x.revenue, revenueShare: pct(x.revenue, totals.revenue),
    variableCosts: p.configured ? x.variableCosts : null,
    contribution: p.configured ? x.contribution : null,
    contributionMargin: p.configured ? pct(x.contribution, x.revenue) : null,
    attributedSpend: null,
  })))
  const excludedStores = list.filter(p => !p.configured && p.totals.revenue > 0).map(p => name.get(p.store.id) ?? p.store.name)
  return {
    rows, totals, configured, attribution: null,
    contributionTotal: withCosts.reduce((s, p) => s + p.totals.contribution, 0),
    costsTotal: withCosts.reduce((s, p) => s + p.totals.variableCosts, 0),
    excludedStores,
    pricedTotals: configured && excludedStores.length ? sumTotals(withCosts.map(p => p.totals)) : null,
  }
}
