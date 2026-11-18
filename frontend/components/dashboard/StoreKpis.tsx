/**
 * StoreKpis — the Resumo's key numbers, each with a one-line note under it and
 * the full definition in the ⓘ. Server component; every value comes from the
 * same engine pass as the verdict (lib/views/store StoreSummary).
 *
 * Partner split: only money RESULTS are halved (profit per order); revenue,
 * spend, margins and ROAS stay whole, as the owner decided.
 */

import type { ReactNode } from 'react'
import type { PageContext } from '@/lib/views/page'
import { CHANNEL_LABEL, empateGap, ledgerAdCents, type StoreSummary } from '@/lib/views/store'
import { formatCents, formatCount, formatMoney, formatNumber, formatRoas, plural } from '@/lib/format'
import { Count, Delta, Icon, KpiCard, Money, Pct, Roas } from '@/components/ui'
import { MiniBars, Sparkline } from '@/components/charts'
import { RoasVsEmpate } from './RoasVsEmpate'
import s from './dashboard.module.css'

/** "vs ontem até esta hora" / "vs 3–9 nov". */
export function comparisonShort(ctx: PageContext): string {
  return ctx.comparison.label === 'ontem até esta hora' ? 'vs ontem até esta hora' : `vs ${ctx.comparisonRangeLabel}`
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

function NotConfigured({ children }: { children: ReactNode }) {
  return <span className={s.cfg}><Icon name="sliders" size={12} />{children}</span>
}

export function StoreKpis({ ctx, summary }: { ctx: PageContext; summary: StoreSummary }) {
  const k = summary.kpis
  const p = k.previous
  const configured = summary.pnl.configured
  const daily = summary.pnl.daily
  const multiDay = daily.length > 2
  const vs = comparisonShort(ctx)
  const noOrders = k.orders === 0
  const lc = ledgerAdCents(summary.pnl.totals, configured)
  const gap = empateGap(configured, k.breakEven, summary.pnl.totals)

  return (
    <div className={s.kpis}>
      <KpiCard
        label="Receita"
        value={<Money value={k.revenue} />}
        note={noOrders
          ? 'nenhum pedido no período'
          : k.days > 1
            ? <span className={s.kpiNote}><b>{formatMoney(k.revenue / k.days)}</b> por dia em média</span>
            : 'pedidos pagos, impostos incluídos'}
        spark={multiDay ? <Sparkline values={daily.map(d => d.revenue)} ariaLabel="Receita por dia" /> : undefined}
        delta={p && !(k.revenue === 0 && p.revenue === 0) && <Delta current={k.revenue} previous={p?.revenue ?? null} label={vs} goodWhen="neutral" showPrevious />}
        info={<>Total pago pelos clientes nos pedidos não reembolsados nem cancelados, com impostos e frete, nas datas do fuso da loja.
          Um pedido reembolsado por inteiro sai do dia em que foi feito. Vendas em outra moeda entram convertidas em dólar.</>}
      />
      <KpiCard
        label="Pedidos e ticket"
        value={<Count value={k.orders} />}
        note={noOrders ? 'nenhum pedido no período' : (
          <span className={s.kpiNote}>ticket médio <b>{formatMoney(k.aov)}</b>{k.days > 1 && <> · <b>{k.ordersPerDay < 10 ? formatNumber(k.ordersPerDay, 1) : formatCount(k.ordersPerDay)}</b> por dia</>}</span>
        )}
        spark={multiDay ? <MiniBars values={daily.map(d => d.orders)} color="neu" width={0} height={30} ariaLabel="Pedidos por dia" /> : undefined}
        delta={p && !(k.orders === 0 && p.orders === 0) && <Delta current={k.orders} previous={p?.orders ?? null} label={vs} kind="count" goodWhen="neutral" showPrevious />}
        info="Pedidos pagos no período (reembolsados e cancelados não entram). Ticket médio = receita ÷ pedidos."
      />
      <KpiCard
        wide
        swatch={k.roasChannel === 'shop' ? 'shop' : 'meta'}
        label={k.roasChannel === 'both' ? 'ROAS dos anúncios (Meta + Shopify) × empate' : k.roasChannel === 'shop' ? 'ROAS dos Anúncios Shopify × empate' : 'ROAS do Meta × empate'}
        value={k.channelRoas === null ? <span className="mut">—</span> : <Roas value={k.channelRoas} />}
        note={k.channelRoas === null || !k.roasChannel
          ? 'sem gasto em anúncios no período'
          : (
            <span className={s.kpiWords}>
              Cada $1 em {k.roasChannel === 'both' ? 'anúncios (Meta e Shopify somados)' : CHANNEL_LABEL[k.roasChannel]} trouxe{' '}
              <b className="num">{formatMoney(k.channelRoas, { cents: 'always' })}</b> em vendas da loja (todas as vendas, não só as atribuídas).
              {k.roasChannel === 'both' && k.metaRoas !== null && <> Só o Meta: <b className="num">{formatRoas(k.metaRoas)}</b>, que credita ao Meta também as vendas dos Anúncios Shopify.</>}
              {k.roasChannel === 'meta' && k.shopSpend > 0 && <> Os <b className="num">{formatMoney(k.shopSpend)}</b> de Anúncios Shopify ficam fora deste ROAS e entram no lucro.</>}
              {k.roasChannel === 'shop' && k.metaSpend > 0 && <> Os <b className="num">{formatMoney(k.metaSpend)}</b> de Meta ficam fora deste ROAS e entram no lucro.</>}
            </span>
          )}
        spark={k.channelRoas !== null && k.roasChannel
          ? <RoasVsEmpate roas={k.channelRoas} breakEven={k.breakEven} gap={gap} label={k.roasChannel === 'both' ? 'ROAS dos anúncios' : `ROAS ${CHANNEL_LABEL[k.roasChannel]}`} />
          : undefined}
        footnote={p?.channelRoas != null ? `${vs}: ${formatRoas(p.channelRoas)}` : undefined}
        info={<>ROAS = receita da loja ÷ gasto em anúncios. Com um só canal gastando, é esse canal; com Meta e Anúncios Shopify gastando,
          é o gasto dos dois somado — dividir a receita só pelo Meta daria ao Meta as vendas que os Anúncios Shopify trouxeram.
          Empate = receita ÷ (receita − produto − frete − taxas): o ROAS em que os anúncios comem toda a margem. Acima dele, os anúncios deixam lucro
          antes dos custos fixos. Sem custos configurados, o empate é desconhecido.</>}
      />
      <KpiCard
        swatch="meta"
        label="Anúncios Meta"
        value={<Money value={k.metaSpend} />}
        note={k.metaSpend > 0
          ? <span className={s.kpiNote}><SpendShare cents={k.metaCents} ledgerCents={lc.meta} />{k.days > 1 && <> · <b>{formatMoney(k.metaPerDay)}</b>/dia</>}</span>
          : 'nenhum gasto no Meta no período'}
        spark={multiDay && k.metaSpend > 0 ? <Sparkline values={daily.map(d => d.metaSpend)} tone="meta" ariaLabel="Gasto no Meta por dia" /> : undefined}
        delta={!p || underADollar(k.metaSpend, p.metaSpend) ? undefined : <Delta current={k.metaSpend} previous={p?.metaSpend ?? null} label={vs} goodWhen="neutral" showPrevious />}
        info="Gasto em Facebook e Instagram das contas de anúncio da loja, dia a dia. Uma conta desligada deixa de ser coletada, mas o gasto que já teve continua nas contas."
      />
      <KpiCard
        swatch="shop"
        label="Anúncios Shopify"
        value={<Money value={k.shopSpend} />}
        note={k.shopSpend > 0
          ? <span className={s.kpiNote}><SpendShare cents={k.shopCents} ledgerCents={lc.shop} />{k.days > 1 && <> · <b>{k.shopDays}</b> de {k.days} dias com gasto</>}</span>
          : 'nenhum gasto com Shop Campaigns'}
        spark={multiDay && k.shopSpend > 0 ? <MiniBars values={daily.map(d => d.shopSpend)} color="shop" width={0} height={30} ariaLabel="Anúncios Shopify por dia" /> : undefined}
        delta={!p || underADollar(k.shopSpend, p.shopSpend) ? undefined : <Delta current={k.shopSpend} previous={p?.shopSpend ?? null} label={vs} goodWhen="neutral" showPrevious />}
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
        delta={p && k.adCostPerOrder !== null && <Delta current={k.adCostPerOrder} previous={p?.adCostPerOrder ?? null} label={vs} goodWhen="down" showPrevious />}
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
        delta={configured && p && k.margin !== null ? <Delta current={k.margin} previous={p.margin} label={vs} kind="pct" showPrevious /> : undefined}
        info={<>Margem = lucro real ÷ receita: quantos centavos de cada dólar vendido sobram depois de todos os custos (não muda na visão de sócio).
          Lucro por pedido = lucro real ÷ pedidos{ctx.split ? '; na visão de sócio, a sua metade' : ''}. {plural(k.orders, 'pedido', 'pedidos')} no período.</>}
      />
    </div>
  )
}
