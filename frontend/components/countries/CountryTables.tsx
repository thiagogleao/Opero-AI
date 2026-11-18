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
import { formatMoney } from '@/lib/format'
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

export function CountryTable({ rows, totals, configured, rangeLabel, storesLabel }: {
  rows: CountryRow[]; totals: PnL; configured: boolean; rangeLabel: string
  /** "Todas": contribution counts only stores with costs. */
  storesLabel?: string
}) {
  const columns: DataColumn[] = [
    { key: 'country', label: 'País' },
    { key: 'orders', label: 'Pedidos', numeric: true, sortable: true },
    { key: 'revenue', label: 'Receita', numeric: true, sortable: true },
    { key: 'share', label: '% das vendas', numeric: true, sortable: true },
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
      revenue: <Money value={r.revenue} />,
      share: <Pct value={r.revenueShare} />,
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
    share: <Pct value={totals.revenue > 0 ? 100 : null} />,
    costs: <Money value={totals.variableCosts} tone="none" />,
    contribution: <Money value={totals.contribution} />,
    margin: <Pct value={totals.contributionMargin} tone="auto" />,
    perOrder: <Money value={totals.orders > 0 ? totals.contribution / totals.orders : null} />,
  }
  return (
    <DataTable
      caption={`Contribuição por país em ${rangeLabel}`}
      columns={columns}
      rows={data}
      footer={footer}
      initialSort={{ key: 'revenue', dir: 'desc' }}
      dense
      empty={<EmptyState compact title="Nenhum pedido no período" />}
    />
  )
}

export function MetaCountries({ rows, purchasesKnown, rangeLabel }: {
  rows: CountryRow[]; purchasesKnown: boolean; rangeLabel: string
}) {
  const withMeta = rows.filter(r => r.meta.spend > 0 || r.meta.purchases > 0)
  const columns: DataColumn[] = [
    { key: 'country', label: 'País' },
    { key: 'spend', label: 'Gasto (Meta)', numeric: true, sortable: true },
    ...(purchasesKnown ? [
      { key: 'purchases', label: 'Compras (Meta)', numeric: true, sortable: true },
      { key: 'orders', label: 'Pedidos reais', numeric: true, sortable: true, info: 'Pedidos da Shopify entregues no país, no mesmo período.' },
      { key: 'capture', label: 'Captura', numeric: true, sortable: true, info: 'Compras que o Meta diz ter visto ÷ pedidos reais. Acima de 100%, o Meta credita vendas que não existem nesse país; abaixo, deixa de ver vendas. Não é taxa de conversão.' },
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
      capture: <Pct value={r.meta.capturePct} digits={0} />,
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
      empty={<EmptyState compact title="Sem divisão por país do Meta neste período">O Meta não entregou o detalhamento por país para estas datas.</EmptyState>}
    />
  )
}

/** "O detalhamento por país do Meta cobre 82% do gasto ($4.600 de $5.625)". */
export function coverageText(meta: { coveredSpend: number; totalSpend: number; coveragePct: number | null; missingDays: string[] }): string | null {
  if (!(meta.totalSpend > 0)) return null
  const pct = meta.coveragePct === null ? '—' : `${Math.round(meta.coveragePct)}%`
  const missing = meta.missingDays.length ? ` Faltam ${meta.missingDays.length} ${meta.missingDays.length === 1 ? 'dia' : 'dias'} com gasto sem divisão por país.` : ''
  return `A divisão por país do Meta cobre ${pct} do gasto (${formatMoney(meta.coveredSpend)} de ${formatMoney(meta.totalSpend)}).${missing}`
}
