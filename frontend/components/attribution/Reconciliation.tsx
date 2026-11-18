/**
 * "O que cada lado conta" — the right column of the attribution verdict:
 * what the store sold, what Meta claims, what Shopify's journeys link to
 * Meta's ads, and what came with no ad at all, on one scale so a Meta claim
 * larger than the whole store is visible at a glance. Server-safe.
 */

import type { AttributionTotals, SharedAdAccount } from '@/lib/attributionModels'
import { formatPct, plural } from '@/lib/format'
import { EmptyState } from '@/components/ui'
import { HorizontalBars, type HorizontalBarItem } from '@/components/charts'
import { AsideNote, AsideTitle } from './AttributionHeader'
import { formatOrders, ordersLabel } from './model'
import type { AttributionVerdict } from './verdict'

export function Reconciliation({ verdict, totals: t, sales, shared, storeId, rangeLabel }: {
  verdict: AttributionVerdict
  totals: AttributionTotals
  sales: { revenue: number; orders: number }
  shared: SharedAdAccount[]
  storeId: string
  rangeLabel: string
}) {
  const title = <AsideTitle title="O que cada lado conta" sub={`Vendas de ${rangeLabel}, na mesma escala`} />
  if (verdict.state === 'no_sales') {
    return <>{title}<EmptyState compact icon="ring" title="Nada para comparar">Sem pedidos e sem gasto no Meta neste período.</EmptyState></>
  }

  const share = (v: number) => (sales.revenue > 0 ? formatPct((v / sales.revenue) * 100, { digits: 0 }) : undefined)
  const storeBar: HorizontalBarItem = {
    key: 'store', label: 'Vendas da loja', sub: `${plural(sales.orders, 'pedido', 'pedidos')} · tudo o que a Shopify registrou`,
    value: sales.revenue, tone: 'neu',
  }
  const noAdBar: HorizontalBarItem = {
    key: 'noad', label: 'Sem anúncio na jornada', sub: 'orgânico, e-mail, direto, pago sem identificação',
    value: verdict.withoutAd, note: share(verdict.withoutAd), tone: 'mut',
  }

  const ownAds = !['shared_account', 'no_spend'].includes(verdict.state)
  if (ownAds) {
    const siblings = [...new Set(shared.filter(p => p.adStoreId === storeId).map(p => p.salesStoreName))]
    const sib = t.siblingOrders > 0.05
      ? ` · ${formatOrders(t.siblingOrders)} na ${siblings.length === 1 ? siblings[0] : 'outra loja'}`
      : ''
    const items: HorizontalBarItem[] = [
      storeBar,
      {
        key: 'meta', label: 'O Meta declara', sub: `${plural(t.metaPurchases, 'compra', 'compras')} · relato do próprio Meta`,
        value: t.metaRevenue, tone: 'meta',
      },
      {
        key: 'journey', label: 'A Shopify liga aos anúncios do Meta', sub: `${ordersLabel(t.journeyOrdersOwnAds)} pela jornada${sib}`,
        value: t.journeyRevenueOwnAds, tone: 'neu',
      },
      noAdBar,
    ]
    return (
      <>
        {title}
        <HorizontalBars items={items} ariaLabel="Vendas da loja, o que o Meta declara e o que a Shopify liga aos anúncios" />
        <AsideNote>
          Compare o Meta só com <b>a terceira linha</b>: as duas falam dos mesmos anúncios da conta desta loja.
          A primeira é tudo o que a loja vendeu, com ou sem anúncio.
        </AsideNote>
      </>
    )
  }

  // No spend in this store's own account: show where the ad-linked sales came from.
  const onShared = Math.max(0, t.revenue - t.unknownAdRevenue)
  const adStore = shared.find(p => p.salesStoreId === storeId)?.adStoreName
  const items: HorizontalBarItem[] = [storeBar]
  if (onShared > 0.005) {
    items.push({
      key: 'shared', label: adStore ? `Anúncios da conta da ${adStore}` : 'Anúncios sem gasto no período',
      sub: adStore ? 'o gasto fica nos livros da outra loja' : 'cliques antigos em anúncios que já não gastam',
      value: onShared, note: share(onShared), tone: 'meta',
    })
  }
  if (t.unknownAdRevenue > 0.005) {
    items.push({
      key: 'unknown', label: 'Anúncios de conta não conectada', sub: 'nenhuma loja conectada lê essa conta',
      value: t.unknownAdRevenue, note: share(t.unknownAdRevenue), tone: 'mut',
    })
  }
  items.push(noAdBar)
  return (
    <>
      {title}
      <HorizontalBars items={items} ariaLabel="De onde vieram as vendas da loja" />
      <AsideNote>
        Sem gasto na conta desta loja, não há relato do Meta para comparar aqui.
        {adStore ? <> O que o Meta declara para esses anúncios aparece na página da <b>{adStore}</b>.</> : null}
      </AsideNote>
    </>
  )
}
