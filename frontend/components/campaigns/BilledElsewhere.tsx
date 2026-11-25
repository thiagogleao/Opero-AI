/**
 * Campaigns whose orders land in this store while their spend sits in another
 * store's books (CAMP HALLOW has no ad account: its ads ran in EPOCH's old
 * one). Information only — the spend is the other store's cost line, never
 * this one's. Server component.
 *
 * Props: { rows: BilledElsewhereRow[]; storeName: string; rangeLabel: string;
 *          hrefFor: (storeId) => string | null — null when the viewer cannot
 *          see that store (lib/period carry): the name renders without a link }
 */

import Link from 'next/link'
import type { BilledElsewhereRow } from '@/lib/data/campaigns'
import { Block, DataTable, Money, type DataColumn, type DataRow } from '@/components/ui'
import { formatRoas } from '@/lib/format'
import s from './campaigns.module.css'

/** Everything on a row is the page's window: spend, Meta's credit and the
 *  orders. Only the reason a campaign is listed (most of its tracked orders,
 *  ever, landed here) looks further back, and the header says so. */
export const ORDERS_HERE_INFO =
  'Pedidos desta loja feitos no período cuja jornada registrada pela Shopify passa pela campanha, '
  + 'sobre os pedidos do período de todas as lojas com ela no caminho (reembolsados fora). '
  + 'Qualquer visita da campanha no caminho conta. Outras telas contam de outro jeito e mostram menos: a Atribuição dá cada pedido a um anúncio só, '
  + 'pelo modelo escolhido, e o aviso de conta compartilhada conta só visitas de anúncios com gasto registrado na outra loja. '
  + 'A campanha entra nesta lista porque a maior parte dos pedidos rastreados dela, desde sempre, caiu nesta loja.'

export function BilledElsewhere({ rows, storeName, rangeLabel, hrefFor }: {
  rows: BilledElsewhereRow[]; storeName: string; rangeLabel: string; hrefFor: (storeId: string) => string | null
}) {
  if (!rows.length) return null
  const columns: DataColumn[] = [
    { key: 'name', label: 'Campanha' },
    { key: 'billed', label: 'Gasto na conta de' },
    { key: 'spend', label: 'Gasto da campanha', numeric: true, info: 'O gasto da campanha inteira no período, todos os anúncios dela. A Atribuição soma só os anúncios que tiveram pedido creditado nesta loja, por isso mostra menos.' },
    { key: 'pv', label: 'Vendas atribuídas', numeric: true },
    { key: 'roas', label: 'ROAS atribuído', numeric: true },
    { key: 'orders', label: 'Pedidos rastreados aqui', numeric: true, info: ORDERS_HERE_INFO },
  ]
  const data: DataRow[] = rows.map(r => ({
    key: r.campaignId,
    cells: {
      name: <span className={s.cName}>{r.name}</span>,
      billed: (() => {
        const href = hrefFor(r.billedStoreId)
        return href ? <Link className={s.adLink} href={href}>{r.billedStoreName}</Link> : <span>{r.billedStoreName}</span>
      })(),
      spend: <Money value={r.spend} />,
      pv: <Money value={r.purchaseValue} />,
      roas: <span>{formatRoas(r.spend > 0 ? r.purchaseValue / r.spend : null)}</span>,
      orders: r.windowOrdersTotal > 0
        ? <span>{r.windowOrdersHere} de {r.windowOrdersTotal}</span>
        : <span className="mut">nenhum no período</span>,
    },
  }))
  return (
    <Block
      title={`Campanhas pagas por outra loja que vendem na ${storeName}`}
      eyebrow={rangeLabel}
      howTo="O gasto destas campanhas está na contabilidade da outra loja; as vendas caíram aqui. Some as duas lojas para julgar o resultado. Os números são do período; a campanha está aqui porque a maior parte das vendas rastreadas dela, desde sempre, caiu nesta loja."
      flush
    >
      <DataTable caption="Campanhas pagas por outra loja" columns={columns} rows={data} dense />
    </Block>
  )
}
