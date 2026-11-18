/**
 * RefundsBlock — refunds and chargebacks: what ARRIVED in the period (dated
 * when it arrived, as the books keep it), the cash result it leaves, and the
 * store's 90-day chargeback health with the disputes still answerable.
 *
 * The period part is synchronous (it is in the window's engine totals); the
 * 90-day health is a property of the store, not of the period, and streams in
 * its own <Suspense> (ChargebackHealthPart).
 *
 * Partner split: refund cost and cash result are money results and are halved;
 * dispute counts, rates and the amounts disputed are facts and stay whole.
 */

import { Suspense } from 'react'
import type { PageContext } from '@/lib/views/page'
import type { StoreSummary } from '@/lib/views/store'
import { CHARGEBACK_LIMIT_PCT, CHARGEBACK_WATCH_PCT, dueInTz, loadChargebacks } from '@/lib/views/store'
import { formatClock, formatDate, formatMoney, formatNumber, formatPct, plural } from '@/lib/format'
import { Block, Callout, Chip, ErrorState, Money, Skeleton } from '@/components/ui'
import s from './dashboard.module.css'

/** Shopify's dispute reason codes, in words. Unknown codes are shown as they come. */
const REASON: Record<string, string> = {
  product_unacceptable: 'produto não aceitável',
  product_not_received: 'produto não recebido',
  fraudulent: 'fraude (compra não reconhecida)',
  unrecognized: 'cobrança não reconhecida',
  credit_not_processed: 'reembolso não processado',
  duplicate: 'cobrança duplicada',
  subscription_canceled: 'assinatura cancelada',
  general: 'motivo geral',
  noncompliant: 'fora das regras da bandeira',
  customer_initiated: 'iniciada pelo cliente',
  debit_not_authorized: 'débito não autorizado',
}

export function RefundsBlock({ ctx, summary }: { ctx: PageContext; summary: StoreSummary }) {
  const t = summary.pnl.totals
  const configured = summary.pnl.configured
  const none = t.refundCount === 0 && t.chargebackCount === 0
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
          <span className={s.adjValue}>{t.refundCount ? <Money value={-ctx.part(t.refunds)} tone="auto" /> : <span className="mut">nenhum</span>}</span>
          <span className={s.adjNote}>
            {t.refundCount
              ? <>{plural(t.refundCount, 'reembolso', 'reembolsos')}, <b>{formatMoney(t.refundGross)}</b> devolvidos aos clientes; no lucro pesa a margem que voltou{half}</>
              : 'nenhum reembolso chegou no período'}
          </span>
        </div>
        <div className={s.adjItem}>
          <span className="lbl">Chargebacks</span>
          <span className={s.adjValue}>{t.chargebackCount ? <Money value={-ctx.part(t.chargebacks + t.chargebackFees)} tone="auto" /> : <span className="mut">nenhum</span>}</span>
          <span className={s.adjNote}>
            {t.chargebackCount
              ? <>{plural(t.chargebackCount, 'disputa aberta', 'disputas abertas')}: <b>{formatMoney(t.chargebacks)}</b> disputados + <b>{formatMoney(t.chargebackFees)}</b> em taxas{half}</>
              : 'nenhuma disputa aberta no período'}
          </span>
        </div>
        <div className={s.adjItem}>
          <span className="lbl">Resultado de caixa{ctx.split ? ' (sua parte)' : ''}</span>
          <span className={s.adjValue}>
            {configured && !idle ? <Money value={ctx.part(t.cashResult)} tone="auto" /> : <span className="mut">—</span>}
          </span>
          <span className={s.adjNote}>
            {configured
              ? idle
                ? <>sem vendas, anúncios, reembolsos nem chargebacks no período</>
                : none
                ? <>igual ao lucro real: nada chegou para descontar</>
                : <>lucro real <b>{formatMoney(ctx.part(t.operatingProfit))}</b> − <b>{formatMoney(ctx.part(t.adjustments))}</b> de reembolsos e chargebacks</>
              : 'sem custos configurados não há lucro real de onde descontar'}
          </span>
        </div>
      </div>
      <Suspense fallback={<div className={s.health}><Skeleton width={220} height={14} /><Skeleton height={6} /><Skeleton width="60%" height={11} /></div>}>
        <ChargebackHealthPart storeId={summary.store.id} today={ctx.today} timezone={ctx.timezone} />
      </Suspense>
    </Block>
  )
}

/** A dispute's deadline in words. The list is every dispute still marked
 *  "needs response", so one whose deadline already passed says so instead of
 *  "até 10 nov" under a heading that promises it can still be answered. */
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

async function ChargebackHealthPart({ storeId, today, timezone }: { storeId: string; today: string; timezone: string }) {
  let data
  try {
    data = await loadChargebacks(storeId)
  } catch (err) {
    console.error('[resumo] chargeback health', err)
    return <div className={s.health}><ErrorState compact title="Saúde de chargebacks indisponível" /></div>
  }
  const h = data.health
  const scaleMax = CHARGEBACK_LIMIT_PCT * 2
  const fill = Math.min(100, (h.rate / scaleMax) * 100)
  const levelChip = data.level === 'over'
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
          <span className={`${s.healthRate} ${data.level === 'over' ? 'neg' : data.level === 'watch' ? 'warn' : ''}`}>{formatPct(h.rate, { digits: 2 })}</span>
          <span className="mut"> · {h.count} de {formatNumber(h.orders)} pedidos</span>
        </span>
      </div>
      <div>
        <div className={s.rateTrack} role="img" aria-label={`Taxa de chargeback ${formatPct(h.rate, { digits: 2 })}; limite do Shopify Payments ${formatPct(CHARGEBACK_LIMIT_PCT)}`}>
          <span className={`${s.rateFill} ${data.level === 'over' ? s.rateOver : data.level === 'watch' ? s.rateWatch : s.rateOk}`} style={{ width: `${fill}%` }} />
          <span className={s.rateMark} style={{ left: `${(CHARGEBACK_WATCH_PCT / scaleMax) * 100}%`, opacity: 0.5 }} />
          <span className={s.rateMark} style={{ left: '50%' }} />
        </div>
        <div className={s.rateScale}><span>0%</span><span>limite {formatPct(CHARGEBACK_LIMIT_PCT)}</span><span>{formatPct(scaleMax)}</span></div>
      </div>
      <span className={s.adjNote}>
        Taxa por contagem de pedidos, a que o processador acompanha, por loja.
        {h.count > 0 && <> {h.open} em aberto · {h.lost} perdidas · {h.won} ganhas · <b>{formatMoney(h.amount)}</b> disputados + <b>{formatMoney(h.fees)}</b> em taxas.</>}
      </span>
      {h.open > 0 && h.dueSoon.length === 0 && (
        <span className={s.adjNote}>Nenhuma das abertas espera resposta da loja agora: estão em análise.</span>
      )}
      {h.dueSoon.length > 0 && (
        <div className={s.due}>
          <span className="lbl">Esperando resposta da loja</span>
          {h.dueSoon.map(d => (
            <div key={d.externalId} className={s.dueRow}>
              <b className="num">{d.currency && d.currency.toUpperCase() !== 'USD' ? `${d.currency.toUpperCase()} ${formatNumber(d.amount)}` : formatMoney(d.amount)}</b>
              <span>{d.reason ? REASON[d.reason] ?? d.reason.replace(/_/g, ' ') : 'motivo não informado'}</span>
              <DueBy dueBy={d.dueBy} today={today} timezone={timezone} />
            </div>
          ))}
        </div>
      )}
      {data.neverSeen && (
        <Callout tone="neu">Nenhuma disputa foi lida desta loja até hoje. Se o app não tiver permissão para ler disputas na Shopify, zero aqui não prova que não houve.</Callout>
      )}
    </div>
  )
}
