/**
 * Ad by ad: the spend, the sales Shopify's journeys credit to the ad under the
 * chosen model, the sales it brought to a store sharing the account, and what
 * Meta declares for it. The `limit` biggest spenders are rows; the rest are
 * one "outros" row that always stays last, so the table still adds up to its
 * footer. Cells are rendered here (server) and handed to the shared DataTable.
 */

import type { AttributionReport, CreativeAttribution, Model } from '@/lib/attributionModels'
import { formatCount, formatMoney, plural } from '@/lib/format'
import { Badge, Block, DataTable, EmptyState, Money, Pct, Roas, type DataColumn, type DataRow } from '@/components/ui'
import { adGap, adSpendState, liveThumbnail, MODEL_TEXT, ordersLabel } from './model'
import { WhyEmpty, type EmptyWindowText } from '@/components/campaigns/emptyWhy'
import s from './CreativeTable.module.css'

type Row = CreativeAttribution & { count?: number }

function GapCell({ c }: { c: Row }) {
  const g = adGap(c)
  if (g.kind === 'only_meta') return <span className={s.onlyMeta}>só o Meta vê</span>
  if (g.kind === 'only_journey') return <span className="mut">Meta não declara</span>
  if (g.kind === 'none') return <span className="mut">—</span>
  return <Pct value={g.pct} digits={0} sign tone={g.pct > 50 ? 'neg' : 'none'} />
}

function AdCell({ c, storeId, names, now }: { c: Row; storeId: string; names: Record<string, string>; now: Date }) {
  if (c.adId === 'outros') {
    return (
      <div className={s.ad}>
        <span className={`${s.thumb} ${s.thumbOthers}`} aria-hidden="true">+{formatCount(c.count ?? 0)}</span>
        <div className={s.adText}>
          <span className={s.adName}>{c.name}</span>
          <span className={s.adSub}>somados: os de menor gasto no período</span>
        </div>
      </div>
    )
  }
  const foreign = c.adStoreId && c.adStoreId !== storeId
  const thumb = liveThumbnail(c.thumbnail, now)
  return (
    <div className={s.ad}>
      {thumb
        // Meta's CDN thumbnails: plain img, the Next image optimiser would
        // need every fbcdn host whitelisted and the URLs expire anyway.
        // eslint-disable-next-line @next/next/no-img-element
        ? <img src={thumb} alt="" width={32} height={32} loading="lazy" className={s.thumb} />
        : <span className={s.thumb} aria-hidden="true" />}
      <div className={s.adText}>
        <span className={s.adName} title={c.name ?? c.adId}>{c.name ?? (c.adStoreId ? 'Anúncio sem nome' : 'Anúncio de conta não conectada')}</span>
        <span className={s.adSub}>
          {c.campaignName ?? (c.name ? null : <span className="num">{c.adId}</span>)}
          {foreign && <Badge tone="info" icon="swap">conta da {names[c.adStoreId!] ?? 'outra loja'}</Badge>}
          {!c.adStoreId && c.name && <Badge tone="mut">conta não conectada</Badge>}
        </span>
      </div>
    </div>
  )
}

export function CreativeTable({ report, storeId, storeName, names, model, rangeLabel, now, why = null }: {
  report: AttributionReport
  storeId: string
  storeName: string
  /** Store id → display name (viewer's stores), for "conta da EPOCH". */
  names: Record<string, string>
  model: Model
  rangeLabel: string
  /** The page's clock, to skip thumbnails whose CDN link expired. */
  now: Date
  /** The verdict's reason the window is empty (components/campaigns/emptyWhy). */
  why?: EmptyWindowText | null
}) {
  const all: Row[] = report.others ? [...report.creatives, report.others] : report.creatives
  const siblingIds = [...new Set(report.sharedAccounts.filter(p => p.adStoreId === storeId).map(p => p.salesStoreName))]
  const hasSiblings = all.some(c => c.siblingRevenue > 0.005)
  const siblingLabel = siblingIds.length === 1 ? `Na ${siblingIds[0]}` : 'Em outra loja'

  const columns: DataColumn[] = [
    { key: 'ad', label: 'Anúncio' },
    { key: 'spend', label: 'Gasto', numeric: true, sortable: true },
    { key: 'revenue', label: 'Vendas pela jornada', numeric: true, sortable: true },
    ...(hasSiblings ? [{ key: 'sibling', label: siblingLabel, numeric: true, sortable: true, info: 'Vendas que o mesmo anúncio trouxe para outra loja que usa esta conta de anúncios.' } satisfies DataColumn] : []),
    { key: 'roas', label: 'ROAS jornada', numeric: true, sortable: true },
    { key: 'meta', label: 'Meta declara', numeric: true, sortable: true },
    { key: 'gap', label: 'Diferença', numeric: true, sortable: true, info: 'Quanto o Meta declara a mais (+) ou a menos (−) do que as vendas da jornada ligadas ao anúncio.' },
  ]

  const rows: DataRow[] = all.map(c => {
    const others = c.adId === 'outros'
    const g = adGap(c)
    // Unknown spend (no connected account reports the ad) or no spend with
    // sales here or in the sibling store: ./model adSpendState.
    const spendState = adSpendState(c)
    const unknownSpend = spendState === 'unknown'
    const pausedCredit = spendState === 'none'
    return {
      key: c.adId,
      tone: others ? 'mut' : undefined,
      cells: {
        ad: <AdCell c={c} storeId={storeId} names={names} now={now} />,
        spend: unknownSpend ? <span className={s.noSpend}>gasto desconhecido</span>
          : pausedCredit ? <span className={s.noSpend}>sem gasto no período</span>
          : <Money value={c.spend} />,
        revenue: <span className={s.stack}><Money value={c.revenue} tone={c.revenue > 0 ? 'none' : 'mut'} /><small>{ordersLabel(c.orders)}</small></span>,
        sibling: c.siblingRevenue > 0.005
          ? <span className={s.stack}><Money value={c.siblingRevenue} /><small>{ordersLabel(c.siblingOrders)}</small></span>
          : <span className="mut">—</span>,
        roas: <Roas value={c.roasJourney} />,
        meta: <span className={s.stack}><Money value={c.metaRevenue} tone={c.metaRevenue > 0 ? 'none' : 'mut'} /><small>{plural(c.metaPurchases, 'compra', 'compras')}</small></span>,
        gap: <GapCell c={c} />,
      },
      // "outros" has no sort values: nulls sort last in both directions, so
      // the summed row never lands between two real ads.
      sort: others ? undefined : {
        spend: unknownSpend ? null : c.spend, revenue: c.revenue, sibling: c.siblingRevenue,
        roas: c.roasJourney, meta: c.metaRevenue,
        gap: g.kind === 'pct' ? g.pct : g.kind === 'only_meta' ? Number.MAX_SAFE_INTEGER : null,
      },
    }
  })

  const sum = all.reduce((a, c) => ({
    spend: a.spend + c.spend, orders: a.orders + c.orders, revenue: a.revenue + c.revenue,
    sib: a.sib + c.siblingRevenue, sibOrders: a.sibOrders + c.siblingOrders,
    meta: a.meta + c.metaRevenue, metaPc: a.metaPc + c.metaPurchases,
  }), { spend: 0, orders: 0, revenue: 0, sib: 0, sibOrders: 0, meta: 0, metaPc: 0 })
  const adCount = report.creatives.length + (report.others?.count ?? 0)
  // The footer's ROAS and gap are the verdict's like-for-like numbers (ads of
  // this store's own account only), never a ratio of the column sums: those
  // also hold ads of another account, whose Meta claim is not on this page.
  const t = report.totals
  const mixed = t.unknownAdRevenue > 0.5 || t.sharedSpend > 0.005
  // On CAMP HALLOW's page the spend and Meta columns add up EPOCH's ads,
  // whose Meta claim covers both shops' sales: say so under the sums.
  const otherAdStore = t.sharedSpend > 0.005
    ? report.sharedAccounts.find(p => p.salesStoreId === storeId && p.adStoreId !== storeId)?.adStoreName ?? 'outra loja'
    : null
  const footNote = otherAdStore
    ? `Gasto e Meta declara somam anúncios da conta da ${otherAdStore}, que vendem nas duas lojas; ROAS e diferença: só a conta desta loja, como no topo`
    : mixed ? 'ROAS e diferença: só a conta desta loja, como no topo' : null

  return (
    <Block
      title="Anúncio por anúncio"
      howTo={`Gasto de cada anúncio ao lado das vendas que a Shopify liga a ele (${MODEL_TEXT[model].label.toLowerCase()}) e do que o Meta declara, ${rangeLabel}. Ordenado por gasto; ${report.others ? `os ${formatCount(report.others.count)} menores estão somados em “outros”` : 'todos os anúncios com atividade'}.`}
      info={<>
        <p><b>Gasto</b>: o do anúncio no período, na conta de anúncios que o roda (pode ser a de outra loja da sua conta).</p>
        <p><b>Vendas pela jornada</b>: vendas e pedidos desta loja que a jornada da Shopify credita ao anúncio, por {MODEL_TEXT[model].label.toLowerCase()}.</p>
        <p><b>ROAS jornada</b>: todas as vendas da jornada ligadas ao anúncio (desta loja e da outra que usa a conta) ÷ gasto.</p>
        <p><b>Meta declara</b>: o valor de compra que o próprio Meta informa para o anúncio, sem as compras fantasmas acima de $20.000 num dia.</p>
        <p>Um anúncio que o Meta credita muito acima do que a jornada viu é o mais provável de estar sendo escalado por compras que não aconteceram na loja.</p>
        <p>“Sem gasto no período”: o pedido veio de um clique antigo num anúncio que não gastou nestas datas.</p>
      </>}
      flush
    >
      {/* The table scrolls inside 560px; the wrapper keeps the totals row
          (and so "outros") in sight instead of below 40 rows of scroll. */}
      <div className={s.tableWrap}>
      <DataTable
        caption={`Anúncios da ${storeName} com gasto ou venda em ${rangeLabel}`}
        columns={columns}
        rows={rows}
        initialSort={{ key: 'spend', dir: 'desc' }}
        maxHeight={560}
        dense
        empty={why ? <WhyEmpty why={why} /> : <EmptyState compact icon="ring" title="Nenhum anúncio com gasto ou venda neste período">A conta de anúncios desta loja não gastou e nenhum pedido passou por anúncio entre {rangeLabel}.</EmptyState>}
        footer={all.length ? {
          ad: <span className={s.footLabel}>Todos os {plural(adCount, 'anúncio', 'anúncios')}{footNote && <small>{footNote}</small>}</span>,
          spend: formatMoney(sum.spend),
          revenue: <span className={s.stack}>{formatMoney(sum.revenue)}<small>{ordersLabel(sum.orders)}</small></span>,
          sibling: hasSiblings ? <span className={s.stack}>{formatMoney(sum.sib)}<small>{ordersLabel(sum.sibOrders)}</small></span> : null,
          roas: <Roas value={t.roasJourney} />,
          meta: <span className={s.stack}>{formatMoney(sum.meta)}<small>{plural(sum.metaPc, 'compra', 'compras')}</small></span>,
          gap: t.metaGapPct !== null && t.spend > 0.005 ? <Pct value={t.metaGapPct} digits={0} sign /> : <span className="mut">—</span>,
        } : undefined}
      />
      </div>
    </Block>
  )
}
