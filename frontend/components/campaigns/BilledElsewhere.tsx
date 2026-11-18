/**
 * Campaigns whose orders land in this store while their spend sits in another
 * store's books (CAMP HALLOW has no ad account: its ads ran in EPOCH's old
 * one). Information only — the spend is the other store's cost line, never
 * this one's. Server component.
 *
 * Props: { rows: BilledElsewhereRow[]; storeName: string; hrefFor: (storeId) => string }
 */

import Link from 'next/link'
import type { BilledElsewhereRow } from '@/lib/data/campaigns'
import { Block, DataTable, Money, type DataColumn, type DataRow } from '@/components/ui'
import { formatRoas } from '@/lib/format'
import s from './campaigns.module.css'

export function BilledElsewhere({ rows, storeName, hrefFor }: {
  rows: BilledElsewhereRow[]; storeName: string; hrefFor: (storeId: string) => string
}) {
  if (!rows.length) return null
  const columns: DataColumn[] = [
    { key: 'name', label: 'Campanha' },
    { key: 'billed', label: 'Gasto na conta de' },
    { key: 'spend', label: 'Gasto', numeric: true },
    { key: 'pv', label: 'Vendas atribuídas', numeric: true },
    { key: 'roas', label: 'ROAS atribuído', numeric: true },
    { key: 'orders', label: 'Pedidos rastreados aqui', numeric: true, info: 'Pedidos desta loja cuja jornada registrada pela Shopify passa pela campanha, sobre o total rastreado em todas as lojas.' },
  ]
  const data: DataRow[] = rows.map(r => ({
    key: r.campaignId,
    cells: {
      name: <span className={s.cName}>{r.name}</span>,
      billed: <Link className={s.adLink} href={hrefFor(r.billedStoreId)}>{r.billedStoreName}</Link>,
      spend: <Money value={r.spend} />,
      pv: <Money value={r.purchaseValue} />,
      roas: <span>{formatRoas(r.spend > 0 ? r.purchaseValue / r.spend : null)}</span>,
      orders: <span>{r.journeyOrdersHere} de {r.journeyOrdersTotal}</span>,
    },
  }))
  return (
    <Block
      title={`Campanhas pagas por outra loja que vendem na ${storeName}`}
      howTo="O gasto destas campanhas está na contabilidade da outra loja; as vendas caíram aqui. Some as duas lojas para julgar o resultado."
      flush
    >
      <DataTable caption="Campanhas pagas por outra loja" columns={columns} rows={data} dense />
    </Block>
  )
}
