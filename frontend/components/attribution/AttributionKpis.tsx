/**
 * The spend and the three ROAS that must never be confused: by the journey
 * (sales Shopify links to the ads), as Meta declares it, and of the whole
 * store (every sale ÷ the ad spend, organic included). The last one rises by
 * itself when spend falls, so it is the only one judged against the store's
 * break-even. Server-safe.
 *
 * The store ROAS is the Resumo's, measured on the same ad channel
 * (lib/views/adChannel): Meta alone, Anúncios Shopify alone, or both together
 * when each carries 10% or more of the spend. It used to be revenue ÷ Meta
 * spend whatever the channel: Dumpling 8jcp3a read "319,43× → no lucro" here
 * while the Resumo said 2,97× on its Shopify ads.
 */

import type { AttributionTotals } from '@/lib/attributionModels'
import { adChannelOf, channelRoas } from '@/lib/views/adChannel'
import { formatCount, formatMoney, plural } from '@/lib/format'
import { KpiCard, Money, Roas, RoasGauge } from '@/components/ui'
import { leftOutSpend, storeRoasLabel, type StoreRoasTotals } from './model'
import s from './AttributionKpis.module.css'

export function AttributionKpis({ totals: t, store, configured, sharedAdStore }: {
  totals: AttributionTotals
  /** The engine's totals for the store and window; null when there is no P&L. */
  store: StoreRoasTotals | null
  /** The store has cost settings (without them the break-even is unknown). */
  configured: boolean
  /** Name of the store whose account runs ads this store also sells on. */
  sharedAdStore?: string | null
}) {
  const channel = store ? adChannelOf(store) : null
  const storeRoas = store ? channelRoas(store) : null
  const leftOut = store ? leftOutSpend(store, channel) : null
  return (
    // Own grid instead of <KpiGrid columns={4}>: a fixed count stays 4-wide on a
    // phone, and auto-fill leaves an empty fifth slot at 1440px.
    <div className={s.grid}>
      <KpiCard
        label="Gasto no Meta" swatch="meta"
        value={<Money value={t.spend} />}
        note={t.sharedSpend > 0.005
          ? <>na conta desta loja · mais <b>{formatMoney(t.sharedSpend)}</b> da conta da {sharedAdStore ?? 'outra loja'}</>
          : <>na conta desta loja · <b>{formatCount(t.adsWithActivity)}</b> {t.adsWithActivity === 1 ? 'anúncio' : 'anúncios'} com gasto ou venda</>}
        info="Gasto dos anúncios da conta de anúncios desta loja no período. É o mesmo gasto que o cálculo de lucro desconta."
      />
      <KpiCard
        label="ROAS pela jornada"
        value={<Roas value={t.roasJourney} />}
        note={<><b>{formatMoney(t.journeyRevenueOwnAds)}</b> que a Shopify liga aos anúncios ÷ gasto</>}
        info="Vendas que as jornadas da Shopify ligam aos anúncios desta conta (inclusive as que caíram em outra loja da mesma conta), divididas pelo gasto. Não conta quem comprou sem passar por um link de anúncio, por isso tende a ficar abaixo do ROAS da loja."
      />
      <KpiCard
        label="ROAS que o Meta declara" swatch="meta"
        value={<Roas value={t.roasMeta} />}
        note={<><b>{plural(t.metaPurchases, 'compra', 'compras')}</b> · <b>{formatMoney(t.metaRevenue)}</b> ÷ gasto</>}
        info="O valor de compra que o próprio Meta informa para esses anúncios, dividido pelo gasto. Compras acima de $20.000 em um anúncio num só dia são descartadas como falha do relatório."
      />
      <KpiCard
        label={storeRoasLabel(channel)}
        swatch={channel === 'shop' ? 'shop' : 'meta'}
        value={<Roas value={storeRoas} />}
        note={<RoasGauge roas={storeRoas} breakEven={store?.breakEvenRoas ?? null} configured={configured} size="mini"
          revenue={store?.revenue ?? null} contribution={store?.contribution ?? null} />}
        footnote={leftOut ?? undefined}
        info="Todas as vendas da loja, com orgânico e recompra, divididas pelo gasto em anúncios — o mesmo ROAS do Resumo. Com um só canal gastando, é esse canal; com Meta e Anúncios Shopify gastando (cada um com 10% ou mais do gasto), é o gasto dos dois somado, porque dividir só pelo Meta daria ao Meta as vendas que os Anúncios Shopify trouxeram. Sobe sozinho quando o gasto cai, porque a venda orgânica continua: serve para a loja, não para julgar um anúncio."
      />
    </div>
  )
}
