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
  dayOfLabel, formatClock, formatCount, formatDate, formatMoney, formatPct, formatRelativeTime,
  formatTimeInTz, formatWeekdayDate, partialLabel, plural, tzCity,
} from '@/lib/format'
import { minutesIntoDay, todayInTz } from '@/lib/engine/dates'
import { judgedStores, periodPhrase, storeRoas, storeStatus, storeStatusChips, type RoasSummary, type Verdict } from '@/lib/views/verdict'
import type { MobileResponse } from '@/lib/views/mobile'
import type { IntradayAside, LiveOrderItem, PortfolioStoreRow } from '@/lib/views/portfolio'
import { LIVE_FEED_SIZE } from '@/lib/views/portfolioLimits'
import { clockDiffers, tzOffsetMinutes } from '../_lib/selection'
import { noSpendLine, pairNotes, type SharedAds } from '../_lib/sharedAds'
import { dueByLabel, feedLine } from '../_lib/labels'
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
  const cmpLabel = data.comparison.label === 'ontem até esta hora' ? 'Ontem até esta hora' : data.comparison.label.replace(/^./, c => c.toUpperCase())
  return (
    <VerdictCard
      verdict={v}
      compact
      headingLevel="h1"
      footer={
        <div className={s.pair}>
          <div className={s.pairCell}>
            <small>Vendas</small>
            <b>{formatMoney(t.revenue)}</b>
            <em>{plural(t.orders, 'pedido', 'pedidos')}</em>
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
  const notes = pairNotes(shared, { all, storeId: all ? null : data.stores[0].id }, data.rangeLabel, ordersOf)
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
          {formatMoney(c.revenue)} em vendas e <Money value={c.operatingProfit} /> de {data.stores.find(r => r.id === c.storeId)?.configured === false ? 'vendas − anúncios' : 'lucro'}.
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
  const partialDay = data.range.to >= data.anchorToday ? data.anchorToday : undefined
  const minutes = minutesIntoDay(data.anchorTimezone, new Date(data.generatedAt))
  // The bars follow the verdict above them: in a sum, a store without costs
  // is left out (its revenue − ads is not profit), so the bars add up to the
  // big number. A store judged alone without costs is drawn as revenue − ads.
  const days = data.dailyJudged
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
    return (
      <Block title={title}>
        <EmptyState compact icon="clock" title={`Nenhuma venda e nenhum gasto em ${data.rangeLabel}`} />
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

export function StoreList({ data, shared, onPick }: { data: Data; shared: SharedAds; onPick: (id: string) => void }) {
  if (data.stores.length < 2) return null
  const singleDay = data.range.from === data.range.to
  const running = singleDay && data.range.to === data.anchorToday
  const rows = [...data.stores].sort((a, b) =>
    Number(active(b)) - Number(active(a)) || b.totals.operatingProfit - a.totals.operatingProfit)
  return (
    <Block
      title={running ? 'Lojas hoje' : `Lojas · ${data.rangeLabel}`}
      howTo="Cada loja no seu dia e no seu fuso. Toque numa loja para fixá-la."
      flush
    >
      <ul className={s.list}>
        {rows.map(r => {
          const t = r.totals
          // "no prejuízo" + "custos não configurados" for a store without costs
          // whose ads passed its sales, as the desktop table shows it.
          const chips = storeStatusChips(r, { singleDay })
          const on = active(r)
          const dayLabel = dayOfLabel(r.timezone)
          const sr = t.orders > 0 ? storeRoas(t, r.configured) : null
          const pairBadges = shared.badges[r.id] ?? []
          return (
            <li key={r.id}>
              <button type="button" className={`${s.row} ${s.rowBtn}`} onClick={() => onPick(r.id)} aria-label={`Abrir ${r.name}`}>
                <Avatar name={r.name} size="sm" />
                <span>
                  <span className={s.rowName}><StoreName name={r.name} /></span>
                  <span className={s.rowSub} style={{ display: 'block' }}>
                    {t.orders > 0
                      ? <><b>{plural(t.orders, 'pedido', 'pedidos')}</b> · vendas <b>{formatMoney(t.revenue)}</b></>
                      : r.partial ? 'nenhuma venda ainda' : 'nenhuma venda no período'}
                    {/* No sale: "ROAS 0,00× · empate desconhecido" said nothing; the money
                        already spent does. */}
                    {t.orders === 0 && t.adSpend > 0 && <> · <b>{formatMoney(t.adSpend)}</b> em anúncios</>}
                    {/* ROAS on the store's ad channel (lib/views/adChannel), as the Resumo and
                        the verdict: Dumpling sells through Shop Campaigns and read "109×" on
                        its $56 of Meta. */}
                    {sr && <><br />{rowRoas(sr)}</>}
                    {t.orders > 0 && t.shopSpend > 0 && <><br />Anúncios Shopify {formatMoney(t.shopSpend)}{t.metaSpend > 0 && t.metaSpend < t.shopSpend ? ` · Meta ${formatMoney(t.metaSpend)}` : ''}</>}
                    {/* CAMP HALLOW read "sem anúncios" while its ads ran on EPOCH's account. */}
                    {t.adSpend === 0 && on && <><br />{noSpendLine(shared, r.id, t.orders)}</>}
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
  return (
    <Block
      title="Reembolsos e chargebacks"
      howTo="Os que chegaram no período, de pedidos de qualquer data. Já estão descontados no resultado de caixa."
      info="Um reembolso custa a margem que o pedido tinha deixado (o produto já foi comprado e enviado); um pedido reembolsado por inteiro sai do dia em que foi feito. Chargebacks custam o valor disputado mais a taxa."
      flush={list.length > 0}
    >
      {list.length === 0 ? (
        <EmptyState compact icon="check" title="Nenhum reembolso ou chargeback chegou no período" />
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

const REASON: Record<string, string> = {
  fraudulent: 'fraude', product_not_received: 'produto não recebido', product_unacceptable: 'produto diferente do anunciado',
  subscription_canceled: 'assinatura cancelada', duplicate: 'cobrança duplicada', credit_not_processed: 'reembolso não processado',
  unrecognized: 'cobrança não reconhecida', general: 'outro motivo', noncompliant: 'fora das regras',
}

function rateTone(rate: number): 'neg' | 'warn' | 'pos' {
  return rate >= CB_LIMIT ? 'neg' : rate >= CB_WARN ? 'warn' : 'pos'
}

/** Disputes listed before "Mostrar as outras N". */
const DUE_SHOWN = 4

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
                {d.currency === 'USD' ? formatMoney(d.amount) : `${d.currency} ${Math.round(d.amount)}`} · {Object.hasOwn(REASON, d.reason) ? REASON[d.reason] : d.reason}
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
          <EmptyState compact icon="check" title="Nenhuma disputa nos últimos 90 dias" />
          {/* A dispute opened before the 90 days can still be waiting. */}
          {dueBlock && <p className={s.note} style={{ marginTop: 8 }}>{dueBlock}</p>}
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
            {h.byStore.length > 1 && <>Somando as lojas: {formatPct(h.rate, { digits: 2 })} ({formatCount(h.count)} de {formatCount(h.orders)}), mas o limite vale por loja. </>}
            {formatCount(h.lost)} perdidas · {formatCount(h.won)} ganhas{h.lost + h.won > 0 && ` (${formatPct((h.won / (h.lost + h.won)) * 100, { digits: 0 })} de vitória)`} · {formatMoney(h.fees)} em taxas.
            {dueBlock && <><br />{dueBlock}</>}
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
  const several = data.stores.length > 1
  const items = all ? data.liveFeed : data.liveFeed.slice(0, 12)
  const noLive = data.freshness.storesWithoutLiveFeed
  // One store on another clock: the whole screen (banner, "parcial · até",
  // the curve) is on the store's clock, so the sale times are too, and the
  // line above the list says which clock that is.
  const storeTz = !isAllAnswer(data) && data.stores.length === 1 ? data.stores[0].timezone : null
  const clockTz = storeTz && now && clockDiffers(storeTz, deviceTz, new Date(now)) ? storeTz : deviceTz
  return (
    <Block
      title={<span className={s.live}>Vendas ao vivo</span>}
      howTo={clockTz !== deviceTz
        ? `As mais recentes primeiro, no horário de ${tzCity(clockTz)}, como o resto da tela. Cada venda nova aparece em segundos.`
        : 'As mais recentes primeiro. Cada venda nova aparece em segundos.'}
      flush={items.length > 0}
      footer={noLive.length > 0
        ? `${noLive.map(n => n.name).join(', ')} ${noLive.length > 1 ? 'não avisam' : 'não avisa'} vendas na hora: os pedidos aparecem com a sincronização, até 10 minutos depois.`
        : undefined}
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
