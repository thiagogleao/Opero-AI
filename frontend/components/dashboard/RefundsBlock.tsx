/**
 * RefundsBlock — refunds and chargebacks: what ARRIVED in the period (dated
 * when it arrived, as the books keep it), the cash result it leaves, and the
 * store's 90-day chargeback health with EVERY dispute still answerable (the
 * soonest four, then "Mostrar as outras N") and a count of those past their
 * deadline.
 *
 * The period part is synchronous (it is in the window's engine totals), except
 * the status today of the period's chargebacks (WindowDisputes, one small
 * query, streams); the 90-day health is a property of the store, not of the
 * period, and streams in its own <Suspense> (ChargebackHealthPart). Both name
 * every status, so their parts add up to the count next to them.
 *
 * Partner split: refund cost and cash result are money results and are halved;
 * dispute counts, rates and the amounts disputed are facts and stay whole.
 */

import { Suspense } from 'react'
import type { PageContext } from '@/lib/views/page'
import type { StoreSummary } from '@/lib/views/store'
import { CHARGEBACK_LIMIT_PCT, CHARGEBACK_WATCH_PCT, dueInTz, loadChargebacks } from '@/lib/views/store'
import { getWindowDisputeStatuses, type ChargebackHealth } from '@/lib/adjustments'
import { formatClock, formatCount, formatDate, formatMoney, formatNumber, formatPct, plural } from '@/lib/format'
import { Block, Callout, Chip, ErrorState, Money, Skeleton } from '@/components/ui'
import { disputeReasonText } from '@/lib/views/verdict'
import { archiveMoment, findStore } from '@/lib/period'
import { healthParts, rateWithoutPrevented, windowStatusText, type ArchivedAt } from './disputes'
import { emptyWindowText, type EmptyWindow } from './emptyWindow'
import s from './dashboard.module.css'

export function RefundsBlock({ ctx, summary, empty = null }: {
  ctx: PageContext; summary: StoreSummary
  /** The verdict's reason the window is empty (./emptyWindow emptyWindowOf). */
  empty?: EmptyWindow | null
}) {
  const t = summary.pnl.totals
  const configured = summary.pnl.configured
  // R10: the "as of" of an archived store is its archive instant (day beside
  // this window, time on its clock), from the store facts.
  const facts = summary.row.archived ? findStore(ctx.viewerStores, summary.store.id) : null
  const moment = facts ? archiveMoment(facts, { window: ctx.range, comparison: ctx.comparison, clockToday: ctx.today }) : null
  const archivedAt: ArchivedAt | null = summary.row.archived ? { day: moment?.day ?? null, time: moment?.time ?? null } : null
  const none = t.refundCount === 0 && t.chargebackCount === 0
  // Before the first sale nothing can be refunded, and after an archived
  // store's archive day nothing is read: "nenhum reembolso chegou" would
  // claim a reading that never happened. Whatever did arrive is still shown.
  const why = empty && none ? emptyWindowText(empty, ctx.rangeLabel).note : null
  // Nothing happened at all (a day that just started): "$0" would be the fake
  // zero the verdict above already refuses ("—, nenhum pedido até agora").
  const idle = none && t.orders === 0 && t.revenue <= 0 && t.adSpend <= 0 && t.fixedCosts <= 0
  // The amounts in the note are the store's whole facts; only the big number
  // above them is halved — say which is which.
  const half = ctx.split ? ' · o valor acima é a sua metade' : ''
  return (
    <Block
      title="Reembolsos e chargebacks"
      howTo={`O que chegou em ${ctx.rangeLabel}, no dia em que chegou — não no dia da venda. O resultado de caixa é o lucro real menos isso.`}
      info={<>Um reembolso custa a margem do pedido (o produto e o frete voltam com a venda; o anúncio já gasto não volta){configured ? '' : '; sem custos configurados, custa o valor inteiro'}.
        Um pedido reembolsado por inteiro já saiu do dia em que foi feito e não é descontado de novo. Um chargeback custa o valor disputado mais a taxa, a menos que a disputa seja ganha.</>}
    >
      <div className={s.adjGrid}>
        <div className={s.adjItem}>
          <span className="lbl">Reembolsos</span>
          <span className={s.adjValue}>{t.refundCount ? <Money value={-ctx.part(t.refunds)} tone="auto" /> : <span className="mut">{why ? '—' : 'nenhum'}</span>}</span>
          <span className={s.adjNote}>
            {t.refundCount
              ? <>{plural(t.refundCount, 'reembolso', 'reembolsos')}, <b>{formatMoney(t.refundGross)}</b> devolvidos aos clientes; no lucro pesa a margem que voltou{half}</>
              : why ?? 'nenhum reembolso chegou no período'}
          </span>
        </div>
        <div className={s.adjItem}>
          <span className="lbl">Chargebacks</span>
          <span className={s.adjValue}>{t.chargebackCount ? <Money value={-ctx.part(t.chargebacks + t.chargebackFees)} tone="auto" /> : <span className="mut">{why ? '—' : 'nenhum'}</span>}</span>
          {/* Every chargeback that arrived and was not won weighs here, open
              or closed: calling them all "disputas abertas" read 37 open for
              EPOCH's October, where 16 were. The split streams below. */}
          <span className={s.adjNote}>
            {t.chargebackCount
              ? <>{plural(t.chargebackCount, 'disputa pesa', 'disputas pesam')} no período: <b>{formatMoney(t.chargebacks)}</b> disputados + <b>{formatMoney(t.chargebackFees)}</b> em taxas{half}</>
              : why ?? 'nenhuma disputa pesa no período'}
          </span>
          <Suspense fallback={null}>
            <WindowDisputes storeId={summary.store.id} from={ctx.range.from} to={ctx.range.to}
              archived={archivedAt} />
          </Suspense>
        </div>
        <div className={s.adjItem}>
          <span className="lbl">Resultado de caixa{ctx.split ? ' (sua parte)' : ''}</span>
          <span className={s.adjValue}>
            {configured && !idle && !why ? <Money value={ctx.part(t.cashResult)} tone="auto" /> : <span className="mut">—</span>}
          </span>
          <span className={s.adjNote}>
            {why ?? (configured
              ? idle
                ? <>sem vendas, anúncios, reembolsos nem chargebacks no período</>
                : none
                ? <>igual ao lucro real: nada chegou para descontar</>
                : <>lucro real <b>{formatMoney(ctx.part(t.operatingProfit))}</b> − <b>{formatMoney(ctx.part(t.adjustments))}</b> de reembolsos e chargebacks</>
              : 'sem custos configurados não há lucro real de onde descontar')}
          </span>
        </div>
      </div>
      <Suspense fallback={<div className={s.health}><Skeleton width={220} height={14} /><Skeleton height={6} /><Skeleton width="60%" height={11} /></div>}>
        <ChargebackHealthPart storeId={summary.store.id} today={ctx.today} timezone={ctx.timezone}
          archived={archivedAt} />
      </Suspense>
    </Block>
  )
}

/**
 * What became of the period's chargebacks, by their status today (streams:
 * one small query). The parts that cost add up to the count above; the won
 * ones, which cost nothing, are said apart. Nothing on failure: the line
 * above is complete without it.
 */
async function WindowDisputes({ storeId, from, to, archived }: {
  storeId: string; from: string; to: string
  /** An archived store: the status is the one read when it was archived. */
  archived: ArchivedAt | null
}) {
  let text: string | null
  try {
    text = windowStatusText(await getWindowDisputeStatuses(storeId, from, to), archived)
  } catch (err) {
    console.error('[resumo] period disputes', err)
    return null
  }
  return text ? <span className={s.adjNote}>{text}</span> : null
}

/** A dispute's deadline in words. The list holds only disputes still in time
 *  (lib/adjustments getChargebackHealth), but one whose deadline passed while
 *  the page was open still says so instead of "até 10 nov". */
function DueBy({ dueBy, today, timezone }: { dueBy: string | null; today: string; timezone: string }) {
  const due = dueBy ? dueInTz(dueBy, timezone) : null
  if (!due) return <span className="mut">sem prazo informado</span>
  // The deadline is an instant: the hour on the store's clock says how much
  // of that day is really left.
  const at = `${formatDate(due.date, today)}, ${formatClock(due.minutes)}`
  if (due.date < today) return <span className="neg">prazo venceu em {at}</span>
  if (due.date === today) return <span className="neg">até hoje, {formatClock(due.minutes)}</span>
  return <span className="warn">até {at}</span>
}

/** Disputes listed before "Mostrar as outras N". */
const DUE_SHOWN = 4

function DueRow({ d, today, timezone }: { d: ChargebackHealth['dueSoon'][number]; today: string; timezone: string }) {
  return (
    <div className={s.dueRow}>
      <b className="num">{d.currency && d.currency.toUpperCase() !== 'USD' ? `${d.currency.toUpperCase()} ${formatNumber(d.amount)}` : formatMoney(d.amount)}</b>
      {/* The phone's words too (lib/views/verdict): CAMP HALLOW's dispute read
          "produto não aceitável" on one screen only. */}
      <span>{d.reason ? disputeReasonText(d.reason) : 'motivo não informado'}</span>
      <DueBy dueBy={d.dueBy} today={today} timezone={timezone} />
    </div>
  )
}

async function ChargebackHealthPart({ storeId, today, timezone, archived }: {
  storeId: string; today: string; timezone: string
  /** An archived store (its archive instant when known): it is not read any
   *  more, so nothing about its disputes is "agora". */
  archived: ArchivedAt | null
}) {
  let data
  try {
    data = await loadChargebacks(storeId)
  } catch (err) {
    console.error('[resumo] chargeback health', err)
    return <div className={s.health}><ErrorState compact title="Saúde de chargebacks indisponível" /></div>
  }
  const h = data.health
  // Every dispute still in time, soonest first (not the first five), and the
  // ones past their deadline counted apart.
  const due = h.dueSoon
  const overdue = h.overdue ?? 0
  const scaleMax = CHARGEBACK_LIMIT_PCT * 2
  const fill = Math.min(100, (h.rate / scaleMax) * 100)
  const withoutPrevented = rateWithoutPrevented(h)
  // Not one dispute was ever read for this store (Glooty, Hibikura): a token
  // without the disputes permission gives the same zero, so no "0,00%", no
  // empty gauge and no reassuring chip — the callout below says why.
  const unread = data.neverSeen
  // The latest refunds/disputes pass hit the 403 (lib/adjustments
  // disputesReadable): the token cannot read disputes at all — said plainly.
  const forbidden = h.readable === false
  const levelChip = forbidden
    ? <Chip tone="warn" icon="alert" size="sm">sem permissão para ler disputas</Chip>
    : unread
    ? <Chip tone="neu" icon="info" size="sm">nenhuma disputa lida</Chip>
    : data.level === 'over'
    ? <Chip tone="neg" icon="alert" size="sm">acima do limite</Chip>
    : data.level === 'watch'
      ? <Chip tone="warn" icon="alert" size="sm">perto do limite</Chip>
      : data.level === 'ok'
        ? <Chip tone="pos" icon="check" size="sm">dentro do limite</Chip>
        : <Chip tone="neu" icon="ring" size="sm">nenhuma disputa</Chip>

  return (
    <div className={s.health}>
      <div className={s.healthHead}>
        <span>
          <span className="lbl">Chargebacks nos últimos 90 dias</span>{' '}{levelChip}
        </span>
        <span>
          {unread ? <>
            <span className={`${s.healthRate} mut`}>—</span>
            <span className="mut"> · {formatCount(h.orders)} pedidos</span>
          </> : <>
            <span className={`${s.healthRate} ${data.level === 'over' ? 'neg' : data.level === 'watch' ? 'warn' : ''}`}>{formatPct(h.rate, { digits: 2 })}</span>
            <span className="mut"> · {formatCount(h.count)} de {formatCount(h.orders)} pedidos</span>
          </>}
        </span>
      </div>
      {!unread && <div>
        <div className={s.rateTrack} role="img" aria-label={`Taxa de chargeback ${formatPct(h.rate, { digits: 2 })}; limite do Shopify Payments ${formatPct(CHARGEBACK_LIMIT_PCT)}`}>
          <span className={`${s.rateFill} ${data.level === 'over' ? s.rateOver : data.level === 'watch' ? s.rateWatch : s.rateOk}`} style={{ width: `${fill}%` }} />
          <span className={s.rateMark} style={{ left: `${(CHARGEBACK_WATCH_PCT / scaleMax) * 100}%`, opacity: 0.5 }} />
          <span className={s.rateMark} style={{ left: '50%' }} />
        </div>
        <div className={s.rateScale}><span>0%</span><span>limite {formatPct(CHARGEBACK_LIMIT_PCT)}</span><span>{formatPct(scaleMax)}</span></div>
      </div>}
      <span className={s.adjNote}>
        Taxa por contagem de pedidos, a que o processador acompanha, por loja.
        {/* Every status is named, so the parts add up to the count; the
            prevented ones are in the rate (the prudent side) and the rate
            without them is given, since the data does not say whether the
            processor counts them. */}
        {h.count > 0 && <> {healthParts(h).join(' · ')} · <b>{formatMoney(h.amount)}</b> disputados + <b>{formatMoney(h.fees)}</b> em taxas.</>}
        {withoutPrevented !== null && <> As evitadas entram na taxa; sem elas, {formatPct(withoutPrevented, { digits: 2 })}.</>}
      </span>
      {h.open > 0 && due.length === 0 && overdue === 0 && (
        <span className={s.adjNote}>
          {archived
            ? `${archived.day ? `Até ${archived.day}${archived.time ? ` às ${archived.time}` : ''}, quando` : 'Quando'} a loja foi arquivada, nenhuma das abertas esperava resposta da loja.`
            : 'Nenhuma das abertas espera resposta da loja agora: estão em análise.'}
        </span>
      )}
      {due.length > 0 && (
        <div className={s.due}>
          <span className="lbl">Esperando resposta da loja · {plural(due.length, 'disputa no prazo', 'disputas no prazo')}</span>
          {due.slice(0, DUE_SHOWN).map(d => <DueRow key={d.externalId} d={d} today={today} timezone={timezone} />)}
          {due.length > DUE_SHOWN && (
            // Native disclosure: the whole list without client code.
            <details className={s.dueMore}>
              <summary>
                <span className={s.whenClosed}>Mostrar {due.length - DUE_SHOWN === 1 ? 'a outra' : `as outras ${due.length - DUE_SHOWN}`}</span>
                <span className={s.whenOpen}>Esconder {due.length - DUE_SHOWN === 1 ? 'a outra' : `as outras ${due.length - DUE_SHOWN}`}</span>
              </summary>
              <div className={s.due}>
                {due.slice(DUE_SHOWN).map(d => <DueRow key={d.externalId} d={d} today={today} timezone={timezone} />)}
              </div>
            </details>
          )}
        </div>
      )}
      {overdue > 0 && (
        <span className={s.adjNote}>
          <b className="neg">{plural(overdue, 'disputa', 'disputas')}</b> sem resposta já {overdue === 1 ? 'passou' : 'passaram'} do prazo: não dá mais para enviar a defesa.
        </span>
      )}
      {forbidden ? (
        <Callout tone="warn">
          O app não tem permissão para ler as disputas desta loja no Shopify Payments: {unread ? 'zero aqui não prova que não houve nenhuma' : 'disputas novas não estão sendo lidas, e o estado das abertas pode ter mudado'}.
          Reconecte a loja em Ajustes para dar a permissão.
        </Callout>
      ) : data.neverSeen && (
        <Callout tone="neu">Nenhuma disputa foi lida desta loja até hoje. Se o app não tiver permissão para ler disputas na Shopify, zero aqui não prova que não houve.</Callout>
      )}
    </div>
  )
}
