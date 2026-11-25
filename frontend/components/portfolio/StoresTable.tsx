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
import { rangeBeside } from '@/lib/period'
import type { PortfolioStoreRow, PortfolioView } from '@/lib/views/portfolio'
import { storeStatusChips, type Verdict } from '@/lib/views/verdict'
import { formatDate, formatMoney, formatPct, formatRangeLabel, plural } from '@/lib/format'
import {
  Avatar, Badge, Block, Chip, CodePill, Count, DataTable, Delta, EmptyState, Money, Pct, StatusDot,
  VerdictChips, type DataRow,
} from '@/components/ui'
import { MiniBars } from '@/components/charts'
import { empateGap } from '@/lib/views/store'
import { RoasVsEmpate } from '@/components/dashboard/RoasVsEmpate'
import { dateBeside } from '@/components/campaigns/storeStart'
import type { SharedAdAccount } from '@/lib/attributionModels'
import { loadRowExtras, type RowExtras } from './data'
import {
  adChannels, freshnessCell, lastSaleDate, noSalesCashHit, notSellingYet, pairOrdersIn, resultSortValue,
  rowBeforeFirstSale, rowResult, sharedAccountBadges, sumMembers, totalRowIdle, trailGap, trailProfitCount, trailSinceStart, type TrailGap,
} from './model'
import s from './portfolio.module.css'

function StoreCell({ ctx, row, extras }: { ctx: PageContext; row: PortfolioStoreRow; extras: RowExtras }) {
  const opt = ctx.storeOptions.find(o => o.id === row.id)
  // The same chips as the phone store list (storeStatusChips): the status, and
  // "custos não configurados" second whenever the status says something else.
  // With the window, a store whose first sale came after it reads "ainda não
  // vendia" and nothing else, as the phone, the verdict and this row's own
  // result say — not "sem vendas · custos não configurados" (Glooty, Mês
  // passado; every row of January).
  const chips = storeStatusChips(row, { singleDay: ctx.range.from === ctx.range.to, range: ctx.range })
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
          <VerdictChips chips={chips} size="sm" />
          {opt?.dayLabel && <Chip tone="info" icon="clock" size="sm" title={dayBadge?.detail}>{opt.dayLabel}{dayBadge ? ` · ${dayBadge.code === 'dia_encerrado' ? 'dia encerrado' : 'dia não começou'}` : ''}</Chip>}
          {shared.map(b => <Badge key={b.label} tone="info" icon="swap" title={b.detail}>{b.label}</Badge>)}
          {currency && <Badge tone="mut" title={`Vende em ${currency}; os valores aparecem convertidos em dólar, no câmbio de cada pedido.`}>vende em {currency}</Badge>}
        </span>
      </span>
    </span>
  )
}

/** "2 chargebacks: −$343 no caixa" under a row with no sale (model noSalesCashHit). */
function CashHitLine({ ctx, row }: { ctx: PageContext; row: PortfolioStoreRow }) {
  const hit = noSalesCashHit(row.totals)
  if (!hit) return null
  return (
    <small title="Reembolsos e chargebacks de pedidos anteriores, que chegaram neste período: saem do resultado de caixa, não do lucro.">
      {hit.what ?? 'reembolsos e chargebacks'}: <b className="neg">{formatMoney(ctx.part(hit.amount))}</b> no caixa
    </small>
  )
}

/** The store did not exist yet in the window (model rowBeforeFirstSale): the
 *  result cell says "ainda não vendia · 1ª venda em …", so the money cells
 *  beside it show "—", not "$0 · 0", and the ad cells drop what the store
 *  "used to" do. A store that spent before its first sale is not one: it
 *  shows $0 · 0 beside its loss. */
function beforeFirstSale(row: PortfolioStoreRow, range: PageContext['range']): boolean {
  return rowBeforeFirstSale(row, range)
}

function ResultCell({ ctx, row, extras }: { ctx: PageContext; row: PortfolioStoreRow; extras: RowExtras }) {
  const r = rowResult(row)
  // A row without orders says when the store last sold (Glooty: 10 nov), so a
  // store that stopped selling is not read as a sync that stopped reading.
  const last = row.totals.orders === 0 ? lastSaleDate(extras.lastActivity.get(row.id)?.lastSaleAt, row.timezone) : null
  // A store that had not made its first sale yet (Hibikura, Mês passado) read
  // "sem vendas · última 18 nov", a sale after the window, as if it had
  // stopped: say when it started, as the verdict does — with the year when
  // the window or its comparison is in another year ("1ª venda em 11 abr"
  // beside "15 dez 2025 – 15 jan 2026" read as 11 abr 2025). One that spent
  // on ads before that first sale did sell nothing in a window it existed in:
  // "sem vendas", with the same first sale instead of a later "última".
  const first = row.totals.orders === 0 && notSellingYet(row, ctx.range) && row.firstOrderDate
    ? dateBeside(row.firstOrderDate, [ctx.range.from, ctx.range.to, ctx.comparison.from, ctx.comparison.to], ctx.today)
    : null
  const lastText = first
    ? beforeFirstSale(row, ctx.range) ? `ainda não vendia · 1ª venda em ${first}` : `sem vendas · 1ª venda em ${first}`
    : last ? `sem vendas · última ${formatDate(last, ctx.today)}` : 'sem vendas'
  // In a narrow table the sparkline column is hidden and the same bars sit
  // under the result (portfolio.module.css, container query).
  const trail = <TrailCell ctx={ctx} row={row} extras={extras} inline />
  if (r.kind === 'none') {
    return (
      <span className={s.money}>
        <span className="num mut">—</span>
        <small>{lastText}</small>
        <CashHitLine ctx={ctx} row={row} />
        {trail}
      </span>
    )
  }
  if (r.kind === 'revenue_minus_ads') {
    return (
      <span className={s.money}>
        <span className="num mut">—</span>
        <small>receita − anúncios: <b className={r.value! < 0 ? 'neg' : undefined}>{formatMoney(ctx.part(r.value!))}</b></small>
        {row.totals.orders === 0 && <small>{lastText}</small>}
        <CashHitLine ctx={ctx} row={row} />
        {trail}
      </span>
    )
  }
  const cmp = row.comparison
  const prev = cmp.included && (cmp.totals.orders > 0 || cmp.totals.adSpend > 0) ? ctx.part(cmp.totals.operatingProfit) : null
  return (
    <span className={s.money}>
      <Money value={ctx.part(r.value!)} tone="auto" />
      <Delta current={ctx.part(r.value!)} previous={prev} />
      <CashHitLine ctx={ctx} row={row} />
      {trail}
    </span>
  )
}

/** Revenue, and in a narrow table the margin under it (its column is hidden). */
function RevenueCell({ row }: { row: PortfolioStoreRow }) {
  const t = row.totals
  return (
    <span className={s.revenue}>
      <Money value={t.revenue} />
      {row.configured && t.margin !== null && (
        <small className={s.inlineMargin}>margem <Pct value={t.margin} tone={t.margin < 0 ? 'neg' : 'none'} /></small>
      )}
    </span>
  )
}

/** The sparkline cell; `inline` is its copy under the result in a narrow
 *  table, which draws the bars only (the result cell already says why a row
 *  has none: sem vendas, custos não configurados). */
function trailGapText(g: TrailGap): string {
  switch (g.kind) {
    case 'no_data': return '—'
    case 'not_yet': return 'ainda não vendia'
    case 'unconfigured': return 'sem série de lucro até configurar custos'
    case 'idle': return `sem movimento em ${plural(g.days, 'dia', 'dias')}`
  }
}

/** "sua parte (50%)", as the Resumo charts name the partner's share. */
const shareLabel = (ctx: PageContext) => `sua parte (${formatPct(ctx.splitFactor * 100, { digits: 0 })})`

function TrailCell({ ctx, row, extras, inline = false }: { ctx: PageContext; row: PortfolioStoreRow; extras: RowExtras; inline?: boolean }) {
  const all = extras.trail.get(row.id)
  const gap = trailGap(all, row)
  if (gap || !all) return inline ? null : <span className={s.sparkNone}>{gap ? trailGapText(gap) : '—'}</span>
  // From the store's start, as the Resumo chart counts (model trailSinceStart):
  // Hibikura's bars began 19 days before its first sale and read "8 de 30".
  const { days: pts, startedOn } = trailSinceStart(all, row.firstOrderDate)
  const shown = startedOn ? { from: pts[0].date, to: pts[pts.length - 1].date } : extras.trailRange
  // A range that starts at the store's start is a store-fact range beside
  // the window (R11 rangeBeside): with its year when the window carries one.
  const shownLabel = `${rangeBeside(shown, { window: ctx.range, comparison: ctx.comparison, clockToday: ctx.today })}${startedOn ? ' (desde que a loja começou)' : ''}`
  // Drawn as the viewer's share, like the Resumo chart (DailyProfitBars); the
  // tooltip names it and gives the store's whole sum next to it — a bare
  // "soma $809" under ?parte=50 read as Hibikura's whole profit ($1.617).
  const values = pts.map(p => ctx.part(p.profit))
  const days = pts.filter(p => p.date >= ctx.range.from && p.date <= ctx.range.to).length
  const whole = pts.reduce((a, p) => a + p.profit, 0)
  const sum = ctx.part(whole)
  const tone = sum < 0 ? 'neg' : 'pos'
  const count = trailProfitCount(pts, row.partial ? row.storeToday : null)
  const notes = [
    days < values.length ? 'A parte sombreada é o período escolhido.' : null,
    count.leftOut ? 'Hoje, ainda em andamento, fica fora de “dias no lucro”.' : null,
  ].filter((n): n is string => !!n)
  const sumRows: [string, string, ('pos' | 'neg')?][] = ctx.split
    ? [[shareLabel(ctx), formatMoney(sum), tone], ['soma da loja inteira', formatMoney(whole)]]
    : [['soma', formatMoney(sum), tone]]
  return (
    <span className={inline ? `${s.spark} ${s.inlineTrail}` : s.spark}>
      <MiniBars
        values={values}
        width={100}
        height={28}
        highlightLast={days < values.length ? days : undefined}
        tip={{
          title: `Lucro por dia · ${shownLabel}`,
          rows: [...sumRows, ['dias no lucro', `${count.inProfit} de ${count.of}`]],
          note: notes.length ? notes.join(' ') : undefined,
        }}
        ariaLabel={`${ctx.split ? `Sua parte (${formatPct(ctx.splitFactor * 100, { digits: 0 })}) do lucro` : 'Lucro'} por dia da ${row.name} em ${shownLabel}`}
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

function RoasCell({ row, extras, range }: { row: PortfolioStoreRow; extras: RowExtras; range: PageContext['range'] }) {
  const { gauge, spendOnly } = adChannels(row.totals, row.configured)
  if (!gauge) {
    // Before its first sale the store did not exist yet: "antes vendia com
    // anúncios pagos pela EPOCH" told a past that is in the window's future
    // (CAMP HALLOW, dez 2025 – abr 2026; first sale 24 jul 2026).
    const sold = beforeFirstSale(row, range) ? undefined : extras.shared.find(p => p.salesStoreId === row.id)
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
  // Each row is an R4 link (lib/period carry): the period travels as asked
  // (a preset stays a preset), the store's Resumo resolves it on its own
  // clock, and `vem=todas` makes it announce other dates on landing. The
  // help line names, with the same function, the stores whose page opens
  // other dates than their row shows (L32, L575).
  const store = (id: string) => ({ kind: 'store' as const, id })
  const rows: DataRow[] = view.stores.map(row => {
    const r = rowResult(row)
    const t = row.totals
    return {
      key: row.id,
      href: ctx.scopeHref('/', store(row.id)) ?? ctx.hrefWith('/'),
      // Greyed only when nothing happened: a row whose chargebacks took money
      // out (noSalesCashHit) is news, not an idle store.
      tone: r.kind === 'none' && !noSalesCashHit(t) ? 'mut' : undefined,
      cells: {
        store: <StoreCell ctx={ctx} row={row} extras={extras} />,
        result: <ResultCell ctx={ctx} row={row} extras={extras} />,
        trail: <span className={s.colTrail}><TrailCell ctx={ctx} row={row} extras={extras} /></span>,
        revenue: beforeFirstSale(row, ctx.range) ? <span className="num mut">—</span> : <RevenueCell row={row} />,
        orders: beforeFirstSale(row, ctx.range) ? <span className="num mut">—</span> : <Count value={t.orders} />,
        margin: <span className={s.colMargin}>{row.configured && t.margin !== null ? <Pct value={t.margin} tone={t.margin < 0 ? 'neg' : 'none'} /> : <span className="mut">—</span>}</span>,
        ads: <AdsCell row={row} />,
        roas: <RoasCell row={row} extras={extras} range={ctx.range} />,
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

  // R4 on the link's help line (lib/period rowsAnnouncement, shared with Campanhas · Todas).
  const opensOther = ctx.rowsAnnouncement(view.stores.map(r => r.id))
  const vt = verdict.totals
  // Counted like the verdict ("4 lojas na soma"): stores with costs that had
  // something in the window; the rest are named, not counted.
  const members = sumMembers(view.stores)
  const excluded = verdict.excluded.map(e => e.name)
  // Named the way the verdict's notes name them: a store that had not made its
  // first sale yet is not a store with "sem movimento", with or without costs
  // (Glooty in October, model totalRowIdle).
  const idle = totalRowIdle(view.stores, ctx.range)
  const names = (rows: PortfolioStoreRow[]) => rows.map(r => r.name).join(', ')
  // A window before every store's first sale: the verdict says so, and the
  // Total row read "— sem vendas $0 0", a fake $0 beside it.
  const notYet = !!verdict.beforeStart
  const footer = view.stores.length > 1 ? {
    store: (
      <span className={s.foot}>
        <b>Total · {members.summed.length} de {plural(verdict.storeCount, 'loja', 'lojas')}</b>
        {excluded.length > 0 && <small>{excluded.join(', ')} {excluded.length === 1 ? 'fica' : 'ficam'} fora: sem custos configurados</small>}
        {idle.notStarted.length > 0 && <small>{names(idle.notStarted)}: o dia ainda não começou no fuso {idle.notStarted.length === 1 ? 'dela' : 'delas'}</small>}
        {idle.notYet.length > 0 && <small>{names(idle.notYet)}: ainda não {idle.notYet.length === 1 ? 'vendia' : 'vendiam'} no período</small>}
        {idle.quiet.length > 0 && <small>{names(idle.quiet)}: sem movimento no período</small>}
      </span>
    ),
    result: (
      <span className={s.money}>
        {verdict.amount === null ? <span className="num mut">—</span> : <Money value={verdict.amount} tone="auto" />}
        {/* The amount follows the partner split in both bases (verdict k). */}
        <small>{notYet ? 'ainda não vendiam'
          : verdict.basis === 'profit' ? `lucro real${ctx.split ? ' · sua parte' : ''}`
            : verdict.basis === 'revenue_minus_ads' ? `receita − anúncios${ctx.split ? ' · sua parte' : ''}` : 'sem vendas'}</small>
      </span>
    ),
    trail: <span className={s.colTrail} />,
    revenue: notYet ? <span className="num mut">—</span> : (
      <span className={s.revenue}>
        <Money value={vt.revenue} />
        {verdict.basis === 'profit' && vt.margin !== null && <small className={s.inlineMargin}>margem <Pct value={vt.margin} /></small>}
      </span>
    ),
    orders: notYet ? <span className="num mut">—</span> : <Count value={vt.orders} />,
    margin: <span className={s.colMargin}>{verdict.basis === 'profit' && vt.margin !== null ? <Pct value={vt.margin} /> : <span className="mut">—</span>}</span>,
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
      howTo={`Cada loja em ${ctx.rangeLabel}, no calendário do próprio fuso, ordenadas por lucro. Clique numa loja para abrir o Resumo dela no mesmo período${opensOther ? ` ${opensOther}` : ''}.`}
      info={<>Lucro real = receita − produto − frete − taxas − Anúncios Meta − Anúncios Shopify − custos fixos, pelo mesmo motor de todas as telas.
        Uma loja sem custos configurados mostra receita − anúncios e fica fora do total. O ROAS de cada loja é comparado com o empate dela
        (receita ÷ contribuição). Ao lado da cidade de cada loja, a leitura mais antiga das fontes dela: pedidos ou Meta.</>}
      flush
    >
      {/* A size container: below the table's natural width (~1100px) the
          sparkline and margin columns fold into the result and revenue cells,
          so ROAS × empate stays on screen (1024px: 906px of box; 1280: 982). */}
      <div className={s.tableBox}>
        <DataTable
          caption={`Lojas em ${ctx.rangeLabel}, com lucro, receita, pedidos, margem, anúncios e ROAS`}
          initialSort={{ key: 'result', dir: 'desc' }}
          columns={[
            { key: 'store', label: 'Loja', sortable: true, info: 'Ao lado da cidade: a última leitura bem-sucedida da fonte mais antiga da loja (pedidos ou Meta). Âmbar: atrasada; coral: atrasada e a última tentativa falhou. Uma tentativa que falhou com a leitura ainda em dia não muda a cor: aparece na dica ao passar o mouse.' },
            { key: 'result', label: `Lucro${ctx.split ? ' (sua parte)' : ''}`, numeric: true, sortable: true, info: `Lucro real no período e a variação ${ctx.comparisonText}. Sem custos configurados: receita − anúncios, fora do total.` },
            { key: 'trail', label: <span className={s.colTrail}>Lucro por dia</span>, info: `Lucro real de cada dia em ${formatRangeLabel(extras.trailRange, ctx.today)} (uma loja mais nova, desde que começou: a primeira venda ou o primeiro anúncio), na escala de cada loja. A parte sombreada é o período escolhido.${ctx.split ? ` Na visão de sócio, cada barra é a ${shareLabel(ctx)} do lucro do dia; a dica traz também a soma da loja inteira.` : ''}` },
            { key: 'revenue', label: 'Receita', numeric: true, sortable: true },
            { key: 'orders', label: 'Pedidos', numeric: true, sortable: true },
            { key: 'margin', label: <span className={s.colMargin}>Margem</span>, numeric: true, sortable: true },
            { key: 'ads', label: 'Anúncios', numeric: true, sortable: true },
            { key: 'roas', label: 'ROAS × empate', info: 'Receita da loja ÷ gasto em anúncios, contra o empate da própria loja (receita ÷ contribuição). Mede o canal que carrega o gasto; com Meta e Shopify gastando de verdade, os dois somados (“Anúncios”). Um canal com menos de 10% do gasto entra só no lucro.' },
          ]}
          rows={rows}
          footer={footer}
          empty={<EmptyState compact title="Nenhuma loja ativa" />}
        />
      </div>
    </Block>
  )
}
