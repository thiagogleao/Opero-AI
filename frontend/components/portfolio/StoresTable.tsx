/**
 * StoresTable — one row per store of "Todas as lojas": profit (or revenue − ads
 * when costs are missing, or nothing when there were no sales), its change, a
 * sparkline of daily profit, revenue, orders, margin, ad spend per channel,
 * ROAS against the store's own break-even, freshness per source and the
 * badges that keep a row honest (custos não configurados, sem vendas, dia de
 * Tóquio, anúncios na conta da EPOCH…). A click opens that store's Resumo
 * keeping the period — a plain link, nothing to get stuck on.
 *
 * Async server component (streams in <Suspense>): it loads the sparkline days,
 * freshness, shared ad accounts and currencies (./data.ts). The
 * totals row follows the verdict: stores without costs are named, not summed.
 */

import type { PageContext } from '@/lib/views/page'
import type { PortfolioStoreRow, PortfolioView } from '@/lib/views/portfolio'
import { storeStatus, type Verdict } from '@/lib/views/verdict'
import { formatDate, formatMoney, formatRangeLabel, plural } from '@/lib/format'
import {
  Avatar, Badge, Block, Chip, CodePill, Count, DataTable, Delta, EmptyState, Money, Pct, StatusDot,
  VerdictChips, type DataRow,
} from '@/components/ui'
import { MiniBars } from '@/components/charts'
import { empateGap } from '@/lib/views/store'
import { RoasVsEmpate } from '@/components/dashboard/RoasVsEmpate'
import type { SharedAdAccount } from '@/lib/attributionModels'
import { loadRowExtras, type RowExtras } from './data'
import { adChannels, freshnessCell, lastSaleDate, pairOrdersIn, resultSortValue, resumoLinkOverrides, rowResult, sharedAccountBadges } from './model'
import s from './portfolio.module.css'

function StoreCell({ ctx, row, extras }: { ctx: PageContext; row: PortfolioStoreRow; extras: RowExtras }) {
  const opt = ctx.storeOptions.find(o => o.id === row.id)
  const status = storeStatus(row, { singleDay: ctx.range.from === ctx.range.to })
  const shared = sharedAccountBadges(row.id, extras.shared, 'Nos últimos 90 dias')
  const currency = extras.currencies.get(row.id)
  const dayBadge = row.badges.find(b => b.code === 'dia_encerrado' || b.code === 'dia_nao_comecou')
  const fresh = freshnessCell(extras.freshness.get(row.id), ctx.now)
  const freshText = fresh.state === 'failing' ? `falhando · ${fresh.label}`
    : fresh.state === 'stale' ? `atrasada · ${fresh.label}`
    : fresh.label.startsWith('há') || fresh.label === 'agora' ? `atualizada ${fresh.label}` : fresh.label
  return (
    <span className={s.store}>
      <Avatar name={row.name} size="sm" />
      <span className={s.storeText}>
        <span className={s.storeName}><b>{row.name}</b>{opt?.code && !row.name.endsWith(opt.code) && <CodePill>{opt.code}</CodePill>}</span>
        <span className={s.storeSub}>
          {opt?.city ?? row.timezone} · <StatusDot state={fresh.state} title={fresh.detail}>{freshText}</StatusDot>
        </span>
        <span className={s.badges}>
          <VerdictChips chips={[status]} size="sm" />
          {!row.configured && status.code !== 'sem_custos' && <Chip tone="cfg" icon="sliders" size="sm">custos não configurados</Chip>}
          {opt?.dayLabel && <Chip tone="info" icon="clock" size="sm" title={dayBadge?.detail}>{opt.dayLabel}{dayBadge ? ` · ${dayBadge.code === 'dia_encerrado' ? 'dia encerrado' : 'dia não começou'}` : ''}</Chip>}
          {shared.map(b => <Badge key={b.label} tone="info" icon="swap" title={b.detail}>{b.label}</Badge>)}
          {currency && <Badge tone="mut" title={`Vende em ${currency}; os valores aparecem convertidos em dólar, no câmbio de cada pedido.`}>vende em {currency}</Badge>}
        </span>
      </span>
    </span>
  )
}

function ResultCell({ ctx, row, extras }: { ctx: PageContext; row: PortfolioStoreRow; extras: RowExtras }) {
  const r = rowResult(row)
  if (r.kind === 'none') {
    const last = lastSaleDate(extras.freshness.get(row.id)?.lastOrderAt, row.timezone)
    return (
      <span className={s.money}>
        <span className="num mut">—</span>
        <small>sem vendas{last ? ` · última ${formatDate(last, ctx.today)}` : ''}</small>
      </span>
    )
  }
  if (r.kind === 'revenue_minus_ads') {
    return (
      <span className={s.money}>
        <span className="num mut">—</span>
        <small>receita − anúncios: <b className={r.value! < 0 ? 'neg' : undefined}>{formatMoney(ctx.part(r.value!))}</b></small>
      </span>
    )
  }
  const cmp = row.comparison
  const prev = cmp.included && (cmp.totals.orders > 0 || cmp.totals.adSpend > 0) ? ctx.part(cmp.totals.operatingProfit) : null
  return (
    <span className={s.money}>
      <Money value={ctx.part(r.value!)} tone="auto" />
      <Delta current={ctx.part(r.value!)} previous={prev} />
    </span>
  )
}

function TrailCell({ ctx, row, extras }: { ctx: PageContext; row: PortfolioStoreRow; extras: RowExtras }) {
  const pts = extras.trail.get(row.id)
  if (!pts?.length) return <span className={s.sparkNone}>—</span>
  if (!row.configured) return <span className={s.sparkNone}>sem série de lucro até configurar custos</span>
  if (pts.every(p => p.revenue === 0 && p.adSpend === 0)) return <span className={s.sparkNone}>sem movimento em {extras.trail.get(row.id)!.length} dias</span>
  const values = pts.map(p => ctx.part(p.profit))
  const days = pts.filter(p => p.date >= ctx.range.from && p.date <= ctx.range.to).length
  const sum = values.reduce((a, b) => a + b, 0)
  return (
    <span className={s.spark}>
      <MiniBars
        values={values}
        width={100}
        height={28}
        highlightLast={days < values.length ? days : undefined}
        tip={{
          title: `Lucro por dia · ${formatRangeLabel(extras.trailRange, ctx.today)}`,
          rows: [['soma', formatMoney(sum), sum < 0 ? 'neg' : 'pos'], ['dias no lucro', `${values.filter(v => v > 0).length} de ${values.length}`]],
          note: days < values.length ? 'A parte sombreada é o período escolhido.' : undefined,
        }}
        ariaLabel={`Lucro por dia da ${row.name} em ${formatRangeLabel(extras.trailRange, ctx.today)}`}
      />
    </span>
  )
}

function AdsCell({ row }: { row: PortfolioStoreRow }) {
  const t = row.totals
  if (t.metaSpend <= 0 && t.shopSpend <= 0) return <span className={s.channels}>sem anúncios</span>
  return (
    <span className={s.channels}>
      {t.metaSpend > 0 && <span>Meta <b>{formatMoney(t.metaSpend)}</b></span>}
      {t.shopSpend > 0 && <span>Shopify <b>{formatMoney(t.shopSpend)}</b></span>}
    </span>
  )
}

function RoasCell({ row, extras }: { row: PortfolioStoreRow; extras: RowExtras }) {
  const { gauge, spendOnly } = adChannels(row.totals, row.configured)
  if (!gauge) {
    const sold = extras.shared.find(p => p.salesStoreId === row.id)
    const soldNow = sold ? pairOrdersIn(extras.sharedNow, sold) : 0
    return (
      <span className={s.none}>
        {!sold ? 'sem gasto em anúncio'
          : soldNow === 0 ? `sem gasto em anúncio · antes vendia com anúncios pagos pela ${sold.adStoreName}`
          : `sem gasto no período · vende com anúncios pagos pela ${sold.adStoreName}`}
      </span>
    )
  }
  return (
    <span className={s.roas}>
      <RoasVsEmpate roas={gauge.roas} breakEven={gauge.breakEven} gap={empateGap(row.configured, gauge.breakEven, row.totals)} label={gauge.label} size="mini" />
      {spendOnly.map(c => (
        <span key={c.channel} className={s.roasExtra} title="Canal com menos de 10% do gasto em anúncios: entra no lucro, fica fora do ROAS.">+ {c.label} <b>{formatMoney(c.spend)}</b> (só gasto)</span>
      ))}
    </span>
  )
}

export async function StoresTable({ ctx, view, verdict, shared, sharedNow }: {
  ctx: PageContext; view: PortfolioView; verdict: Verdict
  /** 90-day pairs (the badges: a property of the stores). */
  shared: SharedAdAccount[]
  /** The same pairs inside the window (null: unknown) — decides whether a
   *  row with no ad spend "vende com anúncios pagos pela EPOCH" right now. */
  sharedNow: SharedAdAccount[] | null
}) {
  const extras = await loadRowExtras(ctx.selected, ctx.range, ctx.now, shared, sharedNow)
  const rows: DataRow[] = view.stores.map(row => {
    const r = rowResult(row)
    const t = row.totals
    return {
      key: row.id,
      href: ctx.hrefWith('/', resumoLinkOverrides(row, ctx)),
      tone: r.kind === 'none' ? 'mut' : undefined,
      cells: {
        store: <StoreCell ctx={ctx} row={row} extras={extras} />,
        result: <ResultCell ctx={ctx} row={row} extras={extras} />,
        trail: <TrailCell ctx={ctx} row={row} extras={extras} />,
        revenue: <Money value={t.revenue} />,
        orders: <Count value={t.orders} />,
        margin: row.configured && t.margin !== null ? <Pct value={t.margin} tone={t.margin < 0 ? 'neg' : 'none'} /> : <span className="mut">—</span>,
        ads: <AdsCell row={row} />,
        roas: <RoasCell row={row} extras={extras} />,
      },
      sort: {
        store: row.name.toLowerCase(),
        result: resultSortValue(r),
        revenue: t.revenue,
        orders: t.orders,
        margin: row.configured ? t.margin : null,
        ads: t.adSpend,
      },
    }
  })

  // Stores whose own day is not Brasília's right now (see model resumoLinkOverrides).
  const shifted = view.stores.filter(r => r.storeToday !== ctx.today).map(r => r.name)
  const vt = verdict.totals
  const judged = verdict.storeCount - verdict.excluded.length
  const excluded = verdict.excluded.map(e => e.name)
  const footer = view.stores.length > 1 ? {
    store: (
      <span className={s.foot}>
        <b>Total · {judged} de {plural(verdict.storeCount, 'loja', 'lojas')}</b>
        {excluded.length > 0 && <small>{excluded.join(', ')} {excluded.length === 1 ? 'fica' : 'ficam'} fora: sem custos configurados</small>}
      </span>
    ),
    result: (
      <span className={s.money}>
        {verdict.amount === null ? <span className="num mut">—</span> : <Money value={verdict.amount} tone="auto" />}
        <small>{verdict.basis === 'profit' ? `lucro real${ctx.split ? ' · sua parte' : ''}` : verdict.basis === 'revenue_minus_ads' ? 'receita − anúncios' : 'sem vendas'}</small>
      </span>
    ),
    revenue: <Money value={vt.revenue} />,
    orders: <Count value={vt.orders} />,
    margin: verdict.basis === 'profit' && vt.margin !== null ? <Pct value={vt.margin} /> : <span className="mut">—</span>,
    ads: (
      <span className={s.channels}>
        {vt.metaSpend > 0 && <span>Meta <b>{formatMoney(vt.metaSpend)}</b></span>}
        {vt.shopSpend > 0 && <span>Shopify <b>{formatMoney(vt.shopSpend)}</b></span>}
      </span>
    ),
  } : undefined

  return (
    <Block
      title="Lojas"
      howTo={`Cada loja em ${ctx.rangeLabel}, no calendário do próprio fuso, ordenadas por lucro. Clique numa loja para abrir o Resumo dela no mesmo período${shifted.length && ctx.period !== 'custom' ? ` (${shifted.join(', ')}: nas mesmas datas, ${formatRangeLabel(ctx.range, ctx.today)})` : ''}.`}
      info={<>Lucro real = receita − produto − frete − taxas − Anúncios Meta − Anúncios Shopify − custos fixos, pelo mesmo motor de todas as telas.
        Uma loja sem custos configurados mostra receita − anúncios e fica fora do total. O ROAS de cada loja é comparado com o empate dela
        (receita ÷ contribuição). A coluna Atualizado mostra a fonte mais antiga da loja: pedidos ou Meta.</>}
      flush
    >
      <DataTable
        caption={`Lojas em ${ctx.rangeLabel}, com lucro, receita, pedidos, margem, anúncios e ROAS`}
        initialSort={{ key: 'result', dir: 'desc' }}
        columns={[
          { key: 'store', label: 'Loja', sortable: true, info: 'Ao lado da cidade: a última leitura bem-sucedida da fonte mais antiga da loja (pedidos ou Meta). Âmbar: atrasada; coral: a última tentativa falhou.' },
          { key: 'result', label: `Lucro${ctx.split ? ' (sua parte)' : ''}`, numeric: true, sortable: true, info: `Lucro real no período e a variação ${ctx.comparisonText}. Sem custos configurados: receita − anúncios, fora do total.` },
          { key: 'trail', label: `Lucro por dia`, info: `Lucro real de cada dia em ${formatRangeLabel(extras.trailRange, ctx.today)}, na escala de cada loja. A parte sombreada é o período escolhido.` },
          { key: 'revenue', label: 'Receita', numeric: true, sortable: true },
          { key: 'orders', label: 'Pedidos', numeric: true, sortable: true },
          { key: 'margin', label: 'Margem', numeric: true, sortable: true },
          { key: 'ads', label: 'Anúncios', numeric: true, sortable: true },
          { key: 'roas', label: 'ROAS × empate', info: 'Receita da loja ÷ gasto em anúncios, contra o empate da própria loja (receita ÷ contribuição). Mede o canal que carrega o gasto; com Meta e Shopify gastando de verdade, os dois somados (“Anúncios”). Um canal com menos de 10% do gasto entra só no lucro.' },
        ]}
        rows={rows}
        footer={footer}
        empty={<EmptyState compact title="Nenhuma loja ativa" />}
      />
    </Block>
  )
}
