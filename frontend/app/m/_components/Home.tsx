'use client'

/**
 * The blocks of the phone's home screen, all drawn from one GET /api/mobile
 * answer (lib/views/portfolio PortfolioView) and the verdict built from it.
 * Every rendering decision reads the ANSWER (its request, its stores), never
 * the selection: while a new store loads, the old answer is still described
 * as what it is.
 */

import { useState } from 'react'
import {
  Avatar, Badge, Block, BreakdownLedger, Button, Callout, Chip, EmptyState, Icon, Money, VerdictCard, VerdictChips,
} from '@/components/ui'
import { DailyProfitBars, DailyProfitLegend, IntradayCurve, IntradayLegend } from '@/components/charts'
import {
  dayOfLabel, formatClock, formatCount, formatDate, formatMoney, formatPct, formatRangeLabel, formatRelativeTime,
  formatTimeInTz, formatWeekdayDate, partialLabel, plural, tzCity,
} from '@/lib/format'
import { minutesIntoDay, todayInTz } from '@/lib/engine/dates'
import {
  comparisonCut, disputeReasonText, judgedStores, noSalesCashHit, notSellingYet, periodPhrase, storeRoas, storeStatus, storeStatusChips,
  type RoasSummary, type Verdict,
} from '@/lib/views/verdict'
import type { MobileResponse } from '@/lib/views/mobile'
import type { IntradayAside, LiveOrderItem, PortfolioStoreRow } from '@/lib/views/portfolio'
import { LIVE_FEED_SIZE } from '@/lib/views/portfolioLimits'
import { dateBeside } from '@/components/campaigns/storeStart'
import { clockDiffers, rowOpensDates, storeRowSelection, tzOffsetMinutes, type Selection } from '../_lib/selection'
import { noSpendLine, pairNotes, type SharedAds } from '../_lib/sharedAds'
import { dueByLabel, feedLine, liveFeedSpeed } from '../_lib/labels'
import { NetBars, NetBarsLegend } from './NetBars'
import s from '../m.module.css'

type Data = MobileResponse

const isAllAnswer = (d: Data) => d.request.store === 'all'
const active = (r: PortfolioStoreRow) => r.totals.orders > 0 || r.totals.revenue > 0 || r.totals.adSpend > 0

/** "Dumpling Squishy · 8jcp3a" → ["Dumpling Squishy", "8jcp3a"]. */
export function splitName(name: string): [string, string | null] {
  const i = name.lastIndexOf(' · ')
  return i > 0 ? [name.slice(0, i), name.slice(i + 3)] : [name, null]
}

export function StoreName({ name }: { name: string }) {
  const [main, code] = splitName(name)
  return <>{main}{code && <> <small>{code}</small></>}</>
}

// ─── Clock banner (one store on another clock) ────────────────────────────────

export function ClockBanner({ tz, deviceTz, now }: { tz: string; deviceTz: string; now: number }) {
  if (!now) return null
  const at = new Date(now)
  if (!clockDiffers(tz, deviceTz, at)) return null
  const diff = tzOffsetMinutes(tz, at) - tzOffsetMinutes(deviceTz, at)
  const hours = Math.round(Math.abs(diff) / 60)
  const turnedAt = ((-diff % 1440) + 1440) % 1440
  const city = tzCity(tz)
  return (
    <div className={s.clock} role="note">
      <Icon name="clock" size={18} />
      <div>
        <b>Dia de {city} · {formatWeekdayDate(todayInTz(tz, at))} · {formatTimeInTz(at, tz)}</b>
        <span>
          {city} está {hours} h {diff > 0 ? 'à frente' : 'atrás'} deste aparelho: o dia da loja vira às {formatClock(turnedAt)} daqui.
          “Hoje” é o dia de {city}.
        </span>
      </div>
    </div>
  )
}

// ─── Verdict + ledger ─────────────────────────────────────────────────────────

export function VerdictBlock({ data, v }: { data: Data; v: Verdict }) {
  const t = v.totals
  const cmp = v.comparisonTotals
  // A window of several days ending today is compared with the earlier days
  // whole and the last one cut at this hour: the cell says where it stops
  // ("10 dias anteriores · até 04h16 de 9 nov"), as the verdict does.
  const cut = comparisonCut(data.comparison, data.anchorToday)
  const cmpLabel = (data.comparison.label === 'ontem até esta hora' ? 'Ontem até esta hora' : data.comparison.label.replace(/^./, c => c.toUpperCase()))
    + (cut ? ` · ${cut}` : '')
  // The whole window is before the first sale: no "$0 · 0 pedidos" beside a
  // verdict that says the store (or every store) was not selling yet.
  const notYet = v.beforeStart ?? null
  // An archived store's window after its archive day has no data: no "$0".
  const frozen = v.frozen ?? null
  const several = data.stores.length > 1
  return (
    <VerdictCard
      verdict={v}
      compact
      headingLevel="h1"
      footer={
        <div className={s.pair}>
          <div className={s.pairCell}>
            <small>Vendas</small>
            {notYet ? (
              <><b className="mut">—</b><em>{several ? 'ainda não vendiam' : 'ainda não vendia'}</em></>
            ) : frozen ? (
              <><b className="mut">—</b><em>sem dados: loja arquivada</em></>
            ) : (
              <>
                <b>{formatMoney(t.revenue)}</b>
                <em>{plural(t.orders, 'pedido', 'pedidos')}</em>
              </>
            )}
          </div>
          <div className={s.pairCell}>
            <small>{cmpLabel}</small>
            {cmp && (cmp.orders > 0 || cmp.adSpend > 0) ? (
              <>
                <b className={cmp.operatingProfit < 0 ? 'neg' : undefined}>{formatMoney(cmp.operatingProfit)}</b>
                {/* "−$40,77 de lucro" read as a contradiction. */}
                <em>{v.basis === 'revenue_minus_ads' ? 'vendas − anúncios' : cmp.operatingProfit < 0 ? 'de prejuízo' : 'de lucro'} · {formatMoney(cmp.revenue)} em vendas</em>
              </>
            ) : (
              <><b className="mut">—</b><em>sem vendas para comparar</em></>
            )}
          </div>
        </div>
      }
      aside={
        <BreakdownLedger
          pnl={t}
          configured={v.basis !== 'revenue_minus_ads'}
          title="Para onde foi cada dólar"
          // Nothing sold: there is no dollar to split, so no "0¢ Meta" bar either.
          bar={t.revenue > 0}
          sub={t.revenue > 0
            ? `De cada $1,00 vendido em ${data.rangeLabel}${v.excluded.length ? `, sem ${v.excluded.map(e => e.name).join(' e ')} (sem custos)` : ''}`
            // Nothing sold and nothing spent: the ledger's own empty state says it.
            : t.adSpend > 0 ? `Nenhuma venda em ${data.rangeLabel}${v.excluded.length ? ` (sem ${v.excluded.map(e => e.name).join(' e ')}, sem custos)` : ''}` : undefined}
          // Before the first sale the generic "Sem vendas no período" would read
          // as a dead window; say why it is empty, as the desktop Resumo does.
          emptyTitle={notYet ? (several ? 'As lojas ainda não vendiam' : 'A loja ainda não vendia') : frozen ? 'Sem dados neste período' : undefined}
          emptyText={notYet
            ? `${several ? 'A primeira venda foi' : `A ${data.stores[0]?.name ?? 'loja'} começou a vender`} em ${notYet.text}: escolha um período a partir dessa data.`
            : frozen ? `A loja está arquivada${frozen.text ? ` desde ${frozen.text}` : ''} e não sincroniza mais: nada é lido depois disso.` : undefined}
        />
      }
    />
  )
}

// ─── Shared ad accounts (CAMP HALLOW on EPOCH's account) ──────────────────────

/** The pair notes under the verdict, from the answer on screen (its stores,
 *  its range): Todas names every pair; one store the pairs it is in. */
export function SharedAdsNotes({ data, shared, onAll }: { data: Data; shared: SharedAds; onAll: () => void }) {
  if (!shared.pairs.length || !data.stores.length) return null
  const all = isAllAnswer(data)
  const ordersOf = (id: string) => data.stores.find(r => r.id === id)?.totals.orders ?? null
  const notes = pairNotes(shared, { all, storeId: all ? null : data.stores[0].id }, data.rangeLabel, ordersOf,
    { range: data.range, today: data.anchorToday, alsoShown: [data.comparison.from, data.comparison.to] })
  if (!notes.length) return null
  return (
    <div className={s.stack} role="region" aria-label="Contas de anúncio compartilhadas">
      {notes.map(n => (
        <Callout key={n.key} tone={n.tone} icon="swap" title={n.title}>
          {n.body}
          {!all && <> <Button size="sm" variant="ghost" icon="arrowRight" onClick={onAll}>Ver as lojas juntas</Button></>}
        </Callout>
      ))}
    </div>
  )
}

/** "ROAS 1,95× · empate 1,53×" for a store row, on the store's ad channel
 *  (lib/views/adChannel), named when it is not Meta. */
function rowRoas(r: RoasSummary): string {
  const name = r.channel === 'shop' ? 'ROAS Shopify' : r.channel === 'both' ? 'ROAS dos anúncios' : 'ROAS'
  return r.text.replace(/^ROAS/, name).replace(/ → .*$/, '')
}

// ─── Day curve (single-day windows) ───────────────────────────────────────────

export function DayBlock({ data }: { data: Data }) {
  const day = data.intraday
  if (!day) return null
  const plotted = new Set(day.stores.map(st => st.storeId))
  const rows = data.stores.filter(r => plotted.has(r.id))
  // An archived store is not synced: its current day never fills in, so there
  // is no day to follow (Squishy World read "Nenhuma venda e nenhum gasto até
  // agora" under a live title). The verdict above says why.
  if (rows.length > 0 && rows.every(r => r.archived && r.partial)) return null
  const runningRows = rows.filter(r => r.partial)
  const running = runningRows.length > 0
  const one = rows.length === 1 ? rows[0] : null
  // Hour h is hour h of EACH store's own day, so the curve runs as far as the
  // store furthest into its day (Hibikura at 15h in Tokyo while Brazil is at
  // 03h). Cutting it at Brazil's clock hid Tokyo's afternoon and drew a jump
  // from the 03h value straight to the headline.
  const ahead = running ? runningRows.reduce((a, r) => (r.minutesCovered > a.minutesCovered ? r : a)) : null
  const behind = running ? runningRows.reduce((a, r) => (r.minutesCovered < a.minutesCovered ? r : a)) : null
  const nowMinutes = ahead ? ahead.minutesCovered : null
  const clocksApart = !!ahead && !!behind && ahead.minutesCovered - behind.minutesCovered >= 60
  const leaders = clocksApart ? runningRows.filter(r => r.minutesCovered - behind!.minutesCovered >= 60) : []
  // The dashed level: the plotted stores only, so it compares like with like
  // (a store whose day closed is not on the curve and not in the level).
  const sameTime = data.comparison.sameTimeOfDay && data.period === 'today'
  const cmpRows = rows.filter(r => r.comparison.included)
  const reference = sameTime && cmpRows.length
    ? { value: cmpRows.reduce((sum, r) => sum + r.comparison.totals.operatingProfit, 0), label: 'ontem até esta hora' }
    : null
  const tzLabel = one ? dayOfLabel(one.timezone) : null
  // No store on the curve has cost settings (Glooty alone): the curve is
  // revenue − ads, and every word around it must say so.
  const netOnly = rows.length > 0 && rows.every(r => !r.configured)
  const unconfigured = netOnly ? rows.filter(active) : []
  // In a sum, a store without costs is out of the curve as it is out of the
  // verdict (lib/views/portfolio unconfiguredStores): folded in as revenue −
  // ads, it ended the curve $64 under the verdict on 14 nov.
  const leftOut = day.unconfiguredStores.filter(asideActive)
  const title = data.period === 'today' || running ? 'Como o dia está andando' : `Como foi ${formatDate(day.day, data.anchorToday)}`
  // No sale and no spend on the curve's stores: a flat line on a "$0 $0 $1"
  // axis is the fake $0 the design forbids.
  const quiet = day.points.length > 0 && rows.length > 0 && rows.every(r => !active(r))
  const what = netOnly ? 'Vendas − anúncios acumuladas hora a hora' : 'Lucro acumulado hora a hora'

  return (
    <Block
      title={title}
      howTo={quiet || day.points.length === 0 ? undefined
        : reference ? `${what}; o tracejado é ${netOnly ? 'o mesmo número' : 'o lucro'} de ontem até esta hora.` : `${what}.`}
      info={netOnly
        ? 'Cada venda entra com o seu valor na hora em que aconteceu; os anúncios do dia são rateados pelas horas. Não é lucro: a loja não tem custos de produto, frete e taxas configurados.'
        : 'Cada venda entra com a sua margem na hora em que aconteceu; anúncios e custos fixos do dia são rateados pelas horas. A curva é uma estimativa; o valor da última hora é exato.'}
      infoLabel="Como a curva é feita"
    >
      {day.points.length === 0 ? (
        <EmptyState compact icon="clock" title="Nenhuma loja com o dia em andamento">
          {day.closedStores.length ? 'As lojas abaixo já fecharam o dia no fuso delas.' : null}
        </EmptyState>
      ) : quiet ? (
        <EmptyState compact icon="clock" title={running ? 'Nenhuma venda e nenhum gasto até agora' : `Nenhuma venda e nenhum gasto em ${formatDate(day.day, data.anchorToday)}`} />
      ) : (
        <div className={s.stack}>
          <div className={s.chartWrap}>
            <IntradayCurve
              points={day.points}
              nowMinutes={nowMinutes}
              nowLabel={clocksApart ? `${tzCity(ahead!.timezone)} · ${formatClock(ahead!.minutesCovered)}` : undefined}
              referenceValue={reference}
              tzNote={tzLabel ? ` · ${tzCity(one!.timezone)}` : ''}
              width={340}
              height={200}
              ariaLabel={`${what} em ${formatDate(day.day, data.anchorToday)}${one ? ` na ${one.name}` : ''}${netOnly ? ': sem custos configurados, não é lucro' : ''}`}
            />
          </div>
          {netOnly ? (
            // IntradayLegend says "lucro acumulado" (components/charts): its
            // words do not fit a curve without costs.
            <div className={s.netLegend}>
              <span><i className={s.netLgPos} />vendas − anúncios acumuladas</span>
              <span><i className={s.netLgNeg} />abaixo de zero</span>
              {reference && <span>tracejado: {reference.label}</span>}
            </div>
          ) : (
            <IntradayLegend reference={reference?.label} now={nowMinutes !== null} />
          )}
          <p className={s.note}>
            {day.peak && day.peak.profit > 0 && <>Pico de <b>{formatMoney(day.peak.profit)}</b> às {String(day.peak.hour).padStart(2, '0')}h. </>}
            {day.greenSince !== null && day.greenSince > 0 && <>{netOnly ? 'Acima de zero' : 'No azul'} desde as {String(day.greenSince).padStart(2, '0')}h. </>}
            {/* "Ainda" only while the day runs: a closed day (Glooty, 14 nov) ended there. */}
            {day.greenSince === null && day.closing < 0 && <>{running ? 'Ainda abaixo de zero. ' : 'Fechou abaixo de zero. '}</>}
            {!one && 'Hora h é a hora h do dia de cada loja.'}
          </p>
          {clocksApart && (
            <p className={s.note}>
              {/* The other stores are still on the curve, frozen at their last hour
                  (combineIntraday): "só tem Hibikura" read as if they had dropped out. */}
              Depois das {formatClock(behind!.minutesCovered)} só {leaders.map(r => r.name).join(' e ')} {leaders.length > 1 ? 'movem' : 'move'} a curva:{' '}
              {leaders.length > 1 ? 'já estão' : 'já está'} às {formatClock(ahead!.minutesCovered)} no {leaders.length > 1 ? 'fuso delas' : `dia de ${tzCity(ahead!.timezone)}`}.
              As outras lojas ainda não chegaram nessa hora e entram com o último valor delas.
            </p>
          )}
          {unconfigured.length > 0 && (
            <p className={s.note}>Sem custos configurados: a curva acima de zero não quer dizer lucro.</p>
          )}
        </div>
      )}
      {leftOut.length > 0 && <LeftOutNote stores={leftOut} running={running} />}
      {day.closedStores.map(c => (
        <Callout key={c.storeId} tone="info" icon="clock" title={`${c.name}: dia de ${tzCity(c.timezone)} já fechado`}>
          Fora da curva. {formatDate(day.day, data.anchorToday)} inteiro em {tzCity(c.timezone)}: {plural(c.orders, 'pedido', 'pedidos')},{' '}
          {formatMoney(c.revenue)} em vendas e <ClosedDayResult value={c.operatingProfit} configured={data.stores.find(r => r.id === c.storeId)?.configured !== false} />.
          {' '}Lá já é {formatDate(c.storeToday, data.anchorToday)}.
        </Callout>
      ))}
      {day.notStartedStores.map(c => (
        <Callout key={c.storeId} tone="neu" icon="clock" title={`${c.name}: dia ainda não começou`}>
          Em {tzCity(c.timezone)} ainda não é {formatDate(day.day, data.anchorToday)}.
        </Callout>
      ))}
    </Block>
  )
}

const asideActive = (a: IntradayAside) => a.orders > 0 || a.revenue > 0 || a.adSpend > 0

/** "$120 de lucro" / "$251 de prejuízo" for a closed store day, as the
 *  verdict's pair cell words it ("−$251 de lucro" read as a contradiction);
 *  a store without costs keeps the signed "vendas − anúncios". */
function ClosedDayResult({ value, configured }: { value: number; configured: boolean }) {
  if (!configured) return <><Money value={value} /> de vendas − anúncios</>
  return value < 0 ? <><Money value={-value} tone="neg" /> de prejuízo</> : <><Money value={value} /> de lucro</>
}

/** "Glooty fica fora da curva…": a store without costs, beside the summed
 *  curve with its revenue − ads in words, never inside it as profit. */
function LeftOutNote({ stores, running }: { stores: IntradayAside[]; running: boolean }) {
  return (
    <p className={s.note} style={{ marginTop: 8 }}>
      {joinNames(stores.map(a => a.name))} {stores.length > 1 ? 'ficam' : 'fica'} fora da curva, como do número do topo: sem custos configurados.
      {stores.map(a => (
        <span key={a.storeId}>
          {' '}{stores.length > 1 ? `${a.name}: v` : 'V'}endas {formatMoney(a.revenue)} − anúncios {formatMoney(a.adSpend)} ={' '}
          <Money value={a.revenue - a.adSpend} />{running ? ' até agora' : ''}, antes do custo dos produtos.
        </span>
      ))}
    </p>
  )
}

// ─── Daily bars (several days) ────────────────────────────────────────────────

export function DailyBlock({ data }: { data: Data }) {
  if (data.range.from === data.range.to) return null
  // A lone archived store's days after its archive day were never read
  // (frozenTailOf, the verdict's frozenTail): no $0 bars for them, as on the
  // desktop Resumo — Squishy World's 30 dias drew 11–23 nov at $0 under "não
  // há dados dos dias seguintes". Nor a hatched "today": nothing arrives.
  const readTo = frozenTailOf(data)
  const partialDay = !readTo && data.range.to >= data.anchorToday ? data.anchorToday : undefined
  const minutes = minutesIntoDay(data.anchorTimezone, new Date(data.generatedAt))
  // The bars follow the verdict above them: in a sum, a store without costs
  // is left out (its revenue − ads is not profit), so the bars add up to the
  // big number. A store judged alone without costs is drawn as revenue − ads.
  const days = readTo ? data.dailyJudged.filter(d => d.date <= readTo) : data.dailyJudged
  const { judged, excluded } = judgedStores(data.stores)
  const leftOut = excluded.filter(active)
  // Every store the bars are made of lacks cost settings (Glooty alone): the
  // bars are revenue − ads, so nothing on this block may call them profit —
  // not the title, not the ⓘ, not the legend, not the bar colour.
  const netOnly = judged.length > 0 && judged.every(r => !r.configured)
  const title = netOnly ? 'Vendas − anúncios por dia' : 'Lucro real por dia'
  // A window with no sale and no spend at all (an archived store, a store
  // that had not opened yet) drew a flat chart on a "$0 $0 $1 $1" axis.
  const empty = days.every(d => d.orders === 0 && d.revenue === 0 && d.metaSpend === 0 && d.shopSpend === 0 && d.operatingProfit === 0)
  if (empty) {
    // An archived store's window after its archive day was never read, and a
    // window before the first sale had nothing to read: no sales is not what
    // happened (as the verdict says).
    return (
      <Block title={title}>
        <EmptyState compact icon="clock" title={notYetTitle(data) ?? frozenTitle(data) ?? `Nenhuma venda e nenhum gasto em ${readSpan(data)}`} />
      </Block>
    )
  }
  const names = joinNames(judged.map(r => r.name))
  return (
    <Block
      title={title}
      howTo={netOnly
        ? 'Azul = vendeu mais do que gastou em anúncios; coral = gastou mais do que vendeu. Toque numa barra para ver o dia.'
        : 'Barra acima da linha do zero = dia no lucro; toque numa barra para ver o dia.'}
      info={netOnly
        ? `Vendas menos Anúncios Meta e Anúncios Shopify de cada dia, no fuso da loja. Não é lucro: ${names} ${judged.length > 1 ? 'não têm' : 'não tem'} custos de produto, frete e taxas configurados, e eles ainda saem dessas vendas.`
        : 'Vendas menos todos os custos do dia, no fuso de cada loja. Reembolsos e chargebacks ficam fora das barras: entram no resultado de caixa.'}
    >
      <div className={s.chartWrap}>
        {netOnly ? (
          <NetBars
            days={days.map(d => ({ date: d.date, value: d.revenue - d.adSpend, revenue: d.revenue, metaSpend: d.metaSpend, shopSpend: d.shopSpend, orders: d.orders }))}
            partialDate={partialDay}
            partialNote={partialDay ? partialLabel(minutes) : undefined}
            today={data.anchorToday}
            ariaLabel={`Vendas menos anúncios por dia, ${data.rangeLabel}: sem custos configurados, não é lucro`}
          />
        ) : (
          <DailyProfitBars
            days={days.map(d => ({ date: d.date, profit: d.operatingProfit, revenue: d.revenue, metaSpend: d.metaSpend, shopSpend: d.shopSpend, orders: d.orders }))}
            partialDate={partialDay}
            partialNote={partialDay ? partialLabel(minutes) : undefined}
            today={data.anchorToday}
            width={340}
            height={210}
            ariaLabel={`Lucro real por dia, ${data.rangeLabel}`}
          />
        )}
      </div>
      {netOnly ? <NetBarsLegend partial={!!partialDay} /> : <DailyProfitLegend partial={!!partialDay} selected={false} />}
      {leftOut.length > 0 && (
        <p className={s.note} style={{ marginTop: 8 }}>{leftOut.map(r => r.name).join(' e ')} {leftOut.length > 1 ? 'ficam' : 'fica'} fora das barras, como do número do topo: sem custos configurados.</p>
      )}
      {netOnly && (
        <p className={s.note} style={{ marginTop: 8 }}>Sem custos configurados, uma barra azul não quer dizer lucro: o produto, o frete e as taxas ainda não saíram.</p>
      )}
    </Block>
  )
}

/** The archive day of a lone archived store when the whole window is after
 *  it (nothing was read in it), else null: the verdict's `frozen` rule
 *  (lib/views/verdict) for the blocks that do not get the verdict. */
export function frozenSince(data: Data): string | null {
  const lone = data.stores.length === 1 ? data.stores[0] : null
  return lone?.archived && lone.archivedOn && data.range.from > lone.archivedOn ? lone.archivedOn : null
}

/** "Sem dados de 17–23 nov: a loja está arquivada desde 10 nov" for a window
 *  frozenSince finds, else null: one wording for every empty block of such a
 *  window (the daily chart, refunds, the detail tabs). */
export function frozenTitle(data: Data): string | null {
  const on = frozenSince(data)
  return on ? `Sem dados de ${data.rangeLabel}: a loja está arquivada desde ${dateBeside(on, [data.range.from, data.range.to], data.anchorToday)}` : null
}

/**
 * "A loja ainda não vendia em 1–6 nov (1ª venda em 7 nov)" when the whole
 * window is before the first sale of the store (or of every store), else
 * null: the verdict's beforeStart rule (lib/views/verdict notSellingYet) for
 * the blocks that do not get the verdict. Under "A Hibikura começou a vender
 * em 7 nov" the daily chart read "Nenhuma venda e nenhum gasto em 1–6 nov"
 * and the refunds "Nenhum reembolso ou chargeback chegou no período", as for
 * a dead window; the desktop Resumo says the store was not selling yet.
 */
export function notYetTitle(data: Data): string | null {
  if (!data.stores.length || !data.stores.every(r => notSellingYet(r, data.range))) return null
  const first = data.stores.map(r => r.firstOrderDate!).reduce((a, b) => (b < a ? b : a))
  const who = data.stores.length > 1 ? 'As lojas ainda não vendiam' : 'A loja ainda não vendia'
  return `${who} em ${data.rangeLabel} (1ª venda em ${dateBeside(first, [data.range.from, data.range.to], data.anchorToday)})`
}

/** The archive day of a lone archived store when the window runs past it
 *  (read up to that day, nothing after), else null — the verdict's frozenTail. */
function frozenTailOf(data: Data): string | null {
  const lone = data.stores.length === 1 ? data.stores[0] : null
  const on = lone?.archived ? lone.archivedOn : null
  return on && data.range.from <= on && on < data.range.to ? on : null
}

/** "1–10 nov, até a loja ser arquivada" for a window that runs past the
 *  archive day, else the window's own label: only the days read had nothing. */
function readSpan(data: Data): string {
  const tail = frozenTailOf(data)
  return tail ? `${formatRangeLabel({ from: data.range.from, to: tail }, data.anchorToday)}, até a loja ser arquivada` : data.rangeLabel
}

/** "MOKOO e Glooty", "MOKOO, EPOCH e Glooty". */
function joinNames(names: string[]): string {
  return names.length <= 1 ? names.join('') : `${names.slice(0, -1).join(', ')} e ${names[names.length - 1]}`
}

// ─── What needs attention (several stores) ────────────────────────────────────

export function Attention({ data }: { data: Data }) {
  const phrase = periodPhrase(data.period, data.range, data.anchorToday)
  const singleDay = data.range.from === data.range.to
  const items: { key: string; tone: 'neg' | 'warn'; title: string; body: string }[] = []
  for (const r of data.stores) {
    // One rule with the store list and the desktop table (verdict
    // storeStatus): a store without costs whose ads passed its sales is "no
    // prejuízo" there too — on a running day as well, past 04h. This block
    // used to skip that case on a running day ("!(singleDay && r.partial)").
    const chip = storeStatus(r, { singleDay })
    if (isAllAnswer(data) && chip.code === 'prejuizo' && r.totals.adSpend > 0) {
      const t = r.totals
      const open = r.partial ? ' Dia ainda aberto.' : ''
      if (t.orders === 0) {
        items.push({
          key: `loss-${r.id}`, tone: 'neg',
          // "está no prejuízo ontem" read wrong: a closed window already happened.
          title: `${r.name} ${r.partial ? 'está' : 'ficou'} no prejuízo ${phrase}`,
          body: `Gastou ${formatMoney(t.adSpend)} em anúncios e não vendeu nada.${open}`,
        })
      } else if (!r.configured) {
        // Without costs only revenue − ads is known, and it is already below
        // zero: the real profit is lower still (Glooty lost $1.572 in 3–12
        // nov while this block named only Hibikura's $147).
        items.push({
          key: `loss-${r.id}`, tone: 'neg',
          title: `${r.name} ${r.partial ? 'está gastando mais em anúncios do que vende' : 'gastou mais em anúncios do que vendeu'} ${phrase}`,
          body: `Vendas ${formatMoney(t.revenue)} − anúncios ${formatMoney(t.adSpend)} = ${formatMoney(t.revenue - t.adSpend)}${r.partial ? ' até agora' : ''}, antes do custo dos produtos: o prejuízo real é maior. Configure os custos dela para ver o lucro.${open}`,
        })
      } else {
        const sr = storeRoas(t, r.configured)
        const roas = sr ? ` ${sr.text.replace(/^ROAS/, sr.label ?? 'ROAS')}.` : ''
        items.push({
          key: `loss-${r.id}`, tone: 'neg',
          title: `${r.name} ${r.partial ? 'está' : 'ficou'} no prejuízo ${phrase}`,
          body: `Gastou ${formatMoney(t.adSpend)} em anúncios e vendeu ${formatMoney(t.revenue)}.${roas}${open}`,
        })
      }
    }
    for (const b of r.badges) {
      if (b.code === 'sync_atrasado' || b.code === 'sync_falhando') {
        items.push({ key: `${b.code}-${r.id}`, tone: 'warn', title: `${r.name}: ${b.label.toLowerCase()}`, body: b.detail })
      }
    }
  }
  if (!items.length) return null
  return (
    <div className={s.stack} role="region" aria-label="Atenção">
      {items.slice(0, 5).map(i => (
        <Callout key={i.key} tone={i.tone} title={i.title}>{i.body}</Callout>
      ))}
    </div>
  )
}

// ─── Store list ───────────────────────────────────────────────────────────────

export function StoreList({ data, shared, onPick }: { data: Data; shared: SharedAds; onPick: (patch: Partial<Selection>) => void }) {
  if (data.stores.length < 2) return null
  const singleDay = data.range.from === data.range.to
  const running = singleDay && data.range.to === data.anchorToday
  // A store with no sale whose refunds or chargebacks took money out is news,
  // not an idle store: it ranks above the ones where nothing happened.
  const rank = (r: PortfolioStoreRow) => (active(r) ? 2 : noSalesCashHit(r.totals) ? 1 : 0)
  const rows = [...data.stores].sort((a, b) => rank(b) - rank(a) || b.totals.operatingProfit - a.totals.operatingProfit)
  // Stores already on another date (Hibikura from 12h in Brasília) open the
  // dates their row shows when their own clock would read the preset as other
  // dates (storeRowSelection), and the line says so.
  const shifted = rows.filter(r => rowOpensDates(r, data))
  return (
    <Block
      title={running ? 'Lojas hoje' : `Lojas · ${data.rangeLabel}`}
      howTo={`Cada loja no seu dia e no seu fuso. Toque numa loja para fixá-la${shifted.length
        ? ` (${joinNames(shifted.map(r => r.name))} ${shifted.length > 1 ? 'abrem' : 'abre'} nas mesmas datas, ${data.rangeLabel})`
        : ''}.`}
      flush
    >
      <ul className={s.list}>
        {rows.map(r => {
          const t = r.totals
          // "no prejuízo" + "custos não configurados" for a store without costs
          // whose ads passed its sales, as the desktop table shows it.
          // A store whose first sale came after the window "ainda não vendia",
          // as the verdict above and the desktop table say — not "sem vendas".
          const chips = storeStatusChips(r, { singleDay, range: data.range })
          const notYet = !!r.firstOrderDate && notSellingYet(r, data.range)
          const on = active(r)
          const dayLabel = dayOfLabel(r.timezone)
          const sr = t.orders > 0 ? storeRoas(t, r.configured) : null
          // No sale, but chargebacks or refunds arrived (CAMP HALLOW, 17–23
          // nov: 2 chargebacks, −$186): said on the row, as the desktop table
          // and the verdict say it, so the row does not read idle.
          const hit = noSalesCashHit(t)
          const pairBadges = shared.badges[r.id] ?? []
          return (
            <li key={r.id}>
              <button type="button" className={`${s.row} ${s.rowBtn}`} onClick={() => onPick(storeRowSelection(r, data))}
                aria-label={`Abrir ${r.name}${shifted.includes(r) ? ` em ${data.rangeLabel}` : ''}`}>
                <Avatar name={r.name} size="sm" />
                <span>
                  <span className={s.rowName}><StoreName name={r.name} /></span>
                  <span className={s.rowSub} style={{ display: 'block' }}>
                    {t.orders > 0
                      ? <><b>{plural(t.orders, 'pedido', 'pedidos')}</b> · vendas <b>{formatMoney(t.revenue)}</b></>
                      // With the year whenever the window or its comparison is in another
                      // year, as the verdict above prints it ("1ª venda em 11 abr 2026").
                      : notYet ? `ainda não vendia · 1ª venda em ${dateBeside(r.firstOrderDate!, [data.range.from, data.range.to, data.comparison.from, data.comparison.to], data.anchorToday)}`
                        : r.partial ? 'nenhuma venda ainda' : 'nenhuma venda no período'}
                    {/* No sale: "ROAS 0,00× · empate desconhecido" said nothing; the money
                        already spent does. */}
                    {t.orders === 0 && t.adSpend > 0 && <> · <b>{formatMoney(t.adSpend)}</b> em anúncios</>}
                    {hit && <><br />{hit.what ?? 'reembolsos e chargebacks'}: <b className="neg">{formatMoney(hit.amount)}</b> no caixa</>}
                    {/* ROAS on the store's ad channel (lib/views/adChannel), as the Resumo and
                        the verdict: Dumpling sells through Shop Campaigns and read "109×" on
                        its $56 of Meta. */}
                    {sr && <><br />{rowRoas(sr)}</>}
                    {t.orders > 0 && t.shopSpend > 0 && <><br />Anúncios Shopify {formatMoney(t.shopSpend)}{t.metaSpend > 0 && t.metaSpend < t.shopSpend ? ` · Meta ${formatMoney(t.metaSpend)}` : ''}</>}
                    {/* CAMP HALLOW read "sem anúncios" while its ads ran on EPOCH's account. */}
                    {t.adSpend === 0 && on && <><br />{noSpendLine(shared, r.id, t.orders, data.range)}</>}
                  </span>
                  {(dayLabel || pairBadges.length > 0 || r.badges.some(b => b.tone === 'warn' && b.code !== 'sem_custos')) && (
                    <span className={s.rowTags}>
                      {dayLabel && <Badge tone="info" icon="clock">{dayLabel}{r.dayClosed ? ' · encerrado' : ''}</Badge>}
                      {pairBadges.map(b => <Badge key={b.label} tone="info" icon="swap" title={b.detail}>{b.label}</Badge>)}
                      {r.badges.filter(b => b.code === 'sync_atrasado' || b.code === 'sync_falhando').map(b => (
                        <Badge key={b.code} tone="warn" icon="alert" title={b.detail}>{b.label}</Badge>
                      ))}
                    </span>
                  )}
                </span>
                <span className={s.rowVal}>
                  {on
                    ? <b><Money value={t.operatingProfit} sign tone={r.configured ? 'auto' : 'mut'} /></b>
                    : <b className={s.mutedVal}>—</b>}
                  {on && !r.configured && <small>vendas − anúncios</small>}
                  <VerdictChips chips={chips} size="sm" />
                </span>
              </button>
            </li>
          )
        })}
      </ul>
    </Block>
  )
}

// ─── Refunds and chargebacks that arrived ─────────────────────────────────────

export function RefundsBlock({ data }: { data: Data }) {
  const list = data.adjustmentsByStore
  const total = list.reduce((sum, a) => sum + a.adjustments, 0)
  const several = data.stores.length > 1
  const frozen = frozenTitle(data)
  // Before the first sale no order existed to refund or dispute.
  const notYet = notYetTitle(data)
  return (
    <Block
      title="Reembolsos e chargebacks"
      howTo="Os que chegaram no período, de pedidos de qualquer data. Já estão descontados no resultado de caixa."
      info="Um reembolso custa a margem que o pedido tinha deixado (o produto já foi comprado e enviado); um pedido reembolsado por inteiro sai do dia em que foi feito. Chargebacks custam o valor disputado mais a taxa."
      flush={list.length > 0}
    >
      {list.length === 0 ? (
        notYet || frozen
          // Nothing was read after the archive day, and nothing could arrive
          // before the first sale: not "none arrived".
          ? <EmptyState compact icon="clock" title={notYet ?? frozen ?? ''} />
          : <EmptyState compact icon="check" title={frozenTailOf(data)
            ? `Nenhum reembolso ou chargeback chegou em ${readSpan(data)}`
            : 'Nenhum reembolso ou chargeback chegou no período'} />
      ) : (
        <ul className={s.list}>
          {list.map(a => (
            <li key={a.storeId} className={`${s.row} ${s.rowNoAvatar}`}>
              <span>
                {several && <span className={s.rowName}><StoreName name={a.name} /></span>}
                <span className={s.rowSub} style={{ display: 'block' }}>
                  {a.refundCount > 0 && <>{plural(a.refundCount, 'reembolso', 'reembolsos')} · {formatMoney(a.refundGross)} devolvidos, custo de {formatMoney(a.refunds)}</>}
                  {a.refundCount > 0 && a.chargebackCount > 0 && <br />}
                  {a.chargebackCount > 0 && <>{plural(a.chargebackCount, 'chargeback', 'chargebacks')} · {formatMoney(a.chargebacks)} + {formatMoney(a.chargebackFees)} de taxa</>}
                </span>
              </span>
              <span className={s.rowVal}><b><Money value={-a.adjustments} /></b></span>
            </li>
          ))}
          {list.length > 1 && (
            <li className={`${s.row} ${s.rowNoAvatar}`}>
              <span className={s.rowName}>Total</span>
              <span className={s.rowVal}><b><Money value={-total} /></b></span>
            </li>
          )}
        </ul>
      )}
    </Block>
  )
}

// ─── Chargeback health (90 days) ──────────────────────────────────────────────

/** Rates the payment processors act on; past 1,5% Shopify Payments itself is at risk. */
const CB_WARN = 1
const CB_LIMIT = 1.5

function rateTone(rate: number): 'neg' | 'warn' | 'pos' {
  return rate >= CB_LIMIT ? 'neg' : rate >= CB_WARN ? 'warn' : 'pos'
}

/** Disputes listed before "Mostrar as outras N". */
const DUE_SHOWN = 4

/** ", sem Glooty e Hibikura, cujas disputas nunca foram lidas" after the
 *  summed rate, or nothing. */
function leftOutText(list: { name: string }[]): string {
  if (!list.length) return ''
  return `, sem ${joinNames(list.map(x => x.name))}, cujas disputas nunca foram lidas`
}

/** "5 da EPOCH ®️, 3 da CAMP HALLOW e 1 da MOKOO". */
function awaitingSplit(list: { name: string; count: number }[]): string {
  return joinNames(list.map(a => `${formatCount(a.count)} da ${a.name}`))
}

export function ChargebackBlock({ data, deviceTz, now }: { data: Data; deviceTz: string; now: number }) {
  const [allDue, setAllDue] = useState(false)
  const h = data.chargebackHealth
  // Deadlines are instants: shown on this phone's clock, with the hour.
  const at = new Date(now || data.generatedAt)
  const several = data.stores.length > 1
  // The server sends every dispute still in time (not the first 5): the
  // heading counts them all, so 4 lines never read as the whole to-do list.
  const due = h?.dueSoon ?? []
  const shownDue = allDue ? due : due.slice(0, DUE_SHOWN)
  const dueBlock = h && (due.length > 0 || h.overdue > 0) ? (
    <>
      {due.length > 0 && (
        <>
          <b>{plural(due.length, 'disputa espera', 'disputas esperam')} resposta e ainda {due.length === 1 ? 'está' : 'estão'} no prazo</b>
          {several && h.awaitingByStore.length > 1 && <> ({awaitingSplit(h.awaitingByStore)})</>}.{' '}
          {due.length > shownDue.length ? `As ${shownDue.length} de prazo mais curto` : due.length === 1 ? 'Prazo' : 'Prazos'} no horário de {tzCity(deviceTz)}:
          {shownDue.map(d => {
            // Never the UTC date: "2026-11-22 04:00:00+00" is 01h00 on the
            // 22nd in Brasília and was shown as "até 22 nov", as if the
            // whole 22nd were still available.
            const dueAt = d.dueBy ? dueByLabel(d.dueBy, deviceTz, at) : null
            return (
              <span key={`${d.storeId}|${d.externalId}`} style={{ display: 'block' }}>
                {d.currency === 'USD' ? formatMoney(d.amount) : `${d.currency} ${Math.round(d.amount)}`} · {disputeReasonText(d.reason)}
                {several ? ` · ${d.store}` : ''}{dueAt ? ` · ${dueAt}` : ''}
              </span>
            )
          })}
          {due.length > DUE_SHOWN && (
            <button type="button" className={s.linkBtn} onClick={() => setAllDue(v => !v)} aria-expanded={allDue}>
              {allDue ? `Mostrar só as ${DUE_SHOWN} mais urgentes` : `Mostrar ${due.length - DUE_SHOWN === 1 ? 'a outra' : `as outras ${due.length - DUE_SHOWN}`}`}
            </button>
          )}
        </>
      )}
      {h.overdue > 0 && (
        <span style={{ display: 'block' }}>
          {plural(h.overdue, 'disputa', 'disputas')} sem resposta já {h.overdue === 1 ? 'passou' : 'passaram'} do prazo.
        </span>
      )}
    </>
  ) : null
  // An archived store is not synced: its disputes are the ones read up to
  // the day it was archived, and new ones (it sold until shortly before) are
  // never read — nothing here is "agora".
  // Stores whose token cannot read Shopify Payments disputes (lib/adjustments
  // disputesReadable): said plainly, instead of only hedging a zero.
  const unreadable = h?.unreadable ?? []
  const unreadableNote = unreadable.length ? (
    <>O app não tem permissão para ler as disputas {several ? `de ${joinNames(unreadable.map(u => u.name))}` : 'desta loja'} no Shopify Payments: zero aqui não quer dizer que não houve nenhuma. Reconecte a loja em Ajustes, no computador, para dar a permissão.</>
  ) : null
  const allArchived = data.stores.length > 0 && data.stores.every(r => r.archived)
  const frozenOn = allArchived ? data.stores.map(r => r.archivedOn).filter((d): d is string => !!d).sort().pop() ?? null : null
  const frozenNote = allArchived ? (
    <>Loja arquivada{frozenOn ? ` em ${formatDate(frozenOn, data.anchorToday)}` : ''}: estas são as disputas lidas até lá. Disputas novas não são lidas, e o estado das abertas pode ter mudado.</>
  ) : null
  return (
    <Block
      title="Chargebacks · últimos 90 dias"
      howTo={`Cada loja é uma conta no Shopify Payments: acima de ${formatPct(CB_WARN)} acende o alerta, acima de ${formatPct(CB_LIMIT)} a conta corre risco.`}
      info="Contado por número de disputas sobre pedidos, que é como o limite é medido. Não depende do período escolhido acima."
      flush={!!h && h.byStore.length > 0}
    >
      {!h ? (
        <EmptyState compact icon="alert" title="Não foi possível ler os chargebacks agora">Os outros números não dependem disso.</EmptyState>
      ) : h.byStore.length === 0 ? (
        <>
          {/* A dispute read at some point (any date) says the token reads them:
              the empty 90 days is a clean record. hasData is the 90 days' own
              count, empty here by definition (an older cached answer has no
              everRead and keeps the hedge). */}
          {h.everRead ? (
            <EmptyState compact icon={unreadable.length ? 'alert' : 'check'} title="Nenhuma disputa nos últimos 90 dias">{unreadableNote}</EmptyState>
          ) : (
            // Not one dispute was ever read for these stores (Glooty, Hibikura):
            // that is also what a token without the disputes permission gives,
            // so the zero is not proof — no check icon, and say where to look.
            <EmptyState compact icon={unreadable.length ? 'alert' : 'info'}
              title={unreadable.length && !several ? 'Sem permissão para ler as disputas desta loja' : several ? 'Nenhuma disputa lida destas lojas' : 'Nenhuma disputa lida desta loja'}>
              {unreadableNote ?? 'O Opero só vê as disputas que o app da Shopify tem permissão para ler. Se em Ajustes (no computador) faltar a permissão de chargebacks, zero aqui não quer dizer que não houve nenhuma.'}
            </EmptyState>
          )}
          {/* A dispute opened before the 90 days can still be waiting. */}
          {dueBlock && <p className={s.note} style={{ marginTop: 8 }}>{dueBlock}</p>}
          {frozenNote && <p className={s.note} style={{ marginTop: 8 }}>{frozenNote}</p>}
        </>
      ) : (
        <>
          <ul className={s.list}>
            {h.byStore.map(b => {
              const tone = rateTone(b.rate)
              return (
                <li key={b.storeId} className={`${s.row} ${s.rowNoAvatar}`}>
                  <span>
                    <span className={s.rowName}><StoreName name={b.name} /></span>
                    <span className={s.rowSub} style={{ display: 'block' }}>
                      {formatCount(b.count)} de {formatCount(b.orders)} pedidos · {formatCount(b.open)} em aberto · {formatMoney(b.amount)} disputados
                    </span>
                  </span>
                  <span className={s.rowVal}>
                    <b className={tone === 'neg' ? 'neg' : tone === 'warn' ? 'warn' : undefined}>{formatPct(b.rate, { digits: 2 })}</b>
                    {tone === 'neg' && <Chip tone="neg" icon="alert" size="sm">acima do limite</Chip>}
                    {tone === 'warn' && <Chip tone="warn" icon="alert" size="sm">perto do limite</Chip>}
                  </span>
                  {/* Full row width, so every store's bar shares one scale on screen; the
                      tick in the middle is the 1,5% limit. */}
                  <span className={s.meter} aria-hidden="true">
                    <span className={s.meterFill} style={{ width: `${Math.min(100, (b.rate / (CB_LIMIT * 2)) * 100)}%`, background: `var(--${tone === 'pos' ? 'pos-m' : tone === 'neg' ? 'neg-m' : 'warn'})` }} />
                    <span className={s.meterMark} style={{ left: '50%' }} />
                  </span>
                </li>
              )
            })}
          </ul>
          <div style={{ padding: '10px 16px 14px', borderTop: '1px solid var(--line)' }} className={s.note}>
            {/* The orders of stores whose disputes were never read are out of
                the sum (portfolio combineHealth rateLeftOut): their zero is
                unknown, not "no dispute". */}
            {h.byStore.length > 1 && <>Somando as lojas: {formatPct(h.rate, { digits: 2 })} ({formatCount(h.count)} de {formatCount(h.orders)})
              {leftOutText(h.rateLeftOut ?? [])}, mas o limite vale por loja. </>}
            {formatCount(h.lost)} perdidas · {formatCount(h.won)} ganhas{h.lost + h.won > 0 && ` (${formatPct((h.won / (h.lost + h.won)) * 100, { digits: 0 })} de vitória)`}
            {/* Prevented disputes are in the count (and the rate) too; an older
                cached answer has no field. */}
            {(h.prevented ?? 0) > 0 && ` · ${plural(h.prevented ?? 0, 'evitada', 'evitadas')}`} · {formatMoney(h.fees)} em taxas.
            {dueBlock && <><br />{dueBlock}</>}
            {unreadableNote && <><br />{unreadableNote}</>}
            {frozenNote && <><br />{frozenNote}</>}
          </div>
        </>
      )}
    </Block>
  )
}

// ─── Live feed ────────────────────────────────────────────────────────────────

function orderTotal(o: LiveOrderItem): string {
  if (o.currency === 'USD') return formatMoney(o.total)
  try { return new Intl.NumberFormat('pt-BR', { style: 'currency', currency: o.currency, maximumFractionDigits: 0 }).format(o.total) }
  catch { return `${o.currency} ${Math.round(o.total)}` }
}

export function LiveFeed({ data, now, deviceTz }: { data: Data; now: number; deviceTz: string }) {
  const [all, setAll] = useState(false)
  // An archived store is not synced and has no feed: no promise of new sales.
  if (data.stores.length > 0 && data.stores.every(r => r.archived)) return null
  const several = data.stores.length > 1
  const items = all ? data.liveFeed : data.liveFeed.slice(0, 12)
  const speed = liveFeedSpeed(data.stores, data.freshness.storesWithoutLiveFeed)
  // One store on another clock: the whole screen (banner, "parcial · até",
  // the curve) is on the store's clock, so the sale times are too, and the
  // line above the list says which clock that is.
  const storeTz = !isAllAnswer(data) && data.stores.length === 1 ? data.stores[0].timezone : null
  const clockTz = storeTz && now && clockDiffers(storeTz, deviceTz, new Date(now)) ? storeTz : deviceTz
  return (
    <Block
      title={<span className={s.live}>Vendas ao vivo</span>}
      howTo={clockTz !== deviceTz
        ? `As mais recentes primeiro, no horário de ${tzCity(clockTz)}, como o resto da tela. ${speed.howTo}`
        : `As mais recentes primeiro. ${speed.howTo}`}
      flush={items.length > 0}
      footer={speed.footer ?? undefined}
    >
      {items.length === 0 ? (
        <EmptyState compact icon="clock" title={several ? 'Nenhuma venda recente' : 'Nenhuma venda recente nesta loja'} />
      ) : (
        <>
          <ul className={s.list}>
            {items.map(o => {
              const at = o.placedAt ?? o.receivedAt
              const line = feedLine(o.items)
              return (
                <li key={`${o.storeId}|${o.orderId}`}>
                  <div className={s.feedRow}>
                    <span className={s.feedTime}>{formatTimeInTz(at, clockTz)}<small>{now ? formatRelativeTime(at, new Date(now)) : ''}</small></span>
                    <span className={s.feedTitle}>
                      <span className={s.feedHead}>
                        <span className={s.feedName}>{line.name}</span>
                        {line.more && <span className={s.feedMore}>{line.more}</span>}
                      </span>
                      <small>{[line.units, several ? o.store : null, o.country, o.orderNumber, o.source === 'sync' ? 'via sincronização' : null].filter(Boolean).join(' · ')}</small>
                    </span>
                    <span className="num pos">{orderTotal(o)}</span>
                  </div>
                </li>
              )
            })}
          </ul>
          {data.liveFeed.length > 12 && (
            <button type="button" className={s.moreBtn} onClick={() => setAll(v => !v)}>
              {/* The feed stops at LIVE_FEED_SIZE sales: "todas (40)" claimed a
                  completeness the server never sends. */}
              {all ? 'Mostrar menos' : data.liveFeed.length >= LIVE_FEED_SIZE ? `Mostrar as ${data.liveFeed.length} mais recentes` : `Mostrar mais ${data.liveFeed.length - 12}`}
            </button>
          )}
        </>
      )}
    </Block>
  )
}
