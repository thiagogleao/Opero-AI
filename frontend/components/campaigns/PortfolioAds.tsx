/**
 * Campanhas in "Todas as lojas": each store's ads against its own break-even,
 * side by side, each row opening that store's campaigns. Campaigns themselves
 * are per store (one ad account, one margin), so the portfolio view judges
 * stores, not campaigns. Built from buildPortfolio rows (engine totals) and
 * lib/data/campaigns getOwnAttribution (own vs shared-account campaigns).
 *
 * The rules (channel ROAS, own-campaign ROAS atribuído) live in the pure
 * ./portfolioAdsModel; this file renders them.
 * Exports buildPortfolioAdsVerdict (re-export), <SharedAccountsCallout> and
 * <PortfolioAdsTable> (server).
 */

import type { PortfolioStoreRow } from '@/lib/views/portfolio'
import type { SharedAdAccount } from '@/lib/attributionModels'
import type { OwnAttribution } from '@/lib/data/campaigns'
import { Badge, Callout, DataTable, EmptyState, Money, Pct, RoasGauge, type DataColumn, type DataRow } from '@/components/ui'
import { formatMoney, formatPct, formatRoas, plural } from '@/lib/format'
import { CHANNEL_SHORT, joinNames, storeAdsRow } from './portfolioAdsModel'
import s from './campaigns.module.css'

export { buildPortfolioAdsVerdict } from './portfolioAdsModel'

export function SharedAccountsCallout({ pairs }: { pairs: SharedAdAccount[] }) {
  if (!pairs.length) return null
  return (
    <Callout tone="warn" title="Conta de anúncio compartilhada.">
      {' '}{pairs.map(p => `Anúncios pagos pela ${p.adStoreName} trouxeram ${plural(p.orders, 'pedido', 'pedidos')} (${formatMoney(p.revenue)}) da ${p.salesStoreName}`).join('; ')}.
      {' '}O gasto fica na loja dona da conta e as vendas na loja que vendeu: some as duas para julgar o resultado.
    </Callout>
  )
}

export function PortfolioAdsTable({ stores, attribution, pairs, hrefFor, rangeLabel }: {
  stores: PortfolioStoreRow[]
  /** Null when the own/shared split failed to load: its columns show "—". */
  attribution: ReadonlyMap<string, OwnAttribution> | null
  /** Shared-account pairs of the window: a store without ad spend that sells
   *  on another store's ads says so instead of "sem gasto". */
  pairs: SharedAdAccount[]
  /** The row's link. Gets the whole row so it can keep the exact dates the
   *  row was priced on (components/portfolio/model resumoLinkOverrides). */
  hrefFor: (row: PortfolioStoreRow) => string
  rangeLabel: string
}) {
  const columns: DataColumn[] = [
    { key: 'store', label: 'Loja' },
    { key: 'spend', label: 'Gasto Meta', numeric: true, sortable: true, info: 'Todo o gasto no Meta que a contabilidade da loja carrega, inclusive campanhas de conta compartilhada.' },
    { key: 'revenue', label: 'Vendas', numeric: true, sortable: true, info: 'Tudo o que a loja vendeu no período (Shopify), creditado ao Meta ou não.' },
    { key: 'roas', label: 'ROAS da loja', sortable: true, info: 'Vendas da loja (todas, creditadas ou não) ÷ gasto no canal em que ela anuncia — Meta, Anúncios Shopify ou os dois —, contra o empate da própria loja (receita ÷ contribuição): o mesmo ROAS do Resumo. Um canal com menos de 10% do gasto aparece como "só gasto": entra no lucro, fica fora do ROAS.' },
    { key: 'pv', label: 'Atribuídas', numeric: true, sortable: true, info: 'O que o Meta credita às campanhas da própria loja. Campanhas de conta compartilhada (vendas em outra loja) ficam fora; o valor delas aparece embaixo. Compras impossíveis já descartadas.' },
    { key: 'metaRoas', label: 'ROAS atribuído', numeric: true, sortable: true, info: 'Atribuídas ÷ gasto das campanhas da própria loja: o mesmo número da página de Campanhas da loja.' },
    // Below ~1100px of table box these two fold under Atribuídas and Gasto
    // Meta (campaigns.module.css, container query): the table is ~1150px, so
    // even at 1440 the Shopify header was clipped, and at 1024 both columns
    // sat behind an unseen scrollbar.
    { key: 'credit', label: <span className={s.colCredit}>Crédito Meta</span>, numeric: true, sortable: true, info: 'Atribuídas ÷ vendas da loja. Acima de 100%: o Meta credita mais do que a loja vendeu.' },
    { key: 'shop', label: <span className={s.colShop}>Shopify</span>, numeric: true, sortable: true, info: 'Anúncios Shopify (Shop Campaigns), cobrados pela Shopify, fora do Meta. Entram no ROAS da loja quando são o canal dela.' },
  ]
  const rows: DataRow[] = stores.map(r => {
    const t = r.totals
    const a = storeAdsRow(r, attribution ? attribution.get(r.id) ?? null : null)
    const sellsVia = pairs.filter(p => p.salesStoreId === r.id).map(p => p.adStoreName)
    return {
      key: r.id,
      href: hrefFor(r),
      tone: t.metaSpend > 0 || t.shopSpend > 0 ? undefined : 'mut',
      cells: {
        store: <span className={s.storeCell}><span className={s.nm}>{r.name}</span>{!r.configured && <Badge tone="cfg" icon="sliders">sem custos</Badge>}</span>,
        spend: (
          <span>
            <Money value={t.metaSpend} />
            {a.shared && a.shared.spend > 0 && <span className={`${s.cellSub} ${s.cellSubWrap}`}>{formatMoney(a.shared.spend)} em conta compartilhada</span>}
            {t.shopSpend > 0 && <span className={`${s.cellSub} ${s.inlineAds}`}>+ {formatMoney(t.shopSpend)} Anúncios Shopify</span>}
          </span>
        ),
        revenue: <Money value={t.revenue} />,
        roas: a.roas && a.channel ? (
          <span className={s.roasStore}>
            <RoasGauge roas={a.roas.roas} breakEven={r.configured ? t.breakEvenRoas : null} configured={r.configured}
              revenue={t.revenue} contribution={t.contribution} label={CHANNEL_SHORT[a.channel]} size="mini" />
            {a.sideSpend && (
              <span className={s.cellSub} title="Canal com menos de 10% do gasto em anúncios: entra no lucro, fica fora do ROAS.">
                + {a.sideSpend.label} <b className={s.num}>{formatMoney(a.sideSpend.spend)}</b> (só gasto)
              </span>
            )}
          </span>
        ) : (
          <span className={s.why}>
            {sellsVia.length ? `sem gasto próprio · vende com anúncios pagos pela ${joinNames([...new Set(sellsVia)])}` : 'sem gasto em anúncio'}
          </span>
        ),
        pv: a.own ? (
          <span>
            <Money value={a.own.purchaseValue} />
            {a.own.creditPct !== null && <span className={`${s.cellSub} ${s.inlineAds}`}>{formatPct(a.own.creditPct, { digits: 0 })} das vendas</span>}
            {a.shared && a.shared.purchaseValue > 0 && <span className={`${s.cellSub} ${s.cellSubWrap}`}>fora: {formatMoney(a.shared.purchaseValue)} de conta compartilhada</span>}
          </span>
        ) : <span className={s.muted}>—</span>,
        metaRoas: <span>{formatRoas(a.own?.roas ?? null)}</span>,
        credit: <span className={s.colCredit}><Pct value={a.own?.creditPct ?? null} digits={0} /></span>,
        shop: <span className={s.colShop}><Money value={t.shopSpend} /></span>,
      },
      sort: {
        spend: t.metaSpend, revenue: t.revenue, roas: a.roas?.roas ?? null, pv: a.own?.purchaseValue ?? null, metaRoas: a.own?.roas ?? null,
        credit: a.own?.creditPct ?? null, shop: t.shopSpend,
      },
    }
  })
  return (
    <div className={s.adsBox}>
      <DataTable
        caption={`Anúncios por loja em ${rangeLabel}`}
        columns={columns}
        rows={rows}
        initialSort={{ key: 'spend', dir: 'desc' }}
        dense
        empty={<EmptyState compact title="Nenhuma loja para mostrar" />}
      />
    </div>
  )
}
