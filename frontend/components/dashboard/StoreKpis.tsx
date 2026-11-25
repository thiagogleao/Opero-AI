/**
 * StoreKpis — the Resumo's key numbers, each with a one-line note under it and
 * the full definition in the ⓘ. Server component; every value comes from the
 * same engine pass as the verdict (lib/views/store StoreSummary).
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
import { CHANNEL_LABEL, daysRead, empateGap, ledgerAdCents, MINOR_CHANNEL_SHARE, type StoreSummary } from '@/lib/views/store'
import type { ComparisonWindow } from '@/lib/views/verdict'
import { formatCents, formatCount, formatMoney, formatNumber, formatPct, formatRangeLabel, formatRoas, plural } from '@/lib/format'
import { Count, Delta, Icon, KpiCard, Money, Pct, Roas, type DeltaProps } from '@/components/ui'
import { MiniBars, Sparkline } from '@/components/charts'
import { RoasVsEmpate } from './RoasVsEmpate'
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

/** A KPI's delta pill: may wrap inside its card (a cut comparison with the
 *  previous value, "▲ 20,0 p.p. vs 1–24 out até 00h33 (−12,6%)", is wider
 *  than a 4-column card at 1440), with the full comparison on hover. */
function KpiDelta({ vs, ...rest }: Omit<DeltaProps, 'className' | 'label'> & { vs: KpiComparisonLabel }) {
  return <span title={vs.full}><Delta {...rest} label={vs.short} className={s.kpiDelta} /></span>
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

// Revenue and orders per day start at the first sale; spend per day at the
// store's start, which an ad before the first sale moves earlier (Glooty:
// ads from 4 nov, first order on 6 nov). Each ⓘ says which days it divides by.
const SALES_PER_DAY_INFO = 'Média por dia: só os dias fechados desde a primeira venda da loja; o dia de hoje, ainda em andamento, fica de fora.'
const SPEND_PER_DAY_INFO = 'Média por dia: só os dias fechados desde que a loja começou (a primeira venda ou o primeiro anúncio, o que veio antes: anúncio antes da primeira venda é gasto de verdade); o dia de hoje, ainda em andamento, fica de fora.'

/** "10%": the share under which a second ad channel stays out of the ROAS (lib/views/adChannel). */
const MINOR_PCT = formatPct(MINOR_CHANNEL_SHARE * 100, { digits: 0 })

function NotConfigured({ children }: { children: ReactNode }) {
  return <span className={s.cfg}><Icon name="sliders" size={12} />{children}</span>
}

/** The grid when the window has nothing in it for a reason other than "no
 *  sales": the same cards and definitions, "—" for every number, the reason
 *  under each, and no delta (there is nothing to compare). */
function EmptyKpis({ note }: { note: string }) {
  const dash = <span className="mut">—</span>
  return (
    <div className={s.kpis}>
      <KpiCard label="Receita" value={dash} note={note}
        info={`Total pago pelos clientes nos pedidos não reembolsados nem cancelados, com impostos e frete, nas datas do fuso da loja. ${SALES_PER_DAY_INFO}`} />
      <KpiCard label="Pedidos e ticket" value={dash} note={note}
        info={`Pedidos pagos no período (reembolsados e cancelados não entram). Ticket médio = receita ÷ pedidos. ${SALES_PER_DAY_INFO}`} />
      <KpiCard wide label="ROAS × empate" value={dash} note={note}
        info="ROAS = receita da loja ÷ gasto em anúncios. Empate = receita ÷ (receita − produto − frete − taxas): o ROAS em que os anúncios comem toda a margem." />
      <KpiCard swatch="meta" label="Anúncios Meta" value={dash} note={note}
        info={`Gasto em Facebook e Instagram das contas de anúncio da loja, dia a dia. ${SPEND_PER_DAY_INFO}`} />
      <KpiCard swatch="shop" label="Anúncios Shopify" value={dash} note={note}
        info="Shop Campaigns, cobrados na fatura da Shopify, fora do Meta. Entram no lucro como custo próprio e nunca no ROAS do Meta." />
      <KpiCard label="Anúncio por pedido" value={dash} note={note}
        info="(Anúncios Meta + Anúncios Shopify) ÷ pedidos da loja — todos os pedidos, não só os que o Meta atribui a si." />
      <KpiCard label="Margem e lucro por pedido" value={dash} tone="mut" note={note}
        info="Margem = lucro real ÷ receita: quantos centavos de cada dólar vendido sobram depois de todos os custos. Lucro por pedido = lucro real ÷ pedidos." />
    </div>
  )
}

export function StoreKpis({ ctx, summary, empty = null }: {
  ctx: PageContext; summary: StoreSummary
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
  const vs = comparisonShort(ctx, summary.view.comparison)
  const noOrders = k.orders === 0
  const lc = ledgerAdCents(summary.pnl.totals, configured)
  const gap = empateGap(configured, k.breakEven, summary.pnl.totals)
  // Two closed days at least: one day's "average" is just that day.
  const salesPerDay = k.salesAvgDays > 1
  const spendPerDay = k.avgDays > 1

  return (
    <div className={s.kpis}>
      <KpiCard
        label="Receita"
        value={<Money value={k.revenue} />}
        note={noOrders
          ? 'nenhum pedido no período'
          : salesPerDay
            ? <span className={s.kpiNote}><b>{formatMoney(k.revenuePerDay)}</b> por dia{perDayDays(k.salesAvgRange, ctx)}</span>
            : 'pedidos pagos, impostos incluídos'}
        spark={multiDay ? <Sparkline values={daily.map(d => d.revenue)} ariaLabel="Receita por dia" /> : undefined}
        delta={p && !(k.revenue === 0 && p.revenue === 0) && <KpiDelta current={k.revenue} previous={p?.revenue ?? null} vs={vs} goodWhen="neutral" showPrevious />}
        info={<>Total pago pelos clientes nos pedidos não reembolsados nem cancelados, com impostos e frete, nas datas do fuso da loja.
          Um pedido reembolsado por inteiro sai do dia em que foi feito. Vendas em outra moeda entram convertidas em dólar. {SALES_PER_DAY_INFO}</>}
      />
      <KpiCard
        label="Pedidos e ticket"
        value={<Count value={k.orders} />}
        note={noOrders ? 'nenhum pedido no período' : (
          <span className={s.kpiNote}>ticket médio <b>{formatMoney(k.aov)}</b>{salesPerDay && <> · <b>{k.ordersPerDay < 10 ? formatNumber(k.ordersPerDay, 1) : formatCount(k.ordersPerDay)}</b> por dia{perDayDays(k.salesAvgRange, ctx)}</>}</span>
        )}
        spark={multiDay ? <MiniBars values={daily.map(d => d.orders)} color="neu" width={0} height={30} ariaLabel="Pedidos por dia" /> : undefined}
        delta={p && !(k.orders === 0 && p.orders === 0) && <KpiDelta current={k.orders} previous={p?.orders ?? null} vs={vs} kind="count" goodWhen="neutral" showPrevious />}
        info={`Pedidos pagos no período (reembolsados e cancelados não entram). Ticket médio = receita ÷ pedidos. ${SALES_PER_DAY_INFO}`}
      />
      <KpiCard
        wide
        swatch={k.roasChannel === 'shop' ? 'shop' : k.roasChannel ? 'meta' : undefined}
        // No spend at all: no channel to name ("ROAS do Meta" over a store with no ads).
        label={k.roasChannel === 'both' ? 'ROAS dos anúncios (Meta + Shopify) × empate' : k.roasChannel === 'shop' ? 'ROAS dos Anúncios Shopify × empate' : k.roasChannel === 'meta' ? 'ROAS do Meta × empate' : 'ROAS × empate'}
        value={k.channelRoas === null ? <span className="mut">—</span> : <Roas value={k.channelRoas} />}
        note={k.channelRoas === null || !k.roasChannel
          ? 'sem gasto em anúncios no período'
          : (
            <span className={s.kpiWords}>
              Cada $1 em {k.roasChannel === 'both' ? 'anúncios (Meta e Shopify somados)' : CHANNEL_LABEL[k.roasChannel]} trouxe{' '}
              <b className="num">{formatMoney(k.channelRoas, { cents: 'always' })}</b> em vendas da loja (todas as vendas, não só as atribuídas).
              {k.roasChannel === 'both' && k.metaRoas !== null && <> Só o Meta: <b className="num">{formatRoas(k.metaRoas)}</b>, que credita ao Meta também as vendas dos Anúncios Shopify.</>}
              {k.roasChannel === 'meta' && k.shopSpend > 0 && <> Os <b className="num">{formatMoney(k.shopSpend)}</b> de Anúncios Shopify ficam fora deste ROAS (menos de {MINOR_PCT} do gasto em anúncios) e entram no lucro.</>}
              {k.roasChannel === 'shop' && k.metaSpend > 0 && <> Os <b className="num">{formatMoney(k.metaSpend)}</b> de Meta ficam fora deste ROAS (menos de {MINOR_PCT} do gasto em anúncios) e entram no lucro.</>}
            </span>
          )}
        spark={k.channelRoas !== null && k.roasChannel
          ? <RoasVsEmpate roas={k.channelRoas} breakEven={k.breakEven} gap={gap} label={k.roasChannel === 'both' ? 'ROAS dos anúncios' : `ROAS ${CHANNEL_LABEL[k.roasChannel]}`} />
          : undefined}
        footnote={p?.channelRoas != null ? <span title={vs.full}>{vs.short}: {formatRoas(p.channelRoas)}</span> : undefined}
        // The rule actually applied (lib/views/adChannel adChannelOf): MOKOO's
        // $194 of Shopify ads next to $5.931 of Meta stay out, and the ⓘ said
        // "é o gasto dos dois somado" over a Meta-only number.
        info={<>ROAS = receita da loja ÷ gasto em anúncios. Com um só canal gastando, é esse canal. Com Meta e Anúncios Shopify gastando,
          é o gasto dos dois somado, porque dividir a receita só pelo Meta daria ao Meta as vendas que os Anúncios Shopify trouxeram.
          A exceção: um canal com menos de {MINOR_PCT} do gasto em anúncios fica fora do ROAS, que passa a ser o do outro canal, e entra só no lucro.
          Empate = receita ÷ (receita − produto − frete − taxas): o ROAS em que os anúncios comem toda a margem. Acima dele, os anúncios deixam lucro
          antes dos custos fixos. Sem custos configurados, o empate é desconhecido.</>}
      />
      <KpiCard
        swatch="meta"
        label="Anúncios Meta"
        value={<Money value={k.metaSpend} />}
        note={k.metaSpend > 0
          ? <span className={s.kpiNote}><SpendShare cents={k.metaCents} ledgerCents={lc.meta} />{spendPerDay && <> · <b>{formatMoney(k.metaPerDay)}</b>/dia{k.metaAvgRange && perDayDays(k.metaAvgRange, ctx)}</>}</span>
          : 'nenhum gasto no Meta no período'}
        spark={multiDay && k.metaSpend > 0 ? <Sparkline values={daily.map(d => d.metaSpend)} tone="meta" ariaLabel="Gasto no Meta por dia" /> : undefined}
        delta={!p || underADollar(k.metaSpend, p.metaSpend) ? undefined : <KpiDelta current={k.metaSpend} previous={p?.metaSpend ?? null} vs={vs} goodWhen="neutral" showPrevious />}
        info={`Gasto em Facebook e Instagram das contas de anúncio da loja, dia a dia. Uma conta desligada deixa de ser coletada, mas o gasto que já teve continua nas contas. ${SPEND_PER_DAY_INFO}`}
      />
      <KpiCard
        swatch="shop"
        label="Anúncios Shopify"
        value={<Money value={k.shopSpend} />}
        note={k.shopSpend > 0
          ? <span className={s.kpiNote}><SpendShare cents={k.shopCents} ledgerCents={lc.shop} />{k.spanDays > 1 && <> · <b>{k.shopDays}</b> de {k.spanDays} dias com gasto{k.startedOn && <> desde <span className="num">{ctx.dateBeside(k.startedOn)}</span></>}</>}</span>
          : 'nenhum gasto com Shop Campaigns'}
        spark={multiDay && k.shopSpend > 0 ? <MiniBars values={daily.map(d => d.shopSpend)} color="shop" width={0} height={30} ariaLabel="Anúncios Shopify por dia" /> : undefined}
        delta={!p || underADollar(k.shopSpend, p.shopSpend) ? undefined : <KpiDelta current={k.shopSpend} previous={p?.shopSpend ?? null} vs={vs} goodWhen="neutral" showPrevious />}
        info="Shop Campaigns, cobrados na fatura da Shopify, fora do Meta. Entram no lucro como custo próprio e nunca no ROAS do Meta."
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
        delta={p && k.adCostPerOrder !== null && <KpiDelta current={k.adCostPerOrder} previous={p?.adCostPerOrder ?? null} vs={vs} goodWhen="down" showPrevious />}
        info={<>(Anúncios Meta + Anúncios Shopify) ÷ pedidos da loja — todos os pedidos, não só os que o Meta atribui a si.
          “Deixa para os anúncios” = (receita − produto − frete − taxas − custos fixos) ÷ pedidos. A diferença entre os dois é o lucro por pedido.</>}
      />
      <KpiCard
        label="Margem e lucro por pedido"
        value={configured ? <Pct value={k.margin} /> : <span className="mut">—</span>}
        tone={!configured || k.margin === null ? 'mut' : k.margin < 0 ? 'neg' : 'pos'}
        note={!configured
          ? <NotConfigured>custos não configurados</NotConfigured>
          : k.profitPerOrder === null
            ? 'sem pedidos no período'
            : <span className={s.kpiNote}><b className={k.profitPerOrder < 0 ? 'neg' : undefined}>{formatMoney(ctx.part(k.profitPerOrder))}</b> de lucro por pedido{ctx.split ? ' · sua parte' : ''}</span>}
        // No margin this window (no orders): a delta would only print "sem comparação".
        delta={configured && p && k.margin !== null ? <KpiDelta current={k.margin} previous={p.margin} vs={vs} kind="pct" showPrevious /> : undefined}
        info={<>Margem = lucro real ÷ receita: quantos centavos de cada dólar vendido sobram depois de todos os custos (não muda na visão de sócio).
          Lucro por pedido = lucro real ÷ pedidos{ctx.split ? '; na visão de sócio, a sua metade' : ''}. {plural(k.orders, 'pedido', 'pedidos')} no período.</>}
      />
    </div>
  )
}
