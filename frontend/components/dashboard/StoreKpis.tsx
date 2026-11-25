/**
 * StoreKpis — "Por dia e por pedido": the Resumo's secondary numbers, the
 * ones the number band at the top does not show (receita e pedidos por dia,
 * Anúncios Meta, Anúncios Shopify, anúncio por pedido, lucro por pedido). The
 * totals — receita, pedidos, margem, ROAS × empate — and their deltas live in
 * the band (lib/views/numberBand), so they are not repeated here. Server
 * component; every value comes from the same engine pass as the verdict
 * (lib/views/store StoreSummary).
 *
 * Partner split: only money RESULTS are halved (profit per order); revenue,
 * spend, margins and ROAS stay whole, as the owner decided.
 *
 * A window before the store's first sale, or an archived store's window after
 * its archive day (`empty`, from the verdict: ./emptyWindow), shows "—" and
 * says why on every card — not "$0 · nenhum pedido no período" beside a
 * verdict that says the store did not sell yet, or was not read.
 */

import type { ReactNode } from 'react'
import type { DateRange } from '@/lib/engine/dates'
import type { PageContext } from '@/lib/views/page'
import { daysRead, ledgerAdCents, type StoreSummary } from '@/lib/views/store'
import type { ComparisonWindow } from '@/lib/views/verdict'
import { followBand, type NumberBand, META_SPEND_INFO, ORDERS_INFO, REVENUE_INFO, SALES_PER_DAY_INFO, SHOP_SPEND_INFO, SPEND_PER_DAY_INFO } from '@/lib/views/numberBand'
import { formatCents, formatCount, formatMoney, formatNumber, formatRangeLabel, plural } from '@/lib/format'
import { Block, Icon, KpiCard, Money } from '@/components/ui'
import { DeltaRow } from '@/components/numbers/NumberBandView'
import { MiniBars, Sparkline } from '@/components/charts'
import { kpiComparisonLabel, type KpiComparisonLabel } from './comparisonLabel'
import { emptyWindowText, type EmptyWindow } from './emptyWindow'
import s from './dashboard.module.css'

/**
 * "vs ontem até esta hora" / "vs 3–9 nov" / "vs 31 out – 9 nov até 04h16",
 * with the whole sentence for the hover title (./comparisonLabel). `cmp` is
 * the comparison as it was priced (StoreSummary view.comparison, with the
 * exact minute of the cut): a window ending today is compared with its last
 * day cut at this hour (lib/views/store comparisonPlan), and "vs 31 out –
 * 9 nov" alone named a whole range the previous values never had. Without it,
 * the same rule on the page context: cut when the window ends today.
 */
export function comparisonShort(
  ctx: PageContext,
  cmp: ComparisonWindow = { ...ctx.comparison, sameTimeOfDay: ctx.comparison.sameTimeOfDay || ctx.range.to >= ctx.today },
): KpiComparisonLabel {
  return kpiComparisonLabel(cmp, ctx.today)
}

/**
 * A card's ▲▼: the band's compact delta row under the band's own comparison
 * state (lib/views/numberBand followBand, components/numbers DeltaRow): no
 * row where the band measures no variation (base incompleta, sem base…),
 * uncoloured while the day is too young to judge. The comparison words are
 * said once in the band's status line, and in full in the row's title and
 * screen-reader text. The kind sets the colour: spend is neutral, a result
 * green when it rose; lowerIsBetter flips it for the ad cost per order.
 */
function KpiDelta({ band, current, previous, kind, k = 1, lowerIsBetter = false }: {
  band: Pick<NumberBand, 'comparison' | 'early'>
  current: number; previous: number | null
  kind: 'money' | 'money_result'; k?: number; lowerIsBetter?: boolean
}) {
  let d = followBand(band, kind, current, previous, k)
  if (!d) return null
  if (lowerIsBetter && d.kind !== 'none' && (d.good === 'up' || d.good === 'down') && d.dir && d.dir !== 'flat') {
    // Spending less per order is the good news: green when it fell.
    d = { ...d, good: d.dir === 'down' ? 'up' : 'down' }
  }
  return <DeltaRow d={d} />
}

/** "51¢ de cada dólar vendido" — or, when the spend passed the sales (Glooty:
 *  $820 of Meta on $156 sold), "$5,24 para cada $1 vendido", since "524¢ de
 *  cada dólar" reads like a typo; with no sales there is nothing to divide. */
function SpendShare({ cents, ledgerCents }: { cents: number | null; ledgerCents: number | null }) {
  if (cents === null) return <>sem vendas para comparar</>
  if (cents >= 100) return <><b>{formatMoney(cents / 100, { cents: 'always' })}</b> para cada $1 vendido</>
  return <><b>{formatCents(ledgerCents ?? cents)}</b> de cada dólar vendido</>
}

/** Both sides under a dollar: a change between them is noise (at 00h01 the
 *  day had $0 of Meta against $0,62 "ontem até esta hora", read as "caiu
 *  100%"), so the delta is left out. */
const underADollar = (cur: number, prev: number) => Math.max(Math.abs(cur), Math.abs(prev)) < 1

/**
 * The days behind a "por dia" (lib/views/store kpiDays): " em média" when they
 * are the whole window, else the days themselves — " em 7–17 nov" for
 * Hibikura's Este mês, which started on 7 nov and whose 18 nov is still
 * running — so an average never reads as total ÷ window.
 */
function perDayDays(days: DateRange | null, ctx: PageContext): ReactNode {
  const text = perDayRangeText(days, ctx)
  return text ? <> em <span className="num">{text}</span></> : ' em média'
}

/**
 * The days of a "por dia" as text, with the year whenever the window or its
 * comparison is in another year than today's (the rule of storeStart
 * dateBeside): under the header "1 dez 2025 – 30 abr 2026" the MOKOO read
 * "por dia em 11–30 abr", which reads as this year's April. formatRange
 * already prints both years when they differ, so only a same-year range
 * needs the suffix. Null when the days are the whole window.
 */
export function perDayRangeText(
  days: DateRange | null,
  ctx: Pick<PageContext, 'today' | 'range' | 'comparison'>,
): string | null {
  if (!days) return null
  const thisYear = ctx.today.slice(0, 4)
  const yearsShown = [ctx.range.from, ctx.range.to, ctx.comparison?.from, ctx.comparison?.to]
    .some(d => !!d && d.slice(0, 4) !== thisYear)
  const label = formatRangeLabel(days, ctx.today)
  return yearsShown && !/\d{4}$/.test(label) ? `${label} ${days.to.slice(0, 4)}` : label
}

function NotConfigured({ children }: { children: ReactNode }) {
  return <span className={s.cfg}><Icon name="sliders" size={12} />{children}</span>
}

// The ⓘ definitions are the band's (lib/views/numberBand: one copy).
const REVENUE_PER_DAY_INFO = `Receita ÷ dias. ${REVENUE_INFO} ${SALES_PER_DAY_INFO}`
const ORDERS_PER_DAY_INFO = `Pedidos ÷ dias. ${ORDERS_INFO} ${SALES_PER_DAY_INFO}`
const META_INFO = `${META_SPEND_INFO} ${SPEND_PER_DAY_INFO}`
const AD_PER_ORDER_INFO = '(Anúncios Meta + Anúncios Shopify) ÷ pedidos da loja — todos os pedidos, não só os que o Meta atribui a si.'
const PROFIT_PER_ORDER_INFO = 'Lucro real ÷ pedidos. A margem (lucro real ÷ receita) está no topo da página e não muda na visão de sócio.'

/** The block around the cards. */
function Section({ children }: { children: ReactNode }) {
  return (
    <Block title="Por dia e por pedido" className={s.perDay}
      howTo="Médias por dia e custos por pedido. Os totais do período, a margem e o ROAS estão no topo da página.">
      <div className={s.kpis2}>{children}</div>
    </Block>
  )
}

/** The cards when the window has nothing in it for a reason other than "no
 *  sales": the same cards and definitions, "—" for every number, the reason
 *  under each, and no delta (there is nothing to compare). */
function EmptyKpis({ note }: { note: string }) {
  const dash = <span className="mut">—</span>
  return (
    <Section>
      <KpiCard label="Receita por dia" value={dash} note={note} info={REVENUE_PER_DAY_INFO} />
      <KpiCard label="Pedidos por dia" value={dash} note={note} info={ORDERS_PER_DAY_INFO} />
      <KpiCard swatch="meta" label="Anúncios Meta" value={dash} note={note} info={META_INFO} />
      <KpiCard swatch="shop" label="Anúncios Shopify" value={dash} note={note} info={SHOP_SPEND_INFO} />
      <KpiCard label="Anúncio por pedido" value={dash} note={note} info={AD_PER_ORDER_INFO} />
      <KpiCard label="Lucro por pedido" value={dash} tone="mut" note={note} info={PROFIT_PER_ORDER_INFO} />
    </Section>
  )
}

export function StoreKpis({ ctx, summary, band, empty = null }: {
  ctx: PageContext; summary: StoreSummary
  /** The number band at the top of the page: its comparison state rules these deltas too. */
  band: Pick<NumberBand, 'comparison' | 'early'>
  /** The verdict's reason the window is empty (./emptyWindow emptyWindowOf). */
  empty?: EmptyWindow | null
}) {
  if (empty) return <EmptyKpis note={emptyWindowText(empty, ctx.rangeLabel).note} />
  const k = summary.kpis
  const p = k.previous
  const configured = summary.pnl.configured
  // The sparklines stop at an archived store's archive day, like its averages
  // (lib/views/store kpiDays): the days after it were never read.
  const daily = daysRead(summary.pnl.daily, summary.row.archived ? summary.row.archivedOn : null)
  const multiDay = daily.length > 2
  const noOrders = k.orders === 0
  const lc = ledgerAdCents(summary.pnl.totals, configured)
  // Two closed days at least: one day's "average" is just that day.
  const salesPerDay = k.salesAvgDays > 1
  const spendPerDay = k.avgDays > 1
  const dash = <span className="mut">—</span>

  return (
    <Section>
      <KpiCard
        label="Receita por dia"
        value={salesPerDay ? <Money value={k.revenuePerDay} /> : dash}
        note={noOrders
          ? 'nenhum pedido no período'
          : salesPerDay
            ? <span className={s.kpiNote}>por dia{perDayDays(k.salesAvgRange, ctx)}</span>
            : 'a média precisa de 2 dias fechados'}
        spark={multiDay ? <Sparkline values={daily.map(d => d.revenue)} ariaLabel="Receita por dia" /> : undefined}
        info={REVENUE_PER_DAY_INFO}
      />
      <KpiCard
        label="Pedidos por dia"
        value={salesPerDay ? (k.ordersPerDay < 10 ? formatNumber(k.ordersPerDay, 1) : formatCount(k.ordersPerDay)) : dash}
        note={noOrders ? 'nenhum pedido no período' : (
          <span className={s.kpiNote}>ticket médio <b>{formatMoney(k.aov)}</b>{salesPerDay && <> · por dia{perDayDays(k.salesAvgRange, ctx)}</>}</span>
        )}
        spark={multiDay ? <MiniBars values={daily.map(d => d.orders)} color="neu" width={0} height={30} ariaLabel="Pedidos por dia" /> : undefined}
        info={ORDERS_PER_DAY_INFO}
      />
      <KpiCard
        swatch="meta"
        label="Anúncios Meta"
        value={<Money value={k.metaSpend} />}
        note={k.metaSpend > 0
          ? <span className={s.kpiNote}><SpendShare cents={k.metaCents} ledgerCents={lc.meta} />{spendPerDay && <> · <b>{formatMoney(k.metaPerDay)}</b>/dia{k.metaAvgRange && perDayDays(k.metaAvgRange, ctx)}</>}</span>
          : 'nenhum gasto no Meta no período'}
        spark={multiDay && k.metaSpend > 0 ? <Sparkline values={daily.map(d => d.metaSpend)} tone="meta" ariaLabel="Gasto no Meta por dia" /> : undefined}
        delta={!p || underADollar(k.metaSpend, p.metaSpend) ? undefined : <KpiDelta band={band} current={k.metaSpend} previous={p?.metaSpend ?? null} kind="money" />}
        info={META_INFO}
      />
      <KpiCard
        swatch="shop"
        label="Anúncios Shopify"
        value={<Money value={k.shopSpend} />}
        note={k.shopSpend > 0
          ? <span className={s.kpiNote}><SpendShare cents={k.shopCents} ledgerCents={lc.shop} />{k.spanDays > 1 && <> · <b>{k.shopDays}</b> de {k.spanDays} dias com gasto{k.startedOn && <> desde <span className="num">{ctx.dateBeside(k.startedOn)}</span></>}</>}</span>
          : 'nenhum gasto com Shop Campaigns'}
        spark={multiDay && k.shopSpend > 0 ? <MiniBars values={daily.map(d => d.shopSpend)} color="shop" width={0} height={30} ariaLabel="Anúncios Shopify por dia" /> : undefined}
        delta={!p || underADollar(k.shopSpend, p.shopSpend) ? undefined : <KpiDelta band={band} current={k.shopSpend} previous={p?.shopSpend ?? null} kind="money" />}
        info={SHOP_SPEND_INFO}
      />
      <KpiCard
        label="Anúncio por pedido"
        value={<Money value={k.adCostPerOrder} />}
        note={noOrders ? 'sem pedidos para dividir o gasto' : configured && k.leftBeforeAdsPerOrder !== null ? (
          <span className={s.kpiNote}>
            cada pedido deixa <b>{formatMoney(k.leftBeforeAdsPerOrder)}</b> para os anúncios → {k.profitPerOrder !== null && k.profitPerOrder < 0 ? 'faltam' : 'sobram'}{' '}
            <b className={k.profitPerOrder !== null && k.profitPerOrder < 0 ? 'neg' : undefined}>{formatMoney(Math.abs(k.profitPerOrder ?? 0))}</b>
            {ctx.split && ' (loja inteira)'}
          </span>
        ) : <NotConfigured>custos não configurados: não dá para saber quanto sobra</NotConfigured>}
        delta={p && k.adCostPerOrder !== null && <KpiDelta band={band} current={k.adCostPerOrder} previous={p?.adCostPerOrder ?? null} kind="money" lowerIsBetter />}
        info={<>{AD_PER_ORDER_INFO}{' '}
          “Deixa para os anúncios” = (receita − produto − frete − taxas − custos fixos) ÷ pedidos. A diferença entre os dois é o lucro por pedido.</>}
      />
      <KpiCard
        label={ctx.split ? 'Lucro por pedido · sua parte' : 'Lucro por pedido'}
        value={configured && k.profitPerOrder !== null ? <Money value={ctx.part(k.profitPerOrder)} /> : dash}
        tone={!configured || k.profitPerOrder === null ? 'mut' : k.profitPerOrder < 0 ? 'neg' : 'pos'}
        note={!configured
          ? <NotConfigured>custos não configurados</NotConfigured>
          : k.profitPerOrder === null
            ? 'sem pedidos no período'
            : <span className={s.kpiNote}>em {plural(k.orders, 'pedido', 'pedidos')}{ctx.split ? ' · sua parte' : ''}</span>}
        delta={configured && p && k.profitPerOrder !== null && p.profitPerOrder !== null
          ? <KpiDelta band={band} current={ctx.part(k.profitPerOrder)} previous={ctx.part(p.profitPerOrder)} kind="money_result" k={ctx.splitFactor} />
          : undefined}
        info={`${PROFIT_PER_ORDER_INFO}${ctx.split ? ' Na visão de sócio, a sua metade.' : ''}`}
      />
    </Section>
  )
}
