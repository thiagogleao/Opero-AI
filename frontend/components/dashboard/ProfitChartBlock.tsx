/**
 * ProfitChartBlock — profit per day for the period, with the 30 days before
 * it for context (and today, hatched, when the period ends yesterday); for a
 * one-day window, the day's cumulative curve under it. Async server component:
 * it loads the context days itself and streams in <Suspense>.
 *
 * A store without cost settings gets NetSalesBars (revenue − ads, never called
 * profit) and no intraday curve. In the partner split (?parte=50) both charts
 * draw the viewer's share, like the verdict above them (the bars and the
 * intraday curve all get the whole day's numbers plus `share`, so their
 * tooltips show the whole day beside "sua parte" and a margin that is never
 * halved); a series with no sale,
 * no spend and no cost on any day is said in words instead of drawn.
 *
 * An archived store has no running day: nothing is read after its archive
 * day, so today is neither drawn ("hoje $0") nor called "parcial", a window
 * after the archive day (the verdict's `frozen`, ./emptyWindow) says "sem
 * dados" instead of drawing $0 bars, and a window that runs past it draws
 * and judges its days up to the archive day only.
 */

import type { PageContext } from '@/lib/views/page'
import type { StoreSummary } from '@/lib/views/store'
import { chartSeries, chartValue, daysRead, loadProfitTrail, seriesIdle, TRAIL_DAYS, windowDaysSinceStart } from '@/lib/views/store'
import { formatClock, formatMoney, formatRangeLabel, formatWeekdayDate, plural, tzCity, dayOfLabel } from '@/lib/format'
import { Block, EmptyState, ErrorState } from '@/components/ui'
import { DailyProfitBars, DailyProfitLegend, IntradayCurve, IntradayLegend } from '@/components/charts'
import { NetSalesBars, NetSalesLegend } from './NetSalesBars'
import { dateBeside } from '@/components/campaigns/storeStart'
import { emptyWindowText, frozenTailOf, type EmptyWindow } from './emptyWindow'
import s from './dashboard.module.css'

/**
 * Whether a band label fits between the band's first bar and the right edge,
 * on the geometry DailyProfitBars and NetSalesBars share (1000 wide, 56 left
 * and 8 right margins, the label 8 units into the band, about 6 units per
 * character at 11,5px). The word joiner formatMoney glues a sign to its "$"
 * with (lib/format SIGN_JOIN) takes no room: counted, it hid a label that
 * still fit by 6 units or less.
 */
export function bandLabelFits(series: { inWindow: boolean }[], label: string): boolean {
  const first = series.findIndex(d => d.inWindow)
  if (first < 0) return true
  const bar = (1000 - 56 - 8) / Math.max(1, series.length)
  return 56 + first * bar + 8 + label.replace(/\u2060/g, '').length * 6 <= 1000 - 8
}

export async function ProfitChartBlock({ ctx, summary, empty = null, amount }: {
  ctx: PageContext; summary: StoreSummary
  /** The verdict's reason the window is empty (./emptyWindow emptyWindowOf). */
  empty?: EmptyWindow | null
  /** The verdict's amount, as the number band prints it: null = "—" (no sale
   *  and no spend), and the band label then says "—" too, not "$0". */
  amount?: number | null
}) {
  const configured = summary.pnl.configured
  const title = configured ? 'Lucro real por dia' : 'Receita − anúncios por dia'
  const half = ctx.split ? ' (sua parte)' : ''
  const why = empty ? emptyWindowText(empty, ctx.rangeLabel) : null
  // Nothing in the window was read (archived store): no bars at $0, no context to load.
  if (empty?.kind === 'frozen' && why) {
    return (
      <Block title={`${title}${half}`}>
        <EmptyState compact icon="clock" title={why.title}>{why.text}</EmptyState>
      </Block>
    )
  }
  const archived = summary.row.archived
  let trail
  try {
    trail = await loadProfitTrail(summary.store.id, ctx.range, ctx.today, ctx.now)
  } catch (err) {
    console.error('[resumo] profit trail', err)
    return <Block title={title}><ErrorState compact /></Block>
  }

  // The first sale keeps the quiet context days of a store that already sold
  // (lib/views/store chartSeries): "desde que a loja começou" only when it did
  // start inside them. An archived store gets no "today": nothing arrives.
  const after = archived ? [] : trail.after
  // Nor the days after its archive day, which were never read: Squishy
  // World's 30 dias drew $0 bars for 11–23 nov and read "3 de 30 dias no
  // lucro" under a verdict saying those days have no data.
  const archivedOn = archived ? summary.row.archivedOn ?? null : null
  const tailFrom = frozenTailOf(archivedOn, ctx.range)
  const series = daysRead(chartSeries(trail.before, summary.pnl.daily, after, summary.row.firstOrderDate), archivedOn)
  const partialDate = !archived && series.some(d => d.date === ctx.today) && (ctx.partial || after.length) ? ctx.today : null
  const partialNote = `parcial · até ${formatClock(ctx.minutesIntoDay)}`
  const name = summary.store.name
  // The summary line judges closed window days from the store's start on:
  // Hibikura's "Este mês" read "8 de 17" with 1–6 nov, before its first sale.
  const since = windowDaysSinceStart(series, summary.row.firstOrderDate)
  const inWindow = since.days.filter(d => d.date !== partialDate)
  const before = series.filter(d => !d.inWindow && d.date < ctx.range.from)
  const sumBefore = before.reduce((a, d) => a + d.profit, 0)
  const windowIdle = series.filter(d => d.inWindow).every(d => d.orders === 0 && d.revenue === 0 && d.metaSpend === 0 && d.shopSpend === 0)
  const single = ctx.range.from === ctx.range.to

  // Nothing at all to draw (Hibikura and Glooty in October, before either
  // store sold): the bars sat on a $0–$1 axis printed "$0 $0 $0 $0 $1 $1 $1".
  // Say it in words, as the phone does. Context days with activity, or fixed
  // costs on an empty day, still draw the chart.
  if (seriesIdle(series, configured)) {
    return (
      <Block title={`${title}${half}`}>
        {why
          ? <EmptyState compact icon="clock" title={why.title}>{why.text}</EmptyState>
          : <EmptyState compact icon="clock" title={`Nenhuma venda e nenhum gasto em ${ctx.rangeLabel}`} />}
      </Block>
    )
  }
  // The band's label ("16 nov · $239") starts at the band and printed past the
  // chart's right edge when the window is one of the last bars ("Ontem": x
  // 942–1014 of 1000). Then the band keeps its shading without a label: the
  // window's total is the verdict's headline. A non-empty blank selectedLabel
  // suppresses both the range and the sum in DailyProfitBars.
  // An archived store's band ends on its archive day, with its bars.
  const band = tailFrom ? { from: ctx.range.from, to: tailFrom } : ctx.range
  // Both charts draw the viewer's share (lib/views/store chartValue): the
  // verdict halves revenue − ads as well as profit in the split view.
  const bandSum = series.filter(d => d.inWindow)
    .reduce((a, d) => a + chartValue(d, configured, ctx.splitFactor), 0)
  const noAmount = amount === null
  const bandLabel = bandLabelFits(series, `${formatRangeLabel(band, ctx.today)} · ${noAmount ? '—' : formatMoney(bandSum)}`)
    ? noAmount ? `${formatRangeLabel(band, ctx.today)} · —` : undefined
    : ' '

  const footer = configured ? (
    <div className={s.footLinks}>
      <span>
        {windowIdle
          ? why ? `No período, ${why.note}.` : 'Sem vendas nem anúncios no período.'
          : inWindow.length > 1 && (() => {
            const best = inWindow.reduce((a, b) => (b.profit > a.profit ? b : a))
            const worst = inWindow.reduce((a, b) => (b.profit < a.profit ? b : a))
            return <>
              No período{since.startedOn ? `, desde que a loja começou (${dateBeside(since.startedOn, [ctx.range.from, ctx.range.to, ctx.comparison.from, ctx.comparison.to], ctx.today)})` : ''}{tailFrom ? `, até ser arquivada (${dateBeside(tailFrom, [ctx.range.from, ctx.range.to, ctx.comparison.from, ctx.comparison.to], ctx.today)})` : ''}: <b>{inWindow.filter(d => d.profit > 0).length} de {inWindow.length}</b> dias no lucro · melhor {formatWeekdayDate(best.date, ctx.today)}, <b>{formatMoney(ctx.part(best.profit))}</b>
              {' '}· pior {formatWeekdayDate(worst.date, ctx.today)}, <b className={worst.profit < 0 ? 'neg' : undefined}>{formatMoney(ctx.part(worst.profit))}</b>
            </>
          })()}
      </span>
      {before.length > 0 && (
        <span>
          {plural(before.length, 'dia', 'dias')} antes{before.length < TRAIL_DAYS ? ', desde que a loja começou' : ''}
          {' '}({plural(before.filter(d => d.profit > 0).length, 'dia', 'dias')} no lucro): <b className={sumBefore < 0 ? 'neg' : undefined}>{formatMoney(ctx.part(sumBefore))}</b>{half}
        </span>
      )}
    </div>
  ) : (
    <div className={s.footLinks}>
      <span>Sem custos configurados, uma barra acima de zero não quer dizer lucro: o produto, o frete e as taxas ainda sairiam daí.</span>
    </div>
  )

  // Say which context is really drawn: chartSeries drops the days before the
  // store started, so "com os 30 dias antes" over a chart that begins on the
  // window's first day (MOKOO from 1 jan, Glooty's first weeks) promised bars
  // that are not there.
  // One day reads "com o dia antes dele", not "com os 1 dia" (Glooty, 5–10 nov).
  const context = before.length === 0
    ? ''
    : before.length === 1
      ? ', com o dia antes dele, quando a loja começou'
      : before.length < TRAIL_DAYS
        ? `, com os ${plural(before.length, 'dia', 'dias')} antes dele desde que a loja começou`
        : `, com os ${TRAIL_DAYS} dias antes dele para comparar`
  const city = dayOfLabel(ctx.timezone) ? tzCity(ctx.timezone) : null
  // A day with nothing in it (CAMP HALLOW today) drew a flat line on a $0–$1
  // axis labelled "$0 $0 $1 $1 $1"; the footer already says "Sem vendas nem
  // anúncios no período".
  const showCurve = configured && single && !windowIdle && !archived && (summary.pnl.hourly?.length ?? 0) > 0
  const refLabel = ctx.range.from === ctx.today ? 'ontem inteiro' : 'dia anterior inteiro'

  return (
    <Block
      title={`${title}${half}`}
      howTo={configured
        ? `O período escolhido em destaque${context}. Barra acima da linha do zero = dia no lucro; abaixo = dia no prejuízo.`
        : `O período em destaque${context}. Azul = vendeu mais do que gastou em anúncios; coral = gastou mais do que vendeu.`}
      info={configured
        ? <>Lucro real de cada dia no fuso da loja{city ? ` (${city})` : ''}: receita − produto − frete − taxas − Anúncios Meta − Anúncios Shopify − custos fixos do dia.
          A soma dos dias do período é o lucro do veredito. Reembolsos e chargebacks não entram nas barras: aparecem no resultado de caixa.</>
        : 'Receita − Anúncios Meta − Anúncios Shopify de cada dia. A loja não tem custos de produto, frete e taxas configurados.'}
      actions={configured ? <DailyProfitLegend partial={!!partialDate} /> : <NetSalesLegend />}
      footer={footer}
    >
      {configured ? (
        // The WHOLE day's profit plus the share: the chart draws profit × share
        // but its tooltip keeps the whole day's profit and margin beside "sua
        // parte" (a halved profit read "margem 9,5%" for a 19,1% day).
        <DailyProfitBars
          days={series.map(d => ({ date: d.date, profit: chartValue(d, true), revenue: d.revenue, metaSpend: d.metaSpend, shopSpend: d.shopSpend, orders: d.orders }))}
          share={ctx.splitFactor}
          selected={band}
          selectedLabel={bandLabel}
          partialDate={partialDate}
          partialNote={partialNote}
          today={ctx.today}
          ariaLabel={`Lucro real por dia da ${name}: ${ctx.rangeLabel} em destaque${context}`}
        />
      ) : (
        <NetSalesBars
          days={series.map(d => ({ date: d.date, value: chartValue(d, false), revenue: d.revenue, adSpend: d.metaSpend + d.shopSpend, orders: d.orders }))}
          share={ctx.splitFactor}
          selected={band}
          selectedLabel={bandLabel}
          partialDate={partialDate}
          partialNote={partialNote}
          today={ctx.today}
          ariaLabel={`Receita menos anúncios por dia da ${name}: ${ctx.rangeLabel} em destaque${context}`}
        />
      )}
      {showCurve && (
        <div className={s.intraday}>
          <div className={s.intradayHead}>
            <h4>{ctx.partial ? 'Como o dia está andando' : 'Como o dia andou'}{half}</h4>
            <IntradayLegend reference={trail.reference ? refLabel : undefined} now={ctx.partial} />
          </div>
          <IntradayCurve
            points={summary.pnl.hourly ?? []}
            share={ctx.splitFactor}
            nowMinutes={ctx.partial ? summary.pnl.minutesCovered : null}
            reference={trail.reference ? { points: trail.reference, label: refLabel } : null}
            tzNote={city ? ` · ${city}` : undefined}
            width={1000}
            height={230}
            ariaLabel={`Lucro acumulado hora a hora da ${name} em ${ctx.rangeLabel}`}
          />
        </div>
      )}
    </Block>
  )
}
