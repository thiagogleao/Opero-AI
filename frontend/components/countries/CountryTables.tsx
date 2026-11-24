/**
 * The two country tables of "Países e clientes", kept apart on purpose:
 *  - CountryTable: the store's real orders per country, priced by the profit
 *    engine (contribution before ads), with an "outros" row so it adds up;
 *  - MetaCountries: what Meta's own country breakdown claims — spend,
 *    purchases, capture against the real orders — labelled as Meta's claim,
 *    with the CLAUDE.md caveat (17%–140% capture measured at EPOCH).
 * Server components.
 */

import type { ReactNode } from 'react'
import type { CountryRow } from '@/lib/data/countries'
import type { PnL } from '@/lib/engine/pnl'
import { Badge, Count, DataTable, EmptyState, Money, Pct, type DataColumn, type DataRow } from '@/components/ui'
import { formatMoney, formatPct, plural } from '@/lib/format'
import { metaCountriesEmpty } from './metaEmpty'
import { WhyEmpty, type EmptyWindowText } from '@/components/campaigns/emptyWhy'
import s from './countries.module.css'

function CountryCell({ row }: { row: CountryRow }) {
  const code = row.country === 'outros' ? '+' : /^[A-Z]{2}$/.test(row.country) ? row.country : '··'
  return (
    <span className={s.country}>
      <span className={s.cc} aria-hidden="true">{code}</span>
      <span>
        <span className={s.cName}>{row.name}</span>
        {row.country === 'US' && <span className={s.cSub}>inclui Porto Rico e territórios</span>}
      </span>
      {row.smallSample && row.country !== 'outros' && row.orders > 0 && (
        <Badge tone="mut" title="Menos de 30 pedidos: amostra pequena para decidir">n&lt;30</Badge>
      )}
    </span>
  )
}

export function CountryTable({ rows, totals, configured, rangeLabel, storesLabel, why = null }: {
  rows: CountryRow[]; totals: PnL; configured: boolean; rangeLabel: string
  /** "Todas": contribution counts only stores with costs. */
  storesLabel?: string
  /** The verdict's reason the window is empty (components/campaigns/emptyWhy):
   *  before the first sale or after the archive day, not "Nenhum pedido". */
  why?: EmptyWindowText | null
}) {
  const columns: DataColumn[] = [
    { key: 'country', label: 'País' },
    { key: 'orders', label: 'Pedidos', numeric: true, sortable: true },
    { key: 'revenue', label: 'Receita', numeric: true, sortable: true },
    // Folds under Receita below ~1000px of table box (countries.module.css):
    // at 1024 "Por pedido" started behind an unseen scrollbar.
    { key: 'share', label: <span className={s.colShare}>% das vendas</span>, numeric: true, sortable: true },
    ...(configured ? [
      { key: 'costs', label: 'Custos', numeric: true, sortable: true, info: 'Produto, frete, taxas e extras de cada pedido, com o preço do fornecedor para o país de entrega.' },
      { key: 'contribution', label: 'Contribuição', numeric: true, sortable: true, info: 'Receita − custos variáveis, antes dos anúncios. Os anúncios não são divididos por país: a divisão do Meta não é confiável para isso.' },
      { key: 'margin', label: 'Margem', numeric: true, sortable: true },
      { key: 'perOrder', label: 'Por pedido', numeric: true, sortable: true, info: 'Contribuição ÷ pedidos.' },
    ] as DataColumn[] : []),
  ]
  const data: DataRow[] = rows.map(r => ({
    key: r.country,
    tone: r.country === 'outros' ? 'mut' : undefined,
    cells: {
      country: <CountryCell row={r} />,
      orders: <Count value={r.orders} />,
      revenue: <><Money value={r.revenue} /><span className={s.inline}>{formatPct(r.revenueShare)} das vendas</span></>,
      share: <span className={s.colShare}><Pct value={r.revenueShare} /></span>,
      costs: <Money value={r.variableCosts} tone="none" />,
      contribution: <Money value={r.contribution} />,
      margin: <Pct value={r.contributionMargin} tone="auto" />,
      perOrder: <Money value={r.contributionPerOrder} />,
    },
    // "Outros" stays at the bottom whatever the sort: it is not a country.
    sort: r.country === 'outros'
      ? { orders: null, revenue: null, share: null, costs: null, contribution: null, margin: null, perOrder: null }
      : {
          orders: r.orders, revenue: r.revenue, share: r.revenueShare, costs: r.variableCosts,
          contribution: r.contribution, margin: r.contributionMargin, perOrder: r.contributionPerOrder,
        },
  }))
  const footer: Record<string, ReactNode> = {
    country: <span>Total{storesLabel ? ` ${storesLabel}` : ''}</span>,
    orders: <Count value={totals.orders} />,
    revenue: <Money value={totals.revenue} />,
    share: <span className={s.colShare}><Pct value={totals.revenue > 0 ? 100 : null} /></span>,
    costs: <Money value={totals.variableCosts} tone="none" />,
    contribution: <Money value={totals.contribution} />,
    margin: <Pct value={totals.contributionMargin} tone="auto" />,
    perOrder: <Money value={totals.orders > 0 ? totals.contribution / totals.orders : null} />,
  }
  return (
    <div className={s.tableBox}>
      <DataTable
        caption={`Contribuição por país em ${rangeLabel}`}
        columns={columns}
        rows={data}
        footer={footer}
        initialSort={{ key: 'revenue', dir: 'desc' }}
        dense
        empty={why ? <WhyEmpty why={why} /> : <EmptyState compact title="Nenhum pedido no período" />}
      />
    </div>
  )
}

export function MetaCountries({ rows, purchasesKnown, rangeLabel, metaSpend, sharedSpend = 0, elsewhere = null, many = false, why = null }: {
  rows: CountryRow[]; purchasesKnown: boolean; rangeLabel: string
  /** See ./metaEmpty metaCountriesEmpty. */
  metaSpend: number; sharedSpend?: number; elsewhere?: string | null; many?: boolean
  /** The verdict's reason the window is empty (components/campaigns/emptyWhy). */
  why?: EmptyWindowText | null
}) {
  const empty = metaCountriesEmpty({ metaSpend, sharedSpend, elsewhere, many })
  const withMeta = rows.filter(r => r.meta.spend > 0 || r.meta.purchases > 0)
  const columns: DataColumn[] = [
    { key: 'country', label: 'País' },
    { key: 'spend', label: 'Gasto (Meta)', numeric: true, sortable: true },
    ...(purchasesKnown ? [
      { key: 'purchases', label: 'Compras (Meta)', numeric: true, sortable: true },
      { key: 'orders', label: 'Pedidos reais', numeric: true, sortable: true, info: 'Pedidos da Shopify entregues no país, no mesmo período.' },
      { key: 'capture', label: 'Captura', numeric: true, sortable: true, info: CAPTURE_INFO },
    ] as DataColumn[] : [
      { key: 'orders', label: 'Pedidos reais', numeric: true, sortable: true },
    ]),
    { key: 'value', label: 'Valor atribuído', numeric: true, sortable: true },
  ]
  const data: DataRow[] = withMeta.map(r => ({
    key: r.country,
    tone: r.country === 'outros' ? 'mut' : undefined,
    cells: {
      country: <CountryCell row={r} />,
      spend: <Money value={r.meta.spend} />,
      purchases: <Count value={r.meta.purchases} />,
      orders: <Count value={r.orders} />,
      // When days are left out, the two figures the capture divides sit
      // under it: "179 · 373 · 87%" alone did not divide.
      capture: <span title={captureTitle(r) ?? undefined}><Pct value={r.meta.capturePct} digits={0} />{captureSub(r) && <span className={s.cSub}>{captureSub(r)}</span>}</span>,
      value: <Money value={r.meta.purchaseValue} />,
    },
    sort: r.country === 'outros'
      ? { spend: null, purchases: null, orders: null, capture: null, value: null }
      : { spend: r.meta.spend, purchases: r.meta.purchases, orders: r.orders, capture: r.meta.capturePct, value: r.meta.purchaseValue },
  }))
  return (
    <DataTable
      caption={`O que o Meta atribui a cada país em ${rangeLabel}`}
      columns={columns}
      rows={data}
      initialSort={{ key: 'spend', dir: 'desc' }}
      dense
      empty={why ? <WhyEmpty why={why} /> : <EmptyState compact title={empty.title}>{empty.body}</EmptyState>}
    />
  )
}

const CAPTURE_INFO =
  'Compras que o Meta diz ter visto ÷ pedidos reais do país, as duas contadas só nos dias em que a divisão por país cobre todo o gasto do dia. ' +
  'Acima de 100%, o Meta credita vendas que não existem nesse país; abaixo, deixa de ver vendas. Não é taxa de conversão.'

/** The capture's own figures, when they are not the row's columns (some days
 *  left out): "154 compras ÷ 177 pedidos nos dias com divisão inteira". */
export function captureTitle(r: Pick<CountryRow, 'orders' | 'meta'>): string | null {
  const orders = r.meta.captureOrders ?? r.orders
  const purchases = r.meta.capturePurchases ?? r.meta.purchases
  if (orders === r.orders && purchases === r.meta.purchases) return null
  return `${plural(Math.round(purchases), 'compra', 'compras')} ÷ ${plural(orders, 'pedido', 'pedidos')} nos dias com divisão inteira`
}

/** The capture's two figures in short ("154 ÷ 177"), under the percentage,
 *  when they are not the row's columns; null otherwise. */
export function captureSub(r: Pick<CountryRow, 'orders' | 'meta'>): string | null {
  if (!captureTitle(r)) return null
  return `${Math.round(r.meta.capturePurchases ?? r.meta.purchases)} ÷ ${r.meta.captureOrders ?? r.orders}`
}

/** "A divisão por país do Meta cobre 82% do gasto ($4.600 de $5.625)", then
 *  the days it misses and, when days are left out, what the capture counts. */
export function coverageText(meta: {
  coveredSpend: number; totalSpend: number; coveragePct: number | null; missingDays: string[]
  partialDays?: string[]; captureSpendDays?: number
}): string | null {
  if (!(meta.totalSpend > 0)) return null
  const pct = meta.coveragePct === null ? '—' : `${Math.round(meta.coveragePct)}%`
  const n = meta.missingDays.length
  const p = meta.partialDays?.length ?? 0
  // The verb agrees with the count: "Falta 1 dia", "Faltam 12 dias".
  const missing = n ? ` ${n === 1 ? 'Falta' : 'Faltam'} ${plural(n, 'dia', 'dias')} com gasto sem divisão por país.` : ''
  const partial = p ? ` Em ${plural(p, 'dia', 'dias')}, ela cobre só parte do gasto.` : ''
  // MOKOO's October divided the purchases of 52% of the spend by every
  // order and read "Captura 48%" beside a Funil at 86%.
  const k = meta.captureSpendDays
  const capture = n + p > 0 && k !== undefined
    ? k > 0
      ? ` Por isso a captura compara compras e pedidos só nos dias em que a divisão cobre todo o gasto (${plural(k, 'dia', 'dias')} com gasto).`
      : ' Nenhum dia com gasto tem a divisão inteira, então a captura por país não tem como ser medida.'
    : ''
  return `A divisão por país do Meta cobre ${pct} do gasto (${formatMoney(meta.coveredSpend)} de ${formatMoney(meta.totalSpend)}).${missing}${partial}${capture}`
}

const CENT = 0.005
/** Below this share of a store's spend (or with a day missing), the store is
 *  named as only partly covered (lib/data/countries FULL_DAY_SHARE). */
const FULL_SHARE = 0.95

const joinAnd = (xs: string[]) => (xs.length <= 1 ? xs.join('') : `${xs.slice(0, -1).join(', ')} e ${xs[xs.length - 1]}`)

/**
 * The coverage line of "Todas": the sum of every store's country rows against
 * their Meta spend, naming the stores whose split is missing or partial.
 * Summed silently, MOKOO's week without a split dropped $6.618 of $20.737 and
 * US read as getting $2.139 of Meta spend. Stores without Meta spend are left
 * out; null when no store spent.
 * "A divisão por país do Meta cobre 66% do gasto ($13.735 de $20.738); a MOKOO
 * não tem divisão por país neste período; na Dumpling Squishy · 8jcp3a ela
 * cobre só 20%, com 5 dias sem divisão."
 */
export function allStoresCoverageText(stores: readonly {
  name: string; coveredSpend: number; totalSpend: number; missingDays: readonly string[]; partialDays?: readonly string[]
}[]): string | null {
  const spenders = stores.filter(s => s.totalSpend > 0)
  if (!spenders.length) return null
  const total = spenders.reduce((t, s) => t + s.totalSpend, 0)
  const covered = spenders.reduce((t, s) => t + s.coveredSpend, 0)
  const head = `A divisão por país do Meta cobre ${Math.round((covered / total) * 100)}% do gasto (${formatMoney(covered)} de ${formatMoney(total)})`
  const none = spenders.filter(s => s.coveredSpend < CENT)
  const part = spenders.filter(s => s.coveredSpend >= CENT && (s.coveredSpend < s.totalSpend * FULL_SHARE || s.missingDays.length > 0))
  const parts: string[] = []
  if (none.length) {
    parts.push(`${joinAnd(none.map(s => `a ${s.name}`))} ${none.length === 1 ? 'não tem' : 'não têm'} divisão por país neste período`)
  }
  for (const s of part) {
    const n = s.missingDays.length
    const days = plural(n, 'dia', 'dias')
    // A share that rounds to 95%+ says nothing; the missing days do.
    parts.push(s.coveredSpend < s.totalSpend * FULL_SHARE
      ? `na ${s.name} ela cobre só ${Math.round((s.coveredSpend / s.totalSpend) * 100)}%${n ? `, com ${days} sem divisão` : ''}`
      : `na ${s.name} ${n === 1 ? 'falta' : 'faltam'} ${days} com gasto sem divisão`)
  }
  return parts.length ? `${head}; ${parts.join('; ')}.` : `${head}.`
}
