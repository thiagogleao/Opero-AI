/**
 * The spend and the three ROAS that must never be confused: by the journey
 * (sales Shopify links to the ads), as Meta declares it, and of the whole
 * store account (every sale ÷ Meta spend, organic included). The last one
 * rises by itself when spend falls, so it is the only one judged against the
 * store's break-even, and only when costs are configured. Server-safe.
 */

import type { AttributionTotals } from '@/lib/attributionModels'
import { formatCount, formatMoney, plural } from '@/lib/format'
import { KpiCard, Money, Roas, RoasGauge } from '@/components/ui'
import s from './AttributionKpis.module.css'

export function AttributionKpis({ totals: t, storeRoas, breakEven, sharedAdStore }: {
  totals: AttributionTotals
  /** Engine: store revenue ÷ Meta spend. */
  storeRoas: number | null
  /** Engine break-even ROAS, or null when the store has no cost settings. */
  breakEven: number | null
  /** Name of the store whose account runs ads this store also sells on. */
  sharedAdStore?: string | null
}) {
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
      {/* "ROAS da loja", the Resumo's name for the same number: on this page
          "conta" means the ad account, and this ROAS is the opposite of an
          ad-account figure (every sale, organic included). */}
      <KpiCard
        label="ROAS da loja"
        value={<Roas value={storeRoas} />}
        note={<RoasGauge roas={storeRoas} breakEven={breakEven} size="mini" />}
        info="Todas as vendas da loja divididas pelo gasto no Meta, com orgânico e recompra — o mesmo ROAS do Resumo. Sobe sozinho quando o gasto cai, porque a venda orgânica continua: serve para a loja, não para julgar um anúncio."
      />
    </div>
  )
}
